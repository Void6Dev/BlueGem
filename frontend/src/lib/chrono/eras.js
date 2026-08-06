// Эпохи — хребет хронологии.
//
// Век богов, Первая империя, Тёмные века, Новое время: крупные отрезки, на
// которые мир делится сам, и цветные полосы, по которым шкала читается с
// одного взгляда. Событие может принадлежать эпохе, даже если точной даты у
// него нет вовсе, — тогда эпоха и есть его дата, с точностью до эпохи.
//
// У эпохи есть ещё одно свойство, без которого фэнтези не живёт: собственный
// счёт лет. «Третья эпоха, 412» — это не 412-й год от начала времён, а 412-й
// от начала эпохи. Эпоха с `countsYears` пересчитывает такие годы в
// абсолютные сама, и писателю не приходится держать в голове смещение.
import { partsSpan, startOfYear } from "./calendar";

const str = (v) => (typeof v === "string" ? v : "");
// Number(null) и Number("") равны нулю, а нуль — это законный год. Поэтому
// «ничего не указано» отсеивается до преобразования: иначе дата точностью в год
// при первой же правке обзаводится нулевым днём нулевого месяца.
const num = (v) => {
  if (v == null || v === "") return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
};

/** Точка начала или конца эпохи. Эпохи намеренно не умеют ссылаться на узлы:
 *  хребет не должен зависеть от того, что на нём держится. */
function normalizeBound(value) {
  if (!value || typeof value !== "object") return null;
  const y = num(value.y);
  if (y == null) return null;
  const m = num(value.m);
  return { y, m, d: m == null ? null : num(value.d) };
}

export function normalizeEra(raw, i = 0) {
  if (!raw || typeof raw !== "object") return null;
  const start = normalizeBound(raw.start);
  return {
    id: str(raw.id) || `era${i}`,
    name: str(raw.name),
    color: str(raw.color) || "#6366f1",
    description: str(raw.description),
    icon: str(raw.icon),
    start,
    end: normalizeBound(raw.end),
    // Считает ли эпоха годы от себя («Третья эпоха, 412») или пользуется
    // общим счётом.
    countsYears: !!raw.countsYears,
  };
}

export function normalizeEras(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach((raw, i) => {
    const era = normalizeEra(raw, i);
    if (!era) return;
    while (seen.has(era.id)) era.id = `${era.id}_`;
    seen.add(era.id);
    out.push(era);
  });
  return out;
}

/**
 * Разложить эпохи по шкале.
 *
 * Эпоха без конца тянется до начала следующей — так их и записывают: «Тёмные
 * века» кончаются там, где начинается «Новое время», и отдельной даты для
 * этого не нужно. Последняя эпоха без конца не кончается никогда.
 *
 * Эпоха без начала на шкалу не попадает, но остаётся годной как ярлык: узел
 * может на неё ссылаться, просто поставить его будет некуда.
 *
 * @returns {{list: object[], byId: Map, placed: object[]}}
 */
export function resolveEras(cal, list) {
  const eras = normalizeEras(list);
  const placed = [];
  for (const era of eras) {
    if (!era.start) continue;
    const [a] = partsSpan(cal, era.start);
    const end = era.end ? partsSpan(cal, era.end)[1] : null;
    placed.push({ ...era, startT: a, endT: end, startYear: era.start.y, explicitEnd: end != null });
  }
  placed.sort((x, y) => x.startT - y.startT || x.name.localeCompare(y.name));
  for (let i = 0; i < placed.length; i += 1) {
    if (placed[i].endT != null) continue;
    const next = placed[i + 1];
    placed[i].endT = next ? next.startT - 1 : Infinity;
  }

  const byId = new Map();
  for (const era of eras) byId.set(era.id, era);
  for (const era of placed) byId.set(era.id, era);
  return { list: eras, placed, byId };
}

/**
 * Эпоха, на которую приходится момент времени. Двоичный поиск по началам:
 * шкала спрашивает об этом на каждой засечке оси.
 */
export function eraAt(placed, t) {
  if (!placed.length || t == null || !Number.isFinite(t)) return null;
  let lo = 0;
  let hi = placed.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (placed[mid].startT <= t) { found = placed[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found && (found.endT == null || t <= found.endT) ? found : null;
}

/**
 * На сколько лет сдвинут собственный счёт эпохи.
 *
 * «Третья эпоха, 412» при начале эпохи в 4000 году — это 4411-й: год 1 эпохи
 * совпадает с годом её начала. У эпохи без своего счёта сдвиг нулевой.
 */
export function eraYearOffset(era) {
  if (!era || !era.countsYears || era.startYear == null) return 0;
  return era.startYear - 1;
}

/** Обратный перевод: абсолютный год -> год в счёте эпохи. Нужен, чтобы
 *  показать посчитанную дату теми же числами, какими её пишет автор. */
export function toEraYear(era, absoluteYear) {
  return absoluteYear - eraYearOffset(era);
}

/** Промежуток, который эпоха занимает на шкале, — с поправкой на то, что
 *  «до начала времён» и «до скончания века» рисовать нечем. */
export function eraSpan(era, fallbackLo, fallbackHi) {
  const a = Number.isFinite(era.startT) ? era.startT : fallbackLo;
  const b = Number.isFinite(era.endT) ? era.endT : fallbackHi;
  return [Math.min(a, b), Math.max(a, b)];
}

/** Первый день года эпохи — для подсказок в редакторе дат. */
export function eraYearStart(cal, era, eraYear) {
  return startOfYear(cal, eraYear + eraYearOffset(era));
}
