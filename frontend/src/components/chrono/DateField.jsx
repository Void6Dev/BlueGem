import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Link2, Plus, Trash2, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  DATE_KINDS, DURATION_UNITS, ENTRY_KEYS, emptyDate, entryLabel,
  formatDate, normalizeDate,
} from "@/lib/chrono";
import "./date-field.css";

// Редактор дат узла.
//
// Дат у узла может быть несколько: родился, умер, основан, разрушен, найден —
// и каждая попадёт на общую шкалу отдельной отметкой. Поэтому здесь список, а
// не одно поле.
//
// Главное требование к этому редактору — не заставлять выдумывать точность,
// которой нет. Год без месяца, «около», «до войны», «через пять дней после
// коронации» и просто «в Тёмные века» вводятся так же легко, как точная дата,
// и ни одно из них не требует придумать день.

const KIND_ICON = { exact: "=", approx: "≈", before: "<", after: ">", between: "↔", unknown: "?" };

/**
 * Список дат узла.
 *
 * @param {object[]} value    записи (node.dates)
 * @param {function} onChange новый список
 * @param {object[]} nodes    узлы проекта — для ссылок «после такого-то»
 * @param {string} selfId     id редактируемого узла
 */
export default function DateField({ value, onChange, nodes, selfId, calendar, eras }) {
  const tr = useT();
  const entries = Array.isArray(value) ? value : [];

  const patch = (index, next) => {
    const list = entries.slice();
    list[index] = next;
    onChange(list);
  };

  const add = () => onChange([...entries, {
    id: `d${Date.now().toString(36)}`,
    key: entries.length ? "custom" : "date",
    label: "",
    start: emptyDate("exact"),
    end: null,
  }]);

  return (
    <div className="df-root" data-testid="date-entries">
      {entries.map((entry, i) => (
        <DateEntry
          key={entry.id || i}
          entry={entry}
          onChange={(next) => patch(i, next)}
          onRemove={() => onChange(entries.filter((_, j) => j !== i))}
          nodes={nodes}
          selfId={selfId}
          calendar={calendar}
          eras={eras}
        />
      ))}
      <button type="button" className="df-add" onClick={add} data-testid="add-date-btn">
        <Plus className="w-3.5 h-3.5" /> {tr("chrono.addDate")}
      </button>
    </div>
  );
}

function DateEntry({ entry, onChange, onRemove, nodes, selfId, calendar, eras }) {
  const tr = useT();
  const [open, setOpen] = useState(() => !entry.start?.y && !entry.start?.rel);
  const ctx = useMemo(() => ({
    eraName: (id) => eras.find((e) => e.id === id)?.name || "",
    nodeTitle: (id) => nodes.find((n) => n.id === id)?.title || "",
    selfId,
  }), [eras, nodes, selfId]);

  const summary = formatDate(calendar, normalizeDate(entry.start), ctx);
  const endSummary = entry.end ? formatDate(calendar, normalizeDate(entry.end), ctx) : "";

  return (
    <div className="df-entry">
      <button type="button" className="df-entry-head" onClick={() => setOpen((v) => !v)}>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform${open ? "" : " -rotate-90"}`} />
        <span className="df-entry-key">{entryLabel(entry)}</span>
        <span className="df-entry-value font-mono-sw truncate">
          {summary}{endSummary ? ` → ${endSummary}` : ""}
        </span>
      </button>

      {open && (
        <div className="df-entry-body">
          <div className="df-row">
            <label className="df-label">{tr("chrono.entryKind")}</label>
            <select
              className="df-select"
              value={ENTRY_KEYS.includes(entry.key) ? entry.key : "custom"}
              onChange={(e) => onChange({ ...entry, key: e.target.value })}
              data-testid="date-entry-key"
            >
              {ENTRY_KEYS.map((key) => (
                <option key={key} value={key}>{tr(`chrono.entry.${key}`)}</option>
              ))}
            </select>
            {entry.key === "custom" && (
              <input
                className="df-input flex-1"
                value={entry.label}
                placeholder={tr("chrono.entryLabel")}
                onChange={(e) => onChange({ ...entry, label: e.target.value })}
              />
            )}
            <button type="button" className="df-icon ml-auto" onClick={onRemove} title={tr("common.delete")}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <DateValueEditor
            value={entry.start}
            onChange={(start) => onChange({ ...entry, start })}
            nodes={nodes}
            selfId={selfId}
            calendar={calendar}
            eras={eras}
          />

          {entry.end ? (
            <>
              <div className="df-divider">{tr("chrono.until")}</div>
              <DateValueEditor
                value={entry.end}
                onChange={(end) => onChange({ ...entry, end })}
                nodes={nodes}
                selfId={selfId}
                calendar={calendar}
                eras={eras}
              />
              <button type="button" className="df-ghost" onClick={() => onChange({ ...entry, end: null })}>
                <X className="w-3 h-3" /> {tr("chrono.removeEnd")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="df-ghost"
              onClick={() => onChange({ ...entry, end: emptyDate("exact") })}
              data-testid="add-end-btn"
            >
              <Plus className="w-3 h-3" /> {tr("chrono.addEnd")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Одно значение даты: оговорка, якорь и — для «между» — второй якорь. */
export function DateValueEditor({ value, onChange, nodes, selfId, calendar, eras }) {
  const tr = useT();
  const date = normalizeDate(value) || emptyDate();
  const set = (patch) => onChange({ ...date, ...patch });
  const relative = !!date.rel;

  return (
    <div className="df-value">
      <div className="df-kinds">
        {DATE_KINDS.map((kind) => (
          <button
            type="button"
            key={kind}
            className={`df-kind${date.kind === kind ? " df-kind-on" : ""}`}
            onClick={() => set({ kind })}
            title={tr(`chrono.kind.${kind}`)}
            data-testid={`date-kind-${kind}`}
          >
            <span className="df-kind-mark">{KIND_ICON[kind]}</span>
            <span className="df-kind-name">{tr(`chrono.kind.${kind}`)}</span>
          </button>
        ))}
      </div>

      {date.kind === "unknown" ? (
        <div className="df-row">
          <label className="df-label">{tr("chrono.eraLabel")}</label>
          <EraSelect value={date.eraId} onChange={(eraId) => set({ eraId })} eras={eras} />
          <input
            className="df-input flex-1"
            value={date.raw}
            placeholder={tr("chrono.rawPlaceholder")}
            onChange={(e) => set({ raw: e.target.value })}
          />
        </div>
      ) : (
        <>
          <div className="df-row">
            <button
              type="button"
              className={`df-toggle${relative ? " df-toggle-on" : ""}`}
              onClick={() => set(relative
                ? { rel: null }
                : { rel: { nodeId: "", entryId: null, edge: "start", amount: 0, unit: "day", dir: "after" } })}
              data-testid="date-relative-toggle"
            >
              <Link2 className="w-3.5 h-3.5" /> {tr("chrono.relative")}
            </button>
            {!relative && (
              <>
                <label className="df-label">{tr("chrono.eraLabel")}</label>
                <EraSelect value={date.eraId} onChange={(eraId) => set({ eraId })} eras={eras} />
              </>
            )}
          </div>

          {relative ? (
            <RelEditor
              rel={date.rel}
              onChange={(rel) => set({ rel })}
              nodes={nodes}
              selfId={selfId}
            />
          ) : (
            <PartsEditor date={date} onChange={set} calendar={calendar} eras={eras} />
          )}

          {date.kind === "approx" && (
            <div className="df-row">
              <label className="df-label">{tr("chrono.spread")}</label>
              <span className="df-pm">±</span>
              <input
                type="number"
                className="df-input df-num"
                value={date.spread?.amount ?? ""}
                placeholder="0"
                onChange={(e) => set({
                  spread: { amount: Number(e.target.value) || 0, unit: date.spread?.unit || "year" },
                })}
              />
              <UnitSelect
                value={date.spread?.unit || "year"}
                onChange={(unit) => set({ spread: { amount: date.spread?.amount || 0, unit } })}
              />
            </div>
          )}

          {date.kind === "between" && (
            <>
              <div className="df-divider">{tr("chrono.and")}</div>
              {date.rel2 ? (
                <RelEditor
                  rel={date.rel2}
                  onChange={(rel2) => set({ rel2 })}
                  nodes={nodes}
                  selfId={selfId}
                  onDetach={() => set({ rel2: null })}
                />
              ) : (
                <PartsEditor
                  date={date}
                  onChange={set}
                  calendar={calendar}
                  eras={eras}
                  second
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Год, месяц и день. Месяц и день можно не заполнять — это и есть точность:
 *  пустой месяц означает «где-то в этом году», а не «в первом месяце». */
function PartsEditor({ date, onChange, calendar, second = false }) {
  const tr = useT();
  const y = second ? date.y2 : date.y;
  const m = second ? date.m2 : date.m;
  const d = second ? date.d2 : date.d;
  const keys = second ? { y: "y2", m: "m2", d: "d2" } : { y: "y", m: "m", d: "d" };
  const hasMonths = calendar.months.length > 1;
  const maxDay = calendar.months[m ?? 0]?.days ?? 31;

  const num = (v) => (v === "" ? null : Number(v));

  return (
    <div className="df-row">
      <label className="df-label">{tr("chrono.year")}</label>
      <input
        type="number"
        className="df-input df-num"
        value={y ?? ""}
        onChange={(e) => onChange({ [keys.y]: num(e.target.value) })}
        data-testid={second ? "date-year-2" : "date-year"}
      />
      {hasMonths && (
        <>
          <select
            className="df-select"
            value={m ?? ""}
            onChange={(e) => {
              const next = e.target.value === "" ? null : Number(e.target.value);
              // Убрали месяц — день теряет смысл вместе с ним.
              onChange({ [keys.m]: next, ...(next == null ? { [keys.d]: null } : {}) });
            }}
            data-testid={second ? "date-month-2" : "date-month"}
          >
            <option value="">{tr("chrono.anyMonth")}</option>
            {calendar.months.map((month, i) => (
              <option key={month.id} value={i}>{month.name || i + 1}</option>
            ))}
          </select>
          <input
            type="number"
            className="df-input df-num"
            value={d ?? ""}
            min={1}
            max={maxDay}
            disabled={m == null}
            placeholder={tr("chrono.anyDay")}
            onChange={(e) => onChange({ [keys.d]: num(e.target.value) })}
            data-testid={second ? "date-day-2" : "date-day"}
          />
        </>
      )}
      {!hasMonths && (
        <input
          type="number"
          className="df-input df-num"
          value={d ?? ""}
          min={1}
          placeholder={tr("chrono.anyDay")}
          onChange={(e) => onChange({ [keys.m]: 0, [keys.d]: num(e.target.value) })}
        />
      )}
    </div>
  );
}

/** Ссылка на другое событие: «+5 дней после...». */
function RelEditor({ rel, onChange, nodes, selfId, onDetach }) {
  const tr = useT();
  const set = (patch) => onChange({ ...rel, ...patch });
  return (
    <div className="df-rel">
      <div className="df-row">
        <input
          type="number"
          className="df-input df-num"
          value={rel.amount ?? 0}
          onChange={(e) => set({ amount: Number(e.target.value) || 0 })}
          data-testid="rel-amount"
        />
        <UnitSelect value={rel.unit} onChange={(unit) => set({ unit })} />
        <select
          className="df-select"
          value={rel.dir}
          onChange={(e) => set({ dir: e.target.value })}
          data-testid="rel-dir"
        >
          <option value="after">{tr("chrono.rel.after")}</option>
          <option value="before">{tr("chrono.rel.before")}</option>
        </select>
        {onDetach && (
          <button type="button" className="df-icon ml-auto" onClick={onDetach}>
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="df-row">
        <NodePicker
          value={rel.nodeId}
          onChange={(nodeId) => set({ nodeId })}
          nodes={nodes}
          selfId={selfId}
        />
        <select
          className="df-select"
          value={rel.edge}
          onChange={(e) => set({ edge: e.target.value })}
          title={tr("chrono.rel.edge")}
        >
          <option value="start">{tr("chrono.rel.itsStart")}</option>
          <option value="end">{tr("chrono.rel.itsEnd")}</option>
        </select>
      </div>
    </div>
  );
}

function UnitSelect({ value, onChange }) {
  const tr = useT();
  return (
    <select className="df-select" value={value} onChange={(e) => onChange(e.target.value)} data-testid="rel-unit">
      {DURATION_UNITS.map((unit) => (
        <option key={unit} value={unit}>{tr(`chrono.unitName.${unit}`)}</option>
      ))}
    </select>
  );
}

function EraSelect({ value, onChange, eras }) {
  const tr = useT();
  return (
    <select
      className="df-select"
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      data-testid="date-era"
    >
      <option value="">{tr("chrono.noEra")}</option>
      {eras.map((era) => (
        <option key={era.id} value={era.id}>{era.name || era.id}</option>
      ))}
    </select>
  );
}

/**
 * Выбор узла для ссылки. Поиск по названию, а не длинный список: в проекте
 * бывают тысячи узлов, и пролистывать их через select невозможно.
 */
function NodePicker({ value, onChange, nodes, selfId }) {
  const tr = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const chosen = nodes.find((n) => n.id === value);

  // Escape перехватываем до окна: иначе он закроет всю панель узла, а человек
  // всего лишь хотел убрать список.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = nodes.filter((n) => n.id !== selfId);
    if (!needle) return pool.slice(0, 30);
    return pool.filter((n) => (n.title || "").toLowerCase().includes(needle)).slice(0, 30);
  }, [nodes, query, selfId]);

  return (
    <div className="df-picker" ref={boxRef}>
      <button
        type="button"
        className={`df-picker-btn${chosen ? "" : " df-picker-empty"}`}
        onClick={() => { setOpen((v) => !v); setQuery(""); }}
        data-testid="rel-node"
      >
        <span className="truncate">{chosen?.title || tr("chrono.rel.pickNode")}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>
      {open && (
        <div className="df-picker-pop">
          <input
            autoFocus
            className="df-input"
            value={query}
            placeholder={tr("chrono.rel.searchNode")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
          />
          <div className="df-picker-list sw-scroll-y">
            {found.length === 0 && <div className="df-picker-none">{tr("common.nothingFound")}</div>}
            {found.map((node) => (
              <button
                type="button"
                key={node.id}
                className="df-picker-item"
                onClick={() => { onChange(node.id); setOpen(false); }}
              >
                <span
                  className="df-picker-dot"
                  style={{ background: node.nodeType?.color || "#64748b" }}
                />
                <span className="truncate">{node.title || tr("common.untitled")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
