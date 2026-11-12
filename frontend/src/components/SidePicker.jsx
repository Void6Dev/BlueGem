import { useT } from "@/lib/i18n";

/**
 * Куда прикрепить связь: схема из двух карточек с точками по бокам.
 *
 * Мышью связь тянут от нужной точки, и сторона выбрана самим жестом. Через
 * интерфейс («Связать с…», выбор узла в панели) жеста нет, и раньше линия
 * цеплялась к первой точке — левой у обеих карточек. Здесь сторону выбирают
 * касанием: у каждой карточки две точки, у выбранной — заливка. «Авто» —
 * по положению карточек: цель правее — из правой точки в левую, и наоборот.
 *
 * @param value {from: "auto"|"l"|"r", to: "auto"|"l"|"r"}
 */
export default function SidePicker({ value, onChange, fromLabel, toLabel, compact = false }) {
  const t = useT();
  const v = { from: value?.from || "auto", to: value?.to || "auto" };
  const auto = v.from === "auto" && v.to === "auto";
  const set = (patch) => onChange({ ...v, ...patch });

  const Dot = ({ which, side }) => {
    const on = v[which] === side;
    return (
      <button
        type="button"
        className={`sw-side-dot ${on ? "is-on" : ""}`}
        data-testid={`side-${which}-${side}`}
        aria-pressed={on}
        aria-label={t(`sides.${which}.${side}`)}
        title={t(`sides.${which}.${side}`)}
        onClick={() => set({ [which]: on ? "auto" : side })}
      >
        <i />
      </button>
    );
  };

  const Card = ({ which, label }) => (
    <span className="sw-side-card">
      <Dot which={which} side="l" />
      <span className="sw-side-name">{label}</span>
      <Dot which={which} side="r" />
    </span>
  );

  return (
    <div className={`sw-side-picker ${compact ? "is-compact" : ""}`} data-testid="side-picker">
      <Card which="from" label={fromLabel} />
      <span className="sw-side-arrow" aria-hidden="true" />
      <Card which="to" label={toLabel || t("sides.other")} />
      <button
        type="button"
        className={`sw-side-auto ${auto ? "is-on" : ""}`}
        data-testid="side-auto"
        onClick={() => onChange({ from: "auto", to: "auto" })}
        title={t("sides.autoHint")}
      >
        {t("sides.auto")}
      </button>
    </div>
  );
}

/**
 * Стороны связи: выбранные явно или «авто» по положению карточек.
 * @param a,b {x, w} — левый край и ширина карточек
 */
export function resolveSides(pick, a, b) {
  const right = (b.x + b.w / 2) >= (a.x + a.w / 2);
  return {
    sourceHandle: pick?.from && pick.from !== "auto" ? pick.from : (right ? "r" : "l"),
    targetHandle: pick?.to && pick.to !== "auto" ? pick.to : (right ? "l" : "r"),
  };
}
