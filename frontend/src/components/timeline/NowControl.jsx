import { useState } from "react";
import { Clock, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  addDuration, eraYearOffset, formatAt, fromDayIndex, nowIndexOf,
} from "@/lib/chrono";

// «Сейчас» кампании: день, до которого дошла игра или рассказ.
//
// От него зависят три вещи: черта «сейчас» на шкале, приглушённое будущее и
// возраст живых («сейчас ей 34»). Двигают его чаще всего на шаг — прошла
// сессия, прошёл день, — поэтому шаги стоят кнопками рядом с самим полем.

const STEPS = ["day", "week", "month", "year"];

function precisionOf(value) {
  if (value?.d != null) return "day";
  if (value?.m != null) return "month";
  return "year";
}

export default function NowControl({ chrono, value, onChange }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const cal = chrono.calendar;
  const nowT = nowIndexOf(chrono, value);
  const text = nowT != null ? formatAt(cal, chrono.eras.placed, nowT, precisionOf(value)) : "";
  const eras = chrono.eras.placed.filter((e) => e.countsYears);
  const era = value?.eraId ? chrono.eras.byId.get(value.eraId) : null;

  const set = (patch) => {
    const next = { y: null, m: null, d: null, eraId: null, ...value, ...patch };
    if (next.m == null) next.d = null;
    onChange(next.y == null ? null : next);
  };

  /** Шаг вперёд: точность растёт до шага — «+день» к году даёт первый день. */
  const step = (unit, n = 1) => {
    if (nowT == null) return;
    const at = fromDayIndex(cal, addDuration(cal, nowT, n, unit));
    const keepDay = value.d != null || unit === "day" || unit === "week";
    const keepMonth = value.m != null || unit !== "year";
    set({
      y: at.y - eraYearOffset(era),
      m: keepMonth ? at.m : null,
      d: keepMonth && keepDay ? at.d : null,
    });
  };

  return (
    <div className="tl-now">
      <button
        type="button"
        className={`tl-now-chip${nowT != null ? " tl-now-chip-on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={tr("timeline.now.hint")}
        data-testid="timeline-now"
      >
        <Clock className="w-3.5 h-3.5" />
        <span className="truncate">{nowT != null ? text : tr("timeline.now.unset")}</span>
      </button>
      {open && (
        <div className="tl-now-pop" data-testid="timeline-now-popover">
          <div className="tl-now-head">
            <span className="tl-rail-head">{tr("timeline.now.title")}</span>
            <button type="button" className="tl-tool ml-auto" onClick={() => setOpen(false)}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="tl-now-note">{tr("timeline.now.hint")}</p>
          <div className="tl-now-fields">
            <input
              className="df-input tl-now-year"
              inputMode="numeric"
              value={value?.y ?? ""}
              placeholder={tr("timeline.now.year")}
              onChange={(e) => {
                const y = parseInt(e.target.value.replace(/[^\d-]/g, ""), 10);
                set({ y: Number.isFinite(y) ? y : null });
              }}
              data-testid="timeline-now-year"
            />
            <select
              className="tl-select"
              value={value?.m ?? ""}
              disabled={value?.y == null}
              onChange={(e) => set({ m: e.target.value === "" ? null : Number(e.target.value) })}
              data-testid="timeline-now-month"
            >
              <option value="">—</option>
              {cal.months.map((m, i) => <option key={m.id} value={i}>{m.name}</option>)}
            </select>
            <input
              className="df-input tl-now-day"
              inputMode="numeric"
              value={value?.d ?? ""}
              disabled={value?.m == null}
              placeholder={tr("timeline.now.day")}
              onChange={(e) => {
                const d = parseInt(e.target.value.replace(/\D/g, ""), 10);
                set({ d: Number.isFinite(d) ? d : null });
              }}
              data-testid="timeline-now-day"
            />
          </div>
          {eras.length > 0 && (
            <select
              className="tl-select w-full"
              value={value?.eraId || ""}
              onChange={(e) => set({ eraId: e.target.value || null })}
            >
              <option value="">{tr("timeline.now.commonCount")}</option>
              {eras.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          <div className="tl-now-steps">
            {STEPS.map((unit) => (
              <button
                key={unit}
                type="button"
                className="tl-now-step"
                disabled={nowT == null}
                onClick={() => step(unit)}
                data-testid={`timeline-now-plus-${unit}`}
              >
                +{tr(`timeline.now.step.${unit}`)}
              </button>
            ))}
          </div>
          {nowT != null && (
            <button type="button" className="tl-rail-clear" onClick={() => onChange(null)} data-testid="timeline-now-clear">
              {tr("timeline.now.clear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
