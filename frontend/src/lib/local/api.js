// API без сервера: те же методы, что у lib/api.js, но данные лежат в
// IndexedDB прямо в приложении.
//
// Зачем. На Android нет ни Python, ни соседнего процесса, которому можно
// отдать запросы, — и не нужно: проекты одного человека на одном устройстве
// помещаются в браузерное хранилище с запасом. Поведение повторяет
// backend/server.py шаг в шаг, включая мелочи: связь сама с собой запрещена,
// повторная связь возвращает существующую, импорт переписывает ссылки
// относительных дат на новые id. Интерфейс не должен замечать, с каким из двух
// «серверов» он разговаривает.
import { req, tx } from "@/lib/local/db";
import {
  DEFAULT_LANG, DEFAULT_SETTINGS, DEFAULT_TEMPLATE, TEMPLATES,
  DND_STARTER_DATES, DND_STARTER_EDGES, DND_STARTER_NODES, DND_STARTER_TEXT,
  canvasesFor, nodeTypesFor, settingsForTemplate,
} from "@/lib/local/templates";
import {
  BACKUP_INTERVAL_MS, backupsToDrop, contentHash, normalizeDeleted, pruneDeleted,
} from "@/lib/local/policy";
import { blobToDataUrl, imageHash, isImageRef, toImageRecord } from "@/lib/images";

/* ---------------- служебное ---------------- */

const nowIso = () => new Date().toISOString();

export function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Ошибка в том же виде, в каком её отдал бы axios: apiErrorMessage читает
 * код из response.data.detail и подбирает подпись на языке интерфейса.
 */
function fail(status, code, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: { code, message } } };
  return err;
}

const str = (v, fallback = "") => (v == null ? fallback : String(v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const int = (v) => Math.trunc(num(v));

function cleanFields(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((f) => f && typeof f === "object")
    .map((f) => ({ key: str(f.key), value: str(f.value) }));
}

function cleanPosition(p) {
  return { x: num(p?.x), y: num(p?.y) };
}

function cleanPoints(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p && typeof p === "object").map((p) => ({ x: num(p.x), y: num(p.y) }));
}

function cleanTags(list) {
  return Array.isArray(list) ? list.map((t) => str(t)) : [];
}

function cleanDates(list) {
  return Array.isArray(list) ? list.filter((d) => d && typeof d === "object") : [];
}

/* ---------------- хронология: те же правила, что в server.py ---------------- */

const LEADING_YEAR = /^\s*(-?\d{1,9})\s*$/;

/** Старая свободная строка даты → одна структурная запись. */
export function legacyDateEntries(text) {
  const s = str(text).trim();
  if (!s) return [];
  const m = LEADING_YEAR.exec(s);
  const start = m
    ? { kind: "exact", y: parseInt(m[1], 10), m: null, d: null }
    : { kind: "unknown", raw: s };
  return [{ id: "legacy", key: "date", label: "", start, end: null }];
}

/** Переписать ссылки относительных дат на новые id узлов. */
export function remapDateRefs(entries, idMap) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((e) => e && typeof e === "object").map((entry) => {
    const out = { ...entry };
    for (const edge of ["start", "end"]) {
      const value = out[edge];
      if (value && typeof value === "object" && value.rel && typeof value.rel === "object") {
        const rel = { ...value.rel };
        rel.nodeId = idMap[rel.nodeId] ?? rel.nodeId;
        out[edge] = { ...value, rel };
      }
    }
    return out;
  });
}

/* ---------------- проекты: сведение и состав ---------------- */

const ORPHAN_TYPE_COLOR = "#6E6E7A";
const TYPE_MIX_LIMIT = 6;

function typeMix(settings, byType) {
  if (!byType || !Object.keys(byType).length) return [];
  const colors = {};
  for (const t of settings.nodeTypes || []) colors[t.id] = t.color;
  const merged = new Map();
  for (const [typeId, count] of Object.entries(byType)) {
    const color = colors[typeId] || ORPHAN_TYPE_COLOR;
    merged.set(color, (merged.get(color) || 0) + count);
  }
  const ordered = [...merged.entries()].sort((a, b) => b[1] - a[1]);
  const head = ordered.slice(0, TYPE_MIX_LIMIT).map(([color, count]) => ({ color, count }));
  const tail = ordered.slice(TYPE_MIX_LIMIT).reduce((s, [, n]) => s + n, 0);
  if (tail) head.push({ color: ORPHAN_TYPE_COLOR, count: tail });
  return head;
}

function projectRow(record, counts) {
  const settings = { ...DEFAULT_SETTINGS, ...(record.settings || {}) };
  return {
    id: record.id,
    name: record.name,
    description: record.description || "",
    settings,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    metaUpdatedAt: record.metaUpdatedAt || record.createdAt,
    nodeCount: counts?.nodes || 0,
    edgeCount: counts?.edges || 0,
    typeMix: typeMix(settings, counts?.byType || {}),
  };
}

/** {projectId: {nodes, edges, byType}} — по ключам индексов, без значений. */
async function allCounts(stores) {
  const out = {};
  const bucket = (pid) => {
    if (!out[pid]) out[pid] = { nodes: 0, edges: 0, byType: {} };
    return out[pid];
  };
  await new Promise((resolve, reject) => {
    const cursorReq = stores.nodes.index("projectType").openKeyCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur) { resolve(); return; }
      const [pid, typeId] = cur.key;
      const b = bucket(pid);
      b.nodes += 1;
      b.byType[typeId] = (b.byType[typeId] || 0) + 1;
      cur.continue();
    };
  });
  await new Promise((resolve, reject) => {
    const cursorReq = stores.edges.index("projectId").openKeyCursor();
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur) { resolve(); return; }
      bucket(cur.key).edges += 1;
      cur.continue();
    };
  });
  return out;
}

async function countsFor(stores, projectId) {
  const range = IDBKeyRange.only(projectId);
  const out = { nodes: 0, edges: 0, byType: {} };
  await new Promise((resolve, reject) => {
    const cursorReq = stores.nodes.index("projectType")
      .openKeyCursor(IDBKeyRange.bound([projectId], [projectId, []]));
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur) { resolve(); return; }
      out.nodes += 1;
      const typeId = cur.key[1];
      out.byType[typeId] = (out.byType[typeId] || 0) + 1;
      cur.continue();
    };
  });
  out.edges = await req(stores.edges.index("projectId").count(range));
  return out;
}

async function touchProject(stores, projectId) {
  const p = await req(stores.projects.get(projectId));
  if (!p) return;
  p.updatedAt = nowIso();
  await req(stores.projects.put(p));
}

/* ---------------- узлы и связи ---------------- */

function makeNode(projectId, data, id = uuid()) {
  return {
    id,
    projectId,
    typeId: str(data.typeId, "note") || "note",
    title: str(data.title, "New node"),
    description: str(data.description),
    fields: cleanFields(data.fields),
    position: cleanPosition(data.position),
    tags: cleanTags(data.tags),
    image: str(data.image),
    date: str(data.date),
    dates: cleanDates(data.dates),
    canvas: str(data.canvas),
    width: int(data.width),
    cardMode: str(data.cardMode),
    createdAt: data.createdAt || nowIso(),
    updatedAt: data.updatedAt || data.createdAt || nowIso(),
  };
}

function makeEdge(projectId, data, id = uuid()) {
  return {
    id,
    projectId,
    source: str(data.source),
    target: str(data.target),
    label: str(data.label),
    relType: str(data.relType),
    color: str(data.color),
    points: cleanPoints(data.points),
    sourceHandle: str(data.sourceHandle),
    targetHandle: str(data.targetHandle),
    shape: str(data.shape),
    updatedAt: data.updatedAt || nowIso(),
  };
}

// Какие поля узла можно править и как приводить значение к нужному виду.
const NODE_PATCH = {
  typeId: str, title: str, description: str, fields: cleanFields, position: cleanPosition,
  tags: cleanTags, image: str, date: str, dates: cleanDates, canvas: str, width: int,
  cardMode: str,
};
const EDGE_PATCH = {
  label: str, relType: str, color: str, source: str, target: str, points: cleanPoints,
  sourceHandle: str, targetHandle: str, shape: str,
};

/** null и отсутствие поля — «не трогать», как exclude_unset + is not None. */
function applyPatch(doc, patch, schema) {
  for (const [key, clean] of Object.entries(schema)) {
    if (patch && key in patch && patch[key] != null) doc[key] = clean(patch[key]);
  }
  return doc;
}

/* ---------------- снимок проекта ---------------- */

/**
 * Узлы и связи снимка в проект.
 *
 * keepIds — оставить id из снимка (синхронизация, восстановление): по ним одно
 * и то же узнаётся на разных устройствах. Занятый в другом проекте id всё
 * равно заменяется — чужой узел перезаписывать нельзя.
 */
async function insertGraph(stores, projectId, nodes, edges, keepIds) {
  const idMap = {};
  const used = new Set();
  const plan = [];
  for (const n of nodes) {
    let next = uuid();
    if (keepIds && n.id && !used.has(n.id)) {
      // eslint-disable-next-line no-await-in-loop
      const taken = await req(stores.nodes.get(n.id));
      if (!taken) next = n.id;
    }
    used.add(next);
    if (n.id && !(n.id in idMap)) idMap[n.id] = next;
    plan.push([n, next]);
  }
  for (const [n, nodeId] of plan) {
    let entries = n.dates;
    if (!Array.isArray(entries) || !entries.length) entries = legacyDateEntries(n.date);
    const node = makeNode(projectId, {
      ...n,
      typeId: n.typeId || "note",
      title: str(n.title),
      date: str(n.date),
      dates: remapDateRefs(entries, idMap),
      createdAt: n.createdAt || nowIso(),
    }, nodeId);
    await req(stores.nodes.add(node));
  }
  const seen = new Set();
  for (const e of edges) {
    const source = idMap[e.source];
    const target = idMap[e.target];
    if (!source || !target || source === target) continue; // висящая связь — отбрасываем
    let edgeId = uuid();
    if (keepIds && e.id && !seen.has(e.id)) {
      const taken = await req(stores.edges.get(e.id));
      if (!taken) edgeId = e.id;
    }
    seen.add(edgeId);
    await req(stores.edges.add(makeEdge(projectId, { ...e, source, target }, edgeId)));
  }
  return plan.length;
}

async function insertSnapshot(stores, name, description, settings, nodes, edges, opts = {}) {
  const stamp = nowIso();
  let keepIds = !!opts.keepIds;
  let id = uuid();
  if (keepIds && opts.projectId && !(await req(stores.projects.get(opts.projectId)))) {
    id = opts.projectId;
  } else {
    keepIds = false;
  }
  const project = {
    id,
    name,
    description: str(description),
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
    createdAt: stamp,
    updatedAt: stamp,
    metaUpdatedAt: (keepIds && opts.metaUpdatedAt) || stamp,
    deleted: keepIds ? pruneDeleted(opts.deleted) : normalizeDeleted(null),
  };
  await req(stores.projects.add(project));
  const count = await insertGraph(stores, project.id, nodes, edges, keepIds);
  return { ...projectRow(project), nodeCount: count };
}

/* ---------------- картинки ---------------- */

/**
 * Строки data: в узлах снимка → ссылки на записи в images.
 *
 * Хэш считается до транзакции: SubtleCrypto — постороннее ожидание, и
 * транзакция IndexedDB за время него закрылась бы. Возвращает узлы со
 * ссылками и записи, которые надо положить в images той же транзакцией, что
 * и сами узлы.
 */
async function prepareImages(nodes) {
  const records = new Map();
  const out = [];
  for (const n of nodes || []) {
    const rec = await toImageRecord(n?.image);
    if (rec) {
      records.set(rec.hash, rec);
      out.push({ ...n, image: rec.ref });
    } else {
      out.push(n);
    }
  }
  return { nodes: out, records: [...records.values()] };
}

function putImages(stores, records) {
  for (const r of records) {
    stores.images.put({ hash: r.hash, mime: r.mime, blob: r.blob, createdAt: nowIso() });
  }
}

/** Ссылки bg-image в узлах → строки data: (для файла .bgproj). */
async function inlineImages(nodes) {
  const hashes = [...new Set(nodes.map((n) => imageHash(n.image)).filter(Boolean))];
  if (!hashes.length) return nodes;
  const rows = await tx("images", "readonly", (s) => Promise.all(hashes.map((h) => req(s.images.get(h)))));
  const urls = {};
  for (const row of rows) if (row?.blob) urls[row.hash] = await blobToDataUrl(row.blob);
  return nodes.map((n) => (isImageRef(n.image) ? { ...n, image: urls[imageHash(n.image)] || "" } : n));
}

/**
 * Однократно вынести base64 из узлов, созданных до версии 2 хранилища.
 * Идемпотентно: узлы со ссылками не трогает. Узел, который успели поправить,
 * пока считался хэш, тоже не трогает — правка новее.
 */
async function migrateInlineImages() {
  const legacy = await tx("nodes", "readonly", async (s) => (await req(s.nodes.getAll()))
    .filter((n) => typeof n.image === "string" && n.image.startsWith("data:image/"))
    .map((n) => ({ id: n.id, image: n.image })));
  if (!legacy.length) return 0;
  const prepared = [];
  for (const n of legacy) {
    const rec = await toImageRecord(n.image);
    if (rec) prepared.push([n, rec]);
  }
  return tx(["nodes", "images"], "readwrite", async (s) => {
    let moved = 0;
    for (const [n, rec] of prepared) {
      const doc = await req(s.nodes.get(n.id));
      if (!doc || doc.image !== n.image) continue;
      putImages(s, [rec]);
      doc.image = rec.ref;
      s.nodes.put(doc);
      moved += 1;
    }
    return moved;
  });
}

/** Убрать картинки, на которые не ссылается ни узел, ни копия. */
async function gcImages() {
  return tx(["nodes", "backups", "images"], "readwrite", async (s) => {
    const used = new Set();
    for (const n of await req(s.nodes.getAll())) if (isImageRef(n.image)) used.add(imageHash(n.image));
    for (const b of await req(s.backups.getAll())) {
      for (const n of b.data?.nodes || []) if (isImageRef(n.image)) used.add(imageHash(n.image));
    }
    let dropped = 0;
    for (const key of await req(s.images.getAllKeys())) {
      if (!used.has(key)) { s.images.delete(key); dropped += 1; }
    }
    return dropped;
  });
}

/* ---------------- следы удалений и копии ---------------- */

async function markDeleted(stores, projectId, nodeIds = [], edgeIds = []) {
  if (!nodeIds.length && !edgeIds.length) return;
  const p = await req(stores.projects.get(projectId));
  if (!p) return;
  const dead = normalizeDeleted(p.deleted);
  const stamp = nowIso();
  for (const id of nodeIds) dead.nodes[id] = stamp;
  for (const id of edgeIds) dead.edges[id] = stamp;
  p.deleted = pruneDeleted(dead);
  await req(stores.projects.put(p));
}

/** Снимок проекта как в экспорте, но картинки — ссылками. */
async function snapshotOf(stores, id) {
  const r = await req(stores.projects.get(id));
  if (!r) return null;
  const nodes = await req(stores.nodes.index("projectId").getAll(IDBKeyRange.only(id)));
  const edges = await req(stores.edges.index("projectId").getAll(IDBKeyRange.only(id)));
  return {
    format: "bluegem-project",
    version: 1,
    exportedAt: nowIso(),
    project: { ...projectRow(r), deleted: pruneDeleted(r.deleted) },
    nodes: nodes.map(migrateNode),
    edges,
  };
}

function backupMeta(b) {
  const { data, hash, ...meta } = b;
  return meta;
}

async function latestBackup(stores, projectId) {
  const list = await req(stores.backups.index("projectId").getAll(IDBKeyRange.only(projectId)));
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list;
}

async function makeBackup(stores, projectId, reason) {
  const snap = await snapshotOf(stores, projectId);
  if (!snap) return null;
  const hash = contentHash(snap);
  const list = await latestBackup(stores, projectId);
  if (list[0] && list[0].hash === hash) return backupMeta(list[0]);
  const doc = {
    id: uuid(),
    projectId,
    createdAt: nowIso(),
    reason,
    hash,
    name: snap.project.name,
    nodeCount: snap.nodes.length,
    edgeCount: snap.edges.length,
    data: snap,
  };
  await req(stores.backups.add(doc));
  for (const dropId of backupsToDrop([doc, ...list])) stores.backups.delete(dropId);
  return backupMeta(doc);
}

/** Копия перед правкой, если последней больше десяти минут. */
async function maybeBackup(stores, projectId) {
  const list = await req(stores.backups.index("projectId").getAll(IDBKeyRange.only(projectId)));
  const last = list.reduce((m, b) => (b.createdAt > m ? b.createdAt : m), "");
  if (last && Date.now() - Date.parse(last) < BACKUP_INTERVAL_MS) return;
  await makeBackup(stores, projectId, "auto");
}

/** Заменить содержимое проекта снимком, сохранив id проекта и узлов. */
async function replaceContent(stores, projectId, snap) {
  const r = await req(stores.projects.get(projectId));
  if (!r) throw fail(404, "projectNotFound", "Project not found");
  const src = snap.project || {};
  const nodeKeys = await req(stores.nodes.index("projectId").getAllKeys(IDBKeyRange.only(projectId)));
  for (const key of nodeKeys) stores.nodes.delete(key);
  const edgeKeys = await req(stores.edges.index("projectId").getAllKeys(IDBKeyRange.only(projectId)));
  for (const key of edgeKeys) stores.edges.delete(key);
  await insertGraph(stores, projectId, snap.nodes || [], snap.edges || [], true);
  const stamp = nowIso();
  r.name = str(src.name || r.name).trim() || r.name;
  if (src.description != null) r.description = str(src.description);
  if (src.settings) r.settings = { ...DEFAULT_SETTINGS, ...src.settings };
  r.updatedAt = stamp;
  r.metaUpdatedAt = src.metaUpdatedAt || stamp;
  r.deleted = pruneDeleted(src.deleted);
  await req(stores.projects.put(r));
  return projectRow(r, await countsFor(stores, projectId));
}

function starterDates(key, ids) {
  return (DND_STARTER_DATES[key] || []).map(([entryKey, start], i) => {
    const value = { ...start };
    if (value.rel) {
      value.rel = {
        nodeId: ids[value.rel.node], entryId: null, edge: "start",
        amount: value.rel.amount, unit: value.rel.unit, dir: value.rel.dir,
      };
    }
    return { id: `s${i}`, key: entryKey, label: "", start: value, end: null };
  });
}

async function insertStarter(stores, projectId, template, lang) {
  if (!TEMPLATES[template]?.starter) return;
  const text = DND_STARTER_TEXT[lang] || DND_STARTER_TEXT[DEFAULT_LANG];
  const ids = {};
  for (const [key] of DND_STARTER_NODES) ids[key] = uuid();
  const canvas = canvasesFor(template, lang)[0].id;
  const stamp = nowIso();
  for (const [key, typeId, x, y, tags] of DND_STARTER_NODES) {
    const [title, description] = text[key];
    await req(stores.nodes.add(makeNode(projectId, {
      typeId, title, description, position: { x, y }, tags,
      dates: starterDates(key, ids), canvas, createdAt: stamp,
    }, ids[key])));
  }
  for (const [a, b, rel] of DND_STARTER_EDGES) {
    await req(stores.edges.add(makeEdge(projectId, {
      source: ids[a], target: ids[b], relType: rel, updatedAt: stamp,
    })));
  }
}

/* ---------------- перенос данных со старого места ---------------- */

/** Перевести старые строковые даты в структурные. Идемпотентно. */
function migrateNode(n) {
  if ((!Array.isArray(n.dates) || !n.dates.length) && n.date) {
    const entries = legacyDateEntries(n.date);
    if (entries.length) return { ...n, dates: entries };
  }
  return n;
}

/* ---------------- сам API ---------------- */

const ALL = ["projects", "nodes", "edges", "backups", "images"];

// Старые картинки выносятся из узлов, а ненужные убираются один раз за
// запуск — при первом открытии списка проектов, в фоне.
let gcStarted = false;

export const localApi = {
  async listProjects() {
    if (!gcStarted) {
      gcStarted = true;
      setTimeout(() => { migrateInlineImages().then(gcImages).catch(() => {}); }, 4000);
    }
    return tx(ALL, "readonly", async (s) => {
      const rows = await req(s.projects.getAll());
      const counts = await allCounts(s);
      return rows
        .map((r) => projectRow(r, counts[r.id]))
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    });
  },

  async listTemplates({ lang = DEFAULT_LANG } = {}) {
    return Object.entries(TEMPLATES).map(([id, spec]) => ({
      id,
      types: nodeTypesFor(lang, spec.types),
      pages: canvasesFor(id, lang).map((c) => c.label),
      starter: spec.starter,
    }));
  },

  async createProject(data = {}) {
    const lang = data.lang || DEFAULT_LANG;
    const template = TEMPLATES[data.template] ? data.template : DEFAULT_TEMPLATE;
    // Пример просят только там, где он есть: флаг с чужого шаблона молча гасим.
    const starter = !!data.starter && TEMPLATES[template].starter;
    const name = str(data.name).trim();
    if (!name) throw fail(400, "projectNameRequired", "A project needs a name");
    const stamp = nowIso();
    const record = {
      id: uuid(),
      name,
      description: str(data.description),
      settings: settingsForTemplate(template, lang),
      createdAt: stamp,
      updatedAt: stamp,
      metaUpdatedAt: stamp,
      deleted: normalizeDeleted(null),
    };
    return tx(ALL, "readwrite", async (s) => {
      await req(s.projects.add(record));
      if (starter) {
        await insertStarter(s, record.id, template, lang);
        return projectRow(record, await countsFor(s, record.id));
      }
      return projectRow(record);
    });
  },

  async getProject(id) {
    return tx(ALL, "readonly", async (s) => {
      const r = await req(s.projects.get(id));
      if (!r) throw fail(404, "projectNotFound", "Project not found");
      return projectRow(r, await countsFor(s, id));
    });
  },

  async updateProject(id, patch = {}) {
    return tx(ALL, "readwrite", async (s) => {
      const r0 = await req(s.projects.get(id));
      if (!r0) throw fail(404, "projectNotFound", "Project not found");
      await maybeBackup(s, id);
      const r = await req(s.projects.get(id));
      const stamp = nowIso();
      if (patch.name != null) r.name = str(patch.name);
      if (patch.description != null) r.description = str(patch.description);
      if (patch.settings != null) r.settings = patch.settings;
      if (patch.name != null || patch.description != null || patch.settings != null) r.metaUpdatedAt = stamp;
      r.updatedAt = stamp;
      await req(s.projects.put(r));
      return projectRow(r);
    });
  },

  async deleteProject(id) {
    return tx(ALL, "readwrite", async (s) => {
      await req(s.projects.delete(id));
      const nodeKeys = await req(s.nodes.index("projectId").getAllKeys(IDBKeyRange.only(id)));
      for (const key of nodeKeys) s.nodes.delete(key);
      const edgeKeys = await req(s.edges.index("projectId").getAllKeys(IDBKeyRange.only(id)));
      for (const key of edgeKeys) s.edges.delete(key);
      const backupKeys = await req(s.backups.index("projectId").getAllKeys(IDBKeyRange.only(id)));
      for (const key of backupKeys) s.backups.delete(key);
      return { ok: true };
    });
  },

  async exportProject(id, { inline = true } = {}) {
    const snap = await tx(ALL, "readonly", (s) => snapshotOf(s, id));
    if (!snap) throw fail(404, "projectNotFound", "Project not found");
    if (inline) snap.nodes = await inlineImages(snap.nodes);
    return snap;
  },

  async importProject(payload = {}) {
    const src = payload.project || {};
    const name = str(payload.name || src.name || "Imported project").trim();
    if (!name) throw fail(400, "projectNameRequired", "A project needs a name");
    const { nodes, records } = await prepareImages(payload.nodes || []);
    return tx(ALL, "readwrite", (s) => {
      putImages(s, records);
      return insertSnapshot(s, name, src.description, src.settings || {}, nodes, payload.edges || [], {
        keepIds: !!payload.keepIds, projectId: src.id, deleted: src.deleted, metaUpdatedAt: src.metaUpdatedAt,
      });
    });
  },

  /** Содержимое проекта целиком (синхронизация); перед заменой — копия. */
  async replaceProject(id, snap = {}) {
    const { nodes, records } = await prepareImages(snap.nodes || []);
    return tx(ALL, "readwrite", async (s) => {
      putImages(s, records);
      await makeBackup(s, id, "sync");
      return replaceContent(s, id, { ...snap, nodes });
    });
  },

  async listBackups(projectId) {
    return tx("backups", "readonly", async (s) => (await latestBackup(s, projectId)).map(backupMeta));
  },

  async createBackup(projectId) {
    return tx(ALL, "readwrite", async (s) => {
      const doc = await makeBackup(s, projectId, "manual");
      if (!doc) throw fail(404, "projectNotFound", "Project not found");
      return doc;
    });
  },

  /** Вернуть проект к копии; текущее состояние перед этим само уходит в копию. */
  async restoreBackup(backupId) {
    return tx(ALL, "readwrite", async (s) => {
      const b = await req(s.backups.get(backupId));
      if (!b) throw fail(404, "backupNotFound", "Backup not found");
      await makeBackup(s, b.projectId, "restore");
      const current = await snapshotOf(s, b.projectId);
      const snap = JSON.parse(JSON.stringify(b.data));
      const stamp = nowIso();
      // Возвращённое — свежая правка: на другом устройстве эти узлы не должны
      // проиграть старым следам удаления, а пропавшие — должны пропасть и там.
      const keepN = new Set((snap.nodes || []).map((n) => n.id));
      const keepE = new Set((snap.edges || []).map((e) => e.id));
      const dead = normalizeDeleted(current?.project?.deleted);
      for (const n of current?.nodes || []) if (!keepN.has(n.id)) dead.nodes[n.id] = stamp;
      for (const e of current?.edges || []) if (!keepE.has(e.id)) dead.edges[e.id] = stamp;
      for (const id of keepN) delete dead.nodes[id];
      for (const id of keepE) delete dead.edges[id];
      for (const n of snap.nodes || []) n.updatedAt = stamp;
      for (const e of snap.edges || []) e.updatedAt = stamp;
      snap.project = { ...(snap.project || {}), deleted: dead, metaUpdatedAt: stamp };
      return replaceContent(s, b.projectId, snap);
    });
  },

  async deleteBackup(backupId) {
    return tx("backups", "readwrite", async (s) => {
      await req(s.backups.delete(backupId));
      return { ok: true };
    });
  },

  /** Байты картинки по хэшу — для показа (см. lib/images.js). */
  async loadImage(hash) {
    return tx("images", "readonly", async (s) => (await req(s.images.get(hash)))?.blob || null);
  },

  async duplicateProject(id) {
    const snapshot = await localApi.exportProject(id, { inline: false });
    const p = snapshot.project;
    return tx(ALL, "readwrite", (s) => insertSnapshot(
      s, `${p.name} (copy)`, p.description, p.settings, snapshot.nodes, snapshot.edges,
    ));
  },

  async getGraph(id) {
    return tx(["nodes", "edges"], "readonly", async (s) => {
      const nodes = await req(s.nodes.index("projectId").getAll(IDBKeyRange.only(id)));
      const edges = await req(s.edges.index("projectId").getAll(IDBKeyRange.only(id)));
      return { nodes: nodes.map(migrateNode), edges };
    });
  },

  async createNode(projectId, data = {}) {
    const rec = await toImageRecord(data.image);
    const node = makeNode(projectId, rec ? { ...data, image: rec.ref } : data);
    return tx(ALL, "readwrite", async (s) => {
      if (rec) putImages(s, [rec]);
      await maybeBackup(s, projectId);
      await req(s.nodes.add(node));
      await touchProject(s, projectId);
      return node;
    });
  },

  async updateNode(id, patch = {}) {
    const rec = await toImageRecord(patch?.image);
    return tx(ALL, "readwrite", async (s) => {
      const doc0 = await req(s.nodes.get(id));
      if (!doc0) throw fail(404, "nodeNotFound", "Node not found");
      await maybeBackup(s, doc0.projectId);
      const doc = await req(s.nodes.get(id));
      if (rec) putImages(s, [rec]);
      applyPatch(doc, rec ? { ...patch, image: rec.ref } : patch, NODE_PATCH);
      doc.updatedAt = nowIso();
      await req(s.nodes.put(doc));
      await touchProject(s, doc.projectId);
      return doc;
    });
  },

  async deleteNode(id) {
    return tx(ALL, "readwrite", async (s) => {
      const doc = await req(s.nodes.get(id));
      if (doc) await maybeBackup(s, doc.projectId);
      await req(s.nodes.delete(id));
      if (doc) {
        const out = await req(s.edges.index("source").getAllKeys(IDBKeyRange.only(id)));
        const inc = await req(s.edges.index("target").getAllKeys(IDBKeyRange.only(id)));
        const edgeIds = [...new Set([...out, ...inc])];
        for (const key of edgeIds) s.edges.delete(key);
        await markDeleted(s, doc.projectId, [id], edgeIds);
        await touchProject(s, doc.projectId);
      }
      return { ok: true };
    });
  },

  async updatePositions(projectId, positions = []) {
    return tx(ALL, "readwrite", async (s) => {
      await maybeBackup(s, projectId);
      const stamp = nowIso();
      for (const p of positions) {
        const doc = await req(s.nodes.get(p.id));
        if (!doc || doc.projectId !== projectId) continue;
        doc.position = cleanPosition(p.position);
        doc.updatedAt = stamp;
        s.nodes.put(doc);
      }
      await touchProject(s, projectId);
      return { ok: true, updated: positions.length };
    });
  },

  async createEdge(projectId, data = {}) {
    if (data.source === data.target) throw fail(400, "selfLink", "A node cannot be linked to itself");
    return tx(ALL, "readwrite", async (s) => {
      const fromSource = await req(s.edges.index("source").getAll(IDBKeyRange.only(str(data.source))));
      const existing = fromSource.find((e) => e.projectId === projectId && e.target === data.target);
      if (existing) return existing;
      await maybeBackup(s, projectId);
      const edge = makeEdge(projectId, data);
      await req(s.edges.add(edge));
      await touchProject(s, projectId);
      return edge;
    });
  },

  async updateEdge(id, patch = {}) {
    return tx(ALL, "readwrite", async (s) => {
      const doc0 = await req(s.edges.get(id));
      if (!doc0) throw fail(404, "edgeNotFound", "Link not found");
      await maybeBackup(s, doc0.projectId);
      const doc = await req(s.edges.get(id));
      applyPatch(doc, patch, EDGE_PATCH);
      doc.updatedAt = nowIso();
      await req(s.edges.put(doc));
      await touchProject(s, doc.projectId);
      return doc;
    });
  },

  async deleteEdge(id) {
    return tx(ALL, "readwrite", async (s) => {
      const doc = await req(s.edges.get(id));
      if (doc) await maybeBackup(s, doc.projectId);
      await req(s.edges.delete(id));
      if (doc) {
        await markDeleted(s, doc.projectId, [], [id]);
        await touchProject(s, doc.projectId);
      }
      return { ok: true };
    });
  },
};
