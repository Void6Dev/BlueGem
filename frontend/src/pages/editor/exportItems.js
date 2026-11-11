// Виды экспорта — одним списком для меню «⋯», «Ещё» на телефоне и палитры.
// Раньше каждый пункт был написан трижды, и новый вид легко было забыть в
// одном из мест.
import { BookOpen, FileJson, FileText, Image as ImageIcon, Printer } from "lucide-react";

const KINDS = [
  { kind: "json", icon: FileJson, group: "file" },
  { kind: "md", icon: FileText, group: "file" },
  { kind: "html", icon: BookOpen, group: "book" },
  { kind: "pdf", icon: Printer, group: "book" },
  { kind: "png", icon: ImageIcon, group: "image" },
  { kind: "svg", icon: ImageIcon, group: "image" },
];

const label = (kind) => `${kind[0].toUpperCase()}${kind.slice(1)}`;

/**
 * Пункты меню экспорта с разделителями между группами.
 * @param only какие виды показать (на телефоне — не все)
 */
export function exportMenuItems(tr, exportAs, prefix, only) {
  const out = [];
  let group = null;
  for (const k of KINDS) {
    if (only && !only.includes(k.kind)) continue;
    if (!only && group && group !== k.group) out.push({ id: `sep-${prefix}-${k.kind}`, separator: true });
    group = k.group;
    out.push({
      id: `${prefix}-${k.kind}`,
      label: tr(`editor.export${label(k.kind)}`),
      icon: k.icon,
      onSelect: () => exportAs(k.kind),
    });
  }
  return out;
}

/** То же для палитры Ctrl+K. */
export function exportCommands(tr, exportAs) {
  return KINDS.map((k) => ({
    id: `export-${k.kind}`,
    label: tr(`palette.export${label(k.kind)}`),
    icon: k.icon,
    run: () => exportAs(k.kind),
  }));
}
