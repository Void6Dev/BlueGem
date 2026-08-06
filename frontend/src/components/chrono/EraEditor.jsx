import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { ICON_OPTIONS } from "@/lib/settings";
import { NodeIcon } from "@/components/NodeIcon";
import {
  formatParts, fromDayIndex, normalizeEras, resolveCalendar, resolveEras,
} from "@/lib/chrono";
import "./date-field.css";

// Эпохи мира.
//
// Порядок здесь не редактируется руками: эпохи выстраиваются по своей дате
// начала, и это единственный правильный порядок. Конец можно не указывать —
// эпоха дотянется до начала следующей.

const PALETTE = [
  "#6366f1", "#e11d48", "#059669", "#d97706", "#7c3aed",
  "#0ea5e9", "#ec4899", "#f59e0b", "#14b8a6", "#84cc16",
];

export default function EraEditor({ settings, onChange }) {
  const tr = useT();
  const calendar = useMemo(() => resolveCalendar(settings), [settings]);
  const eras = useMemo(() => normalizeEras(settings?.eras), [settings?.eras]);
  const placed = useMemo(() => resolveEras(calendar, eras).placed, [calendar, eras]);

  const patch = (index, next) => {
    const list = eras.slice();
    list[index] = { ...list[index], ...next };
    onChange(list);
  };

  const add = () => onChange([...eras, {
    id: `era${Date.now().toString(36)}`,
    name: "",
    color: PALETTE[eras.length % PALETTE.length],
    description: "",
    icon: "",
    start: { y: 0, m: null, d: null },
    end: null,
    countsYears: false,
  }]);

  const bound = (era, which) => era[which] || null;
  const setBound = (index, which, field, raw) => {
    const era = eras[index];
    const value = raw === "" ? null : Number(raw);
    const current = bound(era, which) || { y: 0, m: null, d: null };
    if (field === "y" && value == null && which === "end") return patch(index, { end: null });
    const next = { ...current, [field]: value };
    if (field === "m" && value == null) next.d = null;
    return patch(index, { [which]: next });
  };

  return (
    <div className="df-root" data-testid="era-editor">
      {eras.length === 0 && <p className="cal-note">{tr("chrono.era.empty")}</p>}

      {eras.map((era, i) => {
        const shown = placed.find((p) => p.id === era.id);
        return (
          <div className="era-row" key={era.id}>
            <div className="df-row">
              <input
                type="color"
                className="era-swatch"
                value={era.color}
                onChange={(e) => patch(i, { color: e.target.value })}
                title={tr("chrono.era.color")}
              />
              <input
                className="df-input flex-1"
                value={era.name}
                placeholder={tr("chrono.era.name")}
                onChange={(e) => patch(i, { name: e.target.value })}
                data-testid={`era-name-${i}`}
              />
              <select
                className="df-select"
                value={era.icon || ""}
                onChange={(e) => patch(i, { icon: e.target.value })}
                title={tr("chrono.era.icon")}
              >
                <option value="">{tr("chrono.era.noIcon")}</option>
                {ICON_OPTIONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
              </select>
              {era.icon && <NodeIcon name={era.icon} className="w-4 h-4 sw-text-dim" />}
              <button
                type="button"
                className="df-icon"
                onClick={() => onChange(eras.filter((_, j) => j !== i))}
                title={tr("common.delete")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="df-row">
              <label className="df-label">{tr("chrono.era.start")}</label>
              <input
                type="number"
                className="df-input df-num"
                value={era.start?.y ?? ""}
                onChange={(e) => setBound(i, "start", "y", e.target.value)}
                data-testid={`era-start-${i}`}
              />
              <MonthDay cal={calendar} value={era.start} onField={(f, v) => setBound(i, "start", f, v)} />
            </div>

            <div className="df-row">
              <label className="df-label">{tr("chrono.era.end")}</label>
              <input
                type="number"
                className="df-input df-num"
                value={era.end?.y ?? ""}
                placeholder={tr("chrono.era.openEnd")}
                onChange={(e) => setBound(i, "end", "y", e.target.value)}
                data-testid={`era-end-${i}`}
              />
              {era.end && <MonthDay cal={calendar} value={era.end} onField={(f, v) => setBound(i, "end", f, v)} />}
            </div>

            <div className="df-row">
              <button
                type="button"
                className={`df-toggle${era.countsYears ? " df-toggle-on" : ""}`}
                onClick={() => patch(i, { countsYears: !era.countsYears })}
                title={tr("chrono.era.countsYearsHint")}
                data-testid={`era-counts-${i}`}
              >
                {tr("chrono.era.countsYears")}
              </button>
              {era.countsYears && era.start?.y != null && (
                <span className="cal-note font-mono-sw">
                  {tr("chrono.era.countsExample", {
                    era: era.name || tr("chrono.era.name"),
                    year: formatParts(calendar, { y: era.start.y }, { pattern: "{year}" }),
                  })}
                </span>
              )}
            </div>

            <input
              className="df-input"
              value={era.description}
              placeholder={tr("common.description")}
              onChange={(e) => patch(i, { description: e.target.value })}
            />

            {shown && (
              <span className="cal-note">
                {formatParts(calendar, era.start, { pattern: "{year}" })}
                {" — "}
                {Number.isFinite(shown.endT)
                  ? formatParts(calendar, era.end || fromEnd(calendar, shown.endT), { pattern: "{year}" })
                  : tr("chrono.era.openEnd")}
                {!shown.explicitEnd && ` (${tr("chrono.era.impliedEnd")})`}
              </span>
            )}
            <div className="era-bar" style={{ background: era.color }} />
          </div>
        );
      })}

      <button type="button" className="df-add" onClick={add} data-testid="era-add">
        <Plus className="w-3.5 h-3.5" /> {tr("chrono.era.add")}
      </button>
    </div>
  );
}

function MonthDay({ cal, value, onField }) {
  const tr = useT();
  if (cal.months.length <= 1) return null;
  return (
    <>
      <select
        className="df-select"
        value={value?.m ?? ""}
        onChange={(e) => onField("m", e.target.value)}
      >
        <option value="">{tr("chrono.anyMonth")}</option>
        {cal.months.map((month, i) => (
          <option key={month.id} value={i}>{month.name || i + 1}</option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        className="df-input df-num"
        value={value?.d ?? ""}
        disabled={value?.m == null}
        placeholder={tr("chrono.anyDay")}
        onChange={(e) => onField("d", e.target.value)}
      />
    </>
  );
}

/** Год, в котором эпоха закончилась по чужой воле — по началу следующей. */
function fromEnd(cal, endT) {
  return { y: fromDayIndex(cal, endT).y };
}
