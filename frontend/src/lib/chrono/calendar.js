// Календарь выдуманного мира.
//
// Здесь нет ни одного земного допущения: год — это просто список месяцев,
// у каждого своё число дней, неделя любой длины, високосное правило
// необязательно. Земной календарь существует только как один из пресетов,
// наравне с миром из пяти сезонов по шестьдесят дней.
//
// Вся арифметика сводится к одному числу — **индексу дня**: сколько дней
// прошло от начала года 0. Это целое число, монотонное по времени, поэтому
// сортировка, сравнение, расстояния и позиция на шкале — всё считается по
// нему, а месяцы и названия нужны только на входе и на выходе.
import { t, tList } from "@/lib/i18n";

/** Сколько кратных `step` чисел лежит в промежутке [0, y). Для отрицательных
 *  y — столько же со знаком минус. Работает без ветвлений на знак. */
const multiples = (y, step) => (step > 0 ? Math.ceil(y / step) : 0);

const clampInt = (v, lo, hi, fallback = lo) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

const slug = (s, i) => `${String(s || "m").toLowerCase().replace(/[^a-z0-9]+/g, "") || "m"}${i}`;

// ---------------------------------------------------------------- пресеты

/** Двенадцать месяцев и семидневная неделя — привычная сетка для
 *  исторической прозы и альтернативных историй. Такой же пресет, как и все
 *  остальные: любое поле правится, ничего в движке про него не зашито. */
export function standardCalendar() {
  const names = tList("chrono.preset.standard.months");
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return {
    id: "standard",
    name: t("chrono.preset.standard.name"),
    // Считаем по числам дней, а не по подписям: длина списка названий
    // приходит из локали, и перевод не должен уметь менять длину года.
    months: days.map((count, i) => {
      const name = String(names[i] ?? i + 1);
      return { id: slug(name, i), name, short: name.slice(0, 3), days: count };
    }),
    week: { length: 7, dayNames: tList("chrono.preset.standard.days") },
    seasons: seasonsAt(tList("chrono.preset.standard.seasons"), [[11, 1], [2, 1], [5, 1], [8, 1]],
      ["#60a5fa", "#4ade80", "#fbbf24", "#fb923c"]),
    leap: { enabled: true, cycle: 4, exceptions: [100], reinstate: [400], monthIndex: 1, days: 1 },
    format: { long: "{day} {monthName} {year} {era}", short: "{day}.{month2}.{year}", year: "{year} {era}" },
  };
}

/** Пять сезонов по шестьдесят дней, десятидневные недели — типовая
 *  фэнтезийная сетка. */
export function seasonsCalendar() {
  const names = tList("chrono.preset.seasons.months");
  return {
    id: "seasons",
    name: t("chrono.preset.seasons.name"),
    months: names.map((name, i) => ({ id: slug(name, i), name, short: name.slice(0, 2), days: 60 })),
    week: { length: 10, dayNames: [] },
    seasons: names.map((name, i) => ({
      id: `s${i}`, name, color: ["#60a5fa", "#4ade80", "#f87171", "#fbbf24", "#a78bfa"][i % 5],
      startMonth: i, startDay: 1,
    })),
    leap: { enabled: false, cycle: 4, exceptions: [], reinstate: [], monthIndex: 0, days: 1 },
    format: { long: "{day} {monthName}, {year} {era}", short: "{day} {monthShort} {year}", year: "{year} {era}" },
  };
}

/** Три безымянных отрезка по сто дней: мир, где времени дали только счёт. */
export function cyclesCalendar() {
  const names = tList("chrono.preset.cycles.months");
  return {
    id: "cycles",
    name: t("chrono.preset.cycles.name"),
    months: names.map((name, i) => ({ id: `c${i}`, name, short: `${i + 1}`, days: 100 })),
    week: { length: 10, dayNames: [] },
    seasons: [],
    leap: { enabled: false, cycle: 4, exceptions: [], reinstate: [], monthIndex: 0, days: 1 },
    format: { long: "{monthName}, {day} — {year} {era}", short: "{year}/{month}/{day}", year: "{year} {era}" },
  };
}

/** Только годы: ни месяцев, ни недель. Хроника, где дат мельче года не бывает. */
export function yearsOnlyCalendar() {
  return {
    id: "years",
    name: t("chrono.preset.years.name"),
    months: [{ id: "year", name: t("chrono.preset.years.month"), short: "", days: 360 }],
    week: { length: 0, dayNames: [] },
    seasons: [],
    leap: { enabled: false, cycle: 4, exceptions: [], reinstate: [], monthIndex: 0, days: 1 },
    format: { long: "{year} {era}", short: "{year}", year: "{year} {era}" },
  };
}

/** Сезоны из подписей и точек начала. Список подписей приходит из локали —
 *  берём столько, сколько есть точек, чтобы перевод не мог уронить календарь. */
function seasonsAt(names, starts, colors) {
  return starts.map(([startMonth, startDay], i) => ({
    id: `s${i}`,
    name: String(names?.[i] ?? ""),
    color: colors[i % colors.length],
    startMonth,
    startDay,
  }));
}

export const CALENDAR_PRESETS = [
  { id: "standard", build: standardCalendar },
  { id: "seasons", build: seasonsCalendar },
  { id: "cycles", build: cyclesCalendar },
  { id: "years", build: yearsOnlyCalendar },
];

export const FORMAT_PRESETS = [
  "{day} {monthName} {year} {era}",
  "{day} {monthName}, {year} {era}",
  "{monthName} {day}, {year} {era}",
  "{year}-{month2}-{day2}",
  "{day}.{month2}.{year}",
  "{year} {era}, {monthShort} {day}",
];

// ------------------------------------------------------------- нормализация

/**
 * Привести календарь к полному и непротиворечивому виду.
 *
 * Календарь приходит из базы: он мог быть записан старой версией, руками или
 * наполовину. Ни одна функция ниже не проверяет входные данные — вместо этого
 * всё, что попадает в движок, проходит здесь.
 */
export function normalizeCalendar(input) {
  const raw = input && typeof input === "object" ? input : {};
  const months = (Array.isArray(raw.months) ? raw.months : [])
    .map((m, i) => ({
      id: String(m?.id || slug(m?.name, i)),
      name: String(m?.name ?? `${i + 1}`),
      short: String(m?.short ?? ""),
      // Месяц без дней сломал бы всю арифметику: год стал бы нулевой длины.
      days: clampInt(m?.days, 1, 100000, 30),
    }));
  if (!months.length) months.push({ id: "year", name: "", short: "", days: 360 });

  const weekLength = clampInt(raw.week?.length, 0, 1000, 0);
  const dayNames = (Array.isArray(raw.week?.dayNames) ? raw.week.dayNames : [])
    .slice(0, weekLength).map((d) => String(d ?? ""));
  while (dayNames.length < weekLength) dayNames.push("");

  const leapRaw = raw.leap || {};
  const leap = {
    enabled: !!leapRaw.enabled,
    cycle: clampInt(leapRaw.cycle, 1, 100000, 4),
    exceptions: (Array.isArray(leapRaw.exceptions) ? leapRaw.exceptions : [])
      .map((n) => clampInt(n, 1, 100000, 0)).filter(Boolean),
    reinstate: (Array.isArray(leapRaw.reinstate) ? leapRaw.reinstate : [])
      .map((n) => clampInt(n, 1, 100000, 0)).filter(Boolean),
    monthIndex: clampInt(leapRaw.monthIndex, 0, months.length - 1, 0),
    days: clampInt(leapRaw.days, 1, 1000, 1),
  };

  const seasons = (Array.isArray(raw.seasons) ? raw.seasons : []).map((s, i) => {
    const startMonth = clampInt(s?.startMonth, 0, months.length - 1, 0);
    return {
      id: String(s?.id || `s${i}`),
      name: String(s?.name ?? ""),
      color: String(s?.color || "#64748b"),
      startMonth,
      startDay: clampInt(s?.startDay, 1, months[startMonth].days, 1),
    };
  });

  const fmt = raw.format || {};
  return {
    id: String(raw.id || "custom"),
    name: String(raw.name ?? ""),
    months,
    week: { length: weekLength, dayNames },
    seasons,
    leap,
    format: {
      long: String(fmt.long || "{day} {monthName} {year} {era}"),
      short: String(fmt.short || "{day}.{month2}.{year}"),
      year: String(fmt.year || "{year} {era}"),
    },
  };
}

/** Календарь проекта. `null` в настройках — «пользователь ничего не менял»:
 *  подставляем стандартный на языке интерфейса, как и типы узлов. */
export function resolveCalendar(settings) {
  return normalizeCalendar(settings?.calendar || standardCalendar());
}

// -------------------------------------------------------------- арифметика

/** Длина года без високосной поправки. */
export function baseYearLength(cal) {
  let sum = 0;
  for (const m of cal.months) sum += m.days;
  return sum;
}

export function isLeapYear(cal, year) {
  const { enabled, cycle, exceptions, reinstate } = cal.leap;
  if (!enabled) return false;
  if (reinstate.some((r) => year % r === 0)) return true;
  if (exceptions.some((e) => year % e === 0)) return false;
  return year % cycle === 0;
}

/** Сколько високосных лет в промежутке [0, year). Замкнутая формула, а не
 *  цикл: год 40 000-й должен считаться так же быстро, как пятый. */
function leapYearsBefore(cal, year) {
  const { enabled, cycle, exceptions, reinstate } = cal.leap;
  if (!enabled) return 0;
  let n = multiples(year, cycle);
  for (const e of exceptions) n -= multiples(year, e);
  for (const r of reinstate) n += multiples(year, r);
  return n;
}

export function monthLength(cal, monthIndex, year) {
  const m = cal.months[monthIndex];
  if (!m) return 0;
  return m.days + (monthIndex === cal.leap.monthIndex && isLeapYear(cal, year) ? cal.leap.days : 0);
}

export function daysInYear(cal, year) {
  return baseYearLength(cal) + (isLeapYear(cal, year) ? cal.leap.days : 0);
}

/** Средняя длина года — нужна для первой прикидки при обратном переводе и
 *  для перевода «примерно ±3 года» в дни. */
export function avgYearLength(cal) {
  const { enabled, cycle, exceptions, reinstate, days } = cal.leap;
  if (!enabled) return baseYearLength(cal);
  let rate = 1 / cycle;
  for (const e of exceptions) rate -= 1 / e;
  for (const r of reinstate) rate += 1 / r;
  return baseYearLength(cal) + rate * days;
}

export function startOfYear(cal, year) {
  return year * baseYearLength(cal) + leapYearsBefore(cal, year) * cal.leap.days;
}

/**
 * Структурная дата -> индекс дня.
 * @param {{y:number,m:?number,d:?number}} parts месяц и день необязательны:
 *   их отсутствие означает точность «год» или «месяц», и дата сворачивается
 *   к своему первому дню.
 */
export function toDayIndex(cal, parts) {
  const year = Math.trunc(parts?.y ?? 0);
  let n = startOfYear(cal, year);
  const mi = Math.min(Math.max(Math.trunc(parts?.m ?? 0) || 0, 0), cal.months.length - 1);
  for (let i = 0; i < mi; i += 1) n += monthLength(cal, i, year);
  const maxDay = monthLength(cal, mi, year);
  const day = Math.min(Math.max(Math.trunc(parts?.d ?? 1) || 1, 1), maxDay);
  return n + day - 1;
}

/** Индекс дня -> структурная дата. Обратная к toDayIndex. */
export function fromDayIndex(cal, index) {
  const n = Math.round(index);
  const base = baseYearLength(cal);
  let year = Math.floor(n / (avgYearLength(cal) || base));
  // Прикидка по средней длине года промахивается на год-другой; правим шагом.
  while (startOfYear(cal, year) > n) year -= 1;
  while (startOfYear(cal, year + 1) <= n) year += 1;
  let rest = n - startOfYear(cal, year);
  let m = 0;
  for (; m < cal.months.length - 1; m += 1) {
    const len = monthLength(cal, m, year);
    if (rest < len) break;
    rest -= len;
  }
  return { y: year, m, d: rest + 1 };
}

/** Промежуток, который занимает дата с учётом её точности: год целиком,
 *  месяц целиком или один день. Возвращает [первый день, последний день]. */
export function partsSpan(cal, parts) {
  const y = Math.trunc(parts?.y ?? 0);
  const hasMonth = parts?.m != null;
  const hasDay = parts?.d != null;
  if (!hasMonth) return [startOfYear(cal, y), startOfYear(cal, y + 1) - 1];
  const start = toDayIndex(cal, { y, m: parts.m, d: 1 });
  if (!hasDay) return [start, start + monthLength(cal, parts.m, y) - 1];
  const day = toDayIndex(cal, parts);
  return [day, day];
}

export function precisionOf(parts) {
  if (parts?.d != null) return "day";
  if (parts?.m != null) return "month";
  return "year";
}

export const DURATION_UNITS = ["day", "week", "month", "year"];

/** Прибавить к индексу дня N единиц календаря. Месяцы и годы считаются по
 *  структуре (31-е число в коротком месяце прижимается к последнему дню),
 *  дни и недели — простым сложением. */
export function addDuration(cal, index, amount, unit) {
  const n = Math.round(amount) || 0;
  if (!n) return index;
  if (unit === "day") return index + n;
  if (unit === "week") return index + n * (cal.week.length || 1);
  const parts = fromDayIndex(cal, index);
  if (unit === "year") {
    const y = parts.y + n;
    return toDayIndex(cal, { y, m: parts.m, d: Math.min(parts.d, monthLength(cal, parts.m, y)) });
  }
  const total = parts.y * cal.months.length + parts.m + n;
  const y = Math.floor(total / cal.months.length);
  const m = ((total % cal.months.length) + cal.months.length) % cal.months.length;
  return toDayIndex(cal, { y, m, d: Math.min(parts.d, monthLength(cal, m, y)) });
}

/** Сколько это примерно дней — для «около 300 года» и подобных допусков. */
export function durationInDays(cal, amount, unit) {
  const n = Math.abs(Math.round(amount) || 0);
  if (unit === "day") return n;
  if (unit === "week") return n * (cal.week.length || 1);
  if (unit === "month") return Math.round(n * (baseYearLength(cal) / cal.months.length));
  return Math.round(n * avgYearLength(cal));
}

export function weekdayIndex(cal, index) {
  const len = cal.week.length;
  if (!len) return null;
  return ((Math.round(index) % len) + len) % len;
}

export function weekdayName(cal, index) {
  const i = weekdayIndex(cal, index);
  if (i == null) return "";
  return cal.week.dayNames[i] || t("chrono.dayN", { n: i + 1 });
}

/** Сезон, на который приходится дата. Сезоны заданы точками начала внутри
 *  года и по кругу делят его между собой — включая тот, что начинается в
 *  конце года и переваливает через его границу. */
export function seasonOf(cal, parts) {
  if (!cal.seasons.length) return null;
  const y = Math.trunc(parts?.y ?? 0);
  const start = startOfYear(cal, y);
  const dayOfYear = toDayIndex(cal, { y, m: parts?.m ?? 0, d: parts?.d ?? 1 }) - start;
  const marks = cal.seasons
    .map((s) => ({ s, at: toDayIndex(cal, { y, m: s.startMonth, d: s.startDay }) - start }))
    .sort((a, b) => a.at - b.at);
  let current = marks[marks.length - 1].s; // до первой отметки идёт последний сезон
  for (const mark of marks) {
    if (mark.at <= dayOfYear) current = mark.s;
    else break;
  }
  return current;
}

// ------------------------------------------------------------ форматирование

const TOKEN = /\{(\w+)\}/g;
const PUNCT_ONLY = /^[\s.,;:/|()[\]«»"'—–-]*$/;

/**
 * Разобрать шаблон на куски: постоянный текст и токены.
 * Делается один раз на шаблон и запоминается — форматирование даты вызывается
 * на каждой карточке шкалы, а шаблон меняется раз в жизни проекта.
 */
const patternCache = new Map();

function parsePattern(pattern) {
  const cached = patternCache.get(pattern);
  if (cached) return cached;
  const parts = [];
  let last = 0;
  for (const m of String(pattern).matchAll(TOKEN)) {
    if (m.index > last) parts.push({ lit: pattern.slice(last, m.index) });
    parts.push({ token: m[1], raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < pattern.length) parts.push({ lit: pattern.slice(last) });
  if (patternCache.size > 200) patternCache.clear();
  patternCache.set(pattern, parts);
  return parts;
}

/**
 * Собрать подпись даты по шаблону из настроек календаря.
 *
 * Токены мельче доступной точности выбрасываются — вместе с разделителями,
 * которые к ним прилипли: «около 300 года» не должно печататься как «1. .300».
 * Разделитель уходит, только если он ничего не разделяет: между двумя
 * уцелевшими токенами он остаётся на месте.
 *
 * @param {object} cal    нормализованный календарь
 * @param {object} parts  {y, m, d} — m и d могут отсутствовать
 * @param {object} [opts] {pattern, eraName, precision}
 * @returns {string} пустая строка означает «показывать нечего»
 */
export function formatParts(cal, parts, opts = {}) {
  const precision = opts.precision || precisionOf(parts);
  const pattern = opts.pattern || (precision === "year" ? cal.format.year : cal.format.long);
  const need = { day: 3, month: 2, year: 1 }[precision] || 1;
  const y = Math.trunc(parts?.y ?? 0);
  const mi = parts?.m ?? 0;
  const month = cal.months[mi] || cal.months[0];
  // Календарь из одного безымянного отрезка — это мир без месяцев: даже если
  // шаблон достался от прежнего календаря, месяц печатать нечем.
  const monthRank = cal.months.length <= 1 ? 99 : 2;

  const values = {
    day: [3, () => String(parts?.d ?? 1)],
    day2: [3, () => String(parts?.d ?? 1).padStart(2, "0")],
    month: [monthRank, () => String(mi + 1)],
    month2: [monthRank, () => String(mi + 1).padStart(2, "0")],
    monthName: [monthRank, () => month?.name || ""],
    monthShort: [monthRank, () => month?.short || month?.name || ""],
    year: [1, () => String(y)],
    yearAbs: [1, () => String(Math.abs(y))],
    era: [1, () => opts.eraName || ""],
    weekday: [3, () => weekdayName(cal, toDayIndex(cal, parts))],
    season: [2, () => seasonOf(cal, parts)?.name || ""],
  };

  const pieces = parsePattern(pattern).map((part) => {
    if (part.lit != null) return { text: part.lit, lit: true };
    const entry = values[part.token];
    if (!entry) return { text: part.raw, kept: true };   // чужой токен — не трогаем
    const [rank, read] = entry;
    const text = rank > need ? "" : read();
    return { text, kept: !!text };
  });

  // Разделитель разделяет своих соседей — и больше ничего. Он остаётся, если
  // уцелел токен слева и токен справа от него; край шаблона за соседа не
  // считается, иначе скобки в «({year})» пропали бы вместе с ним.
  const survives = (piece) => !piece || (!piece.lit && piece.kept);

  let out = "";
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    const separator = piece.lit && PUNCT_ONLY.test(piece.text);
    if (!separator || (survives(pieces[i - 1]) && survives(pieces[i + 1]))) out += piece.text;
    else out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}
