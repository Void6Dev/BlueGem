import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TextField } from "@/components/ui/text-field";
import {
  AlertTriangle, CalendarRange, ChevronDown, CornerDownLeft, Filter, GitBranch, LayoutList,
  Link2, MapPin, Minus, Pencil, Plus, Rows3, Search, Settings2, X,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { isMobileNow } from "@/lib/platform";
import {
  ageAt, agesDuring, BIRTH_KEY, canMove, DEATH_KEY, eraAt, findConflicts, formatAt, formatDate,
  formatRange, lifespan, moveDateTo, movedBy, normalizeDate, nowIndexOf, nudgeDate, shiftDate,
  startOfYear, stepOf, storylineOf, valueAt, yearsBetween,
} from "@/lib/chrono";
import { NodeIcon } from "@/components/NodeIcon";
import { DateValueEditor } from "@/components/chrono/DateField";
import { EventRow } from "./EventRow";
import { TimelineMinimap } from "./TimelineMinimap";
import { railWidth, TimelineRail } from "./TimelineRail";
import { HEAD_H, ROW_H, useTimelineRows } from "./useTimelineRows";
import AddEventPanel from "./AddEventPanel";
import NowControl from "./NowControl";
import TimelineLanes from "./TimelineLanes";
import "./timeline.css";

// Шкала времени.
//
// Вертикальная. Горизонтальная умела то, чего вертикаль не умеет, — сравнивать
// длины полос и видеть одновременность, — но платила за это тем, что читать
// сам порядок событий было тяжело: названия обрезались до двух слов, до
// нужного места приходилось добираться зумом и перетаскиванием, а на дальнем
// плане от событий оставались безымянные точки.
//
// Порядок — то, ради чего в хронологию заходят чаще всего, и по вертикали он
// читается сам собой. Длительность не потерялась: она стала колонкой полосок,
// нормированных на самое долгое событие в отборе (см. EventRow). Пустые
// тысячелетия тоже никуда не делись — они отмечены строкой пропуска там, где
// раньше был пустой отрезок шкалы.

const GROUPINGS = ["none", "type", "era"];
const VIEW_KEY = "bluegem:timelineView";
// Сколько возрастов участников показывать прямо в ряду: больше — шум.
const AGES_IN_ROW = 2;

const readView = () => {
  try { return localStorage.getItem(VIEW_KEY) === "lanes" ? "lanes" : "list"; } catch { return "list"; }
};
// Сколько рядов дорисовываем за краями кадра, чтобы прокрутка не мигала.
const OVERSCAN = 8;

export default function TimelinePanel({
  leaving = false,
  chrono, settings, edges, typesById, allNodes,
  onOpenNode, onOpenSettings, onChangeDates, onClose,
  onAddEvent, onShowOnCanvas, onChangeNow, focus,
}) {
  const tr = useT();
  const mobile = isMobileNow();
  const listRef = useRef(null);
  const [viewH, setViewH] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("none");
  const [showLinks, setShowLinks] = useState(false);
  // На телефоне фильтры — выдвижная панель поверх списка, и по умолчанию
  // закрыта: иначе она съела бы половину узкого экрана.
  const [railOpen, setRailOpen] = useState(() => !isMobileNow());
  const [picked, setPicked] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [filters, setFilters] = useState(() => ({
    types: new Set(), tags: new Set(), eras: new Set(), canvases: new Set(), keys: new Set(),
  }));
  const [view, setViewState] = useState(readView);
  const setView = useCallback((v) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* только удобство */ }
  }, []);
  // Панель добавления: null — закрыта, иначе {date} — с чего начать дату.
  const [adding, setAdding] = useState(null);
  // Сюжетная линия: узел и всё, что с ним связано, на глубину depth.
  const [story, setStory] = useState(null);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [drag, setDrag] = useState(null);
  const [lanesJump, setLanesJump] = useState(null);

  const calendar = chrono.calendar;
  const placedEras = chrono.eras.placed;
  const nowT = useMemo(() => nowIndexOf(chrono, settings?.worldNow), [chrono, settings?.worldNow]);
  const conflicts = useMemo(() => findConflicts(chrono, edges), [chrono, edges]);
  const storySet = useMemo(
    () => (story ? storylineOf(edges, story.rootId, story.depth) : null),
    [story, edges],
  );
  const neighbours = useMemo(() => {
    const map = new Map();
    for (const e of edges || []) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source).add(e.target);
      map.get(e.target).add(e.source);
    }
    return map;
  }, [edges]);

  const ctx = useMemo(() => ({
    eraName: (id) => chrono.eras.byId.get(id)?.name || "",
    nodeTitle: (id) => chrono.byNode.get(id)?.[0]?.node?.title || "",
  }), [chrono]);

  // --- отбор -----------------------------------------------------------
  const facets = useMemo(() => collectFacets(chrono.items, chrono.undated), [chrono]);

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return chrono.items.filter((item) => matches(item, filters, needle, chrono)
      && (!storySet || storySet.has(item.nodeId))
      && (!onlyConflicts || conflicts.has(item.key)));
  }, [chrono, filters, search, storySet, onlyConflicts, conflicts]);

  const undated = useMemo(() => {
    if (onlyConflicts) return [];
    const needle = search.trim().toLowerCase();
    return chrono.undated.filter((item) => matches(item, filters, needle, chrono)
      && (!storySet || storySet.has(item.nodeId)));
  }, [chrono, filters, search, storySet, onlyConflicts]);

  // --- ряды -------------------------------------------------------------
  const gapLabel = useCallback((gap) => (gap.years >= 1
    ? tr("timeline.gapYears", { count: gap.years })
    : tr("timeline.gapDays", { count: Math.round(gap.days) })), [tr]);

  const rowsCtx = useMemo(() => ({
    calendar, placedEras, typesById,
    noEraLabel: tr("timeline.noEra"),
    otherLabel: tr("editor.otherType"),
    gapLabel,
    nowT,
    nowLabel: tr("timeline.now.marker"),
  }), [calendar, placedEras, typesById, tr, gapLabel, nowT]);

  const {
    rows, height, events, indexByKey, maxSpan, headOf, maxLane,
  } = useTimelineRows(items, groupBy, rowsCtx);
  const railW = railWidth(maxLane);

  /** Порядковые номера по хронологии — по всему отбору, а не по кадру. */
  const orderByKey = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.t - b.t);
    return new Map(sorted.map((it, i) => [it.key, i + 1]));
  }, [items]);

  // --- окно прокрутки ---------------------------------------------------
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const onScroll = useRafScroll(setScrollTop);

  const window_ = useMemo(() => {
    if (!rows.length) return [];
    const top = scrollTop - OVERSCAN * ROW_H;
    const bottom = scrollTop + (viewH || 600) + OVERSCAN * ROW_H;
    // Ряды идут по возрастанию y — границу ищем двоичным поиском, а не обходом:
    // на тридцати тысячах событий обход стоил бы кадра на каждый пиксель.
    const lo = lowerBound(rows, top);
    const out = [];
    for (let i = lo; i < rows.length && rows[i].y < bottom; i++) out.push(rows[i]);
    return out;
  }, [rows, scrollTop, viewH]);

  /** Заголовок, внутри которого сейчас верх кадра, — по предпосчитанной карте. */
  const pinned = useMemo(() => {
    if (!rows.length) return null;
    const at = lowerBound(rows, scrollTop + HEAD_H);
    return headOf[Math.min(at, rows.length - 1)] || null;
  }, [rows, headOf, scrollTop]);

  // --- связи и подсветка ------------------------------------------------
  const linkedIds = useMemo(() => {
    const focus = hovered || picked;
    if (!focus) return null;
    const set = new Set([focus.nodeId]);
    for (const edge of edges || []) {
      if (edge.source === focus.nodeId) set.add(edge.target);
      else if (edge.target === focus.nodeId) set.add(edge.source);
    }
    return set;
  }, [hovered, picked, edges]);

  // --- навигация --------------------------------------------------------
  const scrollToRow = useCallback((row, where = "nearest") => {
    const el = listRef.current;
    if (!el || !row) return;
    const pad = HEAD_H + 8;
    if (where === "center") {
      el.scrollTo({ top: Math.max(0, row.y - el.clientHeight / 2), behavior: "smooth" });
      return;
    }
    if (row.y < el.scrollTop + pad) el.scrollTo({ top: Math.max(0, row.y - pad), behavior: "smooth" });
    else if (row.y + row.h > el.scrollTop + el.clientHeight - 8) {
      el.scrollTo({ top: row.y + row.h - el.clientHeight + 8, behavior: "smooth" });
    }
  }, []);

  const moveCursor = useCallback((delta, absolute) => {
    if (!events.length) return;
    const next = absolute != null
      ? Math.max(0, Math.min(events.length - 1, absolute))
      : Math.max(0, Math.min(events.length - 1, cursor + delta));
    setCursor(next);
    const row = events[next];
    setPicked(row.item);
    scrollToRow(row);
  }, [cursor, events, scrollToRow]);

  /** Перейти к году: первое событие, которое случилось не раньше него. */
  const goToYear = useCallback((year) => {
    if (!Number.isFinite(year) || !events.length) return false;
    const t = startOfYear(calendar, year);
    let at = events.findIndex((row) => row.item.t >= t);
    if (at < 0) at = events.length - 1;
    setCursor(at);
    setPicked(events[at].item);
    scrollToRow(events[at], "center");
    return true;
  }, [calendar, events, scrollToRow]);

  const goToEra = useCallback((era) => {
    if (!era || !events.length) return;
    let at = events.findIndex((row) => row.item.t >= era.startT);
    if (at < 0) at = events.length - 1;
    setCursor(at);
    setPicked(events[at].item);
    scrollToRow(events[at], "center");
  }, [events, scrollToRow]);

  // Выбор пришёл извне (клик по ряду, переход из инспектора) — курсор едет
  // следом, иначе стрелки продолжили бы шагать от прежнего места.
  useEffect(() => {
    if (!picked) return;
    const at = indexByKey.get(picked.key);
    if (at != null && at !== cursor) setCursor(at);
    // cursor намеренно не в зависимостях: он же здесь и меняется.
    // eslint-disable-next-line
  }, [picked, indexByKey]);

  const onKeyDown = useCallback((e) => {
    // Правка внутри инспектора живёт своей жизнью: стрелки там двигают курсор
    // в поле, а не по хронологии.
    if (e.target.closest("input, textarea, select, .tl-inspect")) return;
    const keys = {
      ArrowDown: () => moveCursor(1), ArrowUp: () => moveCursor(-1),
      PageDown: () => moveCursor(10), PageUp: () => moveCursor(-10),
      Home: () => moveCursor(0, 0), End: () => moveCursor(0, events.length - 1),
    };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); return; }
    if (e.key === "Enter" && picked) { e.preventDefault(); onOpenNode(picked.nodeId); }
  }, [moveCursor, events.length, picked, onOpenNode]);

  // --- подписи ----------------------------------------------------------
  const dateTextOf = useCallback(
    (item) => formatRange(calendar, item.entry, { ...ctx, selfId: item.nodeId }),
    [calendar, ctx]
  );

  const spanTextOf = useCallback((item) => {
    if (item.t2 == null || item.t2 <= item.t) return "";
    const years = yearsBetween(calendar, item.t, item.t2);
    if (years && years >= 1) return tr("timeline.spanYears", { count: years });
    return tr("timeline.spanDays", { count: Math.round(item.t2 - item.t) });
  }, [calendar, tr]);

  // --- возраст участников в ряду ----------------------------------------
  // Кэш на хронологию: массив возрастов уходит в ряд пропсом, и тот же ряд
  // должен получать тот же массив, иначе memo ряда бесполезен.
  const agesCache = useMemo(() => new Map(), [chrono, neighbours]);
  const agesOf = useCallback((item) => {
    if (agesCache.has(item.key)) return agesCache.get(item.key);
    let out = null;
    const key = item.entry.key || "date";
    if (key !== BIRTH_KEY && key !== DEATH_KEY && item.t != null) {
      const list = [];
      for (const otherId of neighbours.get(item.nodeId) || []) {
        const got = ageAt(chrono, otherId, item.t);
        if (got) list.push({ nodeId: otherId, title: chrono.byNode.get(otherId)?.[0]?.node?.title || "", ...got });
      }
      list.sort((a, b) => b.age - a.age);
      if (list.length) out = list.slice(0, AGES_IN_ROW);
    }
    agesCache.set(item.key, out);
    return out;
  }, [agesCache, neighbours, chrono]);

  // --- противоречия ------------------------------------------------------
  const conflictLines = useCallback((list) => (list || []).map((c) => tr(`timeline.conflict.${c.code}`, {
    name: c.otherId ? chrono.byNode.get(c.otherId)?.[0]?.node?.title || tr("common.untitled") : "",
  })), [chrono, tr]);

  // --- правка дат ----------------------------------------------------------
  const eraOf = useCallback((value) => (value?.eraId ? chrono.eras.byId.get(value.eraId) : null), [chrono]);

  /** Записать новую дату записи: начало и, если есть, конец со сдвигом. */
  const commitEntry = useCallback((item, nextStart, delta) => {
    const dates = (item.node?.dates || []).map((entry) => {
      if (entry.id !== item.entryId) return entry;
      const end = normalizeDate(entry.end);
      const movedEnd = end && delta && canMove(end) ? shiftDate(calendar, end, delta, eraOf(end)) : entry.end;
      return { ...entry, start: nextStart, end: movedEnd ?? entry.end };
    });
    onChangeDates?.(item.nodeId, dates);
  }, [calendar, eraOf, onChangeDates]);

  const nudge = useCallback((item, steps) => {
    const start = normalizeDate(item.entry.start);
    if (!canMove(start)) return;
    const next = nudgeDate(calendar, start, steps, eraOf(start));
    const dates = (item.node?.dates || []).map((entry) => {
      if (entry.id !== item.entryId) return entry;
      const end = normalizeDate(entry.end);
      const movedEnd = end && canMove(end) ? nudgeDate(calendar, end, steps, eraOf(end)) : entry.end;
      return { ...entry, start: next, end: movedEnd ?? entry.end };
    });
    onChangeDates?.(item.nodeId, dates);
  }, [calendar, eraOf, onChangeDates]);

  // Перетаскивание за ручку: вертикаль списка переводится во время по
  // соседним событиям — между двумя рядами дата ложится пропорционально.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const onGripDown = useCallback((e, item) => {
    const start = normalizeDate(item.entry.start);
    const list = listRef.current;
    const content = list?.querySelector(".tl-content");
    if (!canMove(start) || !content || item.t == null) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = eventsRef.current.filter((r) => r.item.key !== item.key && r.item.t != null);
    const yearLen = calendar.months.reduce((n, m) => n + m.days, 0) || 360;
    const timeAt = (y) => {
      let prev = null;
      let next = null;
      for (const r of rows) {
        const cy = r.y + r.h / 2;
        if (cy <= y) prev = { cy, t: r.item.t };
        else { next = { cy, t: r.item.t }; break; }
      }
      if (prev && next) return next.cy === prev.cy ? prev.t : prev.t + ((next.t - prev.t) * (y - prev.cy)) / (next.cy - prev.cy);
      if (prev) return prev.t + ((y - prev.cy) / ROW_H) * yearLen;
      if (next) return next.t - ((next.cy - y) / ROW_H) * yearLen;
      return item.t;
    };
    const ctxText = { ...ctx, selfId: item.nodeId };
    const startY = e.clientY;
    let latest = null;
    let auto = 0;
    const update = (clientY) => {
      const y = clientY - content.getBoundingClientRect().top;
      const target = timeAt(y);
      const value = moveDateTo(calendar, start, item.t, target, eraOf(start));
      const real = movedBy(calendar, start, value, eraOf(start));
      latest = { value, delta: real ?? Math.round(target - item.t), moved: Math.abs(clientY - startY) > 4 };
      setDrag({ key: item.key, y, text: value ? formatDate(calendar, value, ctxText) : "" });
    };
    const edge = (clientY) => {
      const box = list.getBoundingClientRect();
      const dy = clientY < box.top + 40 ? -14 : clientY > box.bottom - 40 ? 14 : 0;
      cancelAnimationFrame(auto);
      if (!dy) return;
      const tick = () => { list.scrollTop += dy; update(clientY); auto = requestAnimationFrame(tick); };
      auto = requestAnimationFrame(tick);
    };
    const move = (ev) => { ev.preventDefault(); update(ev.clientY); edge(ev.clientY); };
    const up = () => {
      cancelAnimationFrame(auto);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (latest?.moved && latest.value) commitEntry(item, latest.value, latest.delta);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    setPicked(item);
    update(e.clientY);
  }, [calendar, ctx, eraOf, commitEntry]);

  // --- добавление ----------------------------------------------------------
  const startAdding = useCallback((item) => {
    if (item?.t != null) {
      const precision = item.start?.precision === "era" || !item.start?.precision ? "year" : item.start.precision;
      const era = eraOf(item.entry.start);
      setAdding({ date: valueAt(calendar, item.t, precision, era?.countsYears ? era : null) });
    } else if (nowT != null) {
      setAdding({ date: { kind: "exact", ...settings.worldNow } });
    } else {
      setAdding({ date: { kind: "exact" } });
    }
    setPicked(null);
  }, [calendar, eraOf, nowT, settings]);

  const submitAdd = useCallback(async (payload) => {
    await onAddEvent?.(payload);
    setAdding(null);
  }, [onAddEvent]);

  // --- переход извне («Показать в хронологии») ---------------------------
  const focusSeen = useRef(null);
  useEffect(() => {
    if (!focus || focusSeen.current === focus.nonce) return;
    const item = (chrono.byNode.get(focus.nodeId) || []).find((x) => x.t != null);
    if (!item) return;
    focusSeen.current = focus.nonce;
    setPicked(item);
    setAdding(null);
    const at = indexByKey.get(item.key);
    if (at != null) requestAnimationFrame(() => scrollToRow(events[at], "center"));
  }, [focus, chrono, indexByKey, events, scrollToRow]);

  const goToEraAny = useCallback((era) => {
    if (view === "lanes") setLanesJump({ t: era.startT, nonce: Date.now() });
    else goToEra(era);
  }, [view, goToEra]);

  const goToYearAny = useCallback((year) => {
    if (view !== "lanes") return goToYear(year);
    if (!Number.isFinite(year)) return false;
    setLanesJump({ t: startOfYear(calendar, year), nonce: Date.now() });
    return true;
  }, [view, goToYear, calendar]);

  /** Год под точкой списка — для пузыря при протяжке полосы-обзора. */
  const labelAt = useCallback((y) => {
    if (!rows.length) return "";
    const at = Math.min(lowerBound(rows, y), rows.length - 1);
    for (let i = at; i < rows.length; i++) {
      if (rows[i].kind === "event") return formatAt(calendar, placedEras, rows[i].item.t, "year");
    }
    return "";
  }, [rows, calendar, placedEras]);

  const pickRow = useCallback((item) => { setAdding(null); setPicked(item); }, []);
  const conflictTextOf = useCallback((key) => conflictLines(conflicts.get(key)).join("\n"), [conflictLines, conflicts]);

  const empty = !items.length && !undated.length;
  // Пусто по-разному: дат нет вообще — или они есть, но их отсеяли поиск и
  // фильтры. Во втором случае звать «добавьте дату» было бы враньём.
  const nothingDated = !chrono.items.length && !chrono.undated.length;
  const filtersOn = Object.values(filters).some((s) => s.size);
  // С чего начать: узлы, у которых даты нет. Раньше пустая шкала говорила
  // «укажите дату у узла» и отпускала — искать, у какого и где, человек шёл сам.
  const startWith = useMemo(
    () => (nothingDated ? allNodes.filter((n) => !chrono.byNode.has(n.id)).slice(0, 6) : []),
    [nothingDated, allNodes, chrono],
  );

  return (
    <div className={`tl-root ${leaving ? "is-leaving" : ""}`} data-testid="timeline-panel">
      <header className="tl-head">
        <span className="tl-head-title">
          <CalendarRange className="w-3.5 h-3.5" /> {tr("timeline.title")}
          <span className="font-mono-sw sw-text-dim">{items.length}</span>
        </span>

        <label className="tl-search">
          <Search className="w-3.5 h-3.5 sw-text-dim shrink-0" />
          <TextField
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("timeline.search")}
            data-testid="timeline-search"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="sw-hover rounded p-0.5">
              <X className="w-3 h-3" />
            </button>
          )}
        </label>

        <GoTo eras={placedEras} onYear={goToYearAny} onEra={goToEraAny} />

        <NowControl chrono={chrono} value={settings?.worldNow || null} onChange={(v) => onChangeNow?.(v)} />

        <div className="tl-head-tools">
          {onAddEvent && (
            <button
              type="button"
              onClick={() => (adding ? setAdding(null) : startAdding(null))}
              className={`tl-tool${adding ? " tl-tool-on" : ""}`}
              title={tr("timeline.add.title")}
              data-testid="timeline-add"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}

          <div className="tl-seg" role="group">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`tl-tool${view === "list" ? " tl-tool-on" : ""}`}
              title={tr("timeline.view.list")}
              data-testid="timeline-view-list"
            >
              <LayoutList className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("lanes")}
              className={`tl-tool${view === "lanes" ? " tl-tool-on" : ""}`}
              title={tr("timeline.view.lanes")}
              data-testid="timeline-view-lanes"
            >
              <Rows3 className="w-3.5 h-3.5" />
            </button>
          </div>

          {conflicts.size > 0 && (
            <button
              type="button"
              onClick={() => setOnlyConflicts((v) => !v)}
              className={`tl-tool tl-tool-warn${onlyConflicts ? " tl-tool-on" : ""}`}
              title={tr("timeline.conflicts", { count: conflicts.size })}
              data-testid="timeline-conflicts"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="font-mono-sw">{conflicts.size}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            className={`tl-tool${railOpen ? " tl-tool-on" : ""}`}
            title={tr("timeline.filters")}
            data-testid="timeline-filters-btn"
          >
            <Filter className="w-3.5 h-3.5" />
            {filtersOn && <span className="tl-tool-badge" />}
          </button>

          {view === "list" && <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="tl-select"
            title={tr("timeline.groupBy")}
            data-testid="timeline-group"
          >
            {GROUPINGS.map((g) => (
              <option key={g} value={g}>{tr(`timeline.group.${g}`)}</option>
            ))}
          </select>}

          <button
            type="button"
            onClick={() => setShowLinks((v) => !v)}
            className={`tl-tool${showLinks ? " tl-tool-on" : ""}`}
            title={tr("timeline.links")}
            data-testid="timeline-links"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>

          <button type="button" onClick={onOpenSettings} className="tl-tool" title={tr("timeline.calendarSettings")}>
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onClose} className="tl-tool" data-testid="close-timeline-btn" title={tr("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {(story || (mobile && placedEras.length > 0)) && (
        <div className="tl-chips">
          {story && (
            <span className="tl-story" data-testid="timeline-story-chip">
              <GitBranch className="w-3.5 h-3.5" />
              <span className="truncate">
                {tr("timeline.story.label", { name: chrono.byNode.get(story.rootId)?.[0]?.node?.title || tr("common.untitled") })}
              </span>
              {[1, 2].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`tl-story-depth${story.depth === d ? " tl-story-depth-on" : ""}`}
                  onClick={() => setStory((s) => ({ ...s, depth: d }))}
                  data-testid={`timeline-story-depth-${d}`}
                >
                  {d}
                </button>
              ))}
              <button type="button" className="tl-story-x" onClick={() => setStory(null)} data-testid="timeline-story-clear">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {/* Эпохи лентой — на телефоне это самый быстрый путь через века:
              выпадающий список прячет их за лишним касанием. */}
          {mobile && placedEras.map((era) => (
            <button
              key={era.id}
              type="button"
              className="tl-era-chip"
              style={{ "--tl-tone": era.color }}
              onClick={() => goToEraAny(era)}
              data-testid={`timeline-era-chip-${era.id}`}
            >
              <span className="tl-dot-sm" style={{ background: era.color }} />
              <span className="truncate">{era.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="tl-body">
        {railOpen && (
          <FilterRail
            facets={facets}
            filters={filters}
            onChange={setFilters}
            typesById={typesById}
            eras={chrono.eras.byId}
          />
        )}

        <div className="tl-main">
          {view === "lanes" && !nothingDated ? (
            <TimelineLanes
              items={items}
              chrono={chrono}
              nowT={nowT}
              picked={picked}
              onPick={(item) => { setAdding(null); setPicked(item); }}
              conflicts={conflicts}
              jump={lanesJump}
              mobile={mobile}
            />
          ) : (<>
          {/* Полоса подсказок: чем управлять списком, видно сразу — иначе о
              стрелках и Enter узнают случайно или никогда. */}
          <div className="tl-hint">
            <kbd>↑</kbd><kbd>↓</kbd> {tr("timeline.hintMove")}
            <span className="tl-hint-sep" />
            <kbd>Enter</kbd> {tr("timeline.hintOpen")}
            {events.length > 0 && (
              <span className="tl-hint-pos font-mono-sw">
                {Math.min(cursor + 1, events.length)} / {events.length}
              </span>
            )}
          </div>

          <div className="tl-scroll-wrap">
          {/* Пришпиленный заголовок живёт вне прокрутки: внутри неё его
              пришлось бы двигать трансформом на каждый кадр, и он бы дрожал. */}
          {pinned && !empty && (
            <div
              className="tl-head-row tl-pinned"
              // Ширину рельса передаём и сюда: пришпиленный заголовок живёт вне
              // .tl-content и переменную оттуда не унаследует, а отступ у него
              // должен совпадать с обычным заголовком до пикселя.
              style={{ height: HEAD_H, "--tl-rail-w": `${railW}px` }}
              data-testid="timeline-pinned-head"
            >
              <span className="tl-head-dot" style={{ background: pinned.color || "var(--sw-border-strong)" }} />
              <span className="truncate">{pinned.label}</span>
              <span className="font-mono-sw sw-text-dim">{pinned.count}</span>
            </div>
          )}
          <div
            className="tl-list sw-scroll-y"
            ref={listRef}
            onScroll={onScroll}
            onKeyDown={onKeyDown}
            tabIndex={0}
            data-testid="timeline-list"
          >
            {empty && !nothingDated ? (
              <p className="tl-empty" data-testid="timeline-no-match">{tr("timeline.noMatch")}</p>
            ) : empty ? (
              <div className="tl-empty tl-empty-start" data-testid="timeline-empty">
                <span className="tl-empty-icon"><CalendarRange className="w-5 h-5" /></span>
                <p className="tl-empty-title">{tr("timeline.emptyTitle")}</p>
                <p className="tl-empty-text">{tr("timeline.empty")}</p>
                {startWith.length > 0 && (
                  <div className="tl-empty-nodes">
                    <span className="sw-section-label">{tr("timeline.startWith")}</span>
                    {startWith.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        data-testid={`timeline-start-${n.id}`}
                        onClick={() => onOpenNode(n.id)}
                        className="tl-empty-node"
                      >
                        <span className="tl-empty-node-icon" style={{ background: n.nodeType?.color || "#64748b" }}>
                          <NodeIcon name={n.nodeType?.icon} className="w-2.5 h-2.5 text-white" />
                        </span>
                        <span className="truncate">{n.title || tr("common.untitled")}</span>
                        <CalendarRange className="w-3 h-3 shrink-0 sw-text-dim" />
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={onOpenSettings} className="tl-empty-eras">
                  <Settings2 className="w-3.5 h-3.5" /> {tr("timeline.calendarSettings")}
                </button>
              </div>
            ) : (
              <div
                className="tl-content"
                style={{ height: Math.max(height, 1), "--tl-rail-w": `${railW}px` }}
              >
                <TimelineRail rows={window_} maxLane={maxLane} height={Math.max(height, 1)} />
                {window_.map((row) => {
                  if (row.kind === "head") {
                    return (
                      <div
                        key={row.id}
                        className={`tl-head-row${row.note ? " tl-head-row-first" : ""}`}
                        style={{ top: row.y, height: row.h }}
                      >
                        <span className="tl-head-dot" style={{ background: row.color || "var(--sw-border-strong)" }} />
                        <span className="truncate">{row.label}</span>
                        <span className="font-mono-sw sw-text-dim">{row.count}</span>
                      </div>
                    );
                  }
                  if (row.kind === "now") {
                    return (
                      <div key={row.id} className="tl-now-row" style={{ top: row.y, height: row.h }} data-testid="timeline-now-row">
                        <span className="tl-now-line" />
                        <span className="tl-now-text">{row.label}</span>
                        <span className="tl-now-line" />
                      </div>
                    );
                  }
                  if (row.kind === "gap") {
                    return (
                      <div key={row.id} className="tl-gap-row" style={{ top: row.y, height: row.h }}>
                        <span className="tl-gap-line" />
                        <span className="tl-gap-text font-mono-sw">{row.label}</span>
                        <span className="tl-gap-line" />
                      </div>
                    );
                  }
                  const item = row.item;
                  const span = item.t2 != null && item.t2 > item.t ? item.t2 - item.t : 0;
                  return (
                    <EventRow
                      key={row.id}
                      item={item}
                      y={row.y}
                      height={row.h}
                      order={orderByKey.get(item.key)}
                      dateText={dateTextOf(item)}
                      spanText={spanTextOf(item)}
                      spanRatio={maxSpan > 0 ? span / maxSpan : 0}
                      selected={picked?.key === item.key}
                      focused={events[cursor]?.id === row.id}
                      highlighted={!!linkedIds?.has(item.nodeId)}
                      dimmed={!!linkedIds && !linkedIds.has(item.nodeId) && (showLinks || !!hovered)}
                      lane={row.lane}
                      onPick={pickRow}
                      onHover={setHovered}
                      conflicts={conflicts.get(item.key)}
                      conflictText={conflictTextOf(item.key)}
                      ages={agesOf(item)}
                      future={nowT != null && item.t > nowT}
                      movable={!!onChangeDates && canMove(item.entry.start)}
                      dragging={drag?.key === item.key}
                      onGripDown={onGripDown}
                      onAdd={onAddEvent ? startAdding : null}
                    />
                  );
                })}
                {drag && (
                  <div className="tl-drag-ghost" style={{ top: drag.y }} data-testid="timeline-drag-ghost">
                    <span className="tl-drag-line" />
                    <span className="tl-drag-label font-mono-sw">{drag.text}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Полоса-обзор: где я в списке и сколько ещё осталось. */}
          <TimelineMinimap
            rows={rows}
            height={height}
            viewH={viewH}
            scrollTop={scrollTop}
            onJump={(top) => listRef.current?.scrollTo({ top: Math.max(0, top) })}
            labelAt={labelAt}
          />
          </div>
          </>)}
        </div>

        {adding && (
          <AddEventPanel
            key={JSON.stringify(adding.date)}
            chrono={chrono}
            allNodes={allNodes}
            types={settings?.nodeTypes || Object.values(typesById || {})}
            initialDate={adding.date}
            onSubmit={submitAdd}
            onClose={() => setAdding(null)}
          />
        )}
        {picked && !adding && (
          <Inspector
            item={picked}
            chrono={chrono}
            ctx={ctx}
            edges={edges}
            allNodes={allNodes}
            onClose={() => setPicked(null)}
            onOpenNode={onOpenNode}
            onChangeDates={onChangeDates}
            nowT={nowT}
            conflicts={conflictLines(conflicts.get(picked.key))}
            onNudge={nudge}
            onShowOnCanvas={onShowOnCanvas}
            onStory={(nodeId) => setStory({ rootId: nodeId, depth: story?.depth || 1 })}
            storyOn={story?.rootId === picked.nodeId}
            onGoTo={(item) => {
              setPicked(item);
              const at = indexByKey.get(item.key);
              if (at != null && view === "list") scrollToRow(events[at], "center");
            }}
          />
        )}
      </div>

      {undated.length > 0 && (
        <UndatedDrawer items={undated} onPick={setPicked} onOpenNode={onOpenNode} />
      )}
    </div>
  );
}

/** Первый ряд, чей низ ниже заданной отметки. */
function lowerBound(rows, top) {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].y + rows[mid].h < top) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// ------------------------------------------------------------- переход
/**
 * Переход к году или эпохе. Год вводят числом — это единственная опора,
 * одинаковая во всех календарях: месяцы и дни у каждого мира свои, а «в каком
 * году» спрашивают всегда.
 */
function GoTo({ eras, onYear, onEra }) {
  const tr = useT();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);

  const submit = () => {
    const year = parseInt(value.replace(/[^\d-]/g, ""), 10);
    if (onYear(year)) setValue("");
  };

  return (
    <div className="tl-goto">
      <label className="tl-goto-field">
        <CornerDownLeft className="w-3 h-3 sw-text-dim shrink-0" />
        <TextField
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder={tr("timeline.goToYear")}
          inputMode="numeric"
          data-testid="timeline-goto-year"
        />
      </label>
      {eras.length > 0 && (
        <div className="tl-goto-eras">
          <button
            type="button"
            className="tl-tool"
            onClick={() => setOpen((v) => !v)}
            title={tr("timeline.goToEra")}
            data-testid="timeline-goto-era"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {open && (
            <div className="tl-goto-menu" onMouseLeave={() => setOpen(false)}>
              {eras.map((era) => (
                <button
                  type="button"
                  key={era.id}
                  className="tl-goto-item"
                  onClick={() => { setOpen(false); onEra(era); }}
                >
                  <span className="tl-dot-sm" style={{ background: era.color }} />
                  <span className="truncate">{era.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- отбор

function collectFacets(items, undated) {
  const types = new Map();
  const tags = new Map();
  const eras = new Map();
  const canvases = new Map();
  const keys = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  for (const item of [...items, ...undated]) {
    bump(types, item.node?.typeId || "note");
    bump(keys, item.entry.key || "date");
    if (item.eraId) bump(eras, item.eraId);
    if (item.node?.canvas) bump(canvases, item.node.canvas);
    for (const tag of item.node?.tags || []) bump(tags, tag);
  }
  return { types, tags, eras, canvases, keys };
}

function matches(item, filters, needle, chrono) {
  const node = item.node || {};
  if (filters.types.size && !filters.types.has(node.typeId || "note")) return false;
  if (filters.keys.size && !filters.keys.has(item.entry.key || "date")) return false;
  if (filters.canvases.size && !filters.canvases.has(node.canvas || "")) return false;
  if (filters.tags.size && !(node.tags || []).some((t) => filters.tags.has(t))) return false;
  if (filters.eras.size) {
    const era = item.eraId || eraAt(chrono.eras.placed, item.t)?.id;
    if (!era || !filters.eras.has(era)) return false;
  }
  if (needle) {
    const hay = `${node.title || ""} ${node.description || ""} ${(node.tags || []).join(" ")}`;
    if (!hay.toLowerCase().includes(needle)) return false;
  }
  return true;
}

function FilterRail({ facets, filters, onChange, typesById, eras }) {
  const tr = useT();
  const toggle = (group, key) => {
    onChange((prev) => {
      const next = new Set(prev[group]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [group]: next };
    });
  };
  const active = Object.values(filters).some((s) => s.size);

  const section = (group, entries, render) => {
    if (!entries.size) return null;
    return (
      <div className="tl-rail-section" key={group}>
        <div className="tl-rail-head">{tr(`timeline.facet.${group}`)}</div>
        {[...entries.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => (
          <button
            type="button"
            key={key}
            onClick={() => toggle(group, key)}
            className={`tl-facet${filters[group].has(key) ? " tl-facet-on" : ""}`}
            data-testid={`timeline-facet-${group}-${key}`}
          >
            {render(key)}
            <span className="font-mono-sw sw-text-dim">{count}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <aside className="tl-rail sw-scroll-y" data-testid="timeline-rail">
      {active && (
        <button
          type="button"
          className="tl-rail-clear"
          onClick={() => onChange({
            types: new Set(), tags: new Set(), eras: new Set(), canvases: new Set(), keys: new Set(),
          })}
        >
          {tr("timeline.clearFilters")}
        </button>
      )}
      {section("types", facets.types, (key) => {
        const type = typesById[key];
        return (
          <span className="tl-facet-label">
            <NodeIcon name={type?.icon || "FileText"} className="w-3 h-3" />
            <span className="truncate">{type?.label || key}</span>
          </span>
        );
      })}
      {section("eras", facets.eras, (key) => (
        <span className="tl-facet-label">
          <span className="tl-dot-sm" style={{ background: eras.get(key)?.color || "#64748b" }} />
          <span className="truncate">{eras.get(key)?.name || key}</span>
        </span>
      ))}
      {section("keys", facets.keys, (key) => (
        <span className="tl-facet-label truncate">{tr(`chrono.entry.${key}`)}</span>
      ))}
      {section("tags", facets.tags, (key) => <span className="tl-facet-label truncate">#{key}</span>)}
    </aside>
  );
}

// ------------------------------------------------------------ инспектор

function Inspector({
  item, chrono, ctx, edges, allNodes, onClose, onOpenNode, onChangeDates, onGoTo,
  nowT, conflicts, onNudge, onShowOnCanvas, onStory, storyOn,
}) {
  const tr = useT();
  const node = item.node || {};
  const era = item.eraId ? chrono.eras.byId.get(item.eraId) : eraAt(chrono.eras.placed, item.t);
  const [editing, setEditing] = useState(false);

  // Переключились на другое событие — правка закрывается: редактор, оставшийся
  // открытым на чужой дате, поменял бы не то, что видно.
  useEffect(() => setEditing(false), [item.key]);

  const linked = useMemo(() => {
    const out = [];
    for (const edge of edges || []) {
      const otherId = edge.source === item.nodeId ? edge.target
        : edge.target === item.nodeId ? edge.source : null;
      if (!otherId) continue;
      const other = chrono.byNode.get(otherId)?.[0];
      if (other) out.push({ edge, item: other });
    }
    return out;
  }, [edges, item, chrono]);

  const ages = useMemo(() => {
    const only = new Set(linked.map((l) => l.item.nodeId));
    only.add(item.nodeId);
    return agesDuring(chrono, item.t, only);
  }, [chrono, item, linked]);

  const own = useMemo(() => lifespan(chrono, item.nodeId, nowT), [chrono, item.nodeId, nowT]);

  const resolvedText = useMemo(() => {
    const plain = item.start?.kind === "exact" && !item.entry.start?.rel;
    if (plain || !item.start?.ok) return "";
    const from = formatAt(chrono.calendar, chrono.eras.placed, item.t, item.start.precision);
    if (item.t2 == null || item.t2 === item.t) return from;
    const to = formatAt(chrono.calendar, chrono.eras.placed, item.t2, item.end?.precision);
    return to && to !== from ? `${from} → ${to}` : from;
  }, [chrono, item]);

  /** Записать новое начало даты обратно в узел. */
  const setStart = useCallback((value) => {
    const dates = (node.dates || []).map((entry) => (
      entry.id === item.entryId ? { ...entry, start: value } : entry
    ));
    onChangeDates?.(item.nodeId, dates);
  }, [node.dates, item, onChangeDates]);

  const canEdit = !!onChangeDates && !!node.dates?.some((e) => e.id === item.entryId);
  const movable = canEdit && canMove(item.entry.start);
  const step = stepOf(item.entry.start);

  return (
    <aside className="tl-inspect sw-scroll-y" data-testid="timeline-inspector">
      <div className="tl-inspect-head">
        <span className="tl-inspect-kind" style={{ background: node.nodeType?.color || "#64748b" }} />
        <strong className="truncate">{node.title || tr("common.untitled")}</strong>
        <button type="button" onClick={onClose} className="tl-tool ml-auto"><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="tl-inspect-date font-mono-sw">
        {formatRange(chrono.calendar, item.entry, { ...ctx, selfId: item.nodeId })}
        {canEdit && (
          <button
            type="button"
            className="tl-inspect-edit"
            onClick={() => setEditing((v) => !v)}
            title={tr("timeline.editDate")}
            data-testid="timeline-edit-date"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
      {resolvedText && <div className="tl-inspect-resolved font-mono-sw">= {resolvedText}</div>}

      {/* Сдвиг на шаг своей точности: «на год позже» — без открытия редактора. */}
      {movable && (
        <div className="tl-nudge">
          <button type="button" className="tl-tool" onClick={() => onNudge(item, -1)} data-testid="timeline-nudge-minus">
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="tl-nudge-step">{tr(`timeline.nudge.${step}`)}</span>
          <button type="button" className="tl-tool" onClick={() => onNudge(item, 1)} data-testid="timeline-nudge-plus">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {conflicts?.length > 0 && (
        <div className="tl-inspect-warn" data-testid="timeline-inspector-conflicts">
          {conflicts.map((line) => (
            <div key={line} className="tl-inspect-warn-row">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}

      {/* Правка даты здесь, а не всплывающим окном над рядом: панель узла ради
          одной даты открывать не нужно, а всплывающему тут негде встать —
          у панелей свой transform, и position: fixed внутри них съезжает. */}
      {editing && (
        <div className="tl-inspect-editor" data-testid="timeline-date-editor">
          <DateValueEditor
            value={item.entry.start}
            onChange={setStart}
            nodes={allNodes || []}
            selfId={item.nodeId}
            calendar={chrono.calendar}
            eras={chrono.eras.placed}
          />
        </div>
      )}

      {era && (
        <div className="tl-inspect-era">
          <span className="tl-dot-sm" style={{ background: era.color }} /> {era.name}
        </div>
      )}
      {item.label && <div className="tl-inspect-key">{item.label}</div>}
      {node.description && <p className="tl-inspect-desc">{node.description}</p>}

      {own?.age != null && (
        <div className="tl-inspect-block">
          <div className="tl-rail-head">{tr(own.atDeath ? "chrono.age.lived" : "chrono.age.now")}</div>
          <div className="tl-inspect-age">
            {own.exact ? "" : "≈"}{tr("chrono.age.years", { count: own.age })}
          </div>
        </div>
      )}

      {ages.length > 0 && (
        <div className="tl-inspect-block">
          <div className="tl-rail-head">{tr("chrono.age.during")}</div>
          {ages.map((a) => (
            <button
              type="button"
              key={a.nodeId}
              className="tl-inspect-row"
              onClick={() => onOpenNode(a.nodeId)}
            >
              <span className="truncate">{a.node?.title || tr("common.untitled")}</span>
              <span className="font-mono-sw sw-accent-text">
                {a.exact ? "" : "≈"}{tr("chrono.age.years", { count: a.age })}
              </span>
            </button>
          ))}
        </div>
      )}

      {linked.length > 0 && (
        <div className="tl-inspect-block">
          <div className="tl-rail-head">{tr("timeline.linked")}</div>
          {linked.map(({ edge, item: other }) => (
            <button
              type="button"
              key={edge.id}
              className="tl-inspect-row"
              onClick={() => onGoTo(other)}
            >
              <span className="tl-dot-sm" style={{ background: other.node?.nodeType?.color || "#64748b" }} />
              <span className="truncate">{other.node?.title || tr("common.untitled")}</span>
              {edge.label && <span className="sw-text-dim truncate">{edge.label}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="tl-inspect-actions">
        {onShowOnCanvas && (
          <button
            type="button"
            className="tl-inspect-action"
            onClick={() => onShowOnCanvas(item.nodeId)}
            data-testid="timeline-show-canvas"
          >
            <MapPin className="w-3.5 h-3.5" /> {tr("timeline.showOnCanvas")}
          </button>
        )}
        <button
          type="button"
          className={`tl-inspect-action${storyOn ? " tl-inspect-action-on" : ""}`}
          onClick={() => onStory(item.nodeId)}
          data-testid="timeline-story"
        >
          <GitBranch className="w-3.5 h-3.5" /> {tr("timeline.story.make")}
        </button>
      </div>

      <button
        type="button"
        className="tl-inspect-open"
        onClick={() => onOpenNode(item.nodeId)}
        data-testid="timeline-open-node"
      >
        {tr("timeline.openNode")}
      </button>
    </aside>
  );
}

// --------------------------------------------------------- без даты

function UndatedDrawer({ items, onPick, onOpenNode }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className={`tl-undated${open ? " tl-undated-open" : ""}`} data-testid="timeline-undated">
      <button type="button" className="tl-undated-head" onClick={() => setOpen((v) => !v)}>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform${open ? "" : " -rotate-90"}`} />
        {tr("timeline.undated")}
        <span className="font-mono-sw sw-text-dim">{items.length}</span>
      </button>
      {open && (
        <div className="tl-undated-list sw-scroll-y">
          {items.map((item) => (
            <button
              type="button"
              key={item.key}
              className="tl-undated-item"
              onClick={() => onOpenNode(item.nodeId)}
              title={tr(`timeline.reason.${item.error || "empty"}`)}
            >
              <span className="tl-dot-sm" style={{ background: item.node?.nodeType?.color || "#64748b" }} />
              <span className="truncate">{item.node?.title || tr("common.untitled")}</span>
              <span className="sw-text-dim truncate">{tr(`timeline.reason.${item.error || "empty"}`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Прокрутка сообщается наружу не чаще кадра. */
function useRafScroll(set) {
  const frame = useRef(0);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
  return useCallback((e) => {
    const top = e.currentTarget.scrollTop;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      set(top);
    });
  }, [set]);
}
