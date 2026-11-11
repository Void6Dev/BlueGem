import { useRef } from "react";
import { useSlidingThumb } from "@/lib/useSlidingThumb";

/**
 * Переключатель «одно из нескольких» одной строкой.
 *
 * Стиль живёт в index.css (.sw-seg): здесь только разметка и клавиатура.
 * `variant` меняет вид выбранного — "surface" (подъём поверхности, значение
 * по умолчанию), "accent" (заливка акцентом), "glass" (компактный, для
 * тулбара поверх стекла).
 *
 * Выбранное подсвечивает не сам пункт, а общий ползунок под пунктами — он
 * переезжает к новому выбору (см. lib/useSlidingThumb.js).
 *
 * options: [{ id, label, icon: Component, hint }]
 */
export function Segmented({ options, value, onChange, variant = "surface", className = "", testIdPrefix }) {
  const ref = useRef(null);
  useSlidingThumb(ref, [value]);
  const cls = [
    "sw-seg sw-thumb-host",
    variant === "glass" ? "sw-seg-glass" : "",
    variant === "accent" || variant === "glass" ? "sw-seg-accent" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={cls} role="group">
      <span className="sw-thumb" aria-hidden="true" />
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            title={o.hint || o.label}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.id}` : undefined}
            onClick={() => { if (!active) onChange(o.id); }}
            className="sw-seg-item"
          >
            {Icon && <Icon className="w-3 h-3 shrink-0" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
