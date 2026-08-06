// Дата события.
//
// Даты писателя редко бывают точными. «Где-то в третьем веке», «незадолго до
// войны», «через пять дней после коронации», «между сороковым и шестидесятым»,
// «неизвестно, но точно в Тёмные века» — всё это законные даты, и все они
// должны попадать на шкалу в правильном месте.
//
// Поэтому дата здесь — не число и не строка, а пара «якорь + оговорка»:
//
//   якорь    — либо разложенная дата {y, m, d}, либо ссылка на другой узел
//              со сдвигом («+5 дней после...»);
//   оговорка — kind: точно, приблизительно, до, после, между, неизвестно.
//
// Эти два измерения независимы, и из их сочетаний получается всё
// вышеперечисленное — включая «приблизительно через год после коронации»,
// которое ни в один плоский список видов дат не поместилось бы.
import {
  addDuration, DURATION_UNITS, durationInDays, formatParts, fromDayIndex,
  partsSpan, precisionOf,
} from "./calendar";
import { eraAt, toEraYear } from "./eras";
import { t } from "@/lib/i18n";

/** Оговорка: что именно мы знаем про положение якоря во времени. */
export const DATE_KINDS = ["exact", "approx", "before", "after", "between", "unknown"];

/** Именованные даты узла. Список открытый: `key` может быть любым, эти —
 *  просто те, у которых есть готовая подпись и свой смысл в интерфейсе. */
export const ENTRY_KEYS = [
  "date", "birth", "death", "started", "ended",
  "created", "discovery", "construction", "custom",
];

/** Ключи, по которым персонажу считается возраст. */
export const BIRTH_KEY = "birth";
export const DEATH_KEY = "death";

// Number(null) и Number("") равны нулю, а нуль — это законный год. Поэтому
// «ничего не указано» отсеивается до преобразования: иначе дата точностью в год
// при первой же правке обзаводится нулевым днём нулевого месяца.
const num = (v) => {
  if (v == null || v === "") return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
};

const str = (v) => (typeof v === "string" ? v : "");

function normalizeRel(rel) {
  if (!rel || typeof rel !== "object" || !rel.nodeId) return null;
  return {
    nodeId: String(rel.nodeId),
    // null — «главная дата того узла»: ссылка переживает переименование
    // и пересортировку записей.
    entryId: rel.entryId == null ? null : String(rel.entryId),
    edge: rel.edge === "end" ? "end" : "start",
    amount: num(rel.amount) ?? 0,
    unit: DURATION_UNITS.includes(rel.unit) ? rel.unit : "day",
    dir: rel.dir === "before" ? "before" : "after",
  };
}

function normalizeSpread(spread) {
  if (!spread || typeof spread !== "object") return null;
  const amount = Math.abs(num(spread.amount) ?? 0);
  if (!amount) return null;
  return { amount, unit: DURATION_UNITS.includes(spread.unit) ? spread.unit : "year" };
}

/** Привести значение даты к каноническому виду. Всё, что приходит из базы,
 *  проходит здесь: записи могли быть сделаны прежней версией или руками. */
export function normalizeDate(value) {
  if (!value || typeof value !== "object") return null;
  const kind = DATE_KINDS.includes(value.kind) ? value.kind : "exact";
  const out = {
    kind,
    y: num(value.y),
    m: num(value.m),
    d: num(value.d),
    rel: normalizeRel(value.rel),
    eraId: value.eraId ? String(value.eraId) : null,
    raw: str(value.raw),
  };
  // День без месяца — не точность, а мусор: месяц обязателен, чтобы день
  // что-то значил.
  if (out.m == null) out.d = null;
  if (kind === "approx") out.spread = normalizeSpread(value.spread);
  if (kind === "between") {
    out.y2 = num(value.y2);
    out.m2 = num(value.m2);
    out.d2 = num(value.d2);
    if (out.m2 == null) out.d2 = null;
    out.rel2 = normalizeRel(value.rel2);
  }
  return out;
}

/** Пустая дата: якоря нет, и нечего искать. У «неизвестно» якоря не бывает
 *  по определению — она держится либо на эпохе, либо ни на чём. */
export function isDateEmpty(value) {
  if (!value) return true;
  if (value.kind === "unknown") return !value.eraId && !value.raw;
  return value.y == null && !value.rel;
}

export function emptyDate(kind = "exact") {
  return normalizeDate({ kind });
}

/** Есть ли у даты якорь-ссылка (в любой из позиций). */
export function dateRefs(value) {
  if (!value) return [];
  return [value.rel, value.rel2].filter(Boolean);
}

// ------------------------------------------------------------------ записи

/**
 * Привести список дат узла к каноническому виду.
 * Узел хранит их массивом: рождение, смерть, начало, конец, «обнаружено» и
 * что угодно ещё — каждая попадёт на общую шкалу отдельной отметкой.
 */
export function normalizeEntries(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    let id = String(raw.id || `e${i}`);
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const start = normalizeDate(raw.start);
    const end = normalizeDate(raw.end);
    if (!start && !end) return;
    out.push({
      id,
      key: str(raw.key) || "date",
      label: str(raw.label),
      start: start || emptyDate(),
      end: end && !isDateEmpty(end) ? end : null,
    });
  });
  return out;
}

/** Подпись записи: своя, если задана, иначе готовая для известного ключа. */
export function entryLabel(entry) {
  if (entry?.label) return entry.label;
  const key = entry?.key || "date";
  const known = t(`chrono.entry.${key}`);
  return known === `chrono.entry.${key}` ? key : known;
}

// ------------------------------------------------------------- вычисленное

/**
 * Разрешённая дата: где она стоит на шкале и насколько мы в этом уверены.
 *
 * @typedef {object} Resolved
 * @property {boolean} ok    удалось ли поставить хоть куда-то
 * @property {?number} t     точка, по которой дата сортируется и рисуется
 * @property {number} lo     левый край неопределённости (может быть -Infinity)
 * @property {number} hi     правый край (может быть +Infinity)
 * @property {string} kind   оговорка, с которой дату записали
 * @property {string} precision  'day' | 'month' | 'year' | 'era' | 'none'
 * @property {?string} eraId эпоха, если дата привязана к ней явно
 * @property {?string} error 'empty' | 'missing' | 'cycle' | 'chain'
 */

export const UNRESOLVED = Object.freeze({
  ok: false, t: null, lo: -Infinity, hi: Infinity,
  kind: "unknown", precision: "none", eraId: null, error: "empty",
});

export function unresolved(error, eraId = null) {
  return { ...UNRESOLVED, error, eraId };
}

/**
 * Якорь — то, к чему дата привязана, до всяких оговорок.
 *
 * @typedef {object} Anchor
 * @property {number} a  первый день промежутка, который занимает якорь
 * @property {number} b  последний день (для «1024 года» это весь год)
 * @property {number} lo унаследованная неопределённость слева
 * @property {number} hi и справа: ссылка на приблизительную дату
 *                       остаётся приблизительной, куда её ни сдвинь
 * @property {string} precision
 */

/**
 * Якорь из разложенной даты: промежуток, который она занимает.
 *
 * @param {number} [yearOffset] сдвиг собственного счёта эпохи. Год «412» в
 *   эпохе, считающей годы от себя, — это не 412-й год мира; пересчёт делает
 *   вызывающая сторона, потому что только она знает про эпохи.
 */
export function partsAnchor(cal, value, second = false, yearOffset = 0) {
  const y = second ? value.y2 : value.y;
  if (y == null) return null;
  const parts = second
    ? { y: y + yearOffset, m: value.m2, d: value.d2 }
    : { y: y + yearOffset, m: value.m, d: value.d };
  const [a, b] = partsSpan(cal, parts);
  return { a, b, lo: a, hi: b, precision: precisionOf(parts) };
}

/** Якорь из ссылки: точка другого события, сдвинутая на срок. */
export function relAnchor(cal, rel, base) {
  if (!base || !base.ok || base.t == null) return null;
  const sign = rel.dir === "before" ? -1 : 1;
  const at = addDuration(cal, base.t, sign * rel.amount, rel.unit);
  const shift = at - base.t;
  const move = (v) => (Number.isFinite(v) ? v + shift : v);
  return {
    a: at, b: at,
    // Неопределённость основы едет вместе с ней: «через пять дней после
    // события, которое само известно с точностью до года» — тоже год.
    lo: move(base.lo), hi: move(base.hi),
    precision: base.precision,
  };
}

/**
 * Наложить оговорку на якорь и получить итоговую дату.
 *
 * «До» уводит левый край в минус бесконечность, «после» — правый в плюс,
 * «около» раздвигает оба на заданный допуск, «между» склеивает два якоря.
 * Точка `t` — та, по которой дата сортируется и рисуется: у «до» это начало
 * якоря, у «после» — конец, у «между» — середина промежутка.
 */
export function applyKind(cal, value, anchor, anchor2) {
  const kind = value.kind;
  const base = { ok: true, kind, precision: anchor.precision, eraId: value.eraId || null, error: null };

  if (kind === "between" && anchor2) {
    const lo = Math.min(anchor.lo, anchor2.lo);
    const hi = Math.max(anchor.hi, anchor2.hi);
    return { ...base, t: Math.round((lo + hi) / 2), lo, hi };
  }
  if (kind === "before") return { ...base, t: anchor.a, lo: -Infinity, hi: anchor.hi };
  if (kind === "after") return { ...base, t: anchor.b, lo: anchor.lo, hi: Infinity };
  if (kind === "approx") {
    const pad = value.spread ? durationInDays(cal, value.spread.amount, value.spread.unit) : 0;
    return {
      ...base,
      t: Math.round((anchor.a + anchor.b) / 2),
      lo: anchor.lo - pad,
      hi: anchor.hi + pad,
    };
  }
  // exact: точка — начало промежутка, но занимает дата его целиком, потому
  // что «1024 год» без месяца — это и правда весь год.
  return { ...base, t: anchor.a, lo: anchor.lo, hi: anchor.hi };
}

// ------------------------------------------------------------ подписи даты

/**
 * Человеческая подпись даты: то, что писатель увидит на карточке.
 *
 * @param {object} cal   нормализованный календарь
 * @param {object} value значение даты
 * @param {object} ctx   {eraName(id), nodeTitle(id), resolved}
 */
export function formatDate(cal, value, ctx = {}) {
  if (!value) return "";
  const eraName = value.eraId ? ctx.eraName?.(value.eraId) || "" : "";

  if (value.kind === "unknown" || isDateEmpty(value)) {
    if (value.raw) return value.raw;
    if (eraName) return eraName;
    return t("chrono.kind.unknown");
  }

  const anchorText = (which) => {
    const rel = which === "2" ? value.rel2 : value.rel;
    if (rel) return relText(cal, rel, ctx);
    const parts = which === "2"
      ? { y: value.y2, m: value.m2, d: value.d2 }
      : { y: value.y, m: value.m, d: value.d };
    if (parts.y == null) return "";
    return formatParts(cal, parts, { eraName, precision: precisionOf(parts) });
  };

  const main = anchorText("");
  if (!main) return eraName || t("chrono.kind.unknown");
  if (value.kind === "before") return t("chrono.kind.beforeX", { date: main });
  if (value.kind === "after") return t("chrono.kind.afterX", { date: main });
  if (value.kind === "approx") return t("chrono.kind.approxX", { date: main });
  if (value.kind === "between") {
    const second = anchorText("2");
    return second ? t("chrono.kind.betweenX", { from: main, to: second }) : main;
  }
  return main;
}

/** «через 5 дней после Битвы» — подпись ссылки. */
function relText(cal, rel, ctx) {
  const amount = rel.amount ? t(`chrono.unit.${rel.unit}`, { count: rel.amount }) : "";
  // Ссылка на собственное начало — самый частый способ задать длительность
  // («строили три года»). Повторять в ней название узла незачем: получилось
  // бы «через три года после Сумрачной башни» на карточке этой же башни.
  if (ctx.selfId && rel.nodeId === ctx.selfId) {
    if (!amount) return t("chrono.rel.sameMoment");
    return t(rel.dir === "before" ? "chrono.rel.earlierBy" : "chrono.rel.laterBy", { amount });
  }
  const node = ctx.nodeTitle?.(rel.nodeId) || t("common.untitled");
  if (!amount) {
    return t(rel.edge === "end" ? "chrono.rel.atEndOf" : "chrono.rel.atStartOf", { node });
  }
  return t(rel.dir === "before" ? "chrono.rel.beforeNode" : "chrono.rel.afterNode",
    { amount, node });
}

/**
 * Подпись уже посчитанного момента.
 *
 * Обратный путь: из индекса дня — в те самые числа, какими эту дату написал бы
 * автор, вместе с эпохой и её собственным счётом лет. Нужна там, где дата
 * получилась вычислением: «через пять дней после коронации» — это хорошо, но
 * увидеть, какое это число, всё равно хочется.
 */
export function formatAt(cal, placedEras, dayIndex, precision = "day") {
  if (dayIndex == null || !Number.isFinite(dayIndex)) return "";
  const era = eraAt(placedEras, dayIndex);
  const parts = fromDayIndex(cal, dayIndex);
  const y = era ? toEraYear(era, parts.y) : parts.y;
  return formatParts(cal, { ...parts, y }, { eraName: era?.name || "", precision });
}

/** Короткая подпись для карточки: диапазон печатается одной строкой. */
export function formatRange(cal, entry, ctx = {}) {
  const start = formatDate(cal, entry.start, ctx);
  if (!entry.end) return start;
  const end = formatDate(cal, entry.end, ctx);
  return end && end !== start ? `${start} → ${end}` : start;
}
