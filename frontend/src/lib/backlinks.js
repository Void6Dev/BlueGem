// Обратные ссылки: кто упоминает узел через [[Название]].
//
// Ссылка в тексте односторонняя: из «Короля» видно, что он [[Отец Анны]], а
// из «Анны» — нет. Здесь считается обратная сторона, чтобы в панели узла было
// видно, где о нём пишут, — так в мире находятся связи, которые никто не
// провёл линией.
import { plainText } from "@/lib/search";

const WIKI = /\[\[([^\]]+?)\]\]/g;

/** Нормализованное имя цели: «[[Анна|сестра]]» ведёт к «анна». */
export function wikiKey(raw) {
  return String(raw || "").split("|")[0].trim().toLowerCase();
}

// Разбор текста кэшируется по самому объекту узла: пока описание не меняли,
// объект тот же, и ссылки из него заново не выискиваются.
const parsed = new WeakMap();

function linksOf(d) {
  const hit = parsed.get(d);
  if (hit) return hit;
  const out = new Map(); // ключ цели → строка, где она упомянута впервые
  const scan = (text) => {
    if (!text || !text.includes("[[")) return;
    for (const line of String(text).split("\n")) {
      if (!line.includes("[[")) continue;
      WIKI.lastIndex = 0;
      let m;
      while ((m = WIKI.exec(line))) {
        const key = wikiKey(m[1]);
        if (key && !out.has(key)) out.set(key, line);
      }
    }
  };
  scan(d?.description);
  for (const f of d?.fields || []) scan(f?.value);
  parsed.set(d, out);
  return out;
}

/** Все цели ссылок в тексте узла (ключи в нижнем регистре). */
export function wikiTargets(d) {
  return new Set(linksOf(d).keys());
}

/**
 * Кто ссылается на узел `target`.
 * @param nodes все узлы проекта (data)
 * @returns [{id, title, typeId, nodeType, snippet}] в порядке названий
 */
export function backlinksOf(target, nodes) {
  const key = wikiKey(target?.title);
  if (!key) return [];
  const out = [];
  for (const d of nodes) {
    if (!d || d.id === target.id) continue;
    const line = linksOf(d).get(key);
    if (line == null) continue;
    out.push({
      id: d.id,
      title: d.title,
      typeId: d.typeId,
      nodeType: d.nodeType,
      snippet: plainText(line).trim(),
    });
  }
  return out.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}
