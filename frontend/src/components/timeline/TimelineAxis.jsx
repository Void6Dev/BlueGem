import { memo, useMemo } from "react";
import { axisTicks, formatParts } from "@/lib/chrono";

// Ось времени и полосы эпох.
//
// Обе едут вместе с содержимым — они зарегистрированы как полосы вьюпорта,
// поэтому при панораме их двигает тот же transform, и ни одна засечка не
// отстаёт от своего события ни на кадр.
//
// Засечки строятся только для видимого куска: даже в мире на сорок тысяч лет
// их всегда несколько десятков.

function AxisInner({ calendar, scale, view, width, registerTrack }) {
  const { offsetU, zoom } = view;
  const t0 = scale.invert(offsetU);
  const t1 = scale.invert(offsetU + width / zoom);

  const ticks = useMemo(
    () => axisTicks(calendar, scale, t0, t1, zoom),
    [calendar, scale, t0, t1, zoom]
  );

  const label = (tick) => {
    if (tick.unit === "year") return formatParts(calendar, { y: tick.y }, { pattern: "{year}" });
    if (tick.unit === "month") {
      return formatParts(calendar, { y: tick.y, m: tick.m }, {
        pattern: tick.m === 0 ? "{monthShort} {year}" : "{monthShort}", precision: "month",
      });
    }
    return formatParts(calendar, tick, { pattern: tick.d === 1 ? "{day} {monthShort}" : "{day}" });
  };

  return (
    <div className="tl-axis" data-testid="timeline-axis">
      <div className="tl-axis-track" ref={registerTrack}>
        {ticks.map((tick) => {
          const x = (scale.project(tick.t) - offsetU) * zoom;
          if (x < -160 || x > width + 160) return null;
          return (
            <div key={`${tick.unit}-${tick.t}`} className={`tl-tick${tick.major ? " tl-tick-major" : ""}`} style={{ left: x }}>
              <span className="tl-tick-label font-mono-sw">{label(tick)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TimelineAxis = memo(AxisInner);

/**
 * Эпохи: цветные отрезки над шкалой и их же бледные подложки за событиями.
 *
 * Эпоха без конца тянется до следующей, а последняя — до края видимого; на
 * шкале это выглядит как «и далее», что и имеется в виду.
 */
function BandsInner({ scale, view, width, eras, registerTrack, onPickEra, activeEra }) {
  const { offsetU, zoom } = view;
  const uFrom = offsetU;
  const uTo = offsetU + width / zoom;

  const bands = useMemo(() => eras.map((era) => {
    const u0 = scale.project(Number.isFinite(era.startT) ? era.startT : scale.domain[0]);
    const u1 = scale.project(Number.isFinite(era.endT) ? era.endT : scale.domain[1]);
    return { era, u0, u1: Math.max(u1, u0 + 1) };
  }), [eras, scale]);

  return (
    <div className="tl-eras" data-testid="timeline-eras">
      <div className="tl-eras-track" ref={registerTrack}>
        {bands.map(({ era, u0, u1 }) => {
          if (u1 < uFrom || u0 > uTo) return null;
          const left = (u0 - offsetU) * zoom;
          const w = Math.max((u1 - u0) * zoom, 2);
          // Подпись эпохи прижимается к краю экрана, пока сама эпоха видна:
          // иначе, зайдя в середину «Тёмных веков», перестаёшь понимать, где
          // находишься.
          const labelLeft = Math.max(0, Math.min(-left, w - 8));
          const on = activeEra === era.id;
          return (
            <button
              type="button"
              key={era.id}
              data-testid={`timeline-era-${era.id}`}
              className={`tl-era${on ? " tl-era-on" : ""}`}
              style={{ left, width: w, background: era.color }}
              title={era.description || era.name}
              onClick={() => onPickEra?.(era)}
            >
              <span className="tl-era-name" style={{ left: labelLeft }}>{era.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const EraBands = memo(BandsInner);

/** Бледные подложки эпох за событиями — чтобы принадлежность события эпохе
 *  читалась без сверки с полосой наверху. */
export function EraBackdrop({ scale, view, width, eras, height }) {
  const { offsetU, zoom } = view;
  return (
    <>
      {eras.map((era) => {
        const u0 = scale.project(Number.isFinite(era.startT) ? era.startT : scale.domain[0]);
        const u1 = scale.project(Number.isFinite(era.endT) ? era.endT : scale.domain[1]);
        const left = (u0 - offsetU) * zoom;
        const w = Math.max((u1 - u0) * zoom, 1);
        if (left > width + 200 || left + w < -200) return null;
        return (
          <div
            key={era.id}
            className="tl-era-backdrop"
            style={{ left, width: w, height, background: era.color }}
          />
        );
      })}
    </>
  );
}

/** Отметки сжатых промежутков: там, где шкала «проглотила» пустоту. */
export function GapMarks({ scale, view, width, height }) {
  const { offsetU, zoom } = view;
  return (
    <>
      {scale.gaps.map((gap) => {
        const left = (gap.u0 - offsetU) * zoom;
        const w = (gap.u1 - gap.u0) * zoom;
        if (w < 12 || left > width + 100 || left + w < -100) return null;
        return <div key={gap.u0} className="tl-gap" style={{ left, width: w, height }} />;
      })}
    </>
  );
}
