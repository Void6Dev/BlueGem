// Разрешение дат: превращение записей узлов в точки на шкале.
//
// Главная сложность здесь одна — относительные даты. «Через пять дней после
// битвы», а сама битва — «за год до коронации», а коронация — «через месяц
// после смерти короля». Получается граф зависимостей, и его надо обойти так,
// чтобы каждая дата считалась ровно один раз, а кольцо («A после B, B после
// A») не увело обход в бесконечность, а честно показалось пользователю
// сломанной ссылкой.
//
// Обход — итеративный, со своим стеком, а не рекурсией: цепочка ссылок может
// оказаться в тысячу звеньев, и рекурсия на такой глубине уронит вкладку.
//
// Каждый конец каждой даты получает номер — «ячейку». Граф живёт на числах:
// ни склеенных строковых ключей, ни разбора их обратно, ни зависимости от
// того, что за символы автор набрал в идентификаторе записи.
import {
  applyKind, dateRefs, entryLabel, isDateEmpty, normalizeEntries,
  partsAnchor, relAnchor, unresolved,
} from "./dates";
import { eraYearOffset, resolveEras } from "./eras";

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/**
 * Собрать всю хронологию проекта.
 *
 * Считается целиком и заново при любом изменении дат — так проще рассуждать
 * о правильности, а стоит это один проход по узлам. Результат кэшируется
 * вызывающей стороной (useChronology), поэтому панорамирование и зум шкалы
 * сюда не заглядывают вовсе.
 *
 * @param {object[]} nodes   узлы проекта ({id, title, dates, ...})
 * @param {object} calendar  нормализованный календарь
 * @param {object[]} rawEras эпохи из настроек проекта
 */
export function buildChronology(nodes, calendar, rawEras) {
  const eras = resolveEras(calendar, rawEras);

  // --- ячейки ---------------------------------------------------------
  // slots[i] = один конец одной даты. Всё дальнейшее работает с номерами.
  const slots = [];
  const records = [];                 // {node, entry, startSlot, endSlot}
  const byNodeEntry = new Map();      // nodeId -> Map(entryId -> record)
  const nodeOrder = [];

  for (const node of nodes || []) {
    const list = normalizeEntries(node.dates);
    if (!list.length) continue;
    const perEntry = new Map();
    byNodeEntry.set(node.id, perEntry);
    nodeOrder.push(node.id);
    for (const entry of list) {
      const record = { node, entry, startSlot: slots.length, endSlot: -1 };
      slots.push({ value: entry.start, record });
      if (entry.end) {
        record.endSlot = slots.length;
        slots.push({ value: entry.end, record });
      }
      perEntry.set(entry.id, record);
      records.push(record);
    }
  }

  /** Ячейка, на которую показывает ссылка. Ссылка без указания записи
   *  означает «главная дата того узла» — первая в списке. */
  function targetSlot(rel) {
    const perEntry = byNodeEntry.get(rel.nodeId);
    if (!perEntry) return -1;
    const record = rel.entryId == null
      ? perEntry.values().next().value
      : perEntry.get(rel.entryId);
    if (!record) return -1;
    const slot = rel.edge === "end" ? record.endSlot : record.startSlot;
    return slot >= 0 ? slot : record.startSlot;
  }

  // --- обход ----------------------------------------------------------
  const color = new Uint8Array(slots.length);
  const result = new Array(slots.length).fill(null);

  function compute(index, broken) {
    const value = slots[index].value;
    if (!value) return unresolved("missing");

    // Дата без якоря держится на эпохе — и это законная дата: «когда-то в
    // Тёмные века» рисуется во всю их ширину.
    if (value.kind === "unknown" || isDateEmpty(value)) {
      const era = value.eraId ? eras.byId.get(value.eraId) : null;
      if (!era || era.startT == null) return unresolved("empty", value.eraId);
      const hi = Number.isFinite(era.endT) ? era.endT : era.startT;
      return {
        ok: true, kind: "unknown", precision: "era", eraId: era.id, error: null,
        t: Math.round((era.startT + hi) / 2), lo: era.startT, hi: era.endT,
      };
    }

    if (broken) return unresolved("cycle", value.eraId);

    const offset = eraYearOffset(value.eraId ? eras.byId.get(value.eraId) : null);
    const anchorFor = (rel, second) => {
      if (!rel) return { anchor: partsAnchor(calendar, value, second, offset) };
      const target = targetSlot(rel);
      if (target < 0) return { error: "missing" };
      const base = result[target];
      // Не разрешилась основа — не разрешимся и мы. Причину передаём дальше
      // как есть: обе половины кольца должны честно сказать «кольцо», а не
      // спихивать вину друг на друга.
      if (!base || !base.ok) return { error: base?.error === "cycle" ? "cycle" : "chain" };
      return { anchor: relAnchor(calendar, rel, base) };
    };

    const first = anchorFor(value.rel, false);
    if (!first.anchor) return unresolved(first.error || "empty", value.eraId);
    const second = value.kind === "between" ? anchorFor(value.rel2, true).anchor : null;
    return applyKind(calendar, value, first.anchor, second);
  }

  function dependencies(index) {
    const value = slots[index].value;
    if (!value) return null;
    const refs = dateRefs(value);
    if (!refs.length) return null;
    const out = [];
    for (const rel of refs) {
      const target = targetSlot(rel);
      // Ссылку на саму себя не отсеиваем: к этому моменту ячейка уже серая,
      // и общая проверка на серого предка сама назовёт её кольцом — коротким,
      // но кольцом.
      if (target >= 0) out.push(target);
    }
    return out;
  }

  function visit(root) {
    const stack = [{ index: root, phase: 0, broken: false }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.phase === 0) {
        color[frame.index] = GRAY;
        frame.phase = 1;
        const deps = dependencies(frame.index);
        for (let i = 0; deps && i < deps.length; i += 1) {
          const state = color[deps[i]];
          // Серый предок означает, что ссылки замкнулись в кольцо.
          if (state === GRAY) frame.broken = true;
          else if (state !== BLACK) stack.push({ index: deps[i], phase: 0, broken: false });
        }
        continue;
      }
      result[frame.index] = compute(frame.index, frame.broken);
      color[frame.index] = BLACK;
      stack.pop();
    }
  }

  for (let i = 0; i < slots.length; i += 1) {
    if (color[i] === WHITE) visit(i);
  }

  // --- элементы шкалы -------------------------------------------------
  const items = [];
  const undated = [];
  const byNode = new Map();

  for (const record of records) {
    const { node, entry } = record;
    const start = result[record.startSlot] || unresolved("empty");
    const end = record.endSlot >= 0 ? result[record.endSlot] : null;
    const item = {
      key: `${node.id}/${entry.id}`,
      nodeId: node.id,
      entryId: entry.id,
      node,
      entry,
      label: entryLabel(entry),
      start,
      end,
      // Точка, по которой элемент сортируется и ставится на шкалу.
      t: start.ok ? start.t : null,
      // Правый конец полосы: явный конец, иначе сама дата.
      t2: end?.ok ? end.t : start.ok ? start.t : null,
      // Полный размах неопределённости — по нему рисуется размытая подложка.
      lo: start.ok ? start.lo : null,
      hi: end?.ok ? end.hi : start.ok ? start.hi : null,
      eraId: start.eraId || null,
      error: start.ok ? null : start.error,
    };
    // Конец раньше начала — опечатка автора; рисуем такую запись точкой,
    // а не полосой отрицательной длины.
    if (item.t != null && item.t2 != null && item.t2 < item.t) item.t2 = item.t;
    if (item.t == null) undated.push(item); else items.push(item);
    if (!byNode.has(node.id)) byNode.set(node.id, []);
    byNode.get(node.id).push(item);
  }

  items.sort(compareItems);
  undated.sort((a, b) => title(a).localeCompare(title(b)));

  return {
    items, undated, byNode, eras, calendar,
    bounds: boundsOf(items, eras.placed),
  };
}

const title = (item) => item.node?.title || "";

/**
 * Порядок на шкале. При равном времени вперёд идут более точные даты: «12
 * Инея 300» стоит раньше, чем «когда-то в 300-м», хотя формально они
 * начинаются в один день. Дальше — по названию, чтобы порядок не плясал от
 * запуска к запуску.
 */
const RANK = { day: 0, month: 1, year: 2, era: 3, none: 4 };

function compareItems(a, b) {
  if (a.t !== b.t) return a.t - b.t;
  const pa = RANK[a.start.precision] ?? 9;
  const pb = RANK[b.start.precision] ?? 9;
  if (pa !== pb) return pa - pb;
  return title(a).localeCompare(title(b)) || a.key.localeCompare(b.key);
}

/** Границы обитаемой части шкалы. Бесконечные края («до начала времён»)
 *  в расчёт не идут: по ним нельзя было бы построить ни одного вида. */
function boundsOf(items, placedEras) {
  let min = Infinity;
  let max = -Infinity;
  const eat = (v) => {
    if (v == null || !Number.isFinite(v)) return;
    if (v < min) min = v;
    if (v > max) max = v;
  };
  for (const item of items) { eat(item.t); eat(item.t2); }
  for (const era of placedEras) { eat(era.startT); eat(era.endT); }
  if (min > max) return { min: 0, max: 0, empty: true };
  return { min, max, empty: false };
}
