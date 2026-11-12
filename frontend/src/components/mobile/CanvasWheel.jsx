import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { haptic } from "@/lib/platform";

/**
 * Холсты (страницы мира) — колесом по центру шапки.
 *
 * Названия стоят в ряд, текущее — посередине. Лента листается пальцем
 * вбок и останавливается на ближайшем названии — это и есть переход на
 * холст, без шторки и списка. Касание соседнего названия — переход на него,
 * касание текущего — список холстов (переименовать, добавить).
 *
 * Названия ближе к краям мельчают и тают — так ряд читается как колесо, где
 * выбрано то, что в центре.
 */
export default function CanvasWheel({ canvases, active, onPick, onOpenList }) {
  const ref = useRef(null);
  const settle = useRef(0);
  const programmatic = useRef(false);

  /** Насколько каждое название далеко от центра — для масштаба и прозрачности. */
  const paint = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    for (const item of el.children) {
      const c = item.offsetLeft + item.offsetWidth / 2;
      const d = Math.min(1, Math.abs(c - mid) / (el.clientWidth / 2));
      item.style.setProperty("--d", d.toFixed(3));
    }
  }, []);

  const center = useCallback((id, smooth) => {
    const el = ref.current;
    const item = el?.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!el || !item) return;
    programmatic.current = true;
    el.scrollTo({ left: item.offsetLeft + item.offsetWidth / 2 - el.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
    paint();
  }, [paint]);

  // Текущий холст сменили не колесом (список, переход к узлу) — доворачиваем.
  useLayoutEffect(() => { center(active, false); }, [active, canvases.length, center]);

  const pickCentered = () => {
    const el = ref.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = null;
    let dist = Infinity;
    for (const item of el.children) {
      const d = Math.abs(item.offsetLeft + item.offsetWidth / 2 - mid);
      if (d < dist) { dist = d; best = item; }
    }
    const id = best?.dataset.id;
    if (id && id !== active) {
      haptic("tick");
      onPick(id);
    }
  };

  const onScroll = () => {
    paint();
    clearTimeout(settle.current);
    // Остановка ленты: в браузерах без scrollend ждём паузу в прокрутке.
    settle.current = setTimeout(() => {
      if (programmatic.current) { programmatic.current = false; return; }
      pickCentered();
    }, 140);
  };

  useEffect(() => () => clearTimeout(settle.current), []);

  return (
    <div
      ref={ref}
      className="sw-cwheel"
      onScroll={onScroll}
      onPointerDown={() => { programmatic.current = false; }}
      data-testid="canvas-wheel"
      role="tablist"
    >
      {canvases.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          data-id={c.id}
          aria-selected={c.id === active}
          className={`sw-cwheel-item ${c.id === active ? "is-active" : ""}`}
          data-testid={`canvas-wheel-${c.id}`}
          onClick={() => {
            if (c.id === active) { haptic("tick"); onOpenList(); return; }
            // Доворот к названию; сам переход случится на остановке ленты.
            center(c.id, true);
            programmatic.current = false;
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
