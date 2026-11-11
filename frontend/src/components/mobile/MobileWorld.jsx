import { useMemo, useState } from "react";
import { Link2, Plus, Search, X } from "lucide-react";
import { NodeIcon } from "@/components/NodeIcon";
import { TextField } from "@/components/ui/text-field";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/platform";

/**
 * Мир списком — главный экран проекта на телефоне.
 *
 * Холст хорош, чтобы окинуть связи взглядом, но искать на нём нужного
 * персонажа, водя пальцем по полотну, — мучение. Здесь всё под рукой: поиск,
 * типы чипами, узлы строками с первой фразой текста. Касание — страница узла.
 */

/** Первая содержательная строка текста без разметки — подпись под названием. */
function excerpt(md) {
  if (!md) return "";
  for (const raw of md.split("\n")) {
    const line = raw
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s*/, "")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_~`]+/g, "")
      .trim();
    if (line && !/^(-{3,}|\|)/.test(line)) return line;
  }
  return "";
}

export default function MobileWorld({
  nodes, types, degrees, canvases, mainCanvasId, onOpen, onContextMenu, onCreate,
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");

  const counts = useMemo(() => {
    const out = {};
    for (const n of nodes) out[n.typeId || "note"] = (out[n.typeId || "note"] || 0) + 1;
    return out;
  }, [nodes]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (n) => !needle
      || (n.title || "").toLowerCase().includes(needle)
      || (n.description || "").toLowerCase().includes(needle)
      || (n.tags || []).some((tag) => tag.toLowerCase().includes(needle));
    const byType = new Map();
    for (const n of nodes) {
      const tid = n.typeId || "note";
      if (type !== "all" && tid !== type) continue;
      if (!hit(n)) continue;
      if (!byType.has(tid)) byType.set(tid, []);
      byType.get(tid).push(n);
    }
    const order = types.map((x) => x.id);
    return [...byType.entries()]
      .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
      .map(([tid, list]) => ({
        type: types.find((x) => x.id === tid) || { id: tid, label: t("editor.otherType"), color: "#64748b", icon: "FileText" },
        list: list.slice().sort((a, b) => (a.title || "").localeCompare(b.title || "", "ru")),
      }));
  }, [nodes, types, q, type, t]);

  return (
    <div className="sw-world" data-testid="mobile-world">
      <div className="sw-world-top">
        <div className="sw-msearch !m-0">
          <Search className="sw-msearch-icon" />
          <TextField
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("editor.searchNodes")}
            enterKeyHint="search"
            data-testid="world-search"
          />
          {q ? (
            <button type="button" className="sw-icon-btn sw-msearch-clear" onClick={() => setQ("")} aria-label="clear">
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>
        <div className="sw-world-chips">
          <button type="button" data-active={type === "all"} onClick={() => { haptic("tick"); setType("all"); }}>
            {t("mobile.all")} <span>{nodes.length}</span>
          </button>
          {types.filter((x) => counts[x.id]).map((x) => (
            <button
              key={x.id}
              type="button"
              data-active={type === x.id}
              style={{ "--node-color": x.color }}
              onClick={() => { haptic("tick"); setType(type === x.id ? "all" : x.id); }}
            >
              <i />{x.label} <span>{counts[x.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sw-world-list">
        {nodes.length === 0 ? (
          <div className="sw-world-empty">
            <p className="sw-display text-2xl tracking-tight">{t("editor.emptyCanvas")}</p>
            <p className="sw-text-dim text-sm mt-1">{t("mobile.emptyHint")}</p>
            <button type="button" className="sw-world-add" onClick={onCreate}>
              <Plus className="w-5 h-5" /> {t("editor.create")}
            </button>
          </div>
        ) : groups.length === 0 ? (
          <p className="sw-text-dim text-sm text-center py-10">{t("common.nothingFound")}</p>
        ) : groups.map((g) => (
          <section key={g.type.id} className="sw-world-group">
            {type === "all" && (
              <h3 className="sw-world-head" style={{ "--node-color": g.type.color }}>
                <i />{g.type.label}<span>{g.list.length}</span>
              </h3>
            )}
            {g.list.map((n) => {
              const sub = excerpt(n.description);
              const page = "";
              const deg = degrees.get(n.id) || 0;
              return (
                <button
                  key={n.id}
                  type="button"
                  className="sw-world-row"
                  data-testid={`world-row-${n.id}`}
                  onClick={() => { haptic("light"); onOpen(n.id); }}
                  onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, n.id); }}
                >
                  <span className="sw-world-icon" style={{ background: g.type.color }}>
                    <NodeIcon name={g.type.icon} className="w-[18px] h-[18px] text-white" />
                  </span>
                  <span className="sw-world-text">
                    <span className="sw-world-title">{n.title || t("common.untitled")}</span>
                    {(sub || page) && (
                      <span className="sw-world-sub">{[page, sub].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                  {deg > 0 && <span className="sw-world-deg"><Link2 className="w-3 h-3" />{deg}</span>}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
