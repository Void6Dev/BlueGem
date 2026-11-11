//! Хранилище: SQLite в профиле пользователя.
//!
//! Схема и поведение — те же, что были у backend/server.py: тот же файл базы
//! открывается без переноса данных, а интерфейс не замечает, какой из двух
//! серверов ему отвечает. Комментарии о том, *зачем* что-то устроено именно
//! так, оставлены рядом с кодом, как и в Python-версии.
use crate::catalog;
use crate::error::{fail, ApiResult};
use base64::Engine;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::types::ValueRef;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

pub const IMAGE_PREFIX: &str = "bg-image:";
/// Сколько помнить удаление узла или связи для синхронизации.
const TOMBSTONE_DAYS: i64 = 180;
/// Копия снимается перед правкой, если последней больше этого.
const BACKUP_INTERVAL_MIN: i64 = 10;
/// Последние копии хранятся подряд (пара часов работы)…
const BACKUP_KEEP_RECENT: usize = 12;
/// …а старше — по одной на день, но не дольше месяца.
const BACKUP_KEEP_DAYS: i64 = 30;
/// Больше шести долей полоска состава на карточке проекта не различает.
const TYPE_MIX_LIMIT: usize = 6;
/// Цвет для узла, чей тип удалён из настроек.
const ORPHAN_TYPE_COLOR: &str = "#6E6E7A";

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
}

fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Micros, false)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/* ---------------- значения JSON ---------------- */

/// Строка из поля: как `str(x or "")` в Python — числа становятся текстом,
/// null и отсутствие — пустой строкой.
pub fn text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(true)) => "True".into(),
        _ => String::new(),
    }
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
    }
}

fn number_or_zero(v: Option<&Value>) -> Value {
    match v {
        Some(Value::Number(n)) if n.as_f64() != Some(0.0) => Value::Number(n.clone()),
        _ => json!(0),
    }
}

fn int_of(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_i64().unwrap_or_else(|| n.as_f64().unwrap_or(0.0) as i64),
        Some(Value::String(s)) => s.trim().parse::<f64>().map(|f| f as i64).unwrap_or(0),
        Some(Value::Bool(true)) => 1,
        _ => 0,
    }
}

fn list_or_empty(v: Option<&Value>) -> Value {
    match v {
        Some(Value::Array(a)) if !a.is_empty() => Value::Array(a.clone()),
        _ => json!([]),
    }
}

fn to_json(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

/* ---------------- чтение строк ---------------- */

fn col_text(row: &Row, name: &str) -> String {
    match row.get_ref(name) {
        Ok(ValueRef::Text(t)) => String::from_utf8_lossy(t).into_owned(),
        Ok(ValueRef::Integer(i)) => i.to_string(),
        Ok(ValueRef::Real(f)) => f.to_string(),
        _ => String::new(),
    }
}

fn col_json(row: &Row, name: &str, fallback: Value) -> Value {
    let raw = col_text(row, name);
    if raw.is_empty() {
        return fallback;
    }
    serde_json::from_str(&raw).unwrap_or(fallback)
}

fn col_int(row: &Row, name: &str) -> i64 {
    match row.get_ref(name) {
        Ok(ValueRef::Integer(i)) => i,
        Ok(ValueRef::Real(f)) => f as i64,
        Ok(ValueRef::Text(t)) => String::from_utf8_lossy(t).trim().parse().unwrap_or(0),
        _ => 0,
    }
}

pub fn node_row(row: &Row) -> rusqlite::Result<Value> {
    let created = col_text(row, "createdAt");
    let updated = col_text(row, "updatedAt");
    Ok(json!({
        "id": col_text(row, "id"),
        "projectId": col_text(row, "projectId"),
        "typeId": col_text(row, "typeId"),
        "title": col_text(row, "title"),
        "description": col_text(row, "description"),
        "fields": col_json(row, "fields", json!([])),
        "position": col_json(row, "position", json!({"x": 0, "y": 0})),
        "tags": col_json(row, "tags", json!([])),
        "image": col_text(row, "image"),
        // Старые строки хранили здесь число — наружу всегда строка.
        "date": col_text(row, "date"),
        "dates": col_json(row, "dates", json!([])),
        "canvas": col_text(row, "canvas"),
        "width": col_int(row, "width"),
        "cardMode": col_text(row, "cardMode"),
        "updatedAt": if updated.is_empty() { created.clone() } else { updated },
        "createdAt": created,
    }))
}

pub fn edge_row(row: &Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": col_text(row, "id"),
        "projectId": col_text(row, "projectId"),
        "source": col_text(row, "source"),
        "target": col_text(row, "target"),
        "label": col_text(row, "label"),
        "relType": col_text(row, "relType"),
        "color": col_text(row, "color"),
        "points": col_json(row, "points", json!([])),
        "sourceHandle": col_text(row, "sourceHandle"),
        "targetHandle": col_text(row, "targetHandle"),
        "shape": col_text(row, "shape"),
        "updatedAt": col_text(row, "updatedAt"),
    }))
}

/* ---------------- база ---------------- */

pub struct Store {
    conn: Mutex<Connection>,
    pub path: String,
}

impl Store {
    pub fn open(path: &str) -> rusqlite::Result<Store> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )?;
        let store = Store { conn: Mutex::new(conn), path: path.to_string() };
        store.write(|tx| init_db(tx).map_err(Into::into))
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        Ok(store)
    }

    /// Всё, что меняет данные, — в одной транзакции: правка узла и отметка
    /// «проект изменён» пишутся вместе или не пишутся вовсе.
    pub fn write<T>(&self, f: impl FnOnce(&Transaction) -> ApiResult<T>) -> ApiResult<T> {
        let mut guard = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = guard.transaction()?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }

    /// Свернуть журнал WAL обратно в файл базы перед выходом.
    pub fn checkpoint(&self) {
        let guard = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let _ = guard.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
}

fn ensure_columns(tx: &Transaction, table: &str, columns: &[(&str, &str)]) -> rusqlite::Result<()> {
    let mut stmt = tx.prepare(&format!("PRAGMA table_info({table})"))?;
    let existing: HashSet<String> =
        stmt.query_map([], |r| r.get::<_, String>("name"))?.collect::<Result<_, _>>()?;
    for (name, ddl) in columns {
        if !existing.contains(*name) {
            tx.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {name} {ddl}"))?;
        }
    }
    Ok(())
}

fn init_db(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
            settings TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY, projectId TEXT NOT NULL, typeId TEXT DEFAULT 'note',
            title TEXT DEFAULT '', description TEXT DEFAULT '', fields TEXT NOT NULL,
            position TEXT NOT NULL, createdAt TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
            image TEXT DEFAULT '', date TEXT DEFAULT '', dates TEXT NOT NULL DEFAULT '[]',
            canvas TEXT DEFAULT '', cardMode TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY, projectId TEXT NOT NULL, source TEXT NOT NULL,
            target TEXT NOT NULL, label TEXT DEFAULT '', relType TEXT DEFAULT '',
            color TEXT DEFAULT '', shape TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS images (
            hash TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, createdAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS backups (
            id TEXT PRIMARY KEY, projectId TEXT NOT NULL, createdAt TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT 'auto', hash TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL DEFAULT '', nodeCount INTEGER NOT NULL DEFAULT 0,
            edgeCount INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_backups_project ON backups(projectId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(projectId);
        CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(projectId);
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);",
    )?;
    // Базы, созданные до появления этих колонок.
    ensure_columns(tx, "nodes", &[
        ("tags", "TEXT NOT NULL DEFAULT '[]'"), ("image", "TEXT DEFAULT ''"),
        ("date", "TEXT DEFAULT ''"), ("dates", "TEXT NOT NULL DEFAULT '[]'"),
        ("canvas", "TEXT DEFAULT ''"), ("width", "INTEGER NOT NULL DEFAULT 0"),
        ("cardMode", "TEXT DEFAULT ''"), ("updatedAt", "TEXT NOT NULL DEFAULT ''"),
    ])?;
    ensure_columns(tx, "edges", &[
        ("relType", "TEXT DEFAULT ''"), ("color", "TEXT DEFAULT ''"), ("shape", "TEXT DEFAULT ''"),
        ("points", "TEXT NOT NULL DEFAULT '[]'"), ("sourceHandle", "TEXT DEFAULT ''"),
        ("targetHandle", "TEXT DEFAULT ''"), ("updatedAt", "TEXT NOT NULL DEFAULT ''"),
    ])?;
    ensure_columns(tx, "projects", &[
        ("metaUpdatedAt", "TEXT NOT NULL DEFAULT ''"), ("deleted", "TEXT NOT NULL DEFAULT '{}'"),
    ])?;
    migrate_legacy_dates(tx)?;
    migrate_inline_images(tx)?;
    gc_images(tx)?;
    Ok(())
}

/* ---------------- хронология ---------------- */

/// Старая свободная строка даты → одна структурная запись. Чистое число —
/// точный год; всё остальное сохраняется как дата без разбора.
pub fn legacy_date_entries(raw: &str) -> Value {
    let t = raw.trim();
    if t.is_empty() {
        return json!([]);
    }
    let digits = t.strip_prefix('-').unwrap_or(t);
    let is_year = !digits.is_empty() && digits.len() <= 9 && digits.bytes().all(|b| b.is_ascii_digit());
    let start = match (is_year, t.parse::<i64>()) {
        (true, Ok(y)) => json!({ "kind": "exact", "y": y, "m": null, "d": null }),
        _ => json!({ "kind": "unknown", "raw": t }),
    };
    json!([{ "id": "legacy", "key": "date", "label": "", "start": start, "end": null }])
}

/// Ссылки относительных дат → на новые id узлов (копия, импорт).
pub fn remap_date_refs(entries: &Value, id_map: &HashMap<String, String>) -> Value {
    let Some(list) = entries.as_array() else { return json!([]) };
    Value::Array(
        list.iter()
            .filter(|e| e.is_object())
            .map(|e| {
                let mut entry = e.clone();
                for edge in ["start", "end"] {
                    if let Some(rel) = entry.get_mut(edge).and_then(|v| v.get_mut("rel")) {
                        if rel.is_object() {
                            let old = text(rel.get("nodeId"));
                            if let Some(new) = id_map.get(&old) {
                                rel["nodeId"] = json!(new);
                            }
                        }
                    }
                }
                entry
            })
            .collect(),
    )
}

fn migrate_legacy_dates(tx: &Transaction) -> rusqlite::Result<()> {
    let rows: Vec<(String, String)> = {
        let mut st = tx.prepare(
            "SELECT id, date FROM nodes WHERE dates = '[]' AND date IS NOT NULL AND date != ''",
        )?;
        let it = st.query_map([], |r| Ok((col_text(r, "id"), col_text(r, "date"))))?;
        it.collect::<Result<_, _>>()?
    };
    for (id, date) in rows {
        let entries = legacy_date_entries(&date);
        if entries.as_array().is_some_and(|a| !a.is_empty()) {
            tx.execute("UPDATE nodes SET dates = ? WHERE id = ?", params![to_json(&entries), id])?;
        }
    }
    Ok(())
}

/* ---------------- картинки ---------------- */

/// data:image/<mime>;base64,<...> → (mime, байты).
fn parse_data_url(value: &str) -> Option<(String, Vec<u8>)> {
    let rest = value.strip_prefix("data:image/")?;
    let (subtype, body) = rest.split_once(";base64,")?;
    if subtype.is_empty()
        || !subtype.chars().all(|c| c.is_ascii_alphanumeric() || "_.+-".contains(c))
    {
        return None;
    }
    // Как base64.b64decode(validate=False): лишние символы (переводы строк)
    // отбрасываются, а не ломают разбор.
    let clean: String = body.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '/' || *c == '=').collect();
    let bytes = base64::engine::general_purpose::STANDARD.decode(clean.as_bytes()).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some((format!("image/{subtype}"), bytes))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// data:image/... → ссылка на строку в images; остальное — как есть.
pub fn store_image(tx: &Transaction, value: &str) -> rusqlite::Result<String> {
    let Some((mime, bytes)) = parse_data_url(value) else { return Ok(value.to_string()) };
    let digest = hex(&Sha256::digest(&bytes));
    tx.execute(
        "INSERT OR IGNORE INTO images (hash, mime, data, createdAt) VALUES (?, ?, ?, ?)",
        params![digest, mime, bytes, now_iso()],
    )?;
    Ok(format!("{IMAGE_PREFIX}{digest}"))
}

/// Ссылка → data:image/...; пропавшая картинка → пусто.
fn inline_image(tx: &Transaction, value: &str) -> rusqlite::Result<String> {
    let Some(hash) = value.strip_prefix(IMAGE_PREFIX) else { return Ok(value.to_string()) };
    let row: Option<(String, Vec<u8>)> = tx
        .query_row("SELECT mime, data FROM images WHERE hash = ?", [hash], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    Ok(match row {
        Some((mime, data)) => format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(data)
        ),
        None => String::new(),
    })
}

pub fn get_image(tx: &Transaction, hash: &str) -> rusqlite::Result<Option<(String, Vec<u8>)>> {
    tx.query_row("SELECT mime, data FROM images WHERE hash = ?", [hash], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
}

fn migrate_inline_images(tx: &Transaction) -> rusqlite::Result<()> {
    let rows: Vec<(String, String)> = {
        let mut st = tx.prepare("SELECT id, image FROM nodes WHERE image LIKE 'data:image/%'")?;
        let it = st.query_map([], |r| Ok((col_text(r, "id"), col_text(r, "image"))))?;
        it.collect::<Result<_, _>>()?
    };
    for (id, image) in rows {
        let r = store_image(tx, &image)?;
        if r != image {
            tx.execute("UPDATE nodes SET image = ? WHERE id = ?", params![r, id])?;
        }
    }
    Ok(())
}

/// Все хэши bg-image:<64 hex> в тексте.
pub fn image_refs(text: &str, out: &mut HashSet<String>) {
    let mut rest = text;
    while let Some(at) = rest.find(IMAGE_PREFIX) {
        let tail = &rest[at + IMAGE_PREFIX.len()..];
        let hash: String = tail.chars().take(64).collect();
        if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)) {
            out.insert(hash);
        }
        rest = tail;
    }
}

/// Убрать картинки, на которые не ссылается ни узел, ни резервная копия.
pub fn gc_images(tx: &Transaction) -> rusqlite::Result<usize> {
    let mut used = HashSet::new();
    {
        let mut st = tx.prepare("SELECT image FROM nodes WHERE image LIKE 'bg-image:%'")?;
        for img in st.query_map([], |r| Ok(col_text(r, "image")))? {
            image_refs(&img?, &mut used);
        }
        let mut st = tx.prepare("SELECT data FROM backups WHERE data LIKE '%bg-image:%'")?;
        for data in st.query_map([], |r| Ok(col_text(r, "data")))? {
            image_refs(&data?, &mut used);
        }
    }
    let all: Vec<String> = {
        let mut st = tx.prepare("SELECT hash FROM images")?;
        let it = st.query_map([], |r| r.get::<_, String>(0))?;
        it.collect::<Result<_, _>>()?
    };
    let mut dropped = 0;
    for h in all.into_iter().filter(|h| !used.contains(h)) {
        tx.execute("DELETE FROM images WHERE hash = ?", [h])?;
        dropped += 1;
    }
    Ok(dropped)
}

/* ---------------- следы удалений ---------------- */

pub fn load_deleted(raw: &Value) -> Value {
    let parsed = match raw {
        Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
        other => other.clone(),
    };
    let mut out = Map::new();
    for kind in ["nodes", "edges"] {
        let v = parsed.get(kind).filter(|v| v.is_object()).cloned().unwrap_or_else(|| json!({}));
        out.insert(kind.into(), v);
    }
    Value::Object(out)
}

/// Забыть удаления старше TOMBSTONE_DAYS. Устройство, не синхронизировавшееся
/// полгода, вернёт удалённое — честнее, чем копить следы вечно.
pub fn prune_deleted(dead: &Value) -> Value {
    let cutoff = iso(Utc::now() - Duration::days(TOMBSTONE_DAYS));
    let mut out = Map::new();
    for kind in ["nodes", "edges"] {
        let kept: Map<String, Value> = dead[kind]
            .as_object()
            .map(|m| m.iter().filter(|(_, t)| text(Some(t)) >= cutoff).map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();
        out.insert(kind.into(), Value::Object(kept));
    }
    Value::Object(out)
}

fn mark_deleted(tx: &Transaction, project_id: &str, nodes: &[String], edges: &[String]) -> rusqlite::Result<()> {
    if nodes.is_empty() && edges.is_empty() {
        return Ok(());
    }
    let raw: Option<String> = tx
        .query_row("SELECT deleted FROM projects WHERE id = ?", [project_id], |r| Ok(col_text(r, "deleted")))
        .optional()?;
    let Some(raw) = raw else { return Ok(()) };
    let mut dead = load_deleted(&Value::String(raw));
    let stamp = now_iso();
    for id in nodes {
        dead["nodes"][id] = json!(stamp);
    }
    for id in edges {
        dead["edges"][id] = json!(stamp);
    }
    tx.execute("UPDATE projects SET deleted = ? WHERE id = ?", params![to_json(&prune_deleted(&dead)), project_id])?;
    Ok(())
}

/* ---------------- проекты ---------------- */

pub fn touch_project(tx: &Transaction, project_id: &str) -> rusqlite::Result<()> {
    tx.execute("UPDATE projects SET updatedAt = ? WHERE id = ?", params![now_iso(), project_id])?;
    Ok(())
}

#[derive(Default, Clone)]
pub struct Counts {
    pub nodes: i64,
    pub edges: i64,
    pub by_type: Vec<(String, i64)>,
}

/// {projectId: счётчики} — три запроса на весь список, а не три на проект.
pub fn all_counts(tx: &Transaction) -> rusqlite::Result<HashMap<String, Counts>> {
    let mut out: HashMap<String, Counts> = HashMap::new();
    let mut st = tx.prepare("SELECT projectId, COUNT(*) FROM nodes GROUP BY projectId")?;
    for r in st.query_map([], |r| Ok((col_text(r, "projectId"), r.get::<_, i64>(1)?)))? {
        let (p, c) = r?;
        out.entry(p).or_default().nodes = c;
    }
    let mut st = tx.prepare("SELECT projectId, COUNT(*) FROM edges GROUP BY projectId")?;
    for r in st.query_map([], |r| Ok((col_text(r, "projectId"), r.get::<_, i64>(1)?)))? {
        let (p, c) = r?;
        out.entry(p).or_default().edges = c;
    }
    let mut st = tx.prepare("SELECT projectId, typeId, COUNT(*) FROM nodes GROUP BY projectId, typeId")?;
    for r in st.query_map([], |r| Ok((col_text(r, "projectId"), col_text(r, "typeId"), r.get::<_, i64>(2)?)))? {
        let (p, t, c) = r?;
        out.entry(p).or_default().by_type.push((t, c));
    }
    Ok(out)
}

/// Состав проекта по типам: [{color, count}], крупные доли первыми.
fn type_mix(settings: &Value, by_type: &[(String, i64)]) -> Value {
    if by_type.is_empty() {
        return json!([]);
    }
    let colors: HashMap<String, String> = settings["nodeTypes"]
        .as_array()
        .map(|a| a.iter().map(|t| (text(t.get("id")), text(t.get("color")))).collect())
        .unwrap_or_default();
    let mut merged: Vec<(String, i64)> = Vec::new();
    for (type_id, count) in by_type {
        let color = colors.get(type_id).filter(|c| !c.is_empty()).cloned().unwrap_or_else(|| ORPHAN_TYPE_COLOR.into());
        match merged.iter_mut().find(|(c, _)| *c == color) {
            Some(slot) => slot.1 += count,
            None => merged.push((color, *count)),
        }
    }
    merged.sort_by(|a, b| b.1.cmp(&a.1));
    let tail: i64 = merged.iter().skip(TYPE_MIX_LIMIT).map(|(_, n)| n).sum();
    let mut out: Vec<Value> = merged.iter().take(TYPE_MIX_LIMIT).map(|(c, n)| json!({"color": c, "count": n})).collect();
    if tail > 0 {
        out.push(json!({"color": ORPHAN_TYPE_COLOR, "count": tail}));
    }
    Value::Array(out)
}

pub fn project_row(row: &Row, counts: Option<&Counts>) -> rusqlite::Result<Value> {
    let settings = catalog::merged_settings(&col_json(row, "settings", json!({})));
    let created = col_text(row, "createdAt");
    let meta = col_text(row, "metaUpdatedAt");
    let c = counts.cloned().unwrap_or_default();
    Ok(json!({
        "id": col_text(row, "id"),
        "name": col_text(row, "name"),
        "description": col_text(row, "description"),
        "typeMix": type_mix(&settings, &c.by_type),
        "settings": settings,
        "createdAt": created,
        "updatedAt": col_text(row, "updatedAt"),
        "metaUpdatedAt": if meta.is_empty() { created } else { meta },
        "nodeCount": c.nodes,
        "edgeCount": c.edges,
    }))
}

pub fn get_project_row(tx: &Transaction, id: &str, with_counts: bool) -> rusqlite::Result<Option<Value>> {
    let counts = if with_counts { all_counts(tx)?.remove(id) } else { None };
    tx.query_row("SELECT * FROM projects WHERE id = ?", [id], |r| project_row(r, counts.as_ref()))
        .optional()
}

pub fn require_project(tx: &Transaction, id: &str, with_counts: bool) -> ApiResult<Value> {
    get_project_row(tx, id, with_counts)?.ok_or_else(|| fail(404, "projectNotFound", "Project not found"))
}

pub fn list_projects(tx: &Transaction) -> rusqlite::Result<Vec<Value>> {
    let counts = all_counts(tx)?;
    let mut st = tx.prepare("SELECT * FROM projects ORDER BY updatedAt DESC")?;
    let rows = st.query_map([], |r| {
        let id = col_text(r, "id");
        project_row(r, counts.get(&id))
    })?;
    rows.collect()
}

pub fn insert_project(tx: &Transaction, p: &Value, deleted: &Value) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO projects (id, name, description, settings, createdAt, updatedAt, metaUpdatedAt, deleted) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            text(p.get("id")), text(p.get("name")), text(p.get("description")),
            to_json(&p["settings"]), text(p.get("createdAt")), text(p.get("updatedAt")),
            text(p.get("metaUpdatedAt")), to_json(deleted),
        ],
    )?;
    Ok(())
}

/* ---------------- узлы и связи ---------------- */

/// Узел и связь вставляются из пяти мест (создание, пример шаблона, импорт,
/// копия, замена содержимого) — вставка одна, чтобы колонки не расходились.
pub fn insert_node(tx: &Transaction, project_id: &str, n: &Value, node_id: &str,
                   id_map: Option<&HashMap<String, String>>) -> rusqlite::Result<String> {
    let pos = n.get("position").cloned().unwrap_or(Value::Null);
    let position = json!({ "x": number_or_zero(pos.get("x")), "y": number_or_zero(pos.get("y")) });
    let mut entries = list_or_empty(n.get("dates"));
    if entries.as_array().is_some_and(|a| a.is_empty()) {
        entries = legacy_date_entries(&text(n.get("date")));
    }
    if let Some(map) = id_map {
        entries = remap_date_refs(&entries, map);
    }
    let created = if truthy(n.get("createdAt")) { text(n.get("createdAt")) } else { now_iso() };
    let updated = if truthy(n.get("updatedAt")) { text(n.get("updatedAt")) } else { created.clone() };
    let type_id = if truthy(n.get("typeId")) { text(n.get("typeId")) } else { "note".into() };
    let image = store_image(tx, &text(n.get("image")))?;
    tx.execute(
        "INSERT INTO nodes (id, projectId, typeId, title, description, fields, position, tags, image, \
         date, dates, canvas, width, cardMode, createdAt, updatedAt) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            node_id, project_id, type_id, text(n.get("title")), text(n.get("description")),
            to_json(&list_or_empty(n.get("fields"))), to_json(&position),
            to_json(&list_or_empty(n.get("tags"))), image, text(n.get("date")), to_json(&entries),
            text(n.get("canvas")), int_of(n.get("width")), text(n.get("cardMode")), created, updated,
        ],
    )?;
    Ok(image)
}

pub fn insert_edge(tx: &Transaction, project_id: &str, e: &Value, edge_id: &str,
                   source: &str, target: &str) -> rusqlite::Result<()> {
    let updated = if truthy(e.get("updatedAt")) { text(e.get("updatedAt")) } else { now_iso() };
    tx.execute(
        "INSERT INTO edges (id, projectId, source, target, label, relType, color, points, \
         sourceHandle, targetHandle, shape, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            edge_id, project_id, source, target, text(e.get("label")), text(e.get("relType")),
            text(e.get("color")), to_json(&list_or_empty(e.get("points"))),
            text(e.get("sourceHandle")), text(e.get("targetHandle")), text(e.get("shape")), updated,
        ],
    )?;
    Ok(())
}

fn id_taken(tx: &Transaction, table: &str, id: &str) -> rusqlite::Result<bool> {
    Ok(tx.query_row(&format!("SELECT 1 FROM {table} WHERE id = ?"), [id], |_| Ok(()))
        .optional()?
        .is_some())
}

/// Узлы и связи снимка в проект.
///
/// keep_ids — оставить id из снимка (синхронизация, восстановление): по ним
/// одно и то же узнаётся на разных устройствах. id, занятый в другом проекте,
/// всё равно заменяется — чужой узел перезаписывать нельзя.
pub fn insert_graph(tx: &Transaction, project_id: &str, nodes: &[Value], edges: &[Value],
                    keep_ids: bool) -> rusqlite::Result<usize> {
    let mut id_map: HashMap<String, String> = HashMap::new();
    let mut used: HashSet<String> = HashSet::new();
    let mut plan = Vec::with_capacity(nodes.len());
    for n in nodes {
        let nid = text(n.get("id"));
        let new_id = if keep_ids && !nid.is_empty() && !used.contains(&nid) && !id_taken(tx, "nodes", &nid)? {
            nid.clone()
        } else {
            new_id()
        };
        used.insert(new_id.clone());
        if !nid.is_empty() {
            id_map.entry(nid).or_insert_with(|| new_id.clone());
        }
        plan.push((n, new_id));
    }
    // Карта id готова целиком до первой вставки: относительные даты ссылаются
    // на другие узлы, и их надо переписать на новые id.
    for (n, nid) in &plan {
        insert_node(tx, project_id, n, nid, Some(&id_map))?;
    }
    let mut seen: HashSet<String> = HashSet::new();
    for e in edges {
        let (Some(src), Some(tgt)) = (id_map.get(&text(e.get("source"))), id_map.get(&text(e.get("target")))) else {
            continue; // висящая связь в файле — отбрасываем
        };
        if src == tgt {
            continue;
        }
        let eid = text(e.get("id"));
        let eid = if keep_ids && !eid.is_empty() && !seen.contains(&eid) && !id_taken(tx, "edges", &eid)? {
            eid
        } else {
            new_id()
        };
        seen.insert(eid.clone());
        insert_edge(tx, project_id, e, &eid, src, tgt)?;
    }
    Ok(plan.len())
}

pub fn graph(tx: &Transaction, project_id: &str) -> rusqlite::Result<(Vec<Value>, Vec<Value>)> {
    let nodes = {
        let mut st = tx.prepare("SELECT * FROM nodes WHERE projectId = ?")?;
        let it = st.query_map([project_id], node_row)?;
        it.collect::<Result<Vec<_>, _>>()?
    };
    let edges = {
        let mut st = tx.prepare("SELECT * FROM edges WHERE projectId = ?")?;
        let it = st.query_map([project_id], edge_row)?;
        it.collect::<Result<Vec<_>, _>>()?
    };
    Ok((nodes, edges))
}

pub fn get_node(tx: &Transaction, id: &str) -> rusqlite::Result<Option<Value>> {
    tx.query_row("SELECT * FROM nodes WHERE id = ?", [id], node_row).optional()
}

pub fn get_edge(tx: &Transaction, id: &str) -> rusqlite::Result<Option<Value>> {
    tx.query_row("SELECT * FROM edges WHERE id = ?", [id], edge_row).optional()
}

pub fn save_node(tx: &Transaction, doc: &Value) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE nodes SET typeId = ?, title = ?, description = ?, fields = ?, position = ?, tags = ?, \
         image = ?, date = ?, dates = ?, canvas = ?, width = ?, cardMode = ?, updatedAt = ? WHERE id = ?",
        params![
            text(doc.get("typeId")), text(doc.get("title")), text(doc.get("description")),
            to_json(&doc["fields"]), to_json(&doc["position"]), to_json(&doc["tags"]),
            text(doc.get("image")), text(doc.get("date")), to_json(&doc["dates"]),
            text(doc.get("canvas")), int_of(doc.get("width")), text(doc.get("cardMode")),
            text(doc.get("updatedAt")), text(doc.get("id")),
        ],
    )?;
    Ok(())
}

pub fn save_edge(tx: &Transaction, doc: &Value) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE edges SET label = ?, relType = ?, color = ?, source = ?, target = ?, points = ?, \
         sourceHandle = ?, targetHandle = ?, shape = ?, updatedAt = ? WHERE id = ?",
        params![
            text(doc.get("label")), text(doc.get("relType")), text(doc.get("color")),
            text(doc.get("source")), text(doc.get("target")), to_json(&doc["points"]),
            text(doc.get("sourceHandle")), text(doc.get("targetHandle")), text(doc.get("shape")),
            text(doc.get("updatedAt")), text(doc.get("id")),
        ],
    )?;
    Ok(())
}

pub fn delete_node(tx: &Transaction, node: &Value) -> rusqlite::Result<()> {
    let id = text(node.get("id"));
    let pid = text(node.get("projectId"));
    let edge_ids: Vec<String> = {
        let mut st = tx.prepare("SELECT id FROM edges WHERE source = ? OR target = ?")?;
        let it = st.query_map(params![id, id], |r| r.get::<_, String>(0))?;
        it.collect::<Result<_, _>>()?
    };
    tx.execute("DELETE FROM nodes WHERE id = ?", [&id])?;
    tx.execute("DELETE FROM edges WHERE source = ? OR target = ?", params![id, id])?;
    mark_deleted(tx, &pid, &[id], &edge_ids)?;
    touch_project(tx, &pid)
}

pub fn delete_edge(tx: &Transaction, edge: &Value) -> rusqlite::Result<()> {
    let id = text(edge.get("id"));
    let pid = text(edge.get("projectId"));
    tx.execute("DELETE FROM edges WHERE id = ?", [&id])?;
    mark_deleted(tx, &pid, &[], &[id])?;
    touch_project(tx, &pid)
}

/// Разложить пример шаблона по таблицам. Пустой шаблон — ничего не делает.
pub fn insert_starter(tx: &Transaction, project_id: &str, template: &str, lang: &str) -> rusqlite::Result<()> {
    if !catalog::template_spec(template).is_some_and(|s| s["starter"].as_bool() == Some(true)) {
        return Ok(());
    }
    let nodes = catalog::starter_nodes(lang);
    let ids: HashMap<String, String> = nodes.iter().map(|n| (n.key.clone(), new_id())).collect();
    let stamp = now_iso();
    let canvas = catalog::canvases_for(template, lang)[0]["id"].clone();
    for n in &nodes {
        let data = json!({
            "typeId": n.type_id, "title": n.title, "description": n.description,
            "position": {"x": n.x, "y": n.y}, "tags": n.tags,
            "dates": catalog::starter_dates(&n.key, &ids), "canvas": canvas, "createdAt": stamp,
        });
        insert_node(tx, project_id, &data, &ids[&n.key], None)?;
    }
    for (a, b, rel) in catalog::starter_edges() {
        insert_edge(tx, project_id, &json!({"relType": rel, "updatedAt": stamp}), &new_id(), &ids[&a], &ids[&b])?;
    }
    Ok(())
}

/* ---------------- снимки ---------------- */

/// Проект целиком. inline — картинки строками data: (для файла).
pub fn snapshot(tx: &Transaction, project_id: &str, inline: bool) -> rusqlite::Result<Option<Value>> {
    let row = tx
        .query_row("SELECT * FROM projects WHERE id = ?", [project_id], |r| {
            Ok((project_row(r, None)?, col_text(r, "deleted")))
        })
        .optional()?;
    let Some((mut project, deleted)) = row else { return Ok(None) };
    project["deleted"] = prune_deleted(&load_deleted(&Value::String(deleted)));
    let (mut nodes, edges) = graph(tx, project_id)?;
    if inline {
        for n in nodes.iter_mut() {
            let img = text(n.get("image"));
            n["image"] = json!(inline_image(tx, &img)?);
        }
    }
    Ok(Some(json!({
        "format": "bluegem-project",
        "version": 1,
        "exportedAt": now_iso(),
        "project": project,
        "nodes": nodes,
        "edges": edges,
    })))
}

/// Новый проект из снимка (импорт, копия).
pub fn insert_snapshot(tx: &Transaction, name: &str, description: &str, settings: &Value,
                       nodes: &[Value], edges: &[Value], keep_ids: bool, project_id: Option<&str>,
                       deleted: &Value, meta_updated_at: &str) -> rusqlite::Result<Value> {
    let keep = keep_ids
        && project_id.is_some_and(|id| !id.is_empty())
        && !id_taken(tx, "projects", project_id.unwrap())?;
    let stamp = now_iso();
    let id = if keep { project_id.unwrap().to_string() } else { new_id() };
    let meta = if keep && !meta_updated_at.is_empty() { meta_updated_at.to_string() } else { stamp.clone() };
    let p = json!({
        "id": id, "name": name, "description": description,
        "settings": catalog::merged_settings(settings),
        "createdAt": stamp, "updatedAt": stamp, "metaUpdatedAt": meta,
    });
    let dead = if keep { prune_deleted(&load_deleted(deleted)) } else { json!({}) };
    insert_project(tx, &p, &dead)?;
    let count = insert_graph(tx, &id, nodes, edges, keep)?;
    let mut out = p;
    out["nodeCount"] = json!(count);
    out["edgeCount"] = json!(0);
    out["typeMix"] = json!([]);
    Ok(out)
}

/// Заменить содержимое проекта снимком, сохранив id проекта и узлов.
pub fn replace_content(tx: &Transaction, project_id: &str, snap: &Value) -> ApiResult<Value> {
    let current = require_project(tx, project_id, false)?;
    let src = snap.get("project").cloned().unwrap_or_else(|| json!({}));
    let mut name = text(src.get("name")).trim().to_string();
    if name.is_empty() {
        name = text(current.get("name"));
    }
    let settings = if truthy(src.get("settings")) { src["settings"].clone() } else { current["settings"].clone() };
    let description = match src.get("description") {
        Some(v) if !v.is_null() => text(Some(v)),
        _ => text(current.get("description")),
    };
    let stamp = now_iso();
    tx.execute("DELETE FROM nodes WHERE projectId = ?", [project_id])?;
    tx.execute("DELETE FROM edges WHERE projectId = ?", [project_id])?;
    let empty = vec![];
    let nodes = snap.get("nodes").and_then(|v| v.as_array()).unwrap_or(&empty);
    let edges = snap.get("edges").and_then(|v| v.as_array()).unwrap_or(&empty);
    insert_graph(tx, project_id, nodes, edges, true)?;
    let meta = if truthy(src.get("metaUpdatedAt")) { text(src.get("metaUpdatedAt")) } else { stamp.clone() };
    tx.execute(
        "UPDATE projects SET name = ?, description = ?, settings = ?, updatedAt = ?, metaUpdatedAt = ?, \
         deleted = ? WHERE id = ?",
        params![
            name, description, to_json(&catalog::merged_settings(&settings)), stamp, meta,
            to_json(&prune_deleted(&load_deleted(src.get("deleted").unwrap_or(&Value::Null)))), project_id,
        ],
    )?;
    require_project(tx, project_id, true)
}

/* ---------------- резервные копии ---------------- */

fn content_hash(snap: &Value) -> String {
    let strip = |list: &Value| -> Vec<Value> {
        let mut out: Vec<Value> = list.as_array().cloned().unwrap_or_default().into_iter()
            .map(|mut v| {
                if let Some(o) = v.as_object_mut() {
                    o.remove("updatedAt");
                }
                v
            })
            .collect();
        out.sort_by_key(|v| text(v.get("id")));
        out
    };
    let p = &snap["project"];
    // Ключи объектов serde_json упорядочены — одинаковое содержимое даёт
    // одинаковую строку.
    let body = json!({
        "p": [p["name"], p["description"], p["settings"]],
        "n": strip(&snap["nodes"]),
        "e": strip(&snap["edges"]),
    });
    hex(&Sha256::digest(to_json(&body).as_bytes()))
}

fn backup_row(r: &Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": col_text(r, "id"), "projectId": col_text(r, "projectId"),
        "createdAt": col_text(r, "createdAt"), "reason": col_text(r, "reason"),
        "name": col_text(r, "name"), "nodeCount": col_int(r, "nodeCount"),
        "edgeCount": col_int(r, "edgeCount"),
    }))
}

/// Снять копию. Если содержимое не изменилось с прошлой — вернуть прошлую.
pub fn make_backup(tx: &Transaction, project_id: &str, reason: &str) -> rusqlite::Result<Option<Value>> {
    let Some(snap) = snapshot(tx, project_id, false)? else { return Ok(None) };
    let digest = content_hash(&snap);
    let last = tx
        .query_row(
            "SELECT * FROM backups WHERE projectId = ? ORDER BY createdAt DESC LIMIT 1",
            [project_id],
            |r| Ok((col_text(r, "hash"), backup_row(r)?)),
        )
        .optional()?;
    if let Some((hash, row)) = last {
        if hash == digest {
            return Ok(Some(row));
        }
    }
    let doc = json!({
        "id": new_id(), "projectId": project_id, "createdAt": now_iso(), "reason": reason,
        "name": snap["project"]["name"],
        "nodeCount": snap["nodes"].as_array().map_or(0, |a| a.len()),
        "edgeCount": snap["edges"].as_array().map_or(0, |a| a.len()),
    });
    tx.execute(
        "INSERT INTO backups (id, projectId, createdAt, reason, hash, name, nodeCount, edgeCount, data) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            text(doc.get("id")), project_id, text(doc.get("createdAt")), reason, digest,
            text(doc.get("name")), int_of(doc.get("nodeCount")), int_of(doc.get("edgeCount")), to_json(&snap),
        ],
    )?;
    prune_backups(tx, project_id)?;
    Ok(Some(doc))
}

/// Копия перед правкой, если последней больше десяти минут. Так в копиях
/// всегда есть состояние «до»: и случайно удалённый узел, и неудачная
/// раскладка возвращаются из ближайшей копии.
pub fn maybe_backup(tx: &Transaction, project_id: &str) -> rusqlite::Result<()> {
    let last: Option<String> = tx
        .query_row(
            "SELECT createdAt FROM backups WHERE projectId = ? ORDER BY createdAt DESC LIMIT 1",
            [project_id],
            |r| Ok(col_text(r, "createdAt")),
        )
        .optional()?;
    if let Some(when) = last.and_then(|t| DateTime::parse_from_rfc3339(&t).ok()) {
        if Utc::now().signed_duration_since(when) < Duration::minutes(BACKUP_INTERVAL_MIN) {
            return Ok(());
        }
    }
    make_backup(tx, project_id, "auto")?;
    Ok(())
}

/// Какие копии убрать. rows — от новых к старым: (id, createdAt).
pub fn backups_to_drop(rows: &[(String, String)], now: DateTime<Utc>) -> Vec<String> {
    let cutoff = iso(now - Duration::days(BACKUP_KEEP_DAYS));
    let mut drop = Vec::new();
    let mut days: HashSet<String> = HashSet::new();
    for (i, (id, created)) in rows.iter().enumerate() {
        let day: String = created.chars().take(10).collect();
        if i < BACKUP_KEEP_RECENT {
            days.insert(day);
        } else if *created < cutoff || days.contains(&day) {
            drop.push(id.clone());
        } else {
            days.insert(day);
        }
    }
    drop
}

fn prune_backups(tx: &Transaction, project_id: &str) -> rusqlite::Result<()> {
    let rows: Vec<(String, String)> = {
        let mut st = tx.prepare("SELECT id, createdAt FROM backups WHERE projectId = ? ORDER BY createdAt DESC")?;
        let it = st.query_map([project_id], |r| Ok((col_text(r, "id"), col_text(r, "createdAt"))))?;
        it.collect::<Result<_, _>>()?
    };
    for id in backups_to_drop(&rows, Utc::now()) {
        tx.execute("DELETE FROM backups WHERE id = ?", [id])?;
    }
    Ok(())
}

pub fn list_backups(tx: &Transaction, project_id: &str) -> rusqlite::Result<Vec<Value>> {
    let mut st = tx.prepare(
        "SELECT id, projectId, createdAt, reason, name, nodeCount, edgeCount FROM backups \
         WHERE projectId = ? ORDER BY createdAt DESC",
    )?;
    let it = st.query_map([project_id], backup_row)?;
    it.collect()
}

/// Вернуть проект к копии. Текущее состояние перед этим само уходит в копию.
pub fn restore_backup(tx: &Transaction, backup_id: &str) -> ApiResult<Value> {
    let row: Option<(String, String)> = tx
        .query_row("SELECT projectId, data FROM backups WHERE id = ?", [backup_id], |r| {
            Ok((col_text(r, "projectId"), col_text(r, "data")))
        })
        .optional()?;
    let Some((project_id, data)) = row else {
        return Err(fail(404, "backupNotFound", "Backup not found"));
    };
    let mut snap: Value = serde_json::from_str(&data).unwrap_or_else(|_| json!({}));
    make_backup(tx, &project_id, "restore")?;
    let current = snapshot(tx, &project_id, false)?.unwrap_or_else(|| json!({"nodes": [], "edges": []}));
    // Возвращённое — свежая правка: на другом устройстве эти узлы не должны
    // проиграть старым следам удаления, а пропавшие — должны пропасть и там.
    let stamp = now_iso();
    let ids = |list: &Value| -> HashSet<String> {
        list.as_array().map(|a| a.iter().map(|v| text(v.get("id"))).collect()).unwrap_or_default()
    };
    let keep_n = ids(&snap["nodes"]);
    let keep_e = ids(&snap["edges"]);
    let mut dead = load_deleted(&current["project"]["deleted"]);
    for (kind, keep) in [("nodes", &keep_n), ("edges", &keep_e)] {
        for id in ids(&current[kind]) {
            if !keep.contains(&id) {
                dead[kind][&id] = json!(stamp);
            }
        }
        if let Some(m) = dead[kind].as_object_mut() {
            for id in keep.iter() {
                m.remove(id);
            }
        }
    }
    for kind in ["nodes", "edges"] {
        if let Some(list) = snap.get_mut(kind).and_then(|v| v.as_array_mut()) {
            for item in list.iter_mut() {
                item["updatedAt"] = json!(stamp);
            }
        }
    }
    if !snap["project"].is_object() {
        snap["project"] = json!({});
    }
    snap["project"]["deleted"] = dead;
    snap["project"]["metaUpdatedAt"] = json!(stamp);
    replace_content(tx, &project_id, &snap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn retention_keeps_recent_then_one_per_day() {
        let now = Utc.with_ymd_and_hms(2026, 11, 11, 12, 0, 0).unwrap();
        let mut rows: Vec<(String, String)> = (0..20)
            .map(|i| (format!("t{i}"), iso(now - Duration::minutes(10 * i))))
            .collect();
        for d in 1..40 {
            for h in [18, 9] {
                let day = (now - Duration::days(d)).date_naive().and_hms_opt(h, 0, 0).unwrap().and_utc();
                rows.push((format!("d{d}-{h}"), iso(day)));
            }
        }
        rows.sort_by(|a, b| b.1.cmp(&a.1));
        let drop: HashSet<String> = backups_to_drop(&rows, now).into_iter().collect();
        for i in 0..12 {
            assert!(!drop.contains(&format!("t{i}")));
        }
        let older: Vec<&(String, String)> = rows.iter().filter(|r| !drop.contains(&r.0) && !r.0.starts_with('t')).collect();
        let days: HashSet<String> = older.iter().map(|r| r.1[..10].to_string()).collect();
        assert_eq!(days.len(), older.len());
        let cutoff = iso(now - Duration::days(30));
        assert!(older.iter().all(|r| r.1 >= cutoff));
    }

    #[test]
    fn legacy_dates() {
        assert_eq!(legacy_date_entries("1149")[0]["start"]["y"], 1149);
        assert_eq!(legacy_date_entries(" -42 ")[0]["start"]["kind"], "exact");
        assert_eq!(legacy_date_entries("Третья эпоха")[0]["start"]["kind"], "unknown");
        assert_eq!(legacy_date_entries(""), json!([]));
    }

    #[test]
    fn data_urls() {
        let (mime, bytes) = parse_data_url("data:image/png;base64,aGk=\n").unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, b"hi");
        assert!(parse_data_url("data:text/plain;base64,aGk=").is_none());
        assert!(parse_data_url("https://example.com/a.png").is_none());
    }

    #[test]
    fn finds_image_refs() {
        let h = "a".repeat(64);
        let mut out = HashSet::new();
        image_refs(&format!("x bg-image:{h} y bg-image:zz"), &mut out);
        assert_eq!(out.into_iter().collect::<Vec<_>>(), vec![h]);
    }
}
