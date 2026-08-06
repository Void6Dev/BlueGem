import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, CornerDownLeft } from "lucide-react";
import { NodeIcon } from "@/components/NodeIcon";
import { useT } from "@/lib/i18n";
import { scrollWithin } from "@/lib/scrollWithin";

/**
 * Ctrl+K palette: one input that reaches every node and every command.
 * `commands` — [{ id, label, hint, icon: LucideComponent, run }]
 * `nodes`    — [{ id, title, subtitle, color, icon }]
 */
export default function CommandPalette({ open, onClose, commands = [], nodes = [] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (s) => !needle || (s || "").toLowerCase().includes(needle);
    const cmd = commands.filter((c) => match(c.label) || match(c.hint)).map((c) => ({ ...c, kind: "cmd" }));
    const nds = nodes
      .filter((n) => match(n.title) || match(n.subtitle))
      .slice(0, 40)
      .map((n) => ({ ...n, kind: "node", label: n.title || t("common.untitled") }));
    // While typing, content matters more than commands.
    return needle ? [...nds, ...cmd] : [...cmd, ...nds];
    // t в зависимостях: при смене языка список пересобирается.
  }, [q, commands, nodes, t]);

  useEffect(() => { setCursor(0); }, [q]);

  useEffect(() => {
    // Только свой список: scrollIntoView заодно двигает и корневой экран.
    scrollWithin(listRef.current, listRef.current?.querySelector('[data-active="true"]'), "nearest", "auto");
  }, [cursor]);

  if (!open) return null;

  const choose = (item) => {
    onClose();
    item?.run?.();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[cursor]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/45 backdrop-blur-sm"
      onClick={onClose}
      data-testid="command-palette"
    >
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl border sw-border-c sw-panel overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b sw-border-c">
          <Search className="w-4 h-4 sw-text-dim shrink-0" />
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-[var(--sw-text-dim)]"
          />
          <kbd>Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {items.length === 0 && (
            <p className="px-4 py-6 text-center text-sm sw-text-dim">{t("common.nothingFound")}</p>
          )}
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={`${item.kind}-${item.id}`}
                data-active={i === cursor}
                data-testid={`palette-item-${item.id}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(item)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left"
                style={{ background: i === cursor ? "var(--sw-hover)" : "transparent" }}
              >
                {item.kind === "node" ? (
                  <span className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: item.color }}>
                    <NodeIcon name={item.iconName} className="w-3 h-3 text-white" />
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded flex items-center justify-center shrink-0 border sw-border-c sw-text-dim">
                    {Icon ? <Icon className="w-3 h-3" /> : null}
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{item.label}</span>
                  {item.subtitle && <span className="block text-[11px] sw-text-dim truncate">{item.subtitle}</span>}
                </span>
                {item.hint && <kbd>{item.hint}</kbd>}
                {i === cursor && <CornerDownLeft className="w-3.5 h-3.5 sw-text-dim shrink-0" />}
              </button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
