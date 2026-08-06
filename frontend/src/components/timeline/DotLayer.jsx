import { useCallback, useEffect, useRef } from "react";
import { DETAIL, LANE_H } from "./useTimelineLayout";

// Точечный слой.
//
// На дальнем плане событие — это просто цветная точка без подписи. Точек этих
// на экране бывает полторы тысячи, и каждая, будучи отдельным элементом
// разметки, обходится дорого: браузеру приходится их размечать, а React —
// сверять. Зум на двадцати пяти тысячах событий из-за этого занимал четверть
// секунды.
//
// Поэтому точки рисуются не разметкой, а одним холстом. Полторы тысячи
// заливок — меньше миллисекунды, перерисовка идёт мимо React, а панорама и
// зум остаются такими же гладкими, как на пустом проекте. Карточки с текстом
// по-прежнему живут в разметке: их на экране десятки, и им нужен и текст, и
// выделение, и доступность.

const RADIUS = 4;
const HIT = 9;

export default function DotLayer({
  layout, viewport, width, height, scrollTop, overscan, dimmed, onPick, onHover,
}) {
  const ref = useRef(null);
  const frame = useRef(0);

  const laneH = LANE_H[DETAIL.DOT];

  /** Обойти видимые точки в экранных координатах. */
  const eachDot = useCallback((fn) => {
    const { offsetU, zoom } = viewport.viewRef.current;
    const pad = overscan / zoom;
    layout.forEachVisible(
      offsetU - pad,
      offsetU + width / zoom + pad,
      scrollTop,
      scrollTop + height,
      (entry, y) => fn(entry, (entry.u0 - offsetU) * zoom, y - scrollTop + laneH / 2)
    );
  }, [layout, viewport, width, height, scrollTop, overscan, laneH]);

  const draw = useCallback(() => {
    frame.current = 0;
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    eachDot((entry, x, y) => {
      if (x < -RADIUS || x > width + RADIUS) return;
      const nodeId = entry.item.nodeId;
      ctx.globalAlpha = dimmed && !dimmed.has(nodeId) ? 0.2 : 1;
      ctx.fillStyle = entry.item.node?.nodeType?.color || "#64748b";
      ctx.beginPath();
      ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, [eachDot, width, height, dimmed]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // Холст перерисовывается и по своим изменениям, и по каждому сдвигу шкалы.
  useEffect(() => {
    draw();
    return viewport.subscribe(schedule);
  }, [draw, schedule, viewport]);

  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
  }, []);

  /** Ближайшая точка к курсору — попадание по клику и наведению. */
  const at = useCallback((clientX, clientY) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    const px = clientX - box.left;
    const py = clientY - box.top;
    let best = null;
    let bestDistance = HIT * HIT;
    eachDot((entry, x, y) => {
      const dx = x - px;
      const dy = y - py;
      const distance = dx * dx + dy * dy;
      if (distance <= bestDistance) { bestDistance = distance; best = entry.item; }
    });
    return best;
  }, [eachDot]);

  const hovered = useRef(null);
  const onMove = useCallback((e) => {
    const found = at(e.clientX, e.clientY);
    if (found === hovered.current) return;
    hovered.current = found;
    onHover(found);
  }, [at, onHover]);

  const dpr = window.devicePixelRatio || 1;
  return (
    <canvas
      ref={ref}
      className="tl-dots"
      data-testid="timeline-dots"
      width={Math.max(1, Math.round(width * dpr))}
      height={Math.max(1, Math.round(height * dpr))}
      style={{ width, height }}
      onMouseMove={onMove}
      onMouseLeave={() => { hovered.current = null; onHover(null); }}
      onClick={(e) => {
        const found = at(e.clientX, e.clientY);
        if (found) onPick(found);
      }}
    />
  );
}
