import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Trash2, Save, Link2, ArrowRight, ArrowLeftRight, MousePointerClick } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { REL_TYPES, DEFAULT_EDGE_COLOR } from "@/lib/settings";
import { useT } from "@/lib/i18n";

export default function EdgeEditorPanel({ edge, nodeTitles = {}, onClose, onSave, onDelete, onOpenNode }) {
  const t = useT();
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (edge)
      setDraft({
        id: edge.id,
        label: edge.label || "",
        relType: edge.data?.relType || "",
        color: edge.data?.color || "",
        source: edge.source,
        target: edge.target,
      });
    setConfirmDelete(false);
  }, [edge]);

  if (!edge || !draft) return null;

  const swap = () => setDraft((d) => ({ ...d, source: d.target, target: d.source }));
  const activeColor = draft.color || DEFAULT_EDGE_COLOR;
  const title = (id) => nodeTitles[id] || t("edge.node");
  // Внутри REL_TYPES параметр назван rel, чтобы не затенять функцию перевода.
  const currentType = REL_TYPES.find((rel) => rel.id === (draft.relType || "")) || REL_TYPES[0];

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}

      transition={{ type: "tween", duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="absolute top-0 right-0 h-full w-full sm:w-[26rem] border-l sw-panel sw-border-c z-20 flex flex-col"
      data-testid="edge-editor-panel"
    >
      <div className="flex items-center justify-between px-6 py-5 border-b sw-border-c">
        <span className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim flex items-center gap-2">
          <Link2 className="w-3.5 h-3.5" /> {t("edge.title")}
        </span>
        <button onClick={onClose} data-testid="close-edge-btn" className="p-1.5 rounded-md sw-hover">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 sw-scroll-y px-6 py-6 space-y-6">
        {/* Endpoints + direction */}
        <div className="rounded-lg border sw-border-c p-3">
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => onOpenNode?.(draft.source)} className="truncate flex-1 text-left hover:opacity-80">
              {title(draft.source)}
            </button>
            <ArrowRight className="w-4 h-4 shrink-0" style={{ color: activeColor }} />
            <button onClick={() => onOpenNode?.(draft.target)} className="truncate flex-1 text-right hover:opacity-80">
              {title(draft.target)}
            </button>
          </div>
          <button
            data-testid="swap-edge-btn"
            onClick={swap}
            className="mt-3 w-full flex items-center justify-center gap-2 py-1.5 rounded-md border sw-border-c text-xs sw-text-dim sw-btn"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" /> {t("edge.swap")}
          </button>
        </div>

        {/* Тип выбирается правым кликом по линии — здесь только текущее значение. */}
        <div>
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{t("edge.typeLabel")}</label>
          <div
            data-testid="edge-current-type"
            className="mt-2 flex items-center gap-2 px-3 py-2.5 rounded-lg border sw-border-c"
            style={{ borderColor: `${currentType.color}66`, background: `${currentType.color}14` }}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: currentType.color }} />
            <span className="text-sm flex-1 truncate">{t(currentType.labelKey)}</span>
            <MousePointerClick className="w-3.5 h-3.5 sw-text-dim shrink-0" />
          </div>
          <p className="mt-1.5 text-[11px] sw-text-dim">
            {t("edge.typeHint")}
          </p>
        </div>

        <div>
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{t("edge.label")}</label>
          <Input
            data-testid="edge-label-input"
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder={t("edge.labelPlaceholder")}
            className="mt-2 bg-transparent sw-border-c"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{t("edge.color")}</label>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="color"
              data-testid="edge-color-input"
              value={activeColor}
              onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
              className="w-9 h-9 rounded cursor-pointer bg-transparent border-0 shrink-0"
            />
            <span className="h-1.5 flex-1 rounded-full" style={{ background: activeColor }} />
          </div>
        </div>
      </div>

      <div className="px-6 py-4 border-t sw-border-c flex items-center gap-2">
        {confirmDelete ? (
          <>
            <span className="text-xs sw-text-dim flex-1">{t("edge.confirmDelete")}</span>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} className="text-xs h-9">{t("common.cancel")}</Button>
            <Button
              data-testid="confirm-delete-edge-btn"
              onClick={() => onDelete(draft.id)}
              className="bg-red-600 text-white hover:bg-red-700 border-0 h-9 text-xs"
            >
              {t("common.delete")}
            </Button>
          </>
        ) : (
          <>
            <Button
              data-testid="save-edge-btn"
              onClick={() => onSave(draft.id, {
                label: draft.label, relType: draft.relType, color: draft.color,
                source: draft.source, target: draft.target,
              })}
              className="flex-1 sw-accent-bg text-white border-0 hover:opacity-90 gap-2"
            >
              <Save className="w-4 h-4" /> {t("common.save")}
            </Button>
            <Button
              data-testid="delete-edge-btn"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="text-red-400 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>
    </motion.div>
  );
}
