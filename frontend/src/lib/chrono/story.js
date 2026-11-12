// Сюжетная линия и «сейчас» мира.
import { partsSpan } from "./calendar";
import { eraYearOffset } from "./eras";

/**
 * Узлы сюжетной линии: сам узел и всё, что с ним связано, на глубину depth.
 * @returns {Set<string>}
 */
export function storylineOf(edges, rootId, depth = 1) {
  const out = new Set([rootId]);
  if (!rootId) return out;
  const adj = new Map();
  for (const e of edges || []) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  }
  let frontier = [rootId];
  for (let level = 0; level < depth && frontier.length; level += 1) {
    const next = [];
    for (const id of frontier) {
      for (const other of adj.get(id) || []) {
        if (out.has(other)) continue;
        out.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * «Сейчас» кампании — момент, до которого дошла игра или рассказ.
 * Хранится в settings.worldNow как {y, m, d, eraId}.
 * @returns {?number} индекс дня или null, если «сейчас» не задано
 */
export function nowIndexOf(chrono, value) {
  if (!value || value.y == null) return null;
  const era = value.eraId ? chrono.eras.byId.get(value.eraId) : null;
  const y = value.y + eraYearOffset(era);
  return partsSpan(chrono.calendar, { y, m: value.m, d: value.m == null ? null : value.d })[0];
}
