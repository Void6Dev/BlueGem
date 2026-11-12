import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Clock, History, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { formatAt, fromDayIndex, startOfYear } from "@/lib/chrono";

// Машина времени на холсте.
//
// Ползунок года над холстом: узлы, которых в этот год ещё нет или уже нет,
// уходят в тень. Видно, кто жив во время войны и какие города уже стоят, —
// на той же карте связей, без переключения на хронологию.

export default function TimeMachineBar({ chrono, year, onYear, nowT, onClose, count }) {
  const tr = useT();
  const cal = chrono.calendar;
  const [minY, maxY] = useMemo(() => {
    const b = chrono.bounds;
    if (b.empty) return [0, 100];
    return [fromDayIndex(cal, b.min).y, fromDayIndex(cal, b.max).y];
  }, [chrono.bounds, cal]);
  const label = formatAt(cal, chrono.eras.placed, startOfYear(cal, year), "year");
  const nowYear = nowT != null ? fromDayIndex(cal, nowT).y : null;

  return (
    <div className="sw-timemachine sw-glass" data-testid="time-machine">
      <History className="w-4 h-4 sw-accent-text shrink-0" />
      <button type="button" className="sw-tm-step" onClick={() => onYear(year - 1)} aria-label="-1">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <input
        type="range"
        min={Math.min(minY, year)}
        max={Math.max(maxY, year)}
        step={1}
        value={year}
        onChange={(e) => onYear(Number(e.target.value))}
        className="sw-tm-range"
        data-testid="time-machine-range"
      />
      <button type="button" className="sw-tm-step" onClick={() => onYear(year + 1)} aria-label="+1">
        <ChevronRight className="w-4 h-4" />
      </button>
      <span className="sw-tm-label font-mono-sw" data-testid="time-machine-year">{label}</span>
      <span className="sw-tm-count sw-text-dim">{tr("timeMachine.count", { count })}</span>
      {nowYear != null && nowYear !== year && (
        <button type="button" className="sw-tm-now" onClick={() => onYear(nowYear)} title={tr("timeline.now.title")}>
          <Clock className="w-3.5 h-3.5" />
        </button>
      )}
      <button type="button" className="sw-tm-step" onClick={onClose} data-testid="time-machine-close" aria-label={tr("common.close")}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
