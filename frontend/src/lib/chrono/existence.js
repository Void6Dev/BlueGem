// Когда узел «есть» в мире — для машины времени на холсте.
//
// Человек есть от рождения до смерти, город — от основания (и до гибели,
// если она записана), событие — пока длится. Узел без дат вне времени: он
// виден на любом году.
import { BIRTH_KEY, DEATH_KEY } from "./dates";

const START_KEYS = new Set([BIRTH_KEY, "created", "construction", "started", "discovery"]);
const END_KEYS = new Set([DEATH_KEY, "ended"]);

/**
 * @returns {{from: number, to: number}|null} null — узел вне времени
 */
export function existenceOf(list) {
  if (!list?.length) return null;
  let from = null;
  let to = null;
  let eventFrom = null;
  let eventTo = null;
  for (const item of list) {
    if (item.t == null) continue;
    const key = item.entry.key || "date";
    if (START_KEYS.has(key)) from = from == null ? item.t : Math.min(from, item.t);
    else if (END_KEYS.has(key)) to = to == null ? item.t2 ?? item.t : Math.max(to, item.t2 ?? item.t);
    else {
      eventFrom = eventFrom == null ? item.t : Math.min(eventFrom, item.t);
      eventTo = eventTo == null ? item.t2 ?? item.t : Math.max(eventTo, item.t2 ?? item.t);
    }
  }
  if (from == null && to == null) {
    if (eventFrom == null) return null;
    return { from: eventFrom, to: eventTo };
  }
  return { from: from ?? -Infinity, to: to ?? Infinity };
}

/**
 * Состояние узла в момент времени: есть, ещё нет или уже нет.
 * @param span результат existenceOf
 * @param range [начало, конец] выбранного отрезка (обычно — год)
 */
export function stateAt(span, range) {
  if (!span) return "timeless";
  const [a, b] = range;
  if (span.to < a) return "past";
  if (span.from > b) return "future";
  return "present";
}
