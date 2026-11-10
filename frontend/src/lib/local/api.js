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

async function insertSnapshot(stores, name, description, settings, nodes, edges) {
  const stamp = nowIso();
  const project = {
    id: uuid(),
    name,
    description: str(description),
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
    createdAt: stamp,
    updatedAt: stamp,
  };
  await req(stores.projects.add(project));
  // id раздаём заранее: относительные даты ссылаются на другие узлы, и в копии
  // эти ссылки должны вести на копии, а не на оригиналы.
  const idMap = {};
  for (const n of nodes) idMap[n.id] = uuid();
  for (const n of nodes) {
    let entries = n.dates;
    if (!Array.isArray(entries) || !entries.length) entries = legacyDateEntries(n.date);
    const node = makeNode(project.id, {
      ...n,
      typeId: n.typeId || "note",
      title: str(n.title),
      date: str(n.date),
      dates: remapDateRefs(entries, idMap),
      createdAt: n.createdAt || nowIso(),
    }, idMap[n.id]);
    await req(stores.nodes.add(node));
  }
  for (const e of edges) {
    const source = idMap[e.source];
    const target = idMap[e.target];
    if (!source || !target) continue; // висящая связь в файле — отбрасываем
    await req(stores.edges.add(makeEdge(project.id, { ...e, source, target })));
  }
  return { ...projectRow(project), nodeCount: Object.keys(idMap).length };
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
    await req(stores.edges.add(makeEdge(projectId, { source: ids[a], target: ids[b], relType: rel })));
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

const ALL = ["projects", "nodes", "edges"];

export const localApi = {
  async listProjects() {
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
    return tx("projects", "readwrite", async (s) => {
      const r = await req(s.projects.get(id));
      if (!r) throw fail(404, "projectNotFound", "Project not found");
      if (patch.name != null) r.name = str(patch.name);
      if (patch.description != null) r.description = str(patch.description);
      if (patch.settings != null) r.settings = patch.settings;
      r.updatedAt = nowIso();
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
      return { ok: true };
    });
  },

  async exportProject(id) {
    return tx(ALL, "readonly", async (s) => {
      const r = await req(s.projects.get(id));
      if (!r) throw fail(404, "projectNotFound", "Project not found");
      const nodes = await req(s.nodes.index("projectId").getAll(IDBKeyRange.only(id)));
      const edges = await req(s.edges.index("projectId").getAll(IDBKeyRange.only(id)));
      return {
        format: "bluegem-project",
        version: 1,
        exportedAt: nowIso(),
        project: projectRow(r),
        nodes: nodes.map(migrateNode),
        edges,
      };
    });
  },

  async importProject(payload = {}) {
    const src = payload.project || {};
    const name = str(payload.name || src.name || "Imported project").trim();
    if (!name) throw fail(400, "projectNameRequired", "A project needs a name");
    return tx(ALL, "readwrite", (s) => insertSnapshot(
      s, name, src.description, src.settings || {}, payload.nodes || [], payload.edges || [],
    ));
  },

  async duplicateProject(id) {
    const snapshot = await localApi.exportProject(id);
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
    const node = makeNode(projectId, data);
    return tx(ALL, "readwrite", async (s) => {
      await req(s.nodes.add(node));
      await touchProject(s, projectId);
      return node;
    });
  },

  async updateNode(id, patch = {}) {
    return tx(ALL, "readwrite", async (s) => {
      const doc = await req(s.nodes.get(id));
      if (!doc) throw fail(404, "nodeNotFound", "Node not found");
      applyPatch(doc, patch, NODE_PATCH);
      await req(s.nodes.put(doc));
      await touchProject(s, doc.projectId);
      return doc;
    });
  },

  async deleteNode(id) {
    return tx(ALL, "readwrite", async (s) => {
      const doc = await req(s.nodes.get(id));
      await req(s.nodes.delete(id));
      if (doc) {
        const out = await req(s.edges.index("source").getAllKeys(IDBKeyRange.only(id)));
        const inc = await req(s.edges.index("target").getAllKeys(IDBKeyRange.only(id)));
        for (const key of new Set([...out, ...inc])) s.edges.delete(key);
        await touchProject(s, doc.projectId);
      }
      return { ok: true };
    });
  },

  async updatePositions(projectId, positions = []) {
    return tx(ALL, "readwrite", async (s) => {
      for (const p of positions) {
        const doc = await req(s.nodes.get(p.id));
        if (!doc || doc.projectId !== projectId) continue;
        doc.position = cleanPosition(p.position);
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
      const edge = makeEdge(projectId, data);
      await req(s.edges.add(edge));
      await touchProject(s, projectId);
      return edge;
    });
  },

  async updateEdge(id, patch = {}) {
    return tx(ALL, "readwrite", async (s) => {
      const doc = await req(s.edges.get(id));
      if (!doc) throw fail(404, "edgeNotFound", "Link not found");
      applyPatch(doc, patch, EDGE_PATCH);
      await req(s.edges.put(doc));
      await touchProject(s, doc.projectId);
      return doc;
    });
  },

  async deleteEdge(id) {
    return tx(ALL, "readwrite", async (s) => {
      const doc = await req(s.edges.get(id));
      await req(s.edges.delete(id));
      if (doc) await touchProject(s, doc.projectId);
      return { ok: true };
    });
  },
};
