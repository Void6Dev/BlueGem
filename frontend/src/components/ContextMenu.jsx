import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Check } from "lucide-react";

const MIN_W = 224;
const EDGE_PAD = 8;
// Насколько долго подменю переживает уход курсора — чтобы можно было дойти до
// него по диагонали, задев соседние пункты.
const SUBMENU_GRACE_MS = 260;

/**
 * Right-click menu. `menu` is `{ x, y, items }`; an item is
 * `{ id, label, icon, hint, danger, disabled, onSelect, items: [...] }`,
 * or `{ id, separator: true }`, or `{ id, title: "…" }` for a section caption.
 */
export default function ContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  const subTimer = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0, flipX: false });
  const [openSub, setOpenSub] = useState(null);

  // Подменю закрывается не мгновенно: иначе до него не дойти — курсор по пути
  // задевает соседние пункты и оно схлопывается под рукой.
  const holdSub = useCallback((id) => {
    clearTimeout(subTimer.current);
    setOpenSub(id);
  }, []);
  const releaseSub = useCallback(() => {
    clearTimeout(subTimer.current);
    subTimer.current = setTimeout(() => setOpenSub(null), SUBMENU_GRACE_MS);
  }, []);
  /** Отменить запланированное закрытие, ничего не открывая заново. */
  const keepSub = useCallback(() => clearTimeout(subTimer.current), []);
  useEffect(() => () => clearTimeout(subTimer.current), []);

  useLayoutEffect(() => {
    if (!menu) return;
    const el = ref.current;
    const w = el?.offsetWidth || MIN_W;
    const h = el?.offsetHeight || 0;
    setPos({
      x: Math.max(EDGE_PAD, Math.min(menu.x, window.innerWidth - w - EDGE_PAD)),
      y: Math.max(EDGE_PAD, Math.min(menu.y, window.innerHeight - h - EDGE_PAD)),
      // Submenus open to the left when there is no room on the right.
      flipX: menu.x + w + MIN_W + EDGE_PAD > window.innerWidth,
    });
    setOpenSub(null);
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => onClose();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    // Deferred so the click that produced this menu can't close it immediately.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", close);
      window.addEventListener("wheel", close, { passive: true });
    }, 0);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const pick = (item) => {
    if (item.disabled || !item.onSelect) return;
    onClose();
    item.onSelect();
  };

  // inSub — рисуем содержимое открытого подменю. Его пункты не должны запускать
  // таймер закрытия: иначе подменю схлопывается ровно тогда, когда курсор до
  // него дошёл и встал на нужную строку.
  const renderItems = (items, inSub = false) => items.map((item) => {
    if (item.separator) return <div key={item.id} className="my-1 border-t sw-border-c" />;
    if (item.title) {
      return (
        <div key={item.id} className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.18em] sw-text-dim">
          {item.title}
        </div>
      );
    }
    const Icon = item.icon;
    const hasSub = !!item.items?.length;
    const active = openSub === item.id;
    return (
      <div
        key={item.id}
        className="relative"
        onMouseEnter={() => {
          if (hasSub) holdSub(item.id);
          // Пункт верхнего уровня без вложенного списка — значит курсор ушёл в
          // сторону от подменю; даём ему время вернуться. Внутри самого
          // подменю не закрываем ничего.
          else if (inSub) keepSub();
          else releaseSub();
        }}
      >
        <button
          data-testid={`ctx-${item.id}`}
          disabled={item.disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (hasSub) holdSub(item.id);
            else pick(item);
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors duration-150
            disabled:opacity-40 disabled:cursor-default enabled:hover:bg-[var(--sw-hover)]
            ${item.danger ? "text-red-400" : ""} ${active ? "bg-[var(--sw-hover)]" : ""}`}
        >
          {Icon ? <Icon className="w-3.5 h-3.5 shrink-0 opacity-80" /> : <span className="w-3.5 shrink-0" />}
          <span className="flex-1 truncate">{item.label}</span>
          {item.swatch && (
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: item.swatch }} />
          )}
          {item.checked && <Check className="w-3.5 h-3.5 shrink-0 sw-accent-text" />}
          {item.hint && <kbd className="shrink-0">{item.hint}</kbd>}
          {hasSub && <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" />}
        </button>

        {hasSub && active && (
          <div
            onMouseEnter={() => holdSub(item.id)}
            onMouseLeave={releaseSub}
            className="absolute top-0 rounded-lg border sw-border-c sw-panel py-1 sw-menu z-10 max-h-[60vh] overflow-y-auto"
            style={{
              minWidth: MIN_W,
              [pos.flipX ? "right" : "left"]: "100%",
              "--sw-origin": pos.flipX ? "top right" : "top left",
            }}
          >
            {renderItems(item.items, true)}
          </div>
        )}
      </div>
    );
  });

  // Портал в body: любой предок с transform/filter (панели, холст React Flow)
  // сделал бы себя точкой отсчёта для position: fixed, и меню «ездило» бы
  // вместе с ним.
  return createPortal(
    <div
      ref={ref}
      data-testid="context-menu"
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseLeave={releaseSub}
      className="fixed z-[60] rounded-lg border sw-border-c sw-panel py-1 sw-menu"
      style={{ left: pos.x, top: pos.y, minWidth: MIN_W }}
    >
      {menu.header && (
        <div className="px-3 py-1.5 mb-1 border-b sw-border-c flex items-center gap-2">
          {menu.headerColor && (
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: menu.headerColor }} />
          )}
          <span className="text-xs font-semibold truncate">{menu.header}</span>
        </div>
      )}
      {renderItems(menu.items)}
    </div>,
    document.body
  );
}
