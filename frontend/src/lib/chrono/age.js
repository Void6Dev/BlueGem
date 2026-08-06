// Возраст.
//
// Родился в 52-м, умер в 88-м — значит, прожил 36 лет, и писателю не должно
// приходиться считать это в уме. А если в 70-м году случилось что-то важное,
// то сколько ему было тогда? Восемнадцать. Такие вопросы возникают постоянно,
// и отвечать на них должна программа.
//
// Возраст считается по календарю мира, а не делением дней на 365: в мире с
// годом из трёхсот дней тридцатилетний прожил девять тысяч дней, и никакая
// земная константа тут не поможет.
import { fromDayIndex } from "./calendar";
import { BIRTH_KEY, DEATH_KEY } from "./dates";

/**
 * Полных лет между двумя моментами. Отрицательный результат означает, что
 * «потом» случилось раньше «рождения», — такой возраст не показывается.
 *
 * @returns {?number} null, если посчитать нечего
 */
export function yearsBetween(cal, fromIndex, toIndex) {
  if (fromIndex == null || toIndex == null) return null;
  if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return null;
  const a = fromDayIndex(cal, fromIndex);
  const b = fromDayIndex(cal, toIndex);
  let years = b.y - a.y;
  // День рождения в этом году ещё не наступил — год не засчитан.
  if (b.m < a.m || (b.m === a.m && b.d < a.d)) years -= 1;
  return years;
}

/** Найти запись узла по ключу («birth», «death», ...). */
export function findEntry(chrono, nodeId, key) {
  const list = chrono.byNode.get(nodeId);
  if (!list) return null;
  return list.find((item) => item.entry.key === key) || null;
}

/**
 * Всё, что можно сказать о сроке жизни узла.
 *
 * @returns {{birth, death, age, exact}|null}
 *   `age` — прожитые годы (на момент смерти либо на «сейчас» шкалы),
 *   `exact` — верно ли, что обе даты точные: у приблизительных возраст
 *   тоже считается, но показывать его надо со знаком «около».
 */
export function lifespan(chrono, nodeId, atIndex = null) {
  const birth = findEntry(chrono, nodeId, BIRTH_KEY);
  if (!birth?.start?.ok || birth.t == null) return null;
  const death = findEntry(chrono, nodeId, DEATH_KEY);
  const end = death?.start?.ok ? death.t : atIndex;
  const age = yearsBetween(chrono.calendar, birth.t, end);
  return {
    birth,
    death: death?.start?.ok ? death : null,
    age: age != null && age >= 0 ? age : null,
    atDeath: !!(death?.start?.ok),
    exact: isSharp(birth.start) && (!death || isSharp(death.start)),
  };
}

const isSharp = (res) => res?.ok && res.kind === "exact" && res.precision !== "era";

/**
 * Сколько было лет узлу в указанный момент.
 *
 * Момент после смерти возраста не даёт: «сорок лет спустя ему было бы 78» —
 * это уже не факт мира, а домысел, и придумывать его за автора не стоит.
 *
 * @returns {{age:number, exact:boolean, afterDeath:boolean}|null}
 */
export function ageAt(chrono, nodeId, atIndex) {
  const life = lifespan(chrono, nodeId);
  if (!life || atIndex == null || !Number.isFinite(atIndex)) return null;
  const age = yearsBetween(chrono.calendar, life.birth.t, atIndex);
  if (age == null || age < 0) return null;
  const afterDeath = life.death?.t != null && atIndex > life.death.t;
  if (afterDeath) return null;
  return { age, exact: life.exact, afterDeath };
}

/**
 * Возраст всех узлов, у которых есть дата рождения, на момент события.
 * Используется карточкой события: «кому сколько было, когда это случилось».
 *
 * @param {Set<string>|null} limitTo если задано — считать только для этих узлов
 */
export function agesDuring(chrono, atIndex, limitTo = null) {
  const out = [];
  if (atIndex == null || !Number.isFinite(atIndex)) return out;
  for (const [nodeId, list] of chrono.byNode) {
    if (limitTo && !limitTo.has(nodeId)) continue;
    if (!list.some((item) => item.entry.key === BIRTH_KEY)) continue;
    const got = ageAt(chrono, nodeId, atIndex);
    if (got) out.push({ nodeId, node: list[0].node, ...got });
  }
  return out.sort((a, b) => b.age - a.age);
}
