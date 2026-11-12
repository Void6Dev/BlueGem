// Правка дат по шкале: перетаскивание события и сдвиг на шаг.
//
// Дата записана так, как её записал автор: годом, месяцем, днём или
// «через пять дней после коронации». Правка должна сохранять этот вид —
// событие «в 1024 году», перетащенное на шкале, остаётся датой точностью в
// год, а не превращается в «12 Инея 1031». Относительная дата меняет срок,
// а не становится абсолютной: связь с основой важнее места на шкале.
import {
  avgYearLength, durationInDays, fromDayIndex, monthLength, toDayIndex,
} from "./calendar";
import { eraYearOffset } from "./eras";

/** Можно ли двигать дату: у «неизвестно» и пустой даты якоря нет. */
export function canMove(value) {
  return !!value && value.kind !== "unknown" && (value.y != null || !!value.rel);
}

/** Шаг даты: та точность, с которой её записали. */
export function stepOf(value) {
  if (value?.rel) return value.rel.unit;
  if (value?.d != null) return "day";
  if (value?.m != null) return "month";
  return "year";
}

/** Новая дата в точке шкалы: точная, с заданной точностью. */
export function valueAt(cal, t, precision = "year", era = null) {
  const p = fromDayIndex(cal, t);
  const offset = eraYearOffset(era);
  return {
    kind: "exact",
    y: p.y - offset,
    m: precision === "year" ? null : p.m,
    d: precision === "day" ? p.d : null,
    rel: null,
    eraId: era?.id || null,
    raw: "",
  };
}

/**
 * Части даты, сдвинутые на delta дней, с округлением до своей точности:
 * год, сдвинутый на 200 дней из 360, становится следующим годом, а не тем же.
 */
function shiftParts(cal, y, m, d, delta, offset) {
  const start = toDayIndex(cal, { y: y + offset, m: m ?? 0, d: d ?? 1 });
  const p = fromDayIndex(cal, start + delta);
  if (m == null) {
    const yearLen = avgYearLength(cal);
    const into = start + delta - toDayIndex(cal, { y: p.y, m: 0, d: 1 });
    return { y: p.y - offset + (into > yearLen / 2 ? 1 : 0), m: null, d: null };
  }
  if (d == null) {
    const len = monthLength(cal, p.m, p.y);
    if (p.d - 1 > len / 2) {
      const next = fromDayIndex(cal, toDayIndex(cal, { y: p.y, m: p.m, d: len }) + 1);
      return { y: next.y - offset, m: next.m, d: null };
    }
    return { y: p.y - offset, m: p.m, d: null };
  }
  return { y: p.y - offset, m: p.m, d: p.d };
}

function shiftRel(cal, rel, delta) {
  const unitDays = durationInDays(cal, 1, rel.unit) || 1;
  const signed = (rel.dir === "before" ? -1 : 1) * rel.amount + Math.round(delta / unitDays);
  return { ...rel, amount: Math.abs(signed), dir: signed < 0 ? "before" : "after" };
}

/**
 * Перенести дату так, чтобы её точка на шкале сдвинулась на delta дней.
 * @param era эпоха, в чьём счёте записан год (или null)
 * @returns новое значение даты или null, если двигать нечего
 */
export function shiftDate(cal, value, delta, era = null) {
  if (!canMove(value) || !delta) return canMove(value) ? value : null;
  const offset = eraYearOffset(era);
  const out = { ...value };
  if (value.rel) out.rel = shiftRel(cal, value.rel, delta);
  else Object.assign(out, shiftParts(cal, value.y, value.m, value.d, delta, offset));
  if (value.kind === "between") {
    if (value.rel2) out.rel2 = shiftRel(cal, value.rel2, delta);
    else if (value.y2 != null) {
      const p = shiftParts(cal, value.y2, value.m2, value.d2, delta, offset);
      out.y2 = p.y; out.m2 = p.m; out.d2 = p.d;
    }
  }
  return out;
}

/**
 * Перенести дату так, чтобы её точка встала на момент targetT.
 * Дата с точностью «год» попадает в тот год, где лежит targetT, а не туда,
 * куда её унесло бы округление сдвига: так ведёт себя перетаскивание.
 */
export function moveDateTo(cal, value, resolvedT, targetT, era = null) {
  if (!canMove(value) || resolvedT == null || targetT == null) return null;
  if (value.rel || value.kind === "between") {
    return shiftDate(cal, value, Math.round(targetT - resolvedT), era);
  }
  const p = fromDayIndex(cal, targetT);
  const offset = eraYearOffset(era);
  return {
    ...value,
    y: p.y - offset,
    m: value.m == null ? null : p.m,
    d: value.d == null ? null : p.d,
  };
}

/** Сдвинуть дату на steps шагов её же точности (кнопки «−» и «+»). */
export function nudgeDate(cal, value, steps, era = null) {
  if (!canMove(value) || !steps) return value;
  if (value.rel) {
    const out = { ...value, rel: shiftRel(cal, value.rel, steps * (durationInDays(cal, 1, value.rel.unit) || 1)) };
    if (value.kind === "between" && value.rel2) {
      out.rel2 = shiftRel(cal, value.rel2, steps * (durationInDays(cal, 1, value.rel2.unit) || 1));
    }
    return out;
  }
  const step = stepOf(value);
  const bump = (y, m, d) => {
    if (step === "year") return { y: y + steps, m, d };
    if (step === "month") {
      const total = y * cal.months.length + m + steps;
      const ny = Math.floor(total / cal.months.length);
      const nm = ((total % cal.months.length) + cal.months.length) % cal.months.length;
      return { y: ny, m: nm, d };
    }
    const offset = eraYearOffset(era);
    const p = fromDayIndex(cal, toDayIndex(cal, { y: y + offset, m, d }) + steps);
    return { y: p.y - offset, m: p.m, d: p.d };
  };
  const out = { ...value, ...bump(value.y, value.m, value.d) };
  if (value.kind === "between" && value.y2 != null) {
    const p = bump(value.y2, value.m2 ?? value.m, value.d2 ?? value.d);
    out.y2 = p.y;
    out.m2 = value.m2 == null ? null : p.m;
    out.d2 = value.d2 == null ? null : p.d;
  }
  return out;
}

/**
 * На сколько дней реально сдвинулась дата: между первыми днями старого и
 * нового значения. Конец промежутка едет ровно на столько же — иначе
 * перенос «войны 1020–1027» с округлением до года менял бы её длительность.
 */
export function movedBy(cal, from, to, era = null) {
  if (!from || !to || from.rel || to.rel || from.y == null || to.y == null) return null;
  const offset = eraYearOffset(era);
  const first = (v) => toDayIndex(cal, { y: v.y + offset, m: v.m ?? 0, d: v.d ?? 1 });
  return first(to) - first(from);
}
