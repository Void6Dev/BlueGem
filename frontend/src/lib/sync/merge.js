// Слияние двух версий одного проекта — основа синхронизации между устройствами.
//
// Версии одного проекта узнаются по id: проект, узлы и связи сохраняют свои id
// при переносе (импорт с keepIds). Правило для каждого узла и каждой связи —
// «побеждает последняя правка»: у кого updatedAt новее, того и версия. Удаление
// тоже правка: след {id: когда} в project.deleted побеждает версию узла,
// если удалили позже, чем правили. Без этих следов слияние не отличило бы
// «удалили на телефоне» от «на телефоне его ещё не было» и возвращало бы
// удалённое обратно.
//
// Название, описание и настройки проекта сливаются целиком — по metaUpdatedAt.
// Тонкое слияние настроек (тип на одном устройстве, цвет на другом) здесь не
// нужно: их правят редко, и проще честно взять последнюю версию.
import { normalizeDeleted, pruneDeleted, stableJson } from "@/lib/local/policy";

const ts = (v) => {
  const n = Date.parse(v || "");
  return Number.isFinite(n) ? n : 0;
};

const sameItem = (a, b) => {
  const strip = ({ projectId, updatedAt, ...rest }) => rest;
  return stableJson(strip(a)) === stableJson(strip(b));
};

function mergeDeleted(a, b) {
  const out = normalizeDeleted(a);
  const other = normalizeDeleted(b);
  for (const kind of ["nodes", "edges"]) {
    for (const [id, when] of Object.entries(other[kind])) {
      if (ts(when) > ts(out[kind][id])) out[kind][id] = when;
    }
  }
  return out;
}

/**
 * Свести списки одного вида (узлы или связи).
 * @returns {{items: object[], dead: Record<string,string>}}
 */
function mergeList(localList, remoteList, dead) {
  const byId = new Map();
  for (const it of localList || []) byId.set(it.id, { local: it });
  for (const it of remoteList || []) {
    const slot = byId.get(it.id) || {};
    slot.remote = it;
    byId.set(it.id, slot);
  }
  const items = [];
  const nextDead = { ...dead };
  for (const [id, { local, remote }] of byId) {
    let pick = local || remote;
    if (local && remote) {
      // При равенстве — своя версия: так повторное слияние ничего не меняет.
      const lt = ts(local.updatedAt || local.createdAt);
      const rt = ts(remote.updatedAt || remote.createdAt);
      pick = rt > lt ? remote : local;
    }
    const born = ts(pick.updatedAt || pick.createdAt);
    if (id in nextDead && ts(nextDead[id]) >= born) continue; // удалили позже правки
    // Живая версия новее удаления — значит, её вернули; след больше не нужен.
    delete nextDead[id];
    items.push(pick);
  }
  return { items, dead: nextDead };
}

/**
 * Слить локальную версию проекта с пришедшей.
 *
 * @param local  снимок проекта на этом устройстве (как exportProject)
 * @param remote снимок из файла
 * @returns {{
 *   snapshot: object,         // результат
 *   localChanged: boolean,    // надо записать в хранилище
 *   remoteChanged: boolean,   // надо записать в файл
 *   stats: {added: number, updated: number, removed: number}, // что изменится здесь
 * }}
 */
export function mergeSnapshots(local, remote) {
  const lp = local.project || {};
  const rp = remote.project || {};
  const dead = pruneDeleted(mergeDeleted(lp.deleted, rp.deleted));

  const nodes = mergeList(local.nodes, remote.nodes, dead.nodes);
  const alive = new Set(nodes.items.map((n) => n.id));
  const edges = mergeList(local.edges, remote.edges, dead.edges);
  // Связь без одного из концов не живёт, как бы свежа она ни была.
  const edgeItems = edges.items.filter((e) => alive.has(e.source) && alive.has(e.target));

  const metaRemote = ts(rp.metaUpdatedAt) > ts(lp.metaUpdatedAt);
  const meta = metaRemote ? rp : lp;
  const project = {
    ...lp,
    name: meta.name ?? lp.name,
    description: meta.description ?? lp.description,
    settings: meta.settings ?? lp.settings,
    metaUpdatedAt: meta.metaUpdatedAt || lp.metaUpdatedAt || rp.metaUpdatedAt || "",
    deleted: { nodes: nodes.dead, edges: edges.dead },
  };
  const snapshot = {
    format: "bluegem-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    nodes: nodes.items,
    edges: edgeItems,
  };

  const index = (list) => new Map((list || []).map((x) => [x.id, x]));
  const diff = (side) => {
    const before = { nodes: index(side.nodes), edges: index(side.edges) };
    let added = 0;
    let updated = 0;
    let removed = 0;
    for (const kind of ["nodes", "edges"]) {
      const after = kind === "nodes" ? snapshot.nodes : snapshot.edges;
      const seen = new Set();
      for (const it of after) {
        seen.add(it.id);
        const was = before[kind].get(it.id);
        if (!was) added += 1;
        else if (!sameItem(was, it)) updated += 1;
      }
      for (const id of before[kind].keys()) if (!seen.has(id)) removed += 1;
    }
    const sp = side.project || {};
    const metaChanged = stableJson([sp.name, sp.description, sp.settings])
      !== stableJson([project.name, project.description, project.settings]);
    return { added, updated, removed, metaChanged };
  };

  const l = diff(local);
  const r = diff(remote);
  const deadKey = (d) => stableJson(pruneDeleted(d));
  return {
    snapshot,
    localChanged: !!(l.added || l.updated || l.removed || l.metaChanged),
    remoteChanged: !!(r.added || r.updated || r.removed || r.metaChanged)
      || deadKey(rp.deleted) !== deadKey(project.deleted),
    stats: { added: l.added, updated: l.updated, removed: l.removed },
  };
}
