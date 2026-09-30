/**
 * История отмены.
 *
 * Глубина не фиксированная: держим последние действия, пока они «лёгкие», и
 * укорачиваем историю, когда в ней копится тяжёлое. Перенос узла или
 * переименование стоят единицу — таких помнится сотня. Удаление полусотни
 * карточек тащит за собой их описания, поля и связи — такие вытесняют друг
 * друга, и до дна доходит быстрее.
 *
 * Границы: не меньше MIN шагов при любых весах и не больше MAX никогда.
 */

export const HISTORY_MIN = 50;
export const HISTORY_MAX = 100;
// Суммарный вес, после которого начинаем вытеснять старое. 300 ≈ сотня лёгких
// шагов с запасом на десяток средних.
export const HISTORY_BUDGET = 300;

/** Во что обходится хранение одного узла: поля и описание тоже лежат в записи. */
function nodeCost(n) {
  const text = (n?.description || "").length + (n?.title || "").length;
  return 2 + Math.min(6, Math.floor(text / 1200)) + Math.min(3, (n?.fields || []).length / 4);
}

/**
 * Вес записи. Всё, что не тащит за собой данные графа, стоит единицу: сама
 * возможность отменить шаг ничего не весит, весит только то, что для этого
 * приходится помнить.
 */
export function entryCost(entry) {
  if (!entry) return 0;
  switch (entry.kind) {
    case "restore":
      return 1 + (entry.nodes || []).reduce((sum, n) => sum + nodeCost(n), 0)
        + (entry.edges || []).length;
    case "positions":
      return 1 + Math.floor((entry.positions || []).length / 8);
    case "nodePatch":
      return 1 + (entry.items || []).reduce((sum, it) => sum + nodeCost(it.before), 0) / 2;
    case "edgePatch":
      return 1 + Math.floor((entry.items || []).length / 4);
    case "created":
      return 1;
    case "settings":
      return 2;
    default:
      return 1;
  }
}

// Окно склейки: правки одного и того же за это время считаются одним шагом.
const COALESCE_MS = 2000;

/**
 * Сливается ли новая запись с предыдущей. Ползунок цвета в настройках и набор
 * названия шлют по десятку правок в секунду; без склейки Ctrl+Z полминуты
 * отматывал бы их по одной, а вся остальная история вытеснялась бы ими.
 */
function coalesces(last, entry) {
  if (!last || Date.now() - (last.at || 0) > COALESCE_MS || last.kind !== entry.kind) return false;
  if (entry.kind === "settings") return true;
  if (entry.kind === "nodePatch") {
    return last.items.length === 1 && entry.items.length === 1
      && last.items[0].id === entry.items[0].id;
  }
  return false;
}

/**
 * Добавить запись, вытеснив то, что уже не помещается.
 *
 * Возвращает новый список — история живёт в ref, и мутировать её на месте
 * значило бы прятать изменение от React там, где оно всё-таки нужно.
 */
export function pushEntry(list, entry) {
  // Склеенная запись — это первая из череды: в ней лежит то состояние, к
  // которому Ctrl+Z и должен вернуть.
  if (coalesces(list[list.length - 1], entry)) return list;
  const next = [...list, { ...entry, cost: entryCost(entry), at: Date.now() }];
  while (next.length > HISTORY_MAX) next.shift();
  let total = next.reduce((sum, e) => sum + (e.cost || 1), 0);
  while (next.length > HISTORY_MIN && total > HISTORY_BUDGET) {
    total -= next.shift().cost || 1;
  }
  return next;
}
