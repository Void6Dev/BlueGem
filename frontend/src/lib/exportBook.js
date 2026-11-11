// «Книга мира»: проект одним HTML-файлом, который читают, печатают и
// сохраняют в PDF.
//
// Markdown-выгрузка хороша для заметок и git, но читать её — значит ставить
// себе читалку markdown. Здесь всё уже собрано: оглавление по типам, у узла —
// картинка, даты по календарю мира, характеристики, связи и обратные ссылки,
// а [[ссылки]] в тексте — обычные якоря внутри документа. Файл ни от чего не
// зависит: стили внутри, картинки внутри (строками data:), сеть не нужна.
import { renderMarkdown } from "@/lib/miniMarkdown";
import { backlinksOf } from "@/lib/backlinks";
import { t, getLanguage } from "@/lib/i18n";
import {
  entryLabel, formatRange, normalizeEntries, resolveCalendar, resolveEras,
} from "@/lib/chrono";

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const anchor = (id) => `node-${String(id).replace(/[^\w-]/g, "")}`;

/** Цвет из настроек — только если это и правда цвет (он уходит в style). */
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "#6B7280");

const CSS = `
:root { --ink:#1d2027; --dim:#6a6f7a; --line:#e3e5ea; --bg:#fbfaf7; --card:#fff; --accent:#2a8fb8; }
@media screen and (prefers-color-scheme: dark) {
  :root { --ink:#e8e9ec; --dim:#9aa0ab; --line:#2b2f37; --bg:#14161b; --card:#1b1e24; --accent:#5cc4ea; }
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--ink); }
body { margin: 0 auto; max-width: 860px; padding: 48px 28px 96px;
  font: 17px/1.65 Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif; }
h1, h2, h3, .meta, nav, .chip, table, .links, .mentions, .tags {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
h1 { font-size: 40px; line-height: 1.15; margin: 0 0 8px; letter-spacing: -.01em; }
.lead { color: var(--dim); margin: 0 0 6px; }
.meta { color: var(--dim); font-size: 13px; }
nav { margin: 36px 0 48px; padding: 20px 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
nav h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .14em; color: var(--dim); margin: 0 0 12px; }
nav .group { margin: 0 0 12px; }
nav .group b { font-size: 14px; }
nav ul { margin: 4px 0 0; padding: 0; list-style: none; columns: 2; column-gap: 28px; font-size: 14px; }
nav li { break-inside: avoid; padding: 1px 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
section.type { margin-top: 56px; }
section.type > h2 { font-size: 26px; display: flex; align-items: center; gap: 12px; margin: 0 0 8px;
  padding-bottom: 10px; border-bottom: 2px solid var(--type); }
section.type > h2 .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--type); }
article { padding: 26px 0 22px; border-bottom: 1px solid var(--line); break-inside: avoid-page; }
article h3 { font-size: 22px; margin: 0 0 6px; }
.chip { display: inline-block; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 600;
  color: var(--type); margin-bottom: 6px; }
.dates { font-size: 14px; color: var(--dim); margin: 0 0 10px; font-family: system-ui, sans-serif; }
.tags { margin: 0 0 12px; }
.tags span { display: inline-block; font-size: 12px; padding: 1px 8px; margin: 0 4px 4px 0; border: 1px solid var(--line);
  border-radius: 999px; color: var(--dim); }
figure { margin: 6px 0 16px; }
figure img { max-width: 100%; max-height: 380px; border-radius: 10px; border: 1px solid var(--line); display: block; }
.desc p { margin: 0 0 12px; }
.desc img { max-width: 100%; border-radius: 8px; }
.desc blockquote { margin: 0 0 12px; padding-left: 14px; border-left: 3px solid var(--line); color: var(--dim); }
.desc code { font-size: .9em; background: rgba(127,127,127,.12); padding: 1px 5px; border-radius: 4px; }
.desc pre { background: rgba(127,127,127,.1); padding: 12px; border-radius: 8px; overflow-x: auto; }
.wiki-missing { color: var(--dim); border-bottom: 1px dashed var(--dim); }
table { border-collapse: collapse; margin: 6px 0 14px; font-size: 14px; width: 100%; }
td { border-top: 1px solid var(--line); padding: 6px 10px 6px 0; vertical-align: top; }
td:first-child { color: var(--dim); width: 34%; }
.links, .mentions { font-size: 14px; margin: 8px 0 0; }
.links b, .mentions b { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); display: block; margin-bottom: 4px; }
.links ul, .mentions ul { margin: 0; padding-left: 18px; }
.mentions li span { color: var(--dim); }
footer { margin-top: 64px; color: var(--dim); font: 12px system-ui, sans-serif; text-align: center; }
@media print {
  html, body { background: #fff; color: #000; }
  body { max-width: none; padding: 0; font-size: 11.5pt; }
  nav { break-after: page; border: 0; padding: 0; }
  section.type { break-before: page; margin-top: 0; }
  a { color: inherit; }
  figure img { max-height: 260px; }
  @page { margin: 18mm 16mm; }
}`;

/**
 * Собрать HTML книги мира.
 * @param snapshot снимок проекта как в экспорте (картинки строками data:)
 */
export async function toHtmlBook(snapshot) {
  // Отрисовщик React для статичной разметки нужен только здесь — грузим его,
  // когда книгу и правда собирают, а не с каждым открытием редактора.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { project, nodes, edges } = snapshot;
  const lang = getLanguage();
  const types = project.settings?.nodeTypes || [];
  const typeById = new Map(types.map((x) => [x.id, x]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodesByTitle = {};
  for (const n of nodes) if (n.title) nodesByTitle[n.title.trim().toLowerCase()] = n.id;
  const relLabel = new Map((project.settings?.relTypes || []).map((r) => [r.id, r.label]));

  const calendar = resolveCalendar(project.settings);
  const eras = resolveEras(calendar, project.settings?.eras);
  const dateCtx = {
    eraName: (id) => eras.byId.get(id)?.name || "",
    nodeTitle: (id) => byId.get(id)?.title || "",
  };
  const datesOf = (node) => normalizeEntries(node.dates).map((entry) => {
    const value = formatRange(calendar, entry, { ...dateCtx, selfId: node.id });
    return value ? `${entryLabel(entry)}: ${value}` : "";
  }).filter(Boolean);

  const md = (text) => (text && text.trim()
    ? renderToStaticMarkup(renderMarkdown(text, { doc: true, nodesByTitle, hrefFor: (id) => `#${anchor(id)}` }))
    : "");

  const untitled = t("common.untitled");
  const collator = new Intl.Collator(lang === "ru" ? "ru" : "en");
  const groups = new Map();
  // Порядок разделов — как типы в настройках; узлы удалённых типов — в конце.
  for (const ty of types) groups.set(ty.id, []);
  for (const n of nodes) {
    const key = typeById.has(n.typeId) ? n.typeId : "__other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  for (const list of groups.values()) list.sort((a, b) => collator.compare(a.title || "", b.title || ""));

  const typeName = (id) => (id === "__other" ? t("book.other") : typeById.get(id)?.label || id);
  const typeColor = (id) => safeColor(typeById.get(id)?.color);

  const toc = [...groups].filter(([, list]) => list.length).map(([id, list]) => `
    <div class="group"><b style="color:${typeColor(id)}">${esc(typeName(id))}</b>
      <ul>${list.map((n) => `<li><a href="#${anchor(n.id)}">${esc(n.title || untitled)}</a></li>`).join("")}</ul>
    </div>`).join("");

  const article = (n, typeId) => {
    const dates = datesOf(n);
    const fields = (n.fields || []).filter((f) => f.key || f.value);
    const rels = edges.filter((e) => e.source === n.id || e.target === n.id);
    const mentions = backlinksOf(n, nodes);
    const image = /^(data:image\/|https?:)/.test(n.image || "") ? n.image : "";
    return `
    <article id="${anchor(n.id)}">
      <div class="chip">${esc(typeName(typeId))}</div>
      <h3>${esc(n.title || untitled)}</h3>
      ${dates.length ? `<p class="dates">${dates.map(esc).join(" · ")}</p>` : ""}
      ${n.tags?.length ? `<div class="tags">${n.tags.map((x) => `<span>#${esc(x)}</span>`).join("")}</div>` : ""}
      ${image ? `<figure><img src="${esc(image)}" alt=""></figure>` : ""}
      ${n.description ? `<div class="desc">${md(n.description)}</div>` : ""}
      ${fields.length ? `<table>${fields.map((f) => `<tr><td>${esc(f.key)}</td><td>${md(f.value)}</td></tr>`).join("")}</table>` : ""}
      ${rels.length ? `<div class="links"><b>${esc(t("book.links"))}</b><ul>${rels.map((e) => {
        const out = e.source === n.id;
        const other = byId.get(out ? e.target : e.source);
        const label = e.label || relLabel.get(e.relType) || "";
        return `<li>${out ? "→" : "←"} <a href="#${anchor(other?.id)}">${esc(other?.title || untitled)}</a>${label ? ` <span class="meta">(${esc(label)})</span>` : ""}</li>`;
      }).join("")}</ul></div>` : ""}
      ${mentions.length ? `<div class="mentions"><b>${esc(t("node.mentions"))}</b><ul>${mentions.map((m) => `<li><a href="#${anchor(m.id)}">${esc(m.title || untitled)}</a>${m.snippet ? ` <span>— ${esc(m.snippet.length > 140 ? `${m.snippet.slice(0, 140)}…` : m.snippet)}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
    </article>`;
  };

  const sections = [...groups].filter(([, list]) => list.length).map(([id, list]) => `
  <section class="type" style="--type:${typeColor(id)}">
    <h2><span class="dot"></span>${esc(typeName(id))}</h2>
    ${list.map((n) => article(n, id)).join("")}
  </section>`).join("");

  const when = new Date().toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `<!doctype html>
<html lang="${lang === "ru" ? "ru" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="BlueGem">
<title>${esc(project.name)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>${esc(project.name)}</h1>
  ${project.description ? `<p class="lead">${esc(project.description)}</p>` : ""}
  <p class="meta">${esc(t("count.nodes", { count: nodes.length }))} · ${esc(t("count.edges", { count: edges.length }))} · ${esc(when)}</p>
</header>
<nav><h2>${esc(t("book.contents"))}</h2>${toc || `<p class="meta">${esc(t("book.empty"))}</p>`}</nav>
${sections}
<footer>${esc(t("book.footer"))}</footer>
</body>
</html>`;
}
