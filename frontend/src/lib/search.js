// Поиск по тексту узлов: где нашлось и что показать вокруг найденного.
//
// Палитра (Ctrl+K) раньше искала только по названию и подписи. В большом мире
// человек помнит фразу из описания («тот, кто украл печать»), а не название
// узла, — поэтому ищем и по описанию с характеристиками и показываем кусочек
// текста вокруг совпадения, чтобы было видно, почему узел попал в список.

/** Markdown → плоский текст для поиска и сниппетов (грубо, но предсказуемо). */
export function plainText(md) {
  return String(md || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // картинки
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[Узел|подпись]]
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // [[Узел]]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [текст](ссылка)
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "") // заголовки, цитаты, списки
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$)/g, "$1$2")
    .replace(/[ \t]+/g, " ");
}

/** Текст узла, по которому ищем «в глубину»: описание и характеристики. */
export function nodeBody(d) {
  let s = plainText(d?.description);
  for (const f of d?.fields || []) {
    if (f?.key || f?.value) s += `\n${f.key || ""}: ${f.value || ""}`;
  }
  return s;
}

/**
 * Кусочек текста вокруг первого совпадения.
 * @returns {{before: string, match: string, after: string} | null}
 */
export function snippetAround(text, needle, radius = 42) {
  if (!text || !needle) return null;
  const lower = text.toLowerCase();
  const at = lower.indexOf(needle.toLowerCase());
  if (at < 0) return null;
  // Сниппет — одна строка: переводы строк превращаем в пробелы, но длины
  // не меняем, чтобы индекс совпадения остался верным.
  const flat = text.replace(/\s/g, " ");
  let start = Math.max(0, at - radius);
  let end = Math.min(flat.length, at + needle.length + radius);
  // Не режем слово посередине: раздвигаем края до ближайшего пробела, если он
  // недалеко, — лучше лишнее слово, чем огрызок.
  const SLACK = 16;
  if (start > 0) {
    const sp = flat.lastIndexOf(" ", start);
    if (sp >= 0 && start - sp <= SLACK) start = sp + 1;
  }
  if (end < flat.length) {
    const sp = flat.indexOf(" ", end);
    if (sp < 0 && flat.length - end <= SLACK) end = flat.length;
    else if (sp >= 0 && sp - end <= SLACK) end = sp;
  }
  return {
    before: (start > 0 ? "…" : "") + flat.slice(start, at).replace(/\s+/g, " ").trimStart(),
    match: flat.slice(at, at + needle.length),
    after: flat.slice(at + needle.length, end).replace(/\s+/g, " ").trimEnd() + (end < flat.length ? "…" : ""),
  };
}

/**
 * Отбор и порядок узлов для палитры.
 *
 * Совпадение в названии важнее совпадения в подписи, а то — важнее
 * совпадения где-то в тексте; внутри группы ближе к началу — выше.
 * @param nodes [{title, subtitle, body}]
 * @returns узлы с полем `snippet` у тех, что нашлись только по тексту
 */
export function rankNodes(nodes, query, limit = 40) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return nodes.slice(0, limit);
  const scored = [];
  for (const n of nodes) {
    const title = (n.title || "").toLowerCase();
    let at = title.indexOf(needle);
    if (at >= 0) { scored.push({ n, score: (at === 0 ? 0 : 1) * 1e6 + at }); continue; }
    at = (n.subtitle || "").toLowerCase().indexOf(needle);
    if (at >= 0) { scored.push({ n, score: 2e6 + at }); continue; }
    const snippet = snippetAround(n.body || "", needle);
    if (snippet) scored.push({ n: { ...n, snippet }, score: 3e6 + snippet.before.length });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.n);
}
