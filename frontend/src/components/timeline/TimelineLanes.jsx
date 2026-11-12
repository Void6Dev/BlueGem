import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  ageAt, avgYearLength, existenceOf, formatAt, fromDayIndex, startOfYear, toDayIndex,
} from "@/lib/chrono";

// Дорожки: у каждого узла своя полоса во времени.
//
// Список отвечает на вопрос «что было раньше». Дорожки — на другой: «кто был
// жив, когда это случилось» и «что шло одновременно». Время здесь идёт слева
// направо, у каждого узла — своя дорожка: полоса жизни (от рождения или
// основания до смерти или гибели) и точки событий на ней. Курсор под мышью
// (на телефоне — касанием) показывает дату и возраст каждого на этот день.

export const LANE_H = 30;
const AXIS_H = 34;
const MAX_TRACK_PX = 4_000_000;
const MAX_PX_PER_DAY = 60;

function niceYearStep(pxPerYear) {
  const need = 90 / Math.max(pxPerYear, 1e-9);
  const bases = [1, 2, 5];
  for (let pow = 1; pow < 1e9; pow *= 10) {
    for (const b of bases) if (b * pow >= need) return b * pow;
  }
  return 1e9;
}

export default function TimelineLanes({
  items, chrono, nowT, picked, onPick, conflicts, jump, mobile,
}) {
  const tr = useT();
  const cal = chrono.calendar;
  const ref = useRef(null);
  const [view, setView] = useState({ w: 0, h: 0, left: 0, top: 0 });
  const [scale, setScale] = useState(null);
  const [cursorT, setCursorT] = useState(null);
  const nameW = mobile ? 112 : 168;

  // --- дорожки ------------------------------------------------------------
  const lanes = useMemo(() => {
    const byNode = new Map();
    for (const item of items) {
      if (!byNode.has(item.nodeId)) byNode.set(item.nodeId, { nodeId: item.nodeId, node: item.node, items: [] });
      byNode.get(item.nodeId).items.push(item);
    }
    const out = [...byNode.values()];
    for (const lane of out) lane.span = existenceOf(chrono.byNode.get(lane.nodeId));
    return out;
  }, [items, chrono]);

  const range = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    const eat = (v) => { if (v != null && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); } };
    for (const item of items) { eat(item.t); eat(item.t2); }
    if (nowT != null) eat(nowT);
    const year = avgYearLength(cal);
    if (min > max) { min = 0; max = year; }
    const pad = Math.max((max - min) * 0.04, year);
    return { min: min - pad, max: max + pad };
  }, [items, nowT, cal]);

  const fit = useCallback((w) => Math.max((w - nameW - 24) / Math.max(range.max - range.min, 1), 1e-7), [range, nameW]);
  const minScale = view.w ? fit(view.w) / 2 : 1e-7;
  const maxScale = Math.min(MAX_PX_PER_DAY, MAX_TRACK_PX / Math.max(range.max - range.min, 1));
  const k = scale ?? (view.w ? fit(view.w) : null);
  const trackW = k ? Math.ceil((range.max - range.min) * k) : 0;
  const xOf = useCallback((t) => (t - range.min) * (k || 0), [range.min, k]);

  // --- размеры и прокрутка ----------------------------------------------
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const sync = () => setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight }));
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => ro.disconnect();
  }, []);

  const frame = useRef(0);
  const onScroll = useCallback((e) => {
    const el = e.currentTarget;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setView((v) => ({ ...v, left: el.scrollLeft, top: el.scrollTop }));
    });
  }, []);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  // --- масштаб ------------------------------------------------------------
  /** Новый масштаб с якорем: момент под точкой anchorX остаётся на месте. */
  const zoomTo = useCallback((next, anchorX) => {
    const el = ref.current;
    if (!el || !k) return;
    const clamped = Math.min(maxScale, Math.max(minScale, next));
    const ax = anchorX ?? (el.clientWidth + nameW) / 2;
    const t = range.min + (el.scrollLeft + ax - nameW) / k;
    setScale(clamped);
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, (t - range.min) * clamped + nameW - ax);
    });
  }, [k, maxScale, minScale, range.min, nameW]);

  // Колесо с Ctrl — масштаб (как на холсте). Слушатель не пассивный: иначе
  // браузер успеет масштабировать саму страницу.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const wheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      zoomTo((k || 1) * Math.exp(-e.deltaY * 0.0022), e.clientX - box.left);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomTo, k]);

  // Щипок двумя пальцами. touch-action у полосы — pan-x pan-y, поэтому
  // браузер отдаёт щипок нам, а прокрутку одним пальцем делает сам.
  const touches = useRef(new Map());
  const pinch = useRef(null);
  const tapAt = useRef(null);
  const onPointerDown = (e) => {
    if (e.pointerType !== "touch") return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tapAt.current = touches.current.size === 1 ? { x: e.clientX, y: e.clientY } : null;
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const box = ref.current.getBoundingClientRect();
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: k, mid: (a.x + b.x) / 2 - box.left };
    }
  };
  const onPointerMove = (e) => {
    if (e.pointerType !== "touch") {
      const box = ref.current.getBoundingClientRect();
      const x = e.clientX - box.left;
      setCursorT(x > nameW ? range.min + (ref.current.scrollLeft + x - nameW) / k : null);
      return;
    }
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tapAt.current && Math.hypot(e.clientX - tapAt.current.x, e.clientY - tapAt.current.y) > 8) tapAt.current = null;
    if (pinch.current && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) zoomTo(pinch.current.scale * (dist / pinch.current.dist), pinch.current.mid);
    }
  };
  const onPointerEnd = (e) => {
    if (e.pointerType !== "touch") return;
    // Короткое касание без сдвига ставит курсор: на телефоне мыши нет, а
    // возраст «на этот день» нужен и там.
    if (tapAt.current && touches.current.size === 1 && !e.target.closest("[data-tl-key]")) {
      const box = ref.current.getBoundingClientRect();
      const x = e.clientX - box.left;
      if (x > nameW) setCursorT(range.min + (ref.current.scrollLeft + x - nameW) / k);
    }
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    tapAt.current = null;
  };

  // Переход к моменту снаружи (эпоха из полосы, «сейчас»).
  useEffect(() => {
    const el = ref.current;
    if (!jump || !el || !k) return;
    el.scrollTo({ left: Math.max(0, xOf(jump.t) - (el.clientWidth - nameW) / 2), behavior: "smooth" });
    // xOf и k нарочно не в зависимостях: прыжок — по нажатию, а не по зуму.
    // eslint-disable-next-line
  }, [jump]);

  // Выбранное событие держим в кадре по горизонтали.
  useEffect(() => {
    const el = ref.current;
    if (!picked || !el || !k || picked.t == null) return;
    const x = xOf(picked.t);
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - nameW - 20) {
      el.scrollTo({ left: Math.max(0, x - (el.clientWidth - nameW) / 2), behavior: "smooth" });
    }
    const lane = lanes.findIndex((l) => l.nodeId === picked.nodeId);
    if (lane >= 0) {
      const y = lane * LANE_H;
      if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - AXIS_H - LANE_H) {
        el.scrollTo({ top: Math.max(0, y - (el.clientHeight - AXIS_H) / 2), behavior: "smooth" });
      }
    }
    // eslint-disable-next-line
  }, [picked?.key]);

  // --- ось ------------------------------------------------------------------
  const yearLen = avgYearLength(cal);
  const ticks = useMemo(() => {
    if (!k) return [];
    const from = range.min + Math.max(0, view.left - nameW) / k;
    const to = range.min + (view.left + view.w) / k;
    const out = [];
    const pxPerMonth = (k * yearLen) / Math.max(cal.months.length, 1);
    if (pxPerMonth >= 70) {
      const a = fromDayIndex(cal, from);
      let y = a.y;
      let m = a.m;
      for (let i = 0; i < 400; i++) {
        const t = toDayIndex(cal, { y, m, d: 1 });
        if (t > to) break;
        if (t >= from - 1) out.push({ t, label: m === 0 ? formatAt(cal, chrono.eras.placed, t, "year") : cal.months[m].short || cal.months[m].name, major: m === 0 });
        m += 1;
        if (m >= cal.months.length) { m = 0; y += 1; }
      }
      return out;
    }
    const step = niceYearStep(k * yearLen);
    const first = Math.floor(fromDayIndex(cal, from).y / step) * step;
    for (let y = first, i = 0; i < 400; y += step, i++) {
      const t = startOfYear(cal, y);
      if (t > to) break;
      if (t >= from - yearLen * step) out.push({ t, label: formatAt(cal, chrono.eras.placed, t, "year"), major: true });
    }
    return out;
  }, [k, range.min, view.left, view.w, nameW, cal, yearLen, chrono.eras.placed]);

  const precision = k && k * yearLen / Math.max(cal.months.length, 1) >= 70 ? "day" : "year";

  // --- окно по вертикали ------------------------------------------------
  const first = Math.max(0, Math.floor(view.top / LANE_H) - 4);
  const last = Math.min(lanes.length, Math.ceil((view.top + view.h) / LANE_H) + 4);
  const visible = lanes.slice(first, last);
  const height = lanes.length * LANE_H;

  const cursorAges = useMemo(() => {
    if (cursorT == null) return null;
    const out = new Map();
    for (const lane of visible) {
      const got = ageAt(chrono, lane.nodeId, cursorT);
      if (got) out.set(lane.nodeId, got);
    }
    return out;
  }, [cursorT, visible, chrono]);

  const eraBands = chrono.eras.placed;

  if (!lanes.length) {
    return <p className="tl-empty" data-testid="timeline-lanes-empty">{tr("timeline.noMatch")}</p>;
  }

  return (
    <div className="tl-lanes-wrap">
      <div
        ref={ref}
        className="tl-lanes"
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={(e) => { if (e.pointerType !== "touch") setCursorT(null); }}
        style={{ "--tl-name-w": `${nameW}px` }}
        data-testid="timeline-lanes"
      >
        <div className="tl-lanes-inner" style={{ width: nameW + trackW, height: AXIS_H + height }}>
          <div className="tl-lanes-axis" style={{ height: AXIS_H, width: nameW + trackW }}>
            <div className="tl-lanes-corner" style={{ width: nameW }} />
            {eraBands.map((era) => {
              const a = Math.max(xOf(era.startT), 0);
              const b = Math.min(xOf(Number.isFinite(era.endT) ? era.endT : range.max), trackW);
              if (b <= a) return null;
              return (
                <span
                  key={era.id}
                  className="tl-lanes-era-name"
                  style={{ left: nameW + a, width: b - a, color: era.color, borderColor: era.color }}
                >
                  <span className="truncate">{era.name}</span>
                </span>
              );
            })}
            {ticks.map((tick) => (
              <span
                key={tick.t}
                className={`tl-lanes-tick${tick.major ? " tl-lanes-tick-major" : ""}`}
                style={{ left: nameW + xOf(tick.t) }}
              >
                {tick.label}
              </span>
            ))}
          </div>

          <div className="tl-lanes-body" style={{ height }}>
            {eraBands.map((era) => {
              const a = Math.max(xOf(era.startT), 0);
              const b = Math.min(xOf(Number.isFinite(era.endT) ? era.endT : range.max), trackW);
              if (b <= a) return null;
              return (
                <span
                  key={era.id}
                  className="tl-lanes-era"
                  style={{ left: nameW + a, width: b - a, background: era.color }}
                />
              );
            })}
            {ticks.map((tick) => (
              <span key={tick.t} className="tl-lanes-grid" style={{ left: nameW + xOf(tick.t) }} />
            ))}
            {nowT != null && (
              <>
                <span className="tl-lanes-future" style={{ left: nameW + xOf(nowT), width: Math.max(trackW - xOf(nowT), 0) }} />
                <span className="tl-lanes-now" style={{ left: nameW + xOf(nowT) }} data-testid="timeline-lanes-now" />
              </>
            )}

            {visible.map((lane, i) => {
              const index = first + i;
              const color = lane.node?.nodeType?.color || "#64748b";
              const span = lane.span;
              const from = span ? Math.max(Number.isFinite(span.from) ? xOf(span.from) : 0, 0) : null;
              const to = span ? Math.min(Number.isFinite(span.to) ? xOf(span.to) : trackW, trackW) : null;
              const age = cursorAges?.get(lane.nodeId);
              const on = picked?.nodeId === lane.nodeId;
              return (
                <div
                  key={lane.nodeId}
                  className={`tl-lane${on ? " tl-lane-on" : ""}`}
                  style={{ top: index * LANE_H, height: LANE_H, width: nameW + trackW, "--tl-tone": color }}
                  data-testid={`timeline-lane-${lane.nodeId}`}
                >
                  <button
                    type="button"
                    className="tl-lane-name"
                    style={{ width: nameW }}
                    onClick={() => onPick(lane.items[0])}
                  >
                    <span className="tl-dot-sm" style={{ background: color }} />
                    <span className="truncate">{lane.node?.title || tr("common.untitled")}</span>
                    {age && (
                      <b className="tl-lane-age font-mono-sw" data-testid="timeline-lane-age">
                        {age.exact ? "" : "≈"}{age.age}
                      </b>
                    )}
                  </button>
                  {span && to > from && (
                    <span className="tl-lane-life" style={{ left: nameW + from, width: to - from }} />
                  )}
                  {lane.items.map((item) => {
                    const x = xOf(item.t);
                    const w = item.t2 != null && item.t2 > item.t ? Math.max(xOf(item.t2) - x, 3) : 0;
                    const bad = conflicts?.has(item.key);
                    return (
                      <button
                        type="button"
                        key={item.key}
                        data-tl-key={item.key}
                        className={`tl-lane-mark${w ? " tl-lane-bar" : ""}${picked?.key === item.key ? " tl-lane-mark-on" : ""}${bad ? " tl-lane-mark-bad" : ""}${nowT != null && item.t > nowT ? " tl-lane-mark-future" : ""}`}
                        style={{ left: nameW + x, width: w || undefined }}
                        title={`${item.label || ""} · ${formatAt(cal, chrono.eras.placed, item.t, item.start?.precision === "era" ? "year" : item.start?.precision)}`}
                        onClick={() => onPick(item)}
                        data-testid={`timeline-mark-${item.nodeId}`}
                      />
                    );
                  })}
                </div>
              );
            })}

            {cursorT != null && k && (
              <span className="tl-lanes-cursor" style={{ left: nameW + xOf(cursorT) }} data-testid="timeline-lanes-cursor">
                <span className="tl-lanes-cursor-label font-mono-sw" style={{ top: Math.max(view.top, 0) }}>
                  {formatAt(cal, chrono.eras.placed, cursorT, precision)}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="tl-lanes-zoom">
        <button type="button" className="tl-tool" onClick={() => zoomTo((k || 1) / 1.6)} data-testid="timeline-lanes-zoom-out">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="tl-tool" onClick={() => { setScale(null); ref.current?.scrollTo({ left: 0 }); }} title={tr("timeline.lanes.fit")}>
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="tl-tool" onClick={() => zoomTo((k || 1) * 1.6)} data-testid="timeline-lanes-zoom-in">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
