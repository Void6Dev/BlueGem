import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@xyflow/react";
import {
  CalendarRange, ChevronDown, Layers, Link2, MoreHorizontal, Pencil, Shapes, X,
} from "lucide-react";
import { NodeIcon } from "@/components/NodeIcon";
import MarkdownView from "@/components/MarkdownView";
import { useT } from "@/lib/i18n";

// Превью узла по одиночному клику.
//
// Раньше клик разворачивал саму карточку на холсте: она вырастала на месте и
// ложилась поверх соседей — чтобы заглянуть в один узел, приходилось закрывать
// собой три других. Превью живёт рядом с карточкой, над холстом, и ничего под
// собой не прячет: карточка остаётся своего размера, связи — на месте.
//
// Координаты экранные, а не холста: на отдалении превью, масштабированное
// вместе с холстом, стало бы нечитаемым как раз тогда, когда оно нужнее всего.

const W = 340;
const GAP = 14;
const EDGE = 16;
// Отступ от верхнего края холста. Плавающего тулбара над холстом больше нет —
// панель закреплена выше, вне его, — так что хватает обычного поля.
const TOP_SAFE = 16;

// Меню от кнопки — под ней, по левому краю.
const below = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 6 };
};

export default function NodePreview({
  node, nodes, onOpenEditor, onPeek, onOpenNode, onClose, onLink, onTypeMenu, onMore,
}) {
  const t = useT();
  const id = node.id;
  const ref = useRef(null);
  const [h, setH] = useState(0);

  // Где карточка на экране — одной строкой, округлённой до пикселя: селектор
  // срабатывает на каждый кадр движения холста, а перерисовывать превью стоит
  // только тогда, когда оно и правда сдвинулось.
  const box = useStore(useCallback((s) => {
    const n = s.nodeLookup.get(id);
    if (!n || n.hidden) return "";
    const p = n.internals.positionAbsolute;
    const [tx, ty, z] = s.transform;
    return [p.x * z + tx, p.y * z + ty, (n.measured?.width || 0) * z, (n.measured?.height || 0) * z, s.width, s.height]
      .map(Math.round).join("|");
  }, [id]));

  // Высота нужна, чтобы прижать превью к низу экрана, а не дать ему уйти
  // под край. Картинка догружается позже разметки — поэтому наблюдатель.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setH(el.offsetHeight);
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id]);

  if (!box) return null;
  const [x, y, w, nh, vw, vh] = box.split("|").map(Number);
  // Узел целиком ушёл за край — превью за ним не тянется, но и не пропадает:
  // вернули узел в кадр — оно на месте.
  const off = x + w < 0 || x > vw || y + nh < 0 || y > vh;

  let left = x + w + GAP;
  if (left + W > vw - EDGE) {
    left = x - GAP - W >= EDGE ? x - GAP - W : Math.max(EDGE, vw - EDGE - W);
  }
  const top = Math.max(TOP_SAFE, Math.min(y, vh - EDGE - h));

  const color = node.nodeType?.color || "#64748b";
  const fields = (node.fields || []).filter((f) => f.key);
  const tags = node.tags || [];
  const dates = node.dateLines || [];
  const neighbours = node.neighbours || [];

  return (
    <div
      ref={ref}
      data-testid="node-preview"
      className="sw-preview sw-typed sw-panel"
      style={{
        left,
        top,
        width: W,
        maxHeight: `calc(100% - ${TOP_SAFE + EDGE}px)`,
        "--node-color": color,
        opacity: off ? 0 : 1,
        pointerEvents: off ? "none" : undefined,
      }}
      // Колесо над превью листает его, а не зумит холст под ним.
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="sw-preview-head">
        <div className="flex items-center gap-2">
          <span className="sw-node-badge-icon is-lg">
            <NodeIcon name={node.nodeType?.icon} className="text-white" />
          </span>
          <span className="sw-node-type">{node.nodeType?.label || ""}</span>
          <button
            type="button"
            data-testid="node-preview-close"
            onClick={onClose}
            title={`${t("common.close")} · Esc`}
            className="p-1.5 rounded-md sw-hover sw-text-dim shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <h3 className={`sw-preview-title ${node.title ? "" : "sw-untitled"}`}>
          {node.title || t("common.untitled")}
        </h3>
      </div>

      <div className="sw-preview-body sw-scroll-y">
        {node.image && <img src={node.image} alt="" className="sw-preview-img" decoding="async" />}

        {(node.date || dates.length > 0) && (
          <div className="sw-node-dates">
            {node.date && (
              <span className="sw-node-date"><CalendarRange className="w-3 h-3 shrink-0" />{node.date}</span>
            )}
            {dates.map((d) => (
              <span key={d.key} className="sw-node-date">
                <CalendarRange className="w-3 h-3 shrink-0" />
                {d.label && <span className="sw-node-date-key">{d.label}</span>}
                {d.text}
              </span>
            ))}
          </div>
        )}

        {/* Ссылки [[узел]] в тексте живые: превью — место, где читают, а не
            холст, которому принадлежит клик по карточке. */}
        <MarkdownView text={node.description} nodes={nodes} onOpenNode={onPeek} />

        {fields.length > 0 && (
          <div>
            <span className="sw-section-label">{t("node.customFields")}</span>
            <div className="sw-node-fields mt-1.5">
              {fields.map((f, i) => (
                <div key={`${f.key}-${i}`} className="contents">
                  <span className="sw-node-field-key">{f.key}</span>
                  <span className="sw-preview-field-val">{f.value || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => <span key={tag} className="sw-node-tag">{tag}</span>)}
          </div>
        )}

        {/* Соседи: клик переводит превью на соседа — по миру можно идти от
            узла к узлу, не открывая редактор. Сосед на другом холсте ведёт
            туда же, куда и раньше, — в редактор с переходом на его холст. */}
        {neighbours.length > 0 && (
          <div className="sw-node-links" data-testid="node-preview-links">
            <span className="sw-section-label">
              {t("node.connections")}
              <span className="sw-node-links-count">{neighbours.length}</span>
            </span>
            {neighbours.map((n, i) => (
              <button
                key={`${n.id}-${i}`}
                type="button"
                data-testid={`node-preview-link-${n.id}`}
                className="sw-node-link"
                onClick={() => (n.away ? onOpenNode(n.id) : onPeek(n.id))}
                title={n.rel || undefined}
              >
                <span className="sw-node-link-dir">{n.outgoing ? "→" : "←"}</span>
                <span className="sw-node-link-dot" style={{ background: n.color || "var(--sw-border-strong)" }} />
                <span className="truncate">{n.title || t("common.untitled")}</span>
                {n.rel && <span className="sw-node-link-rel truncate">{n.rel}</span>}
                {n.away && <Layers className="w-2.5 h-2.5 shrink-0 opacity-60" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Частые действия с узлом — здесь, у него под рукой, а не только в
          меню правой кнопки: клик по карточке открывает превью, и отсюда до
          связи или смены типа один шаг. Полное меню — за «⋯». */}
      <div className="sw-preview-foot">
        <button
          type="button"
          data-testid="node-preview-edit"
          onClick={() => onOpenEditor(id)}
          title={t("ctx.previewHint")}
          className="sw-preview-edit"
        >
          <Pencil className="w-3.5 h-3.5" />
          {t("ctx.edit")}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="node-preview-link"
          onClick={() => onLink(id)}
          title={t("ctx.linkTo")}
          className="sw-preview-act"
        >
          <Link2 className="w-3.5 h-3.5" />
          {t("ctx.link")}
        </button>
        <button
          type="button"
          data-testid="node-preview-type"
          onClick={(e) => onTypeMenu(below(e), id)}
          title={t("ctx.changeType")}
          className="sw-preview-act"
        >
          <Shapes className="w-3.5 h-3.5" />
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
        <button
          type="button"
          data-testid="node-preview-more"
          onClick={(e) => onMore(below(e), id)}
          title={t("editor.more")}
          className="sw-preview-act"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
