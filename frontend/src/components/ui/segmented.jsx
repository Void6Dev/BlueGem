/**
 * Переключатель «одно из нескольких» одной строкой.
 *
 * Стиль живёт в index.css (.sw-seg): здесь только разметка и клавиатура.
 * `variant` меняет вид выбранного — "surface" (подъём поверхности, значение
 * по умолчанию), "accent" (заливка акцентом), "glass" (компактный, для
 * тулбара поверх стекла).
 *
 * options: [{ id, label, icon: Component, hint }]
 */
export function Segmented({ options, value, onChange, variant = "surface", className = "", testIdPrefix }) {
  const cls = [
    "sw-seg",
    variant === "glass" ? "sw-seg-glass" : "",
    variant === "accent" || variant === "glass" ? "sw-seg-accent" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={cls} role="group">
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
