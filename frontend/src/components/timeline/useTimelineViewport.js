import { useCallback, useEffect, useRef, useState } from "react";

// Панорама и зум шкалы.
//
// Содержимое живёт в собственных координатах: карточка с позицией `u` стоит на
// `u * zoom` пикселей от начала времён. Панорама — это сдвиг всей полосы, и
// ни одна карточка от неё не меняет своей позиции. Значит, таскать шкалу можно
// одним transform на контейнере, вообще не трогая React: тридцать тысяч
// событий или три — мышь идёт одинаково гладко.
//
// Зум — другое дело: он меняет `u * zoom` у всех сразу, поэтому его мы
// проводим через состояние и перерисовку. Зумят колесом, редко и дискретно,
// так что перерисовки там незаметны.
//
// Ещё панорама обязана изредка отмечаться в состоянии — чтобы пересчитался
// список видимых карточек. Отмечается она, только уехав дальше COMMIT_PX,
// а запас отрисовки (OVERSCAN_PX) заведомо больше, поэтому пустых мест на
// краях не бывает.

const COMMIT_PX = 400;
export const OVERSCAN_PX = 1000;

const MIN_ZOOM = 1e-6;
const MAX_ZOOM = 400;

const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * @param {object} opts
 * @param {number} opts.total  полная длина шкалы в её единицах
 * @param {number} opts.width  ширина видимой области в пикселях
 */
export function useTimelineViewport({ total, width }) {
  const viewRef = useRef({ offsetU: 0, zoom: 1 });
  const bounds = useRef({ total, width });
  bounds.current = { total, width };
  const [committed, setCommitted] = useState({ offsetU: 0, zoom: 1 });
  const committedRef = useRef(committed);
  const tracks = useRef(new Set());
  const frame = useRef(0);
  const listeners = useRef(new Set());
  // Трогал ли шкалу человек. Пока не трогал, вид принадлежит программе: она
  // вправе перестроить его под новые данные. После первого же движения мышью
  // — не вправе, иначе шкала прыгала бы под руками.
  const touched = useRef(false);

  /**
   * Сдвиг полос — не от начала времён, а от последней отметки.
   *
   * Позиции карточек считаются от неё же. Иначе при сильном увеличении
   * левый край содержимого уезжал бы на сотни миллионов пикселей — столько
   * браузеры не умеют размечать, и карточки начали бы дрожать и пропадать.
   * От отметки же расстояния всегда в пределах экрана.
   */
  const applyTransform = useCallback(() => {
    const { offsetU, zoom } = viewRef.current;
    const x = -(offsetU - committedRef.current.offsetU) * zoom;
    for (const el of tracks.current) {
      if (el) el.style.transform = `translate3d(${x}px, 0, 0)`;
    }
    for (const fn of listeners.current) fn(viewRef.current);
  }, []);

  const commit = useCallback(() => {
    const next = { ...viewRef.current };
    committedRef.current = next;
    setCommitted(next);
    applyTransform();
  }, [applyTransform]);

  /** Разложить текущий сдвиг по зарегистрированным полосам. */
  const paint = useCallback(() => {
    frame.current = 0;
    applyTransform();
    const { offsetU, zoom } = viewRef.current;
    if (Math.abs(offsetU - committedRef.current.offsetU) * zoom > COMMIT_PX) commit();
  }, [applyTransform, commit]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
  }, []);

  /** Полоса, которая должна ехать вместе со временем (карточки, ось, эпохи). */
  const registerTrack = useCallback((el) => {
    if (!el) return undefined;
    tracks.current.add(el);
    const { offsetU, zoom } = viewRef.current;
    el.style.transform = `translate3d(${-(offsetU - committedRef.current.offsetU) * zoom}px, 0, 0)`;
    return () => tracks.current.delete(el);
  }, []);

  /** Подписка на живой сдвиг — для подписей, которые обновляются каждый кадр
   *  и которым перерисовка React не нужна. */
  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  /**
   * Удержать вид у хронологии.
   *
   * Без этого шкалу можно увести сколь угодно далеко в пустоту: событий там
   * нет, ориентиров тоже, и вернуться получится только кнопкой «показать
   * всё». Оставляем возможность отойти на пол-экрана за край — этого хватает,
   * чтобы разглядеть крайнее событие, и не хватает, чтобы потеряться.
   */
  const clamp = useCallback(() => {
    const view = viewRef.current;
    const { total: span, width: screenPx } = bounds.current;
    const screenU = screenPx / view.zoom;
    const margin = screenU / 2;
    const lo = -margin;
    const hi = Math.max(lo, (span || 0) - screenU + margin);
    view.offsetU = Math.min(hi, Math.max(lo, view.offsetU));
  }, []);

  const panBy = useCallback((dxPx) => {
    touched.current = true;
    viewRef.current.offsetU += dxPx / viewRef.current.zoom;
    clamp();
    schedule();
  }, [schedule, clamp]);

  /** Зум вокруг точки: момент под курсором остаётся под курсором. */
  const zoomAt = useCallback((factor, anchorPx) => {
    touched.current = true;
    const view = viewRef.current;
    const zoom = clampZoom(view.zoom * factor);
    if (zoom === view.zoom) return;
    const uAtAnchor = view.offsetU + anchorPx / view.zoom;
    view.zoom = zoom;
    view.offsetU = uAtAnchor - anchorPx / zoom;
    clamp();
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    // Зум меняет позицию каждой карточки, поэтому отмечаемся сразу.
    commit();
  }, [commit, clamp]);

  /** Показать промежуток [u0, u1] целиком. */
  const fitRange = useCallback((u0, u1, padPx = 48) => {
    const span = Math.max(u1 - u0, 1e-6);
    const usable = Math.max(width - padPx * 2, 1);
    const zoom = clampZoom(usable / span);
    viewRef.current.zoom = zoom;
    viewRef.current.offsetU = u0 - padPx / zoom;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    commit();
  }, [width, commit]);

  const fitAll = useCallback(() => fitRange(0, total || 1), [fitRange, total]);

  /** Подвести момент к центру экрана, не меняя масштаба. */
  const centerOn = useCallback((u) => {
    touched.current = true;
    viewRef.current.offsetU = u - width / 2 / viewRef.current.zoom;
    clamp();
    schedule();
    commit();
  }, [width, schedule, commit, clamp]);

  return {
    viewRef, committed, registerTrack, subscribe, touched,
    panBy, zoomAt, fitRange, fitAll, centerOn, commit,
    /** Экранная координата -> позиция на шкале, по живому сдвигу. */
    uAt: useCallback((px) => viewRef.current.offsetU + px / viewRef.current.zoom, []),
  };
}

/**
 * Ввод: колесо, перетаскивание, клавиши.
 *
 * Колесо панорамирует, Ctrl (или Cmd) с колесом — зумит, ровно как в Figma.
 * Трекпад с горизонтальной прокруткой работает сам собой, потому что даёт
 * ненулевой deltaX.
 */
export function useTimelineInput(ref, viewport, { onIdle } = {}) {
  const { panBy, zoomAt, fitAll } = viewport;
  const dragging = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Один щелчок колеса — примерно четверть шага масштаба. Мыши сообщают
        // сильно разный deltaY (от 3 до 240 на тот же щелчок), поэтому его
        // приходится подрезать: иначе одно движение уводило бы шкалу с
        // тысячелетий на часы.
        const delta = Math.max(-160, Math.min(160, e.deltaY));
        zoomAt(Math.exp(-delta * 0.002), e.clientX - rect.left);
        return;
      }
      const step = e.deltaMode === 1 ? 16 : 1;
      // Трекпад вбок и Shift с колесом — движение по времени.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        e.preventDefault();
        panBy(-(e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * step);
        return;
      }
      // Обычное колесо листает ряды, пока они не кончились. Когда листать
      // нечего — шкала едет по времени: иначе на хронологии в один ряд
      // колесо не делало бы ничего.
      if (el.scrollHeight > el.clientHeight + 1) return;
      e.preventDefault();
      panBy(-e.deltaY * step);
    };

    const onPointerDown = (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      // По карточке тащить нельзя — это клик по событию, а не панорама.
      if (e.button === 0 && e.target.closest("[data-tl-card]")) return;
      dragging.current = { x: e.clientX, moved: false, id: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
      el.style.cursor = "grabbing";
    };

    const onPointerMove = (e) => {
      const drag = dragging.current;
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 2) drag.moved = true;
      drag.x = e.clientX;
      panBy(dx);
    };

    const endDrag = (e) => {
      const drag = dragging.current;
      if (!drag) return;
      dragging.current = null;
      el.releasePointerCapture?.(e.pointerId);
      el.style.cursor = "";
      if (drag.moved) onIdle?.();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
    };
  }, [ref, panBy, zoomAt, onIdle]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, [contenteditable]")) return;
      const width = ref.current?.clientWidth || 800;
      if (e.key === "+" || e.key === "=") { zoomAt(1.3, width / 2); e.preventDefault(); }
      else if (e.key === "-" || e.key === "_") { zoomAt(1 / 1.3, width / 2); e.preventDefault(); }
      else if (e.key === "0") { fitAll(); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { panBy(e.shiftKey ? 400 : 100); e.preventDefault(); }
      else if (e.key === "ArrowRight") { panBy(e.shiftKey ? -400 : -100); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref, zoomAt, panBy, fitAll]);
}

/** Размер элемента, следящий за изменениями. */
export function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => {
      setSize((prev) => {
        const next = { width: el.clientWidth, height: el.clientHeight };
        return prev.width === next.width && prev.height === next.height ? prev : next;
      });
    });
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
