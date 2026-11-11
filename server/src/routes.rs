//! Маршруты /api — один в один с прежним backend/server.py (FastAPI).
use crate::catalog;
use crate::error::{fail, invalid, ApiResult};
use crate::store::{self, now_iso, text, Store};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use rusqlite::Transaction;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Store>,
    pub version: String,
}

type Q = Query<HashMap<String, String>>;

/// Работа с базой — в отдельном потоке: SQLite синхронная, и держать ею поток
/// асинхронного рантайма незачем.
async fn run<T: Send + 'static>(
    st: &AppState,
    f: impl FnOnce(&Transaction) -> ApiResult<T> + Send + 'static,
) -> ApiResult<T> {
    let store = st.store.clone();
    tokio::task::spawn_blocking(move || store.write(f))
        .await
        .map_err(|_| fail(500, "internal", "Worker failed"))?
}

/// Тело запроса — JSON-объект, иначе 422, как у FastAPI.
fn body(bytes: &Bytes) -> ApiResult<Map<String, Value>> {
    if bytes.is_empty() {
        return Err(invalid("Field required"));
    }
    match serde_json::from_slice::<Value>(bytes) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err(invalid("Input should be a valid dictionary")),
        Err(e) => Err(invalid(format!("JSON decode error: {e}"))),
    }
}

fn opt_str(m: &Map<String, Value>, key: &str) -> ApiResult<Option<String>> {
    match m.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(Value::Number(n)) => Ok(Some(n.to_string())),
        Some(_) => Err(invalid(format!("{key}: Input should be a valid string"))),
    }
}

fn opt_bool(raw: Option<&String>, default: bool) -> ApiResult<bool> {
    match raw.map(|s| s.to_ascii_lowercase()) {
        None => Ok(default),
        Some(s) if ["true", "1", "yes", "on", "t", "y"].contains(&s.as_str()) => Ok(true),
        Some(s) if ["false", "0", "no", "off", "f", "n"].contains(&s.as_str()) => Ok(false),
        Some(_) => Err(invalid("Input should be a valid boolean")),
    }
}

fn num(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn clean_fields(v: &Value) -> ApiResult<Value> {
    let list = v.as_array().ok_or_else(|| invalid("fields: Input should be a valid list"))?;
    Ok(Value::Array(
        list.iter()
            .filter(|f| f.is_object())
            .map(|f| json!({ "key": text(f.get("key")), "value": text(f.get("value")) }))
            .collect(),
    ))
}

fn clean_position(v: &Value) -> ApiResult<Value> {
    if !v.is_object() {
        return Err(invalid("position: Input should be a valid dictionary"));
    }
    Ok(json!({ "x": num(v.get("x")), "y": num(v.get("y")) }))
}

fn clean_strings(v: &Value, key: &str) -> ApiResult<Value> {
    let list = v.as_array().ok_or_else(|| invalid(format!("{key}: Input should be a valid list")))?;
    Ok(Value::Array(list.iter().map(|t| json!(text(Some(t)))).collect()))
}

fn clean_objects(v: &Value, key: &str) -> ApiResult<Value> {
    let list = v.as_array().ok_or_else(|| invalid(format!("{key}: Input should be a valid list")))?;
    Ok(Value::Array(list.iter().filter(|x| x.is_object()).cloned().collect()))
}

fn clean_points(v: &Value) -> ApiResult<Value> {
    let list = v.as_array().ok_or_else(|| invalid("points: Input should be a valid list"))?;
    Ok(Value::Array(
        list.iter()
            .filter(|p| p.is_object())
            .map(|p| json!({ "x": num(p.get("x")), "y": num(p.get("y")) }))
            .collect(),
    ))
}

const NODE_STR: [&str; 7] = ["typeId", "title", "description", "image", "date", "canvas", "cardMode"];
const EDGE_STR: [&str; 8] = ["label", "relType", "color", "source", "target", "sourceHandle", "targetHandle", "shape"];

/// Поля правки узла: только присланные и не null — как exclude_unset + is not None.
fn node_patch(m: &Map<String, Value>) -> ApiResult<Map<String, Value>> {
    let mut out = Map::new();
    for key in NODE_STR {
        if let Some(s) = opt_str(m, key)? {
            out.insert(key.into(), json!(s));
        }
    }
    for (key, v) in m {
        if v.is_null() {
            continue;
        }
        match key.as_str() {
            "fields" => { out.insert(key.clone(), clean_fields(v)?); }
            "position" => { out.insert(key.clone(), clean_position(v)?); }
            "tags" => { out.insert(key.clone(), clean_strings(v, "tags")?); }
            "dates" => { out.insert(key.clone(), clean_objects(v, "dates")?); }
            "width" => { out.insert(key.clone(), json!(num(Some(v)) as i64)); }
            _ => {}
        }
    }
    Ok(out)
}

fn edge_patch(m: &Map<String, Value>) -> ApiResult<Map<String, Value>> {
    let mut out = Map::new();
    for key in EDGE_STR {
        if let Some(s) = opt_str(m, key)? {
            out.insert(key.into(), json!(s));
        }
    }
    // Пустой список — осмысленное «сбросить излом», поэтому проверка на null,
    // а не на пустоту: иначе сброс молча не сохранялся бы.
    if let Some(v) = m.get("points").filter(|v| !v.is_null()) {
        out.insert("points".into(), clean_points(v)?);
    }
    Ok(out)
}

fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/* ---------------- проекты ---------------- */

async fn list_projects(State(st): State<AppState>) -> ApiResult<Json<Value>> {
    let list = run(&st, |tx| Ok(store::list_projects(tx)?)).await?;
    Ok(Json(Value::Array(list)))
}

async fn list_templates(Query(q): Q) -> Json<Value> {
    let lang = q.get("lang").cloned().unwrap_or_else(|| "en".into());
    Json(catalog::list_templates(&lang))
}

async fn create_project(State(st): State<AppState>, bytes: Bytes) -> ApiResult<Json<Value>> {
    let m = body(&bytes)?;
    let name = match m.get("name") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => return Err(invalid("name: Field required")),
    };
    let description = opt_str(&m, "description")?.unwrap_or_default();
    let lang = opt_str(&m, "lang")?.unwrap_or_else(|| "en".into());
    let mut template = opt_str(&m, "template")?.unwrap_or_else(|| catalog::default_template().into());
    if catalog::template_spec(&template).is_none() {
        template = catalog::default_template().into();
    }
    // Пример просят только там, где он есть: флаг с чужого шаблона молча гасим.
    let starter = m.get("starter").and_then(|v| v.as_bool()).unwrap_or(false)
        && catalog::template_spec(&template).is_some_and(|s| s["starter"].as_bool() == Some(true));
    let out = run(&st, move |tx| {
        let stamp = now_iso();
        let mut p = json!({
            "id": store::new_id(), "name": name, "description": description,
            "settings": catalog::settings_for_template(&template, &lang),
            "createdAt": stamp, "updatedAt": stamp, "metaUpdatedAt": stamp,
            "nodeCount": 0, "edgeCount": 0, "typeMix": [],
        });
        store::insert_project(tx, &p, &json!({}))?;
        if starter {
            let id = text(p.get("id"));
            store::insert_starter(tx, &id, &template, &lang)?;
            p = store::require_project(tx, &id, true)?;
        }
        Ok(p)
    })
    .await?;
    Ok(Json(out))
}

async fn get_project(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(run(&st, move |tx| store::require_project(tx, &id, true)).await?))
}

async fn update_project(State(st): State<AppState>, Path(id): Path<String>, bytes: Bytes) -> ApiResult<Json<Value>> {
    let m = body(&bytes)?;
    let name = opt_str(&m, "name")?;
    let description = opt_str(&m, "description")?;
    let settings = match m.get("settings") {
        None | Some(Value::Null) => None,
        Some(v @ Value::Object(_)) => Some(v.clone()),
        Some(_) => return Err(invalid("settings: Input should be a valid dictionary")),
    };
    let out = run(&st, move |tx| {
        let mut doc = store::require_project(tx, &id, false)?;
        store::maybe_backup(tx, &id)?;
        let stamp = now_iso();
        let any = name.is_some() || description.is_some() || settings.is_some();
        if let Some(v) = name { doc["name"] = json!(v); }
        if let Some(v) = description { doc["description"] = json!(v); }
        if let Some(v) = settings { doc["settings"] = v; }
        if any { doc["metaUpdatedAt"] = json!(stamp); }
        doc["updatedAt"] = json!(stamp);
        tx.execute(
            "UPDATE projects SET name = ?, description = ?, settings = ?, updatedAt = ?, metaUpdatedAt = ? WHERE id = ?",
            rusqlite::params![
                text(doc.get("name")), text(doc.get("description")),
                serde_json::to_string(&doc["settings"]).unwrap_or_default(),
                stamp, text(doc.get("metaUpdatedAt")), id,
            ],
        )?;
        Ok(doc)
    })
    .await?;
    Ok(Json(out))
}

async fn delete_project(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    run(&st, move |tx| {
        for table in ["projects WHERE id", "nodes WHERE projectId", "edges WHERE projectId", "backups WHERE projectId"] {
            tx.execute(&format!("DELETE FROM {table} = ?"), [&id])?;
        }
        Ok(())
    })
    .await?;
    Ok(ok())
}

/* ---------------- экспорт, импорт, копия, замена ---------------- */

async fn export_project(State(st): State<AppState>, Path(id): Path<String>, Query(q): Q) -> ApiResult<Json<Value>> {
    let inline = opt_bool(q.get("inline"), true)?;
    let snap = run(&st, move |tx| Ok(store::snapshot(tx, &id, inline)?)).await?;
    snap.map(Json).ok_or_else(|| fail(404, "projectNotFound", "Project not found"))
}

fn list_of(m: &Map<String, Value>, key: &str) -> ApiResult<Vec<Value>> {
    match m.get(key) {
        None | Some(Value::Null) => Ok(vec![]),
        Some(Value::Array(a)) => Ok(a.iter().filter(|v| v.is_object()).cloned().collect()),
        Some(_) => Err(invalid(format!("{key}: Input should be a valid list"))),
    }
}

async fn import_project(State(st): State<AppState>, bytes: Bytes) -> ApiResult<Json<Value>> {
    let m = body(&bytes)?;
    let src = m.get("project").filter(|v| v.is_object()).cloned().unwrap_or_else(|| json!({}));
    let mut name = opt_str(&m, "name")?.filter(|s| !s.is_empty()).unwrap_or_default();
    if name.is_empty() {
        name = text(src.get("name"));
    }
    if name.is_empty() {
        name = "Imported project".into();
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(fail(400, "projectNameRequired", "A project needs a name"));
    }
    let nodes = list_of(&m, "nodes")?;
    let edges = list_of(&m, "edges")?;
    let keep = m.get("keepIds").and_then(|v| v.as_bool()).unwrap_or(false);
    let out = run(&st, move |tx| {
        let pid = text(src.get("id"));
        Ok(store::insert_snapshot(
            tx, &name, &text(src.get("description")), &src["settings"], &nodes, &edges, keep,
            Some(pid.as_str()), src.get("deleted").unwrap_or(&Value::Null), &text(src.get("metaUpdatedAt")),
        )?)
    })
    .await?;
    Ok(Json(out))
}

async fn duplicate_project(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let out = run(&st, move |tx| {
        let snap = store::snapshot(tx, &id, false)?.ok_or_else(|| fail(404, "projectNotFound", "Project not found"))?;
        let p = &snap["project"];
        let empty = vec![];
        Ok(store::insert_snapshot(
            tx, &format!("{} (copy)", text(p.get("name"))), &text(p.get("description")), &p["settings"],
            snap["nodes"].as_array().unwrap_or(&empty), snap["edges"].as_array().unwrap_or(&empty),
            false, None, &Value::Null, "",
        )?)
    })
    .await?;
    Ok(Json(out))
}

/// Содержимое проекта целиком — так синхронизация кладёт результат слияния.
/// Перед заменой снимается копия: прежнее состояние всегда можно вернуть.
async fn put_content(State(st): State<AppState>, Path(id): Path<String>, bytes: Bytes) -> ApiResult<Json<Value>> {
    let m = body(&bytes)?;
    let snap = json!({
        "project": m.get("project").filter(|v| v.is_object()).cloned().unwrap_or_else(|| json!({})),
        "nodes": list_of(&m, "nodes")?,
        "edges": list_of(&m, "edges")?,
    });
    let out = run(&st, move |tx| {
        store::make_backup(tx, &id, "sync")?;
        store::replace_content(tx, &id, &snap)
    })
    .await?;
    Ok(Json(out))
}

/* ---------------- резервные копии ---------------- */

async fn list_backups(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(Value::Array(run(&st, move |tx| Ok(store::list_backups(tx, &id)?)).await?)))
}

async fn create_backup(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let doc = run(&st, move |tx| Ok(store::make_backup(tx, &id, "manual")?)).await?;
    doc.map(Json).ok_or_else(|| fail(404, "projectNotFound", "Project not found"))
}

async fn restore_backup(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(run(&st, move |tx| store::restore_backup(tx, &id)).await?))
}

async fn delete_backup(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    run(&st, move |tx| Ok(tx.execute("DELETE FROM backups WHERE id = ?", [&id])?)).await?;
    Ok(ok())
}

/* ---------------- картинки ---------------- */

async fn get_image(State(st): State<AppState>, Path(digest): Path<String>) -> ApiResult<Response> {
    let valid = digest.len() == 64 && digest.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c));
    if !valid {
        return Err(fail(404, "notFound", "Not found"));
    }
    let row = run(&st, move |tx| Ok(store::get_image(tx, &digest)?)).await?;
    let (mime, data) = row.ok_or_else(|| fail(404, "notFound", "Not found"))?;
    // Содержимое по адресу не меняется никогда: адрес — это хэш содержимого.
    Ok((
        [(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "private, max-age=31536000, immutable".into())],
        data,
    )
        .into_response())
}

/* ---------------- граф ---------------- */

async fn get_graph(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let (nodes, edges) = run(&st, move |tx| Ok(store::graph(tx, &id)?)).await?;
    Ok(Json(json!({ "nodes": nodes, "edges": edges })))
}

async fn create_node(State(st): State<AppState>, Path(pid): Path<String>, bytes: Bytes) -> ApiResult<Json<Value>> {
    let m = body(&bytes)?;
    let patch = node_patch(&m)?;
    let stamp = now_iso();
    let mut d = json!({
        "id": store::new_id(), "projectId": pid, "typeId": "note", "title": "New node",
        "description": "", "fields": [], "position": {"x": 0.0, "y": 0.0}, "tags": [],
        "image": "", "date": "", "dates": [], "canvas": "", "width": 0, "cardMode": "",
        "createdAt": stamp, "updatedAt": stamp,
    });
    for (k, v) in patch {
        d[k] = v;
    }
    let out = run(&st, move |tx| {
        store::maybe_backup(tx, &pid)?;
        let id = text(d.get("id"));
        let image = store::insert_node(tx, &pid, &d, &id, None)?;
        d["image"] = json!(image);
        store::touch_project(tx, &pid)?;
        Ok(d)
    })
    .await?;
    Ok(Json(out))
}

async fn update_positions(State(st): State<AppState>, Path(pid): Path<String>, bytes: Bytes) -> ApiResult<Json<Value>> {
    let m = body(&bytes)?;
    let mut items = Vec::new();
    if let Some(list) = m.get("positions").filter(|v| !v.is_null()) {
        for p in list.as_array().ok_or_else(|| invalid("positions: Input should be a valid list"))? {
            let id = p.get("id").and_then(|v| v.as_str()).ok_or_else(|| invalid("positions.id: Field required"))?;
            let pos = clean_position(p.get("position").ok_or_else(|| invalid("positions.position: Field required"))?)?;
            items.push((id.to_string(), pos));
        }
    }
    let n = items.len();
    run(&st, move |tx| {
        store::maybe_backup(tx, &pid)?;
        let stamp = now_iso();
        for (id, pos) in &items {
            tx.execute(
                "UPDATE nodes SET position = ?, updatedAt = ? WHERE id = ? AND projectId = ?",
                rusqlite::params![pos.to_string(), stamp, id, pid],
            )?;
        }
        store::touch_project(tx, &pid)?;
        Ok(())
    })
    .await?;
    Ok(Json(json!({ "ok": true, "updated": n })))
}

async fn update_node(State(st): State<AppState>, Path(id): Path<String>, bytes: Bytes) -> ApiResult<Json<Value>> {
    let patch = node_patch(&body(&bytes)?)?;
    let out = run(&st, move |tx| {
        let mut doc = store::get_node(tx, &id)?.ok_or_else(|| fail(404, "nodeNotFound", "Node not found"))?;
        let pid = text(doc.get("projectId"));
        store::maybe_backup(tx, &pid)?;
        for (k, v) in patch {
            doc[k] = v;
        }
        let image = text(doc.get("image"));
        doc["image"] = json!(store::store_image(tx, &image)?);
        doc["updatedAt"] = json!(now_iso());
        store::save_node(tx, &doc)?;
        store::touch_project(tx, &pid)?;
        Ok(doc)
    })
    .await?;
    Ok(Json(out))
}

async fn delete_node(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    run(&st, move |tx| {
        if let Some(node) = store::get_node(tx, &id)? {
            store::maybe_backup(tx, &text(node.get("projectId")))?;
            store::delete_node(tx, &node)?;
        }
        Ok(())
    })
    .await?;
    Ok(ok())
}

async fn create_edge(State(st): State<AppState>, Path(pid): Path<String>, bytes: Bytes) -> ApiResult<Json<Value>> {
    let m = body(&bytes)?;
    let source = opt_str(&m, "source")?.ok_or_else(|| invalid("source: Field required"))?;
    let target = opt_str(&m, "target")?.ok_or_else(|| invalid("target: Field required"))?;
    let patch = edge_patch(&m)?;
    if source == target {
        return Err(fail(400, "selfLink", "A node cannot be linked to itself"));
    }
    let out = run(&st, move |tx| {
        let existing = tx
            .query_row(
                "SELECT * FROM edges WHERE projectId = ? AND source = ? AND target = ?",
                rusqlite::params![pid, source, target],
                store::edge_row,
            );
        if let Ok(e) = existing {
            return Ok(e);
        }
        store::maybe_backup(tx, &pid)?;
        let mut d = json!({
            "id": store::new_id(), "projectId": pid, "source": source, "target": target,
            "label": "", "relType": "", "color": "", "points": [], "sourceHandle": "",
            "targetHandle": "", "shape": "", "updatedAt": now_iso(),
        });
        for (k, v) in patch {
            d[k] = v;
        }
        let id = text(d.get("id"));
        store::insert_edge(tx, &pid, &d, &id, &source, &target)?;
        store::touch_project(tx, &pid)?;
        Ok(d)
    })
    .await?;
    Ok(Json(out))
}

async fn update_edge(State(st): State<AppState>, Path(id): Path<String>, bytes: Bytes) -> ApiResult<Json<Value>> {
    let patch = edge_patch(&body(&bytes)?)?;
    let out = run(&st, move |tx| {
        let mut doc = store::get_edge(tx, &id)?.ok_or_else(|| fail(404, "edgeNotFound", "Link not found"))?;
        let pid = text(doc.get("projectId"));
        store::maybe_backup(tx, &pid)?;
        for (k, v) in patch {
            doc[k] = v;
        }
        doc["updatedAt"] = json!(now_iso());
        store::save_edge(tx, &doc)?;
        store::touch_project(tx, &pid)?;
        Ok(doc)
    })
    .await?;
    Ok(Json(out))
}

async fn delete_edge(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    run(&st, move |tx| {
        if let Some(edge) = store::get_edge(tx, &id)? {
            store::maybe_backup(tx, &text(edge.get("projectId")))?;
            store::delete_edge(tx, &edge)?;
        }
        Ok(())
    })
    .await?;
    Ok(ok())
}

/* ---------------- служебное ---------------- */

async fn health(State(st): State<AppState>) -> ApiResult<Json<Value>> {
    let n: i64 = run(&st, |tx| Ok(tx.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?)).await?;
    Ok(Json(json!({ "status": "ok", "db": st.store.path, "projects": n })))
}

async fn root(State(st): State<AppState>) -> Json<Value> {
    Json(json!({ "message": "BlueGem API", "version": st.version }))
}

pub async fn not_found() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, Json(json!({ "detail": "Not Found" })))
}

pub fn api_router(state: AppState) -> Router {
    Router::new()
        .route("/api", get(root))
        .route("/api/", get(root))
        .route("/api/health", get(health))
        .route("/api/templates", get(list_templates))
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/projects/import", post(import_project))
        .route("/api/projects/{id}", get(get_project).put(update_project).delete(delete_project))
        .route("/api/projects/{id}/export", get(export_project))
        .route("/api/projects/{id}/duplicate", post(duplicate_project))
        .route("/api/projects/{id}/content", put(put_content))
        .route("/api/projects/{id}/backups", get(list_backups).post(create_backup))
        .route("/api/backups/{id}/restore", post(restore_backup))
        .route("/api/backups/{id}", delete(delete_backup))
        .route("/api/images/{digest}", get(get_image))
        .route("/api/projects/{id}/graph", get(get_graph))
        .route("/api/projects/{id}/nodes", post(create_node))
        .route("/api/projects/{id}/nodes/positions", put(update_positions))
        .route("/api/nodes/{id}", put(update_node).delete(delete_node))
        .route("/api/projects/{id}/edges", post(create_edge))
        .route("/api/edges/{id}", put(update_edge).delete(delete_edge))
        .with_state(state)
}
