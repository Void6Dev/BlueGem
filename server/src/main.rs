//! Встроенный сервер BlueGem.
//!
//! Electron запускает его сам (electron/backend.js) и гасит при выходе.
//! Всё, что нужно знать серверу, приходит через переменные окружения:
//!
//!   BG_HOST        адрес прослушивания, по умолчанию 127.0.0.1
//!   BG_PORT        порт; 0 — выбрать свободный самостоятельно
//!   BG_TOKEN       общий секрет, без него запросы к /api отклоняются
//!   BG_STATIC_DIR  каталог собранного интерфейса (frontend/build)
//!   SQLITE_PATH    файл базы в профиле пользователя
//!   BG_VERSION     версия приложения для GET /api/
//!   BG_WATCH_PARENT=1  гаснуть, когда закрылся stdin (оболочку сняли)
//!   CORS_ORIGINS   через запятую; по умолчанию «*»
//!
//! Протокол с оболочкой тот же, что был у Python-сервера: строки BG_BOOT /
//! BG_FATAL / BG_STOPPED в stdout, код 98 — порт занят, 99 — прочий отказ.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod catalog;
mod error;
mod routes;
mod store;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::Router;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

const EXIT_PORT_BUSY: i32 = 98;
const EXIT_FAILED: i32 = 99;

/// Строка для лога Electron. Никогда не падает — это всего лишь лог.
pub fn emit(line: &str) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

/// Версия: её передаёт оболочка; из исходников — читается из package.json.
fn app_version() -> String {
    let v = env("BG_VERSION");
    if !v.trim().is_empty() {
        return v.trim().to_string();
    }
    let pkg = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("package.json");
    std::fs::read_to_string(pkg)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v["version"].as_str().map(String::from))
        .unwrap_or_else(|| "dev".into())
}

/* ---------------- токен ---------------- */

/// Сервер слушает только 127.0.0.1, но достучаться до него может любой
/// локальный процесс — в том числе страница в браузере. Токен знает только
/// оболочка, которая сервер запустила.
async fn require_token(State(token): State<Arc<String>>, req: Request, next: Next) -> Response {
    let path = req.uri().path();
    if path.starts_with("/api") && req.method() != Method::OPTIONS {
        let header_ok = req.headers().get("x-bg-token").and_then(|v| v.to_str().ok()) == Some(token.as_str());
        let query_ok = req.uri().query().is_some_and(|q| {
            q.split('&').any(|kv| kv.split_once('=').is_some_and(|(k, v)| k == "token" && v == token.as_str()))
        });
        if !header_ok && !query_ok {
            return (
                StatusCode::FORBIDDEN,
                axum::Json(serde_json::json!({ "detail": { "code": "accessDenied", "message": "Access denied" } })),
            )
                .into_response();
        }
    }
    next.run(req).await
}

/* ---------------- интерфейс ---------------- */

fn mime_of(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

async fn serve_file(path: &Path, no_store: bool) -> Option<Response> {
    let data = tokio::fs::read(path).await.ok()?;
    let mut res = Response::new(Body::from(data));
    res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(mime_of(path)));
    if no_store {
        // index.html кэшировать нельзя: устаревшая оболочка ссылалась бы на
        // файлы сборки, которых после обновления уже нет.
        res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    Some(res)
}

/// Настоящий файл, если он есть, иначе index.html (маршруты интерфейса).
async fn spa(State(root): State<Arc<PathBuf>>, req: Request) -> Response {
    let raw = req.uri().path().trim_start_matches('/');
    // Неизвестный /api — это ошибка JSON, а не страница интерфейса.
    if raw == "api" || raw.starts_with("api/") {
        return error::fail(404, "notFound", "Not found").into_response();
    }
    let rel = Path::new(raw);
    let safe = rel.components().all(|c| matches!(c, Component::Normal(_)));
    if safe && !raw.is_empty() {
        let candidate = root.join(rel);
        if candidate.is_file() {
            if let Some(res) = serve_file(&candidate, false).await {
                return res;
            }
        }
    }
    match serve_file(&root.join("index.html"), true).await {
        Some(res) => res,
        None => error::fail(500, "uiNotBuilt", "The interface has not been built").into_response(),
    }
}

fn cors_layer() -> CorsLayer {
    let raw = std::env::var("CORS_ORIGINS").unwrap_or_else(|_| "*".into());
    let origins: Vec<&str> = raw.split(',').map(str::trim).filter(|o| !o.is_empty()).collect();
    if origins.is_empty() || origins.contains(&"*") {
        return CorsLayer::new()
            .allow_origin(AllowOrigin::any())
            .allow_methods(AllowMethods::any())
            .allow_headers(AllowHeaders::any());
    }
    // Список адресов — с учётными данными; со звёздочкой их сочетать нельзя.
    let list: Vec<HeaderValue> = origins.iter().filter_map(|o| HeaderValue::from_str(o).ok()).collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(list))
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
        .allow_credentials(true)
}

fn build_app(state: routes::AppState) -> Router {
    let mut app = routes::api_router(state);
    let static_dir = env("BG_STATIC_DIR");
    if !static_dir.is_empty() && Path::new(&static_dir).is_dir() {
        let root = Arc::new(PathBuf::from(&static_dir));
        app = app.fallback(axum::routing::any(spa).with_state(root));
    } else {
        app = app.fallback(routes::not_found);
    }
    let token = env("BG_TOKEN");
    if !token.is_empty() {
        app = app.layer(middleware::from_fn_with_state(Arc::new(token), require_token));
    }
    // Импорт проекта с картинками и замена содержимого при синхронизации —
    // это мегабайты: штатного предела в 2 МБ на тело запроса мало.
    app.layer(axum::extract::DefaultBodyLimit::max(1024 * 1024 * 1024))
        // CORS — самым внешним слоем: предварительные запросы отвечаются до
        // проверки токена.
        .layer(cors_layer())
}

/// Сторож: оболочка держит открытым наш stdin. Канал оборвался — оболочки
/// больше нет, и сервер уходит следом, а не висит без окна.
fn watch_parent(tx: tokio::sync::oneshot::Sender<()>) {
    std::thread::spawn(move || {
        let mut sink = String::new();
        let stdin = std::io::stdin();
        while stdin.read_line(&mut sink).map(|n| n > 0).unwrap_or(false) {
            sink.clear();
        }
        emit("BG_PARENT_GONE");
        let _ = tx.send(());
        // Если корректное завершение почему-то подвисло — уходим жёстко.
        std::thread::sleep(std::time::Duration::from_secs(5));
        std::process::exit(0);
    });
}

fn main() {
    std::process::exit(real_main());
}

#[tokio::main]
async fn real_main() -> i32 {
    let host = std::env::var("BG_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = env("BG_PORT").trim().parse().unwrap_or(0);
    let db_path = std::env::var("SQLITE_PATH").unwrap_or_else(|_| "bluegem.db".into());
    if let Some(parent) = Path::new(&db_path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    let store = match store::Store::open(&db_path) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            emit(&format!("BG_FATAL Не удалось открыть базу {db_path}: {e}"));
            return EXIT_FAILED;
        }
    };

    let listener = match tokio::net::TcpListener::bind((host.as_str(), port)).await {
        Ok(l) => l,
        Err(e) => {
            let busy = matches!(e.kind(), std::io::ErrorKind::AddrInUse | std::io::ErrorKind::PermissionDenied);
            emit(&format!("BG_FATAL Порт {port} занят или недоступен: {e}"));
            return if busy && port != 0 { EXIT_PORT_BUSY } else { EXIT_FAILED };
        }
    };
    let actual = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    emit(&format!("BG_BOOT host={host} port={actual} db={db_path}"));

    let state = routes::AppState { store: store.clone(), version: app_version() };
    let app = build_app(state);

    let (gone_tx, gone_rx) = tokio::sync::oneshot::channel::<()>();
    if env("BG_WATCH_PARENT") == "1" {
        watch_parent(gone_tx);
    } else {
        std::mem::forget(gone_tx); // никто не пришлёт — ждём только Ctrl+C
    }
    // Оболочка гасит сервер сигналом SIGTERM (child.kill()): завершаемся
    // аккуратно — с закрытием базы, чтобы журнал WAL свернулся в файл.
    let shutdown = async move {
        #[cfg(unix)]
        let term = async {
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(mut s) => { s.recv().await; }
                Err(_) => std::future::pending::<()>().await,
            }
        };
        #[cfg(not(unix))]
        let term = std::future::pending::<()>();
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = gone_rx => {},
            _ = term => {},
        }
    };

    let result = axum::serve(listener, app).with_graceful_shutdown(shutdown).await;
    store.checkpoint();
    match result {
        Ok(()) => {
            emit("BG_STOPPED");
            0
        }
        Err(e) => {
            emit(&format!("BG_FATAL Сервер упал: {e}"));
            EXIT_FAILED
        }
    }
}
