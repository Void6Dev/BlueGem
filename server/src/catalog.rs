//! Заготовки: типы узлов и связей, страницы, подсказки характеристик, шаблоны
//! проектов и пример кампании. Это данные пользователя, а не интерфейсный
//! текст, поэтому живут на сервере; сами значения — в catalog.json (выгружены
//! из прежнего backend/server.py, чтобы подписи и цвета совпали до буквы).
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::LazyLock;

pub static CAT: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(include_str!("catalog.json")).expect("catalog.json"));

fn lang_table<'a>(table: &'a Value, lang: &str) -> &'a Value {
    let default = CAT["defaultLang"].as_str().unwrap_or("en");
    table.get(lang).filter(|v| !v.is_null()).unwrap_or(&table[default])
}

pub fn default_template() -> &'static str {
    CAT["defaultTemplate"].as_str().unwrap_or("blank")
}

pub fn default_settings() -> &'static Map<String, Value> {
    CAT["defaultSettings"].as_object().expect("defaultSettings")
}

/// Настройки, сохранённые в проекте, поверх значений по умолчанию: у старых
/// проектов нет ключей, появившихся позже.
pub fn merged_settings(stored: &Value) -> Value {
    let mut out = default_settings().clone();
    if let Some(obj) = stored.as_object() {
        for (k, v) in obj {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out)
}

pub fn template_spec(id: &str) -> Option<&'static Value> {
    CAT["templates"].get(id)
}

pub fn template_ids() -> Vec<&'static str> {
    CAT["templateOrder"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect()
}

fn str_list(v: &Value) -> Vec<&str> {
    v.as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default()
}

pub fn node_types_for(lang: &str, ids: &[&str]) -> Value {
    let labels = lang_table(&CAT["nodeTypeLabels"], lang);
    let colors = &CAT["nodeTypeColors"];
    Value::Array(
        ids.iter()
            .filter(|k| colors.get(**k).is_some())
            .map(|k| {
                json!({
                    "id": k, "label": labels[*k], "color": colors[*k][0], "icon": colors[*k][1],
                })
            })
            .collect(),
    )
}

pub fn rel_types_for(lang: &str, ids: &[&str]) -> Value {
    let labels = lang_table(&CAT["relTypeLabels"], lang);
    let colors = &CAT["relTypeColors"];
    Value::Array(
        ids.iter()
            .filter(|k| colors.get(**k).is_some())
            .map(|k| json!({ "id": k, "label": labels[*k], "color": colors[*k] }))
            .collect(),
    )
}

pub fn canvases_for(template: &str, lang: &str) -> Value {
    let spec = template_spec(template).or_else(|| template_spec(default_template())).unwrap();
    let labels = lang_table(&CAT["pageLabels"], lang);
    let main = lang_table(&CAT["mainCanvasLabels"], lang);
    Value::Array(
        str_list(&spec["pages"])
            .into_iter()
            .map(|p| json!({ "id": p, "label": if p == "main" { main.clone() } else { labels[p].clone() } }))
            .collect(),
    )
}

fn field_templates_for(template: &str, lang: &str, type_ids: &[&str]) -> Value {
    let base = lang_table(&CAT["fieldTemplates"], lang);
    let special = CAT["templateFieldTemplates"]
        .get(template)
        .map(|t| lang_table(t, lang).clone())
        .unwrap_or(Value::Null);
    let mut out = Map::new();
    for t in type_ids {
        let keys = special.get(*t).filter(|v| v.as_array().is_some_and(|a| !a.is_empty()))
            .or_else(|| base.get(*t).filter(|v| v.as_array().is_some_and(|a| !a.is_empty())));
        if let Some(k) = keys {
            out.insert((*t).to_string(), k.clone());
        }
    }
    Value::Object(out)
}

pub fn settings_for_template(template: &str, lang: &str) -> Value {
    let template = if template_spec(template).is_some() { template } else { default_template() };
    let spec = template_spec(template).unwrap();
    let types = str_list(&spec["types"]);
    let mut out = default_settings().clone();
    out.insert("nodeTypes".into(), node_types_for(lang, &types));
    out.insert("relTypes".into(), rel_types_for(lang, &str_list(&spec["rels"])));
    out.insert("canvases".into(), canvases_for(template, lang));
    out.insert("fieldTemplates".into(), field_templates_for(template, lang, &types));
    out.insert("template".into(), json!(template));
    Value::Object(out)
}

/// GET /api/templates: что заводит каждый шаблон.
pub fn list_templates(lang: &str) -> Value {
    Value::Array(
        template_ids()
            .into_iter()
            .map(|id| {
                let spec = template_spec(id).unwrap();
                let pages: Vec<Value> = canvases_for(id, lang)
                    .as_array().unwrap().iter().map(|c| c["label"].clone()).collect();
                json!({
                    "id": id,
                    "types": node_types_for(lang, &str_list(&spec["types"])),
                    "pages": pages,
                    "starter": spec["starter"],
                })
            })
            .collect(),
    )
}

/// Узел примера кампании: (ключ, тип, x, y, теги, название, описание, даты).
pub struct StarterNode {
    pub key: String,
    pub type_id: String,
    pub x: Value,
    pub y: Value,
    pub tags: Value,
    pub title: String,
    pub description: String,
}

pub fn starter_nodes(lang: &str) -> Vec<StarterNode> {
    let text = lang_table(&CAT["starterText"], lang);
    CAT["starterNodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            let key = r[0].as_str().unwrap().to_string();
            StarterNode {
                type_id: r[1].as_str().unwrap().to_string(),
                x: r[2].clone(),
                y: r[3].clone(),
                tags: r[4].clone(),
                title: text[&key][0].as_str().unwrap_or("").to_string(),
                description: text[&key][1].as_str().unwrap_or("").to_string(),
                key,
            }
        })
        .collect()
}

pub fn starter_edges() -> Vec<(String, String, String)> {
    CAT["starterEdges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (s(&r[0]), s(&r[1]), s(&r[2])))
        .collect()
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

/// Записи дат узла примера с настоящими id в относительных ссылках.
pub fn starter_dates(key: &str, ids: &HashMap<String, String>) -> Value {
    let Some(list) = CAT["starterDates"].get(key).and_then(|v| v.as_array()) else {
        return json!([]);
    };
    Value::Array(
        list.iter()
            .enumerate()
            .map(|(i, e)| {
                let mut start = e[1].clone();
                if let Some(rel) = start.get("rel").cloned() {
                    let node = rel["node"].as_str().unwrap_or("");
                    start["rel"] = json!({
                        "nodeId": ids.get(node).cloned().unwrap_or_default(), "entryId": null,
                        "edge": "start", "amount": rel["amount"], "unit": rel["unit"], "dir": rel["dir"],
                    });
                }
                json!({ "id": format!("s{i}"), "key": e[0], "label": "", "start": start, "end": null })
            })
            .collect(),
    )
}
