// Шкала: как время превращается в расстояние.
//
// Хронология выдуманного мира почти всегда состоит из плотных сгустков,
// разделённых пустотой: полтора десятка событий в течение одной осады, потом
// четыре тысячи лет, о которых известно только «Тёмные века», потом снова
// плотный клубок вокруг падения империи. Если раскладывать такое время
// линейно, на экране будет одна тонкая полоска и много пустоты.
//
// Поэтому шкала нелинейна: большие пустые промежутки сжимаются логарифмически,
// а плотные участки сохраняют масштаб. Порядок при этом не нарушается никогда —
// преобразование строго возрастающее, а значит, обратимо, и по позиции курсора
// всегда однозначно восстанавливается момент времени.
//
// Устроено это как кусочно-линейное отображение: массив узловых точек «время
// -> расстояние» и двоичный поиск по нему. Считается один раз на набор
// событий; зум и панорама к нему не прикасаются, поэтому таскать шкалу мышью
// можно сколь угодно быстро.
import { avgYearLength, fromDayIndex, startOfYear, toDayIndex } from "./calendar";

/** Во сколько раз промежуток должен превышать типичный, чтобы считаться
 *  пустотой и подлежать сжатию. */
const GAP_FACTOR = 12;

/** Промежутки короче этого (в днях) никогда не сжимаются: на таком масштабе
 *  сжимать нечего. */
const MIN_THRESHOLD = 2;

/**
 * Построить шкалу по набору опорных моментов.
 *
 * @param {number[]} anchors моменты, вокруг которых есть что показывать:
 *   даты событий, их концы, границы эпох. Порядок и повторы не важны.
 * @param {object} [opts]
 * @param {boolean} [opts.compress=true] сжимать пустоту (иначе — честный
 *   линейный масштаб; иногда автору нужны именно настоящие пропорции)
 * @param {number} [opts.pad] запас по краям, в днях
 */
export function buildScale(anchors, opts = {}) {
  const compress = opts.compress !== false;
  const points = uniqueSorted(anchors);

  if (points.length < 2) {
    const centre = points.length ? points[0] : 0;
    const pad = opts.pad ?? 365;
    return linearScale(centre - pad, centre + pad);
  }

  const first = points[0];
  const last = points[points.length - 1];
  const pad = opts.pad ?? Math.max(1, Math.round((last - first) * 0.02));

  if (!compress) return linearScale(first - pad, last + pad);

  const threshold = gapThreshold(points);
  const src = new Float64Array(points.length + 2);
  const dst = new Float64Array(points.length + 2);
  const gaps = [];

  src[0] = first - pad;
  dst[0] = 0;
  for (let i = 0; i < points.length; i += 1) {
    const raw = points[i] - (i === 0 ? first - pad : points[i - 1]);
    const shown = squash(raw, threshold);
    src[i + 1] = points[i];
    dst[i + 1] = dst[i] + shown;
    // Промежуток, который пришлось поджать, шкала помечает: на этом месте
    // рисуется разрыв, чтобы сжатие не выглядело подлогом.
    if (shown < raw - 0.5) {
      gaps.push({ t0: src[i], t1: points[i], u0: dst[i], u1: dst[i + 1], days: raw });
    }
  }
  const n = points.length + 1;
  src[n] = last + pad;
  dst[n] = dst[n - 1] + pad;

  return makeScale(src, dst, gaps, threshold);
}

/** Честный линейный масштаб — тот же интерфейс, без сжатия. */
function linearScale(from, to) {
  const src = Float64Array.from([from, to]);
  const dst = Float64Array.from([0, Math.max(1, to - from)]);
  return makeScale(src, dst, [], Infinity);
}

function makeScale(src, dst, gaps, threshold) {
  const n = src.length;
  const total = dst[n - 1];

  /** Момент времени -> расстояние вдоль шкалы. */
  const project = (t) => {
    if (!Number.isFinite(t)) return t > 0 ? total : 0;
    if (t <= src[0]) return dst[0] + (t - src[0]);
    if (t >= src[n - 1]) return dst[n - 1] + (t - src[n - 1]);
    const i = search(src, t);
    const width = src[i + 1] - src[i];
    if (width <= 0) return dst[i];
    return dst[i] + ((t - src[i]) / width) * (dst[i + 1] - dst[i]);
  };

  /** Расстояние -> момент времени. Нужна на каждое движение мышью: подпись
   *  под курсором, попадание клика, границы видимого куска. */
  const invert = (u) => {
    if (u <= dst[0]) return src[0] + (u - dst[0]);
    if (u >= dst[n - 1]) return src[n - 1] + (u - dst[n - 1]);
    const i = search(dst, u);
    const width = dst[i + 1] - dst[i];
    if (width <= 0) return src[i];
    return src[i] + ((u - dst[i]) / width) * (src[i + 1] - src[i]);
  };

  return {
    project, invert, gaps, total, threshold,
    domain: [src[0], src[n - 1]],
    /** Во сколько раз время в этой точке сжато против линейного масштаба.
     *  Нужно, чтобы засечки оси не лезли друг на друга внутри разрыва. */
    density(t) {
      const i = search(src, Math.max(src[0], Math.min(src[n - 1], t)));
      const width = src[i + 1] - src[i];
      return width > 0 ? (dst[i + 1] - dst[i]) / width : 1;
    },
  };
}

/** Индекс отрезка, в который попадает значение: последний i, где arr[i] <= v. */
function search(arr, v) {
  let lo = 0;
  let hi = arr.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= v) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function uniqueSorted(values) {
  const out = [];
  for (const v of values) if (v != null && Number.isFinite(v)) out.push(v);
  out.sort((a, b) => a - b);
  let write = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (i === 0 || out[i] !== out[i - 1]) out[write++] = out[i];
  }
  out.length = write;
  return out;
}

/**
 * С какого размера промежуток считать пустотой.
 *
 * Берём медиану промежутков — она устойчива к тому, что события сбиты в
 * кучки, — и объявляем пустотой всё, что превышает её на порядок. Мир с
 * событиями раз в день и мир с событиями раз в столетие получат разные
 * пороги, и оба будут смотреться правильно.
 */
function gapThreshold(points) {
  const gaps = [];
  for (let i = 1; i < points.length; i += 1) {
    const g = points[i] - points[i - 1];
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return Infinity;
  gaps.sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  return Math.max(MIN_THRESHOLD, median * GAP_FACTOR);
}

/** Сжать промежуток. До порога — как есть, дальше логарифм: миллион лет и
 *  два миллиона будут различимы, но не в два раза. */
function squash(gap, threshold) {
  if (!(gap > threshold) || !Number.isFinite(threshold)) return Math.max(gap, 0);
  return threshold * (1 + Math.log1p((gap - threshold) / threshold));
}

// ---------------------------------------------------------------- засечки

const NICE_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 50000, 100000];

/**
 * Засечки оси для видимого куска шкалы.
 *
 * Шаг подбирается так, чтобы подписи стояли не чаще, чем `minGap` пикселей, —
 * и внутри сжатого разрыва засечки прореживаются сами собой, потому что
 * проверка идёт уже по экранным координатам.
 *
 * @param {object} cal    календарь мира
 * @param {object} scale  шкала
 * @param {number} t0,t1  видимый промежуток времени
 * @param {number} pxPerUnit  сколько пикселей в единице шкалы (зум)
 * @param {number} [minGap=90] минимальное расстояние между подписями
 */
export function axisTicks(cal, scale, t0, t1, pxPerUnit, minGap = 90) {
  const out = [];
  if (!(t1 > t0)) return out;
  const yearLen = avgYearLength(cal);
  const visibleYears = (t1 - t0) / yearLen;
  // Сколько подписей влезет по ширине — от этого и пляшем.
  const room = Math.max(1, ((scale.project(t1) - scale.project(t0)) * pxPerUnit) / minGap);

  if (visibleYears / room < 1) {
    const perMonth = yearLen / cal.months.length;
    if ((t1 - t0) / perMonth / room < 1 && cal.months.length > 1) return dayTicks(cal, scale, t0, t1, room, out);
    return monthTicks(cal, scale, t0, t1, room, out);
  }
  return yearTicks(cal, scale, t0, t1, room, out);
}

function niceStep(span, room) {
  const raw = span / room;
  for (const step of NICE_STEPS) if (step >= raw) return step;
  return NICE_STEPS[NICE_STEPS.length - 1];
}

function yearTicks(cal, scale, t0, t1, room, out) {
  const y0 = fromDayIndex(cal, t0).y;
  const y1 = fromDayIndex(cal, t1).y;
  const step = niceStep(y1 - y0 + 1, room);
  const from = Math.floor(y0 / step) * step;
  for (let y = from; y <= y1 + step; y += step) {
    out.push({ t: startOfYear(cal, y), unit: "year", y, major: true });
  }
  return out;
}

function monthTicks(cal, scale, t0, t1, room, out) {
  const a = fromDayIndex(cal, t0);
  const b = fromDayIndex(cal, t1);
  const count = cal.months.length;
  const first = a.y * count + a.m;
  const lastOne = b.y * count + b.m;
  const step = niceStep(lastOne - first + 1, room);
  for (let i = Math.floor(first / step) * step; i <= lastOne + step; i += step) {
    const y = Math.floor(i / count);
    const m = ((i % count) + count) % count;
    out.push({ t: toDayIndex(cal, { y, m, d: 1 }), unit: "month", y, m, major: m === 0 });
  }
  return out;
}

function dayTicks(cal, scale, t0, t1, room, out) {
  const step = niceStep(t1 - t0 + 1, room);
  const from = Math.floor(t0 / step) * step;
  for (let t = from; t <= t1 + step; t += step) {
    const parts = fromDayIndex(cal, t);
    out.push({ t, unit: "day", ...parts, major: parts.d === 1 });
  }
  return out;
}
