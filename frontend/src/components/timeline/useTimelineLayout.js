import { useMemo } from "react";

// Раскладка шкалы: кто в каком ряду стоит и кого сейчас видно.
//
// Событий может быть тридцать тысяч, а на экране помещается двести. Поэтому
// раскладка делится надвое:
//
//   1. Разбор по рядам — дорогой, но редкий: пересчитывается только когда
//      меняется набор событий или заметно меняется масштаб.
//   2. Отбор видимых — дешёвый, на каждое движение: двоичный поиск по началу
//      и по номеру ряда.
//
// Ряды раздаются жадно через кучу: берём ряд, освободившийся раньше всех, и
// если он свободен к началу нового события — сажаем туда. Это даёт наименьшее
// возможное число рядов за O(n log n), и — что важнее — время не зависит от
// того, сколько рядов получилось. Простой перебор рядов на плотной хронологии
// выродился бы в квадрат.

/** Насколько подробно рисуется событие — зависит от того, сколько ему досталось
 *  места на экране. */
export const DETAIL = { CARD: "card", CHIP: "chip", DOT: "dot" };

export const WIDTH_PX = { card: 208, chip: 132, dot: 14 };
export const LANE_H = { card: 52, chip: 34, dot: 18 };
const GROUP_HEAD = 26;
const GAP_PX = 8;

/** Куча минимумов по времени освобождения ряда. */
function makeHeap() {
  const ends = [];
  const lanes = [];
  const swap = (i, j) => {
    [ends[i], ends[j]] = [ends[j], ends[i]];
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  };
  return {
    get size() { return ends.length; },
    peekEnd: () => ends[0],
    peekLane: () => lanes[0],
    push(end, lane) {
      ends.push(end); lanes.push(lane);
      let i = ends.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (ends[parent] <= ends[i]) break;
        swap(parent, i);
        i = parent;
      }
    },
    pop() {
      const lastEnd = ends.pop();
      const lastLane = lanes.pop();
      if (!ends.length) return;
      ends[0] = lastEnd; lanes[0] = lastLane;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < ends.length && ends[l] < ends[small]) small = l;
        if (r < ends.length && ends[r] < ends[small]) small = r;
        if (small === i) break;
        swap(small, i);
        i = small;
      }
    },
  };
}

/**
 * Разложить набор событий по рядам.
 * Вход должен быть отсортирован по `u0`.
 */
function packLanes(entries, gapU) {
  const heap = makeHeap();
  let laneCount = 0;
  for (const entry of entries) {
    if (heap.size && heap.peekEnd() <= entry.u0) {
      entry.lane = heap.peekLane();
      heap.pop();
    } else {
      entry.lane = laneCount;
      laneCount += 1;
    }
    heap.push(entry.u1 + gapU, entry.lane);
  }
  return laneCount;
}

/**
 * Сколько рядов потребуется, если каждое событие займёт `widthU` по времени.
 *
 * Это максимум одновременно перекрывающихся событий — то самое число, в которое
 * упрётся раскладка. Считается одним проходом окном по уже отсортированным
 * началам.
 */
function laneEstimate(starts, widthU) {
  let from = 0;
  let most = 0;
  for (let i = 0; i < starts.length; i += 1) {
    while (starts[from] < starts[i] - widthU) from += 1;
    const here = i - from + 1;
    if (here > most) most = here;
  }
  return most;
}

/** Сколько рядов готовы показать, прежде чем перейти к более скупому виду. */
const MAX_LANES = 30;

/**
 * Уровень подробности.
 *
 * Мерить среднее расстояние между событиями бессмысленно: раскладка и так не
 * даёт им наезжать друг на друга, она расставляет их по рядам. Мешает не
 * теснота, а высота — когда рядов становится больше, чем помещается на экране.
 * Поэтому смотрим ровно на это: во сколько рядов выльется самый плотный
 * момент хронологии, если рисовать полноценные карточки.
 */
function detailFor(starts, zoom) {
  if (starts.length < 2) return DETAIL.CARD;
  if (laneEstimate(starts, WIDTH_PX.card / zoom) <= MAX_LANES) return DETAIL.CARD;
  if (laneEstimate(starts, WIDTH_PX.chip / zoom) <= MAX_LANES) return DETAIL.CHIP;
  return DETAIL.DOT;
}

const GROUP_NONE = { id: "", label: "", color: "" };

/**
 * Полная раскладка шкалы.
 *
 * @param {object[]} items    элементы хронологии (отсортированы по времени)
 * @param {object} scale      шкала
 * @param {number} zoom       пикселей на единицу шкалы
 * @param {string} groupBy    'none' | 'type' | 'era'
 * @param {object} context    {typesById, erasById}
 */
export function useTimelineLayout(items, scale, zoom, groupBy, context) {
  // Масштаб огрубляется: пересобирать ряды на каждый щелчок колеса не нужно,
  // а на глаз разница между соседними ступенями незаметна.
  const zoomStep = Math.round(Math.log2(Math.max(zoom, 1e-9)) * 2);

  return useMemo(() => {
    const effectiveZoom = Math.pow(2, zoomStep / 2);
    const u0s = new Float64Array(items.length);
    for (let i = 0; i < items.length; i += 1) u0s[i] = scale.project(items[i].t);

    const detail = detailFor(u0s, effectiveZoom);
    const minWidthU = WIDTH_PX[detail] / effectiveZoom;
    const gapU = GAP_PX / effectiveZoom;

    const placed = items.map((item, i) => {
      const u0 = u0s[i];
      const spanEnd = item.t2 != null && item.t2 > item.t ? scale.project(item.t2) : u0;
      return {
        item,
        u0,
        // Полоса события не короче карточки: иначе подпись некуда девать.
        u1: Math.max(spanEnd, u0 + minWidthU),
        spanU: spanEnd - u0,
        lane: 0,
        group: GROUP_NONE,
      };
    });

    // items уже отсортированы по времени, а проекция монотонна — значит,
    // placed отсортирован по u0, и сортировать заново незачем.
    const groups = [];
    let laneCount = 0;

    if (groupBy === "none") {
      laneCount = packLanes(placed, gapU);
    } else {
      const buckets = new Map();
      for (const entry of placed) {
        const group = groupOf(entry.item, groupBy, context);
        entry.group = group;
        if (!buckets.has(group.id)) buckets.set(group.id, { group, entries: [] });
        buckets.get(group.id).entries.push(entry);
      }
      const ordered = [...buckets.values()].sort((a, b) => order(a.group, b.group));
      for (const bucket of ordered) {
        const count = packLanes(bucket.entries, gapU);
        for (const entry of bucket.entries) entry.lane += laneCount;
        groups.push({ ...bucket.group, lane0: laneCount, lanes: count, count: bucket.entries.length });
        laneCount += count;
      }
    }

    const laneH = LANE_H[detail];
    const headroom = groupBy === "none" ? 0 : GROUP_HEAD;
    // Поправка на заголовки групп: у каждой группы своя полоса сверху.
    const yOf = (lane) => {
      if (groupBy === "none") return lane * laneH;
      let y = 0;
      for (const group of groups) {
        if (lane < group.lane0 + group.lanes) return y + headroom + (lane - group.lane0) * laneH;
        y += headroom + group.lanes * laneH;
      }
      return y;
    };
    for (const group of groups) group.y = yOf(group.lane0) - headroom;

    const height = groupBy === "none"
      ? laneCount * laneH
      : groups.reduce((sum, g) => sum + headroom + g.lanes * laneH, 0);

    // Поиск видимых начинается левее экрана — ровно настолько, чтобы поймать
    // полосу, которая началась за кадром и тянется в него.
    //
    // Отступать на длину самой длинной полосы нельзя: одна война на триста
    // лет заставила бы просматривать весь список на каждое движение мыши.
    // Поэтому длинные полосы — их всегда единицы — выносятся в отдельный
    // список и проверяются перебором, а для остальных хватает небольшого
    // отступа и двоичного поиска.
    const widths = placed.map((entry) => entry.u1 - entry.u0).sort((a, b) => a - b);
    const wideFrom = widths.length
      ? Math.max(widths[Math.floor(widths.length * 0.98)], minWidthU * 24)
      : Infinity;

    const narrow = [];
    const wide = [];
    for (const entry of placed) (entry.u1 - entry.u0 > wideFrom ? wide : narrow).push(entry);

    let reach = 0;
    for (const entry of narrow) reach = Math.max(reach, entry.u1 - entry.u0);

    const starts = new Float64Array(narrow.length);
    for (let i = 0; i < narrow.length; i += 1) starts[i] = narrow[i].u0;

    return {
      placed, groups, laneCount, height, detail, laneH, headroom, yOf,
      wideCount: wide.length,

      /**
       * Пройти по тому, что попадает в прямоугольник экрана.
       *
       * Без сборки массива: точечный слой вызывает это на каждый кадр
       * панорамы, и полторы тысячи лишних объектов за кадр вылились бы в
       * работу для сборщика мусора ровно тогда, когда рука ведёт мышь.
       */
      forEachVisible(uFrom, uTo, yFrom, yTo, fn) {
        const take = (entry) => {
          if (entry.u0 > uTo || entry.u1 < uFrom) return;
          const y = yOf(entry.lane);
          if (y + laneH < yFrom || y > yTo) return;
          fn(entry, y);
        };
        for (let i = lowerBound(starts, uFrom - reach); i < narrow.length; i += 1) {
          if (narrow[i].u0 > uTo) break;
          take(narrow[i]);
        }
        for (const entry of wide) take(entry);
      },

      /** То же самое массивом — для отрисовки карточек через React. */
      visible(uFrom, uTo, yFrom, yTo) {
        const out = [];
        this.forEachVisible(uFrom, uTo, yFrom, yTo, (entry, y) => out.push({ ...entry, y }));
        out.sort((a, b) => a.u0 - b.u0);
        return out;
      },
    };
  }, [items, scale, zoomStep, groupBy, context]);
}

/** Первый индекс, где arr[i] >= v. */
function lowerBound(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function groupOf(item, groupBy, context) {
  if (groupBy === "era") {
    const era = item.eraId
      ? context.erasById?.get(item.eraId)
      : context.eraAt?.(item.t);
    return era
      ? { id: era.id, label: era.name, color: era.color, sort: era.startT }
      : { id: "", label: context.noEraLabel, color: "#64748b", sort: Infinity };
  }
  const type = context.typesById?.[item.node?.typeId];
  return type
    ? { id: type.id, label: type.label, color: type.color, sort: type.order ?? 0 }
    : { id: "", label: context.otherLabel, color: "#64748b", sort: Infinity };
}

function order(a, b) {
  if (a.sort !== b.sort) return (a.sort ?? 0) - (b.sort ?? 0);
  return String(a.label).localeCompare(String(b.label));
}
