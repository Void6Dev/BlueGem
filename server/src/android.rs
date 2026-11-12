//! Ядро внутри приложения для Android.
//!
//! Сервера-процесса на телефоне нет: интерфейс зовёт плагин Capacitor
//! (frontend/android/.../BlueGemCorePlugin.java), а тот — эти две функции.
//! Запрос проходит через тот же маршрутизатор, что и на компьютере, только
//! без сокета: метод, путь и тело — внутрь, статус и тело — наружу. Поэтому
//! телефон и компьютер ведут себя одинаково до последнего кода ошибки.
use crate::routes::{core_router, AppState};
use crate::store::Store;
use axum::body::{to_bytes, Body};
use axum::http::{header, Method, Request};
use axum::Router;
use base64::Engine;
use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use serde_json::json;
use std::sync::{Arc, OnceLock};
use tower::ServiceExt;

struct Core {
    rt: tokio::runtime::Runtime,
    app: Router,
}

static CORE: OnceLock<Core> = OnceLock::new();

fn string(env: &mut JNIEnv, s: &JString) -> String {
    env.get_string(s).map(|v| v.into()).unwrap_or_default()
}

fn out(env: &mut JNIEnv, s: String) -> jstring {
    env.new_string(s).map(|v| v.into_raw()).unwrap_or(std::ptr::null_mut())
}

fn init(db_path: &str, version: &str) -> Result<(), String> {
    if CORE.get().is_some() {
        return Ok(());
    }
    let store = Store::open(db_path).map_err(|e| format!("{e}"))?;
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|e| format!("{e}"))?;
    let app = core_router(AppState { store: Arc::new(store), version: version.to_string() });
    let _ = CORE.set(Core { rt, app });
    Ok(())
}

/// Открыть базу (и перенести её схему, если она старая). Пустая строка —
/// всё хорошо, иначе текст ошибки.
#[no_mangle]
pub extern "system" fn Java_com_bluegem_app_BlueGemCorePlugin_nativeInit(
    mut env: JNIEnv,
    _class: JClass,
    db_path: JString,
    version: JString,
) -> jstring {
    let db = string(&mut env, &db_path);
    let ver = string(&mut env, &version);
    let res = init(&db, &ver).err().unwrap_or_default();
    out(&mut env, res)
}

fn handle(method: &str, path: &str, body: String) -> serde_json::Value {
    let Some(core) = CORE.get() else {
        return json!({ "status": 503, "body": r#"{"detail":{"code":"coreNotReady","message":"Core is not initialised"}}"# });
    };
    let method = Method::from_bytes(method.as_bytes()).unwrap_or(Method::GET);
    let req = match Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
    {
        Ok(r) => r,
        Err(e) => return json!({ "status": 400, "body": format!(r#"{{"detail":"{e}"}}"#) }),
    };
    core.rt.block_on(async {
        let res = match core.app.clone().oneshot(req).await {
            Ok(r) => r,
            Err(e) => match e {},
        };
        let status = res.status().as_u16();
        let ctype = res
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap_or_default();
        // Картинки — двоичные: наружу строкой base64, остальное — текстом.
        if ctype.starts_with("image/") {
            json!({
                "status": status,
                "contentType": ctype,
                "base64": base64::engine::general_purpose::STANDARD.encode(&bytes),
            })
        } else {
            json!({
                "status": status,
                "contentType": ctype,
                "body": String::from_utf8_lossy(&bytes),
            })
        }
    })
}

/// Один запрос к API: метод, путь с параметрами (/api/...), тело JSON.
/// Ответ — JSON {status, contentType, body | base64}.
#[no_mangle]
pub extern "system" fn Java_com_bluegem_app_BlueGemCorePlugin_nativeRequest(
    mut env: JNIEnv,
    _class: JClass,
    method: JString,
    path: JString,
    body: JString,
) -> jstring {
    let m = string(&mut env, &method);
    let p = string(&mut env, &path);
    let b = string(&mut env, &body);
    let res = std::panic::catch_unwind(|| handle(&m, &p, b)).unwrap_or_else(|_| {
        json!({ "status": 500, "body": r#"{"detail":{"code":"internal","message":"Core panicked"}}"# })
    });
    out(&mut env, res.to_string())
}
