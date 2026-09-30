import { memo, useCallback, useMemo, useRef } from "react";

// Полоса-обзор справа, как в редакторе кода.
//
// Отвечает на вопрос «где я и сколько ещё», когда дат много: весь список
// сжат в один столбик, каждое событие — штрих в цвет своего типа, текущее
// окно обведено рамкой. Нажатие переносит туда, протяжка листает.
//
// Штрихи бьются по пикселям полосы, а не рисуются по одному: на проекте в
// тридцать тысяч событий это тридцать тысяч узлов DOM ради полосы шириной
// в палец. Ведёрок ровно столько, сколько в полосе пикселей, — больше
// человек всё равно не различит.

const TICK_H = 2;

function TimelineMinimapInner({ rows, height, viewH, scrollTop, onJump }) {
  const ref = useRef(null);

  // Высоту полосы берём равной высоте списка: одна и та же дробь и здесь,
  // и в прокрутке, — иначе рамка окна врёт.
  const ticks = useMemo(() => {
    if (!height || !viewH) return [];
    const buckets = new Map();
    for (const row of rows) {
      if (row.kind !== "event") continue;
      const at = Math.round((row.y / height) * (viewH - TICK_H));
      if (buckets.has(at)) continue;
      buckets.set(at, row.item.node?.nodeType?.color || "#64748b");
    }
    return [...buckets.entries()].map(([at, color]) => ({ at, color }));
  }, [rows, height, viewH]);

  const jumpTo = useCallback((clientY) => {
    const el = ref.current;
    if (!el || !height) return;
    const box = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - box.top) / box.height));
    // Целимся серединой окна в место нажатия: попасть хотят в событие под
    // курсором, а не поставить его в самый верх экрана.
    onJump(ratio * height - viewH / 2);
  }, [height, viewH, onJump]);

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    jumpTo(e.clientY);
    const move = (ev) => jumpTo(ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [jumpTo]);

  if (!height || height <= viewH) return null;

  const windowTop = (scrollTop / height) * viewH;
  const windowH = Math.max((viewH / height) * viewH, 12);

  return (
    <div
      ref={ref}
      className="tl-minimap"
      onPointerDown={onPointerDown}
      data-testid="timeline-minimap"
    >
      {ticks.map((t) => (
        <span
          key={t.at}
          className="tl-minimap-tick"
          style={{ top: t.at, background: t.color }}
        />
      ))}
      <span
        className="tl-minimap-window"
        style={{ top: windowTop, height: windowH }}
        data-testid="timeline-minimap-window"
      />
    </div>
  );
}

export const TimelineMinimap = memo(TimelineMinimapInner);
export default TimelineMinimap;
