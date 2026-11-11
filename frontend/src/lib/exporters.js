// Turning a project into files the author can keep, share or version.
import { isDesktop, printPdf, saveTextFile } from "@/lib/desktop";
import { isNative, shareTextFile } from "@/lib/platform";
import { t } from "@/lib/i18n";
import {
  entryLabel, formatRange, normalizeEntries, resolveCalendar, resolveEras,
} from "@/lib/chrono";

/** Расширение файла проекта. С ним же связано приложение в системе. */
export const PROJECT_EXT = "bgproj";

function download(filename, text, mime = "application/json") {
  const type = typeof text === "string" ? `${mime};charset=utf-8` : mime;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so Firefox has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * В приложении — системный диалог «Сохранить как», в браузере — обычная
 * загрузка. Возвращает {saved, canceled, path} — вызывающий решает, что сказать.
 */
async function writeFile(filename, text, { mime = "application/json", filters, base64 } = {}) {
  // base64 — двоичный файл (картинка): строка base64 без заголовка data:.
  // Телефон: системное меню «Поделиться» — сохранить в «Файлы», на Диск,
  // отправить в мессенджер. Загрузки по ссылке в WebView нет.
  if (isNative) return shareTextFile(filename, text, { title: filename, base64: !!base64 });
  if (!isDesktop) {
    download(filename, base64 ? Uint8Array.from(atob(text), (c) => c.charCodeAt(0)) : text, mime);
    return { saved: true };
  }
  const res = await saveTextFile({
    defaultPath: filename, content: text, filters, ...(base64 ? { encoding: "base64" } : {}),
  });
  if (res.canceled) return { saved: false, canceled: true };
  if (!res.ok) throw new Error(res.error || t("errors.saveFile"));
  return { saved: true, path: res.path };
}

export function slugify(name) {
  return (name || "project")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
}

export function downloadJson(snapshot) {
  const name = snapshot?.project?.name || "bluegem";
  return writeFile(`${slugify(name)}.${PROJECT_EXT}`, JSON.stringify(snapshot, null, 2), {
    filters: [
      { name: t("file.projectFilter"), extensions: [PROJECT_EXT] },
      { name: t("file.json"), extensions: ["json"] },
    ],
  });
}

/** A readable world bible: one section per node, with its relationships. */
export function toMarkdown(snapshot) {
  const { project, nodes, edges } = snapshot;
  const types = new Map((project.settings?.nodeTypes || []).map((t) => [t.id, t.label]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const title = (id) => byId.get(id)?.title || "?";

  // Даты выносим в том же виде, в каком они видны в программе: по календарю
  // мира и с названиями эпох. Иначе в выгрузке остались бы голые числа,
  // которые вне своего календаря ничего не значат.
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

  const lines = [`# ${project.name}`, ""];
  if (project.description) lines.push(project.description, "");
  lines.push(t("export.summary", {
    nodes: t("count.nodes", { count: nodes.length }),
    edges: t("count.edges", { count: edges.length }),
  }), "");

  const grouped = new Map();
  nodes.forEach((n) => {
    const key = n.typeId || "note";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(n);
  });

  for (const [typeId, group] of grouped) {
    lines.push(`## ${types.get(typeId) || typeId}`, "");
    group
      .slice()
      .sort((a, b) => (a.title || "").localeCompare(b.title || "", "ru"))
      .forEach((n) => {
        lines.push(`### ${n.title || t("common.untitled")}`, "");
        const dates = datesOf(n);
        if (dates.length) lines.push(`${t("export.date")} ${dates.join("; ")}`, "");
        else if (n.date) lines.push(`${t("export.date")} ${n.date}`, "");
        if (n.tags?.length) lines.push(n.tags.map((t) => `\`#${t}\``).join(" "), "");
        if (n.description) lines.push(n.description, "");
        const fields = (n.fields || []).filter((f) => f.key);
        if (fields.length) {
          lines.push(t("export.fieldHeader"), "| --- | --- |");
          fields.forEach((f) => lines.push(`| ${f.key} | ${f.value || ""} |`));
          lines.push("");
        }
        const rels = edges.filter((e) => e.source === n.id || e.target === n.id);
        if (rels.length) {
          lines.push(t("export.links"), "");
          rels.forEach((e) => {
            const outgoing = e.source === n.id;
            const other = outgoing ? e.target : e.source;
            const arrow = outgoing ? "→" : "←";
            const label = e.label ? ` (${e.label})` : "";
            lines.push(`- ${arrow} [[${title(other)}]]${label}`);
          });
          lines.push("");
        }
      });
  }
  return lines.join("\n");
}

export function downloadMarkdown(snapshot) {
  return writeFile(`${slugify(snapshot?.project?.name)}.md`, toMarkdown(snapshot), {
    mime: "text/markdown",
    filters: [{ name: t("file.markdown"), extensions: ["md"] }],
  });
}

/** Read a .json file the user picked and hand back the parsed snapshot. */
export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("errors.readFile")));
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        reject(new Error(t("errors.notJson")));
      }
    };
    reader.readAsText(file);
  });
}

/* ---------------- книга мира и картинка холста ---------------- */

/** Книга мира одним HTML-файлом (см. lib/exportBook.js). */
export async function downloadHtmlBook(snapshot) {
  const { toHtmlBook } = await import("@/lib/exportBook");
  const html = await toHtmlBook(snapshot);
  return writeFile(`${slugify(snapshot?.project?.name)}.html`, html, {
    mime: "text/html",
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
}

/**
 * Книга мира в PDF. В приложении — сразу файлом; в браузере — системный
 * диалог печати, где PDF выбирается как принтер.
 */
export async function downloadPdfBook(snapshot) {
  const { toHtmlBook } = await import("@/lib/exportBook");
  const html = await toHtmlBook(snapshot);
  const name = `${slugify(snapshot?.project?.name)}.pdf`;
  if (isDesktop) {
    const res = await printPdf({ html, defaultPath: name });
    if (res.canceled) return { saved: false, canceled: true };
    if (!res.ok) throw new Error(res.error || t("errors.saveFile"));
    return { saved: true, path: res.path };
  }
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.srcdoc = html;
  document.body.appendChild(frame);
  await new Promise((resolve) => { frame.onload = resolve; });
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60000);
  return { saved: true, printed: true };
}

/** Картинка холста PNG или SVG (см. lib/exportImage.js). */
export async function downloadCanvasImage(rf, format, projectName) {
  const { canvasImage } = await import("@/lib/exportImage");
  const url = await canvasImage(rf, format);
  const comma = url.indexOf(",");
  const head = url.slice(0, comma);
  const body = url.slice(comma + 1);
  const file = `${slugify(projectName)}.${format}`;
  if (format === "svg") {
    const text = /;base64$/.test(head) ? atob(body) : decodeURIComponent(body);
    return writeFile(file, text, { mime: "image/svg+xml", filters: [{ name: "SVG", extensions: ["svg"] }] });
  }
  return writeFile(file, body, { mime: "image/png", base64: true, filters: [{ name: "PNG", extensions: ["png"] }] });
}
