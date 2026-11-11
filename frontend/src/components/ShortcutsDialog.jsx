import { motion } from "framer-motion";
import { X, Keyboard } from "lucide-react";
import { useT } from "@/lib/i18n";

// Сочетания клавиш одинаковы в обоих языках, переводятся только подписи.
const GROUPS = [
  {
    id: "general",
    items: [
      ["Ctrl + K", "palette"],
      ["Ctrl + F", "search"],
      ["?", "help"],
      ["Esc", "escape"],
    ],
  },
  {
    id: "mouse",
    // У «мыши» подпись клавиши тоже словами, поэтому ключ вместо готового текста.
    items: [
      ["dragFromPalette", "dragFromPaletteHint"],
      ["rightClickNode", "rightClickNodeHint"],
      ["rightClickEdge", "rightClickEdgeHint"],
      ["rightClickCanvas", "rightClickCanvasHint"],
      ["rightClickSelection", "rightClickSelectionHint"],
      ["dragFromDot", "dragFromDotHint"],
    ],
    keysAreWords: true,
  },
  {
    id: "nodes",
    items: [
      ["Ctrl + N", "newNote"],
      ["Ctrl + 1 … 9", "newTyped"],
      ["doubleClick", "doubleClickHint", true],
      ["Ctrl + D", "duplicate"],
      ["Ctrl + C", "copy"],
      ["Ctrl + V", "paste"],
      ["Ctrl + S", "saveNode"],
      ["Ctrl + Shift + E", "descFull"],
      ["Delete", "deleteSelection"],
      ["Ctrl + Z", "undo"],
    ],
  },
  {
    id: "canvas",
    items: [
      ["Ctrl + A", "selectAll"],
      ["F", "fit"],
      ["G", "focus"],
      ["L", "layout"],
      ["wheel", "wheelHint", true],
    ],
  },
];

export default function ShortcutsDialog({ open, onClose }) {
  const t = useT();
  if (!open) return null;
  return (
    <div
      className="sw-overlay-in fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/45 backdrop-blur-sm"
      onClick={onClose}
      data-testid="shortcuts-dialog"
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.96, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border sw-border-c sw-panel overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b sw-border-c">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Keyboard className="w-4 h-4" /> {t("shortcuts.title")}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-md sw-hover">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Группы входят лесенкой вслед за окном. */}
          {GROUPS.map((group, gi) => (
            <div key={group.id} className="sw-palette-enter" style={{ animationDelay: `${80 + gi * 50}ms` }}>
              <p className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim mb-2">
                {t(`shortcuts.${group.id}`)}
              </p>
              <div className="space-y-1.5">
                {group.items.map(([key, descKey, keyIsWord]) => (
                  <div key={key} className="flex items-center justify-between gap-4 text-sm">
                    <span className="sw-text-dim">{t(`shortcuts.items.${descKey}`)}</span>
                    <kbd className="shrink-0">
                      {group.keysAreWords || keyIsWord ? t(`shortcuts.items.${key}`) : key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
