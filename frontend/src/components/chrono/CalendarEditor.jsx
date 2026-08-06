import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  CALENDAR_PRESETS, FORMAT_PRESETS, formatParts, normalizeCalendar, resolveCalendar,
} from "@/lib/chrono";
import "./date-field.css";

// Настройка календаря мира.
//
// Здесь нет ничего обязательного: год может состоять из одного безымянного
// отрезка, неделя — отсутствовать вовсе, високосных лет может не быть. Земной
// календарь лежит среди пресетов на равных правах с миром из пяти сезонов.

export default function CalendarEditor({ settings, onChange }) {
  const tr = useT();
  const cal = useMemo(() => resolveCalendar(settings), [settings]);

  const patch = (next) => onChange(normalizeCalendar({ ...cal, ...next }));

  const setMonth = (i, month) => {
    const months = cal.months.slice();
    months[i] = { ...months[i], ...month };
    patch({ months });
  };

  const addMonth = () => patch({
    months: [...cal.months, { id: `m${cal.months.length}`, name: "", short: "", days: 30 }],
  });

  const removeMonth = (i) => patch({ months: cal.months.filter((_, j) => j !== i) });

  const sample = useMemo(() => {
    const m = Math.min(1, cal.months.length - 1);
    return formatParts(cal, { y: 1247, m, d: Math.min(12, cal.months[m].days) }, {
      pattern: cal.format.long, eraName: tr("chrono.sampleEra"),
    });
  }, [cal, tr]);

  const yearLength = cal.months.reduce((sum, m) => sum + m.days, 0);

  return (
    <div className="df-root" data-testid="calendar-editor">
      <div className="cal-presets">
        {CALENDAR_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className="cal-preset"
            onClick={() => onChange(normalizeCalendar(preset.build()))}
            data-testid={`calendar-preset-${preset.id}`}
          >
            {tr(`chrono.preset.${preset.id}.name`)}
          </button>
        ))}
      </div>

      <div className="cal-preview font-mono-sw" data-testid="calendar-preview">{sample}</div>

      <div className="df-row">
        <label className="df-label">{tr("chrono.cal.format")}</label>
        <input
          className="df-input flex-1"
          value={cal.format.long}
          onChange={(e) => patch({ format: { ...cal.format, long: e.target.value } })}
          data-testid="calendar-format"
        />
      </div>
      <div className="cal-presets">
        {FORMAT_PRESETS.map((pattern) => (
          <button
            type="button"
            key={pattern}
            className="cal-preset font-mono-sw"
            onClick={() => patch({ format: { ...cal.format, long: pattern } })}
          >
            {pattern}
          </button>
        ))}
      </div>
      <p className="cal-note">{tr("chrono.cal.formatHint")}</p>

      <div className="df-row">
        <label className="df-label">{tr("chrono.cal.months")}</label>
        <span className="cal-note">{tr("chrono.cal.yearLength", { count: yearLength })}</span>
      </div>
      <div className="cal-months">
        {cal.months.map((month, i) => (
          <div className="cal-month" key={month.id}>
            <span className="cal-month-index font-mono-sw">{i + 1}</span>
            <input
              className="df-input flex-1"
              value={month.name}
              placeholder={tr("chrono.cal.monthName")}
              onChange={(e) => setMonth(i, { name: e.target.value })}
              data-testid={`calendar-month-${i}`}
            />
            <input
              className="df-input df-num"
              value={month.short}
              placeholder={tr("chrono.cal.short")}
              onChange={(e) => setMonth(i, { short: e.target.value })}
            />
            <input
              type="number"
              min={1}
              className="df-input df-num"
              value={month.days}
              onChange={(e) => setMonth(i, { days: Number(e.target.value) || 1 })}
              data-testid={`calendar-days-${i}`}
            />
            {cal.months.length > 1 && (
              <button type="button" className="df-icon" onClick={() => removeMonth(i)}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="df-add" onClick={addMonth} data-testid="calendar-add-month">
        <Plus className="w-3.5 h-3.5" /> {tr("chrono.cal.addMonth")}
      </button>
      {/* Порядок месяцев — часть смысла уже записанных дат: они хранят номер,
          а не название. Об этом честно предупреждаем, а не молча ломаем. */}
      <p className="cal-note">{tr("chrono.cal.monthOrderWarning")}</p>

      <div className="df-row">
        <label className="df-label">{tr("chrono.cal.week")}</label>
        <input
          type="number"
          min={0}
          className="df-input df-num"
          value={cal.week.length}
          onChange={(e) => patch({ week: { ...cal.week, length: Number(e.target.value) || 0 } })}
          data-testid="calendar-week"
        />
        <span className="cal-note">{tr("chrono.cal.weekHint")}</span>
      </div>
      {cal.week.length > 0 && (
        <div className="df-row">
          {cal.week.dayNames.map((name, i) => (
            <input
              key={i}
              className="df-input df-num"
              value={name}
              placeholder={`${i + 1}`}
              onChange={(e) => {
                const dayNames = cal.week.dayNames.slice();
                dayNames[i] = e.target.value;
                patch({ week: { ...cal.week, dayNames } });
              }}
            />
          ))}
        </div>
      )}

      <SeasonEditor cal={cal} patch={patch} />
      <LeapEditor cal={cal} patch={patch} />
    </div>
  );
}

function SeasonEditor({ cal, patch }) {
  const tr = useT();
  const setSeason = (i, next) => {
    const seasons = cal.seasons.slice();
    seasons[i] = { ...seasons[i], ...next };
    patch({ seasons });
  };
  return (
    <>
      <label className="df-label">{tr("chrono.cal.seasons")}</label>
      {cal.seasons.map((season, i) => (
        <div className="cal-month" key={season.id}>
          <input
            type="color"
            className="era-swatch"
            value={season.color}
            onChange={(e) => setSeason(i, { color: e.target.value })}
          />
          <input
            className="df-input flex-1"
            value={season.name}
            placeholder={tr("chrono.cal.seasonName")}
            onChange={(e) => setSeason(i, { name: e.target.value })}
          />
          <select
            className="df-select"
            value={season.startMonth}
            onChange={(e) => setSeason(i, { startMonth: Number(e.target.value) })}
          >
            {cal.months.map((month, j) => (
              <option key={month.id} value={j}>{month.name || j + 1}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            className="df-input df-num"
            value={season.startDay}
            onChange={(e) => setSeason(i, { startDay: Number(e.target.value) || 1 })}
          />
          <button
            type="button"
            className="df-icon"
            onClick={() => patch({ seasons: cal.seasons.filter((_, j) => j !== i) })}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="df-add"
        onClick={() => patch({
          seasons: [...cal.seasons, {
            id: `s${cal.seasons.length}${Date.now().toString(36)}`,
            name: "", color: "#6366f1", startMonth: 0, startDay: 1,
          }],
        })}
      >
        <Plus className="w-3.5 h-3.5" /> {tr("chrono.cal.addSeason")}
      </button>
    </>
  );
}

function LeapEditor({ cal, patch }) {
  const tr = useT();
  const leap = cal.leap;
  const set = (next) => patch({ leap: { ...leap, ...next } });
  const list = (arr) => arr.join(", ");
  const parse = (text) => text.split(/[,\s]+/).map((n) => parseInt(n, 10)).filter((n) => n > 0);

  return (
    <>
      <div className="df-row">
        <button
          type="button"
          className={`df-toggle${leap.enabled ? " df-toggle-on" : ""}`}
          onClick={() => set({ enabled: !leap.enabled })}
          data-testid="calendar-leap"
        >
          {tr("chrono.cal.leap")}
        </button>
      </div>
      {leap.enabled && (
        <>
          <div className="df-row">
            <label className="df-label">{tr("chrono.cal.leapEvery")}</label>
            <input
              type="number"
              min={1}
              className="df-input df-num"
              value={leap.cycle}
              onChange={(e) => set({ cycle: Number(e.target.value) || 1 })}
            />
            <label className="df-label">{tr("chrono.cal.leapExcept")}</label>
            <input
              className="df-input df-num"
              value={list(leap.exceptions)}
              onChange={(e) => set({ exceptions: parse(e.target.value) })}
            />
            <label className="df-label">{tr("chrono.cal.leapBut")}</label>
            <input
              className="df-input df-num"
              value={list(leap.reinstate)}
              onChange={(e) => set({ reinstate: parse(e.target.value) })}
            />
          </div>
          <div className="df-row">
            <label className="df-label">{tr("chrono.cal.leapMonth")}</label>
            <select
              className="df-select"
              value={leap.monthIndex}
              onChange={(e) => set({ monthIndex: Number(e.target.value) })}
            >
              {cal.months.map((month, i) => (
                <option key={month.id} value={i}>{month.name || i + 1}</option>
              ))}
            </select>
            <label className="df-label">{tr("chrono.cal.leapDays")}</label>
            <input
              type="number"
              min={1}
              className="df-input df-num"
              value={leap.days}
              onChange={(e) => set({ days: Number(e.target.value) || 1 })}
            />
          </div>
          <p className="cal-note">{tr("chrono.cal.leapHint")}</p>
        </>
      )}
    </>
  );
}
