import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarRange, ChevronDown, Filter, Link2, Maximize2, Minus, Plus,
  Search, Settings2, X,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  agesDuring, buildScale, eraAt, formatAt, formatRange, lifespan,
} from "@/lib/chrono";
import { NodeIcon } from "@/components/NodeIcon";
import { EventCard } from "./EventCard";
import { EraBackdrop, EraBands, GapMarks, TimelineAxis } from "./TimelineAxis";
import DotLayer from "./DotLayer";
import { DETAIL, useTimelineLayout } from "./useTimelineLayout";
import {
  OVERSCAN_PX, useElementSize, useTimelineInput, useTimelineViewport,
} from "./useTimelineViewport";
import "./timeline.css";

// Шкала времени.
//
// Горизонтальная, а не вертикальная — и вот почему. Вертикальный список
// хорошо читается, но он и так уже есть в боковой панели. От шкалы нужно
// другое: увидеть, что война длилась семь лет, а перемирие — три месяца;
// что между двумя эпохами лежит пустое тысячелетие; что три сюжетные линии
// идут рядом. Всё это — сравнение длин и одновременности, а длину человек
// сравнивает по горизонтали. Плюс эпохи ложатся полосами поперёк движения
// времени, чего в вертикальной раскладке пришлось бы добиваться хитростью.

const GROUPINGS = ["none", "type", "era"];

export default function TimelinePanel({
  chrono, settings, edges, typesById, onOpenNode, onOpenSettings, onClose,
}) {
  const tr = useT();
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const { width, height } = useElementSize(canvasRef);

  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("none");
  const [compress, setCompress] = useState(true);
  const [showLinks, setShowLinks] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [picked, setPicked] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [filters, setFilters] = useState(() => ({
    types: new Set(), tags: new Set(), eras: new Set(), canvases: new Set(), keys: new Set(),
  }));

  const calendar = chrono.calendar;
  const placedEras = chrono.eras.placed;

  const ctx = useMemo(() => ({
    eraName: (id) => chrono.eras.byId.get(id)?.name || "",
    nodeTitle: (id) => chrono.byNode.get(id)?.[0]?.node?.title || "",
  }), [chrono]);

  // --- отбор -----------------------------------------------------------
  const facets = useMemo(() => collectFacets(chrono.items, chrono.undated), [chrono]);

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return chrono.items.filter((item) => matches(item, filters, needle, chrono));
  }, [chrono, filters, search]);

  const undated = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return chrono.undated.filter((item) => matches(item, filters, needle, chrono));
  }, [chrono, filters, search]);

  // --- шкала -----------------------------------------------------------
  const scale = useMemo(() => {
    const anchors = [];
    for (const item of items) {
      anchors.push(item.t);
      if (item.t2 != null && item.t2 !== item.t) anchors.push(item.t2);
    }
    for (const era of placedEras) {
      anchors.push(era.startT);
      if (Number.isFinite(era.endT)) anchors.push(era.endT);
    }
    return buildScale(anchors, { compress });
  }, [items, placedEras, compress]);

  const viewport = useTimelineViewport({ total: scale.total, width });
  const {
    committed, registerTrack, viewRef, zoomAt, fitAll, fitRange, centerOn, touched,
  } = viewport;
  useTimelineInput(canvasRef, viewport);

  // Новый набор событий — новая шкала: показываем её целиком, иначе после
  // включения фильтра можно оказаться в пустоте.
  //
  // Пока человек не трогал шкалу, вид подстраивается под данные сам: открыли
  // панель — видно всё, включили фильтр — видно то, что осталось. Одноразового
  // флага здесь мало: ширина панели становится известна не сразу, и подгон,
  // сделанный до неё, пропал бы впустую. Поэтому подгоняем при каждом
  // изменении — ровно до первого движения мышью, после которого вид
  // принадлежит человеку и трогать его нельзя.
  const fitKey = `${scale.total}|${items.length}|${compress}`;
  // Зависеть здесь можно только от `touched` — это ref, он один на всю жизнь
  // панели. Сам объект вьюпорта пересоздаётся на каждой перерисовке, и от
  // него сброс срабатывал бы после каждого движения колеса, тут же возвращая
  // шкалу к общему виду.
  useEffect(() => {
    touched.current = false;
  }, [fitKey, touched]);
  useEffect(() => {
    if (!width || touched.current) return;
    fitAll();
  }, [fitKey, width, fitAll, touched]);

  const layoutContext = useMemo(() => ({
    typesById,
    erasById: chrono.eras.byId,
    eraAt: (t) => eraAt(placedEras, t),
    noEraLabel: tr("timeline.noEra"),
    otherLabel: tr("editor.otherType"),
  }), [typesById, chrono, placedEras, tr]);

  const layout = useTimelineLayout(items, scale, committed.zoom, groupBy, layoutContext);

  // --- видимое окно ----------------------------------------------------
  const dots = layout.detail === DETAIL.DOT;
  const visible = useMemo(() => {
    // На дальнем плане событие — точка без подписи, и рисует их холст
    // (DotLayer). Разметке остаются только карточки с текстом.
    if (!width || dots) return [];
    const pad = OVERSCAN_PX / committed.zoom;
    return layout.visible(
      committed.offsetU - pad,
      committed.offsetU + width / committed.zoom + pad,
      scrollTop - 200,
      scrollTop + height + 200
    );
  }, [layout, committed, width, height, scrollTop, dots]);

  const onScroll = useRafScroll(setScrollTop);

  // --- связи и подсветка ----------------------------------------------
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

  const links = useMemo(() => {
    if (!showLinks && !linkedIds) return [];
    return buildLinks(edges, visible, linkedIds, showLinks, committed, layout.laneH);
  }, [edges, visible, linkedIds, showLinks, committed, layout.laneH]);

  const openNode = useCallback((item) => {
    setPicked(item);
  }, []);

  const dateTextOf = useCallback(
    (item) => formatRange(calendar, item.entry, { ...ctx, selfId: item.nodeId }),
    [calendar, ctx]
  );

  const zoomPercent = Math.round(committed.zoom * scale.total / Math.max(width, 1) * 100);
  const empty = !items.length && !undated.length;

  return (
    <div className="tl-root" ref={rootRef} data-testid="timeline-panel">
      <header className="tl-head">
        <span className="tl-head-title">
          <CalendarRange className="w-3.5 h-3.5" /> {tr("timeline.title")}
          <span className="font-mono-sw sw-text-dim">{items.length}</span>
        </span>

        <label className="tl-search">
          <Search className="w-3.5 h-3.5 sw-text-dim shrink-0" />
          <input
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

        <div className="tl-head-tools">
          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            className={`tl-tool${railOpen ? " tl-tool-on" : ""}`}
            title={tr("timeline.filters")}
            data-testid="timeline-filters-btn"
          >
            <Filter className="w-3.5 h-3.5" />
          </button>

          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="tl-select"
            title={tr("timeline.groupBy")}
            data-testid="timeline-group"
          >
            {GROUPINGS.map((g) => (
              <option key={g} value={g}>{tr(`timeline.group.${g}`)}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setCompress((v) => !v)}
            className={`tl-tool${compress ? " tl-tool-on" : ""}`}
            title={tr("timeline.compressHint")}
            data-testid="timeline-compress"
          >
            <span className="text-[10px] font-semibold tracking-wide">{tr("timeline.compress")}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowLinks((v) => !v)}
            className={`tl-tool${showLinks ? " tl-tool-on" : ""}`}
            title={tr("timeline.links")}
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>

          <span className="tl-zoom">
            <button type="button" onClick={() => zoomAt(1 / 1.4, width / 2)} className="tl-tool" title={tr("timeline.zoomOut")}>
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono-sw" data-testid="timeline-zoom">{zoomPercent}%</span>
            <button type="button" onClick={() => zoomAt(1.4, width / 2)} className="tl-tool" title={tr("timeline.zoomIn")}>
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={fitAll} className="tl-tool" title={tr("timeline.fit")} data-testid="timeline-fit">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </span>

          <button type="button" onClick={onOpenSettings} className="tl-tool" title={tr("timeline.calendarSettings")}>
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onClose} className="tl-tool" data-testid="close-timeline-btn" title={tr("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

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
          <EraBands
            scale={scale}
            view={committed}
            width={width}
            eras={placedEras}
            registerTrack={registerTrack}
            activeEra={picked?.eraId}
            onPickEra={(era) => fitRange(scale.project(era.startT),
              scale.project(Number.isFinite(era.endT) ? era.endT : scale.domain[1]))}
          />

          <div className="tl-canvas" ref={canvasRef} onScroll={onScroll} data-testid="timeline-canvas">
            {empty ? (
              <p className="tl-empty">{tr("timeline.empty")}</p>
            ) : (
              <div className="tl-content" style={{ height: Math.max(layout.height, 1) }}>
                {/* Подложки эпох и метки разрывов лежат внутри полосы: они
                    обязаны ехать вместе с событиями, а не стоять на месте. */}
                {/* Холст точек живёт вне полосы: он рисует в экранных
                    координатах и сам следит за сдвигом, а `sticky` держит его
                    в поле зрения, пока содержимое прокручивается по рядам. */}
                {dots && (
                  <DotLayer
                    layout={layout}
                    viewport={viewport}
                    width={width}
                    height={height}
                    scrollTop={scrollTop}
                    overscan={OVERSCAN_PX}
                    dimmed={linkedIds}
                    onPick={openNode}
                    onHover={setHovered}
                  />
                )}

                <div className="tl-track" ref={registerTrack}>
                  <EraBackdrop
                    scale={scale} view={committed} width={width}
                    eras={placedEras} height={Math.max(layout.height, height)}
                  />
                  <GapMarks
                    scale={scale} view={committed} width={width}
                    height={Math.max(layout.height, height)}
                  />
                  {groupBy !== "none" && layout.groups.map((group) => (
                    <div key={group.id || "-"} className="tl-group" style={{ top: group.y }}>
                      <span className="tl-group-dot" style={{ background: group.color }} />
                      {group.label}
                      <span className="font-mono-sw sw-text-dim">{group.count}</span>
                    </div>
                  ))}

                  {links.length > 0 && (
                    // Дуги выходят за пределы своего кадра — пусть рисуются.
                    <svg className="tl-links" width="1" height="1" style={{ overflow: "visible" }}>
                      {links.map((link) => (
                        <path key={link.id} d={link.d} className="tl-link" style={{ stroke: link.color }} />
                      ))}
                    </svg>
                  )}

                  {visible.map((entry) => (
                    <EventCard
                      key={entry.item.key}
                      entry={entry}
                      detail={layout.detail}
                      zoom={committed.zoom}
                      origin={committed.offsetU}
                      dateText={dateTextOf(entry.item)}
                      selected={picked?.key === entry.item.key}
                      highlighted={!!linkedIds?.has(entry.item.nodeId)}
                      dimmed={!!linkedIds && !linkedIds.has(entry.item.nodeId)}
                      onOpen={openNode}
                      onHover={setHovered}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <TimelineAxis
            calendar={calendar}
            scale={scale}
            view={committed}
            width={width}
            registerTrack={registerTrack}
          />
        </div>

        {picked && (
          <Inspector
            item={picked}
            chrono={chrono}
            ctx={ctx}
            edges={edges}
            onClose={() => setPicked(null)}
            onOpenNode={onOpenNode}
            onGoTo={(item) => { setPicked(item); centerOn(scale.project(item.t)); }}
          />
        )}
      </div>

      {undated.length > 0 && (
        <UndatedDrawer items={undated} onPick={setPicked} onOpenNode={onOpenNode} />
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

// ----------------------------------------------------------------- связи

/**
 * Дуги между связанными событиями.
 *
 * Рисуются только между теми, что сейчас на экране: связей в проекте бывают
 * тысячи, а видно из них единицы. Координаты — те же, что у карточек: от
 * отметки вьюпорта, чтобы дуги ехали вместе с ними одним transform.
 */
function buildLinks(edges, visible, linkedIds, showAll, view, laneH) {
  const byNode = new Map();
  for (const entry of visible) {
    if (!byNode.has(entry.item.nodeId)) byNode.set(entry.item.nodeId, entry);
  }
  const out = [];
  for (const edge of edges || []) {
    const a = byNode.get(edge.source);
    const b = byNode.get(edge.target);
    if (!a || !b || a === b) continue;
    if (!showAll && !(linkedIds?.has(edge.source) && linkedIds?.has(edge.target))) continue;
    const x1 = (a.u0 - view.offsetU) * view.zoom;
    const x2 = (b.u0 - view.offsetU) * view.zoom;
    const y1 = a.y + laneH / 2;
    const y2 = b.y + laneH / 2;
    // Дуга провисает тем сильнее, чем дальше события друг от друга, — так
    // видно, что это связь, а не случайное совпадение уровней.
    const sag = Math.min(Math.abs(x2 - x1) * 0.3, 70);
    out.push({
      id: edge.id,
      color: edge.data?.color || "var(--sw-border-strong)",
      d: `M ${x1} ${y1} C ${x1 + sag} ${y1 + sag}, ${x2 - sag} ${y2 + sag}, ${x2} ${y2}`,
    });
  }
  return out;
}

// ------------------------------------------------------------ инспектор

function Inspector({ item, chrono, ctx, edges, onClose, onOpenNode, onGoTo }) {
  const tr = useT();
  const node = item.node || {};
  const era = item.eraId ? chrono.eras.byId.get(item.eraId) : eraAt(chrono.eras.placed, item.t);

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

  // Кому сколько было лет, когда это случилось. Считается только для тех,
  // кто связан с событием, — иначе на крупном проекте это простыня.
  const ages = useMemo(() => {
    const only = new Set(linked.map((l) => l.item.nodeId));
    only.add(item.nodeId);
    return agesDuring(chrono, item.t, only);
  }, [chrono, item, linked]);

  // Срок жизни самого узла: у персонажа с датами рождения и смерти это
  // «прожил столько-то», и считать это в уме автору не нужно.
  const own = useMemo(() => lifespan(chrono, item.nodeId), [chrono, item.nodeId]);

  // Число показываем только там, где его не видно в самой записи: у обычной
  // точной даты это было бы повторением её же.
  const resolvedText = useMemo(() => {
    const plain = item.start?.kind === "exact" && !item.entry.start?.rel;
    if (plain || !item.start?.ok) return "";
    const from = formatAt(chrono.calendar, chrono.eras.placed, item.t, item.start.precision);
    if (item.t2 == null || item.t2 === item.t) return from;
    const to = formatAt(chrono.calendar, chrono.eras.placed, item.t2, item.end?.precision);
    return to && to !== from ? `${from} → ${to}` : from;
  }, [chrono, item]);

  return (
    <aside className="tl-inspect sw-scroll-y" data-testid="timeline-inspector">
      <div className="tl-inspect-head">
        <span className="tl-inspect-kind" style={{ background: node.nodeType?.color || "#64748b" }} />
        <strong className="truncate">{node.title || tr("common.untitled")}</strong>
        <button type="button" onClick={onClose} className="tl-tool ml-auto"><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="tl-inspect-date font-mono-sw">
        {formatRange(chrono.calendar, item.entry, { ...ctx, selfId: item.nodeId })}
      </div>
      {/* Дата, полученная вычислением, показывается ещё и числом: «через пять
          дней после коронации» объясняет связь, но не отвечает на вопрос
          «какое это число». */}
      {resolvedText && <div className="tl-inspect-resolved font-mono-sw">= {resolvedText}</div>}
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

/** Прокрутка сообщается наружу не чаще кадра: на каждый пиксель пересобирать
 *  список видимых карточек незачем. */
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
