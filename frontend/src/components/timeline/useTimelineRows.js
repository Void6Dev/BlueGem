import { useMemo } from "react";
import { eraAt, yearsBetween } from "@/lib/chrono";

// Раскладка вертикальной хронологии: плоский список рядов с их высотами.
//
// Ряды считаются один раз на отбор, а рисуются только те, что попали в кадр.
// Поэтому высоты фиксированные: с ними окно считается арифметикой, без
// измерения DOM, и полсотни тысяч событий прокручиваются так же, как десять.

export const ROW_H = 34;
export const HEAD_H = 32;
export const GAP_H = 28;

// Рельс времени как в графе истории правок: события одного и того же момента
// расходятся по параллельным дорожкам и сходятся обратно. Пока они шли
// столбиком, «одновременно» и «одно за другим» выглядели одинаково.
export const LANE_W = 13;
export const RAIL_X = 9;
// Больше пяти дорожек в ширину не разводим: дальше рельс съедает строку.
// Лишние события возвращаются на уже занятые дорожки — они всё равно
// прочитываются как одна гроздь.
const MAX_LANE = 4;

// Во сколько раз пропуск должен превышать обычный шаг между событиями, чтобы
// его стоило отметить. Иначе метки лезут между каждой парой дат.
const GAP_FACTOR = 6;
// И при этом быть не меньше этого в годах: на плотной кампании, где события
// идут через день, шестикратный пропуск — это неделя, отмечать нечего.
const GAP_MIN_YEARS = 5;

/**
 * @param {object[]} items    отобранные события, уже по времени
 * @param {string} groupBy    none | type | era
 * @param {object} ctx        calendar, eras, typesById, подписи
 * @returns {{rows, height, events, indexByKey, maxSpan}}
 */
export function useTimelineRows(items, groupBy, ctx) {
  return useMemo(() => build(items, groupBy, ctx), [items, groupBy, ctx]);
}

function build(items, groupBy, ctx) {
  const { calendar, placedEras, typesById, noEraLabel, otherLabel, gapLabel } = ctx;

  const rows = [];
  const events = [];
  const indexByKey = new Map();
  let y = 0;
  let maxLane = 0;

  // Заголовок, которому принадлежит ряд. Пришпиленной шапке нужен ответ на
  // каждый пиксель прокрутки, и искать его обходом списка нельзя.
  const headOf = [];
  let currentHead = null;

  const push = (row) => {
    row.y = y;
    row.index = rows.length;
    y += row.h;
    if (row.kind === "head") currentHead = row;
    headOf.push(currentHead);
    rows.push(row);
    if (row.kind === "event") {
      indexByKey.set(row.item.key, events.length);
      events.push(row);
    }
  };

  // Самая долгая длительность в отборе — ею нормируется колонка полосок.
  // Считаем по отбору, а не по всему проекту: иначе после фильтра все полоски
  // разом становятся ниточками, хотя сравнивать теперь надо между собой.
  let maxSpan = 0;
  for (const item of items) {
    if (item.t2 != null && item.t2 > item.t) maxSpan = Math.max(maxSpan, item.t2 - item.t);
  }

  // Типичный шаг между событиями — медиана, а не среднее: одно доисторическое
  // событие не должно объявлять «обычным» промежуток в тысячу лет.
  const steps = [];
  for (let i = 1; i < items.length; i++) steps.push(items[i].t - items[i - 1].t);
  steps.sort((a, b) => a - b);
  const typicalStep = steps.length ? steps[Math.floor(steps.length / 2)] : 0;

  const sections = groupItems(items, groupBy, { placedEras, typesById, noEraLabel, otherLabel });

  for (const section of sections) {
    if (section.head) {
      push({ kind: "head", h: HEAD_H, id: section.id, label: section.label,
        color: section.color, count: section.items.length, note: section.note });
    }
    let previous = null;
    // Гроздь — подряд идущие события с одинаковым временем. Первое остаётся на
    // стволе, остальные уходят на свои дорожки и возвращаются на ствол под
    // последним из них.
    for (const cluster of clustersOf(section.items)) {
      const first = rows.length;
      cluster.forEach((item, i) => {
        const gap = gapBetween(previous, item, typicalStep, calendar);
        if (gap) push({ kind: "gap", h: GAP_H, id: `${item.key}-gap`, label: gapLabel(gap) });
        push({ kind: "event", h: ROW_H, id: item.key, item, lane: i > MAX_LANE ? MAX_LANE : i });
        previous = item;
      });
      if (cluster.length > 1) {
        // Концы веток знает вся гроздь целиком: ряд в кадре может оказаться
        // без своих соседей, а рисовать ветку всё равно нужно.
        const top = rows[first].y + ROW_H / 2;
        const bottom = y;
        for (let i = first; i < rows.length; i++) {
          if (rows[i].kind !== "event") continue;
          rows[i].branchTop = top;
          rows[i].branchBottom = bottom;
        }
        maxLane = Math.max(maxLane, Math.min(cluster.length - 1, MAX_LANE));
      }
    }
  }

  return { rows, height: y, events, indexByKey, maxSpan, headOf, maxLane };
}

/** Разбить список на грозди подряд идущих событий с одинаковым временем. */
function clustersOf(items) {
  const out = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last[0].t === item.t) last.push(item);
    else out.push([item]);
  }
  return out;
}

/** Стоит ли отмечать пустоту между двумя соседями и насколько она велика. */
function gapBetween(previous, item, typicalStep, calendar) {
  if (!previous) return null;
  const days = item.t - previous.t;
  if (days <= 0) return null;
  if (typicalStep > 0 && days < typicalStep * GAP_FACTOR) return null;
  const years = yearsBetween(calendar, previous.t, item.t);
  if (!years || years < GAP_MIN_YEARS) return null;
  return { years, days };
}

function groupItems(items, groupBy, { placedEras, typesById, noEraLabel, otherLabel }) {
  if (groupBy === "none") {
    // Плоская хронология всё равно размечается эпохами: без них колонка дат
    // превращается в столбик чисел без опоры. Но заголовок здесь тонкий —
    // это отметка на пути, а не раздел.
    const out = [];
    let currentEra;
    for (const item of items) {
      const era = item.eraId
        ? placedEras.find((e) => e.id === item.eraId)
        : eraAt(placedEras, item.t);
      const id = era?.id || "";
      if (id !== currentEra) {
        currentEra = id;
        out.push({ id: `era-${id || "none"}-${item.key}`, head: !!era, label: era?.name || noEraLabel,
          color: era?.color, items: [] });
      }
      out[out.length - 1].items.push(item);
    }
    // Первый заголовок ни от чего не отделяет — его убираем.
    if (out.length && out[0].head) out[0].note = true;
    return out;
  }

  const buckets = new Map();
  for (const item of items) {
    let id;
    let label;
    let color;
    if (groupBy === "type") {
      id = item.node?.typeId || "note";
      const type = typesById[id];
      label = type?.label || otherLabel;
      color = type?.color;
    } else {
      const era = item.eraId
        ? placedEras.find((e) => e.id === item.eraId)
        : eraAt(placedEras, item.t);
      id = era?.id || "";
      label = era?.name || noEraLabel;
      color = era?.color;
    }
    if (!buckets.has(id)) buckets.set(id, { id, head: true, label, color, items: [] });
    buckets.get(id).items.push(item);
  }

  const out = [...buckets.values()];
  // Эпохи — по времени, типы — по населённости: у эпох есть свой порядок,
  // у типов его нет, и алфавитный здесь никому не помогает.
  if (groupBy === "era") {
    const order = new Map(placedEras.map((e, i) => [e.id, i]));
    out.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  } else {
    out.sort((a, b) => b.items.length - a.items.length);
  }
  return out;
}
