import { useMemo, useRef } from "react";
import { resolveCalendar } from "./calendar";
import { buildChronology } from "./resolve";

/**
 * Хронология проекта, пересчитанная ровно тогда, когда она изменилась.
 *
 * Тонкость вот в чём. Узлы приходят от React Flow, и он подменяет объект узла
 * на каждый кадр перетаскивания по холсту. Считать всю хронологию заново на
 * каждый такой кадр нельзя — тридцать тысяч событий разбираются полторы сотни
 * миллисекунд, и мышь встанет колом.
 *
 * Но React Flow подменяет только сам узел, оставляя `data` тем же объектом:
 * позиция меняется, содержимое — нет. Поэтому сравниваем ссылки на `data`, а
 * не узлы целиком. Перетаскивание проходит мимо, а любая правка узла —
 * замена `data` — пересчёт вызывает.
 *
 * @param {object[]} rfNodes узлы React Flow ({id, position, data})
 * @param {object} settings  настройки проекта: календарь и эпохи
 */
export function useChronology(rfNodes, settings) {
  const cache = useRef({ refs: null, nodes: null });

  const nodes = useMemo(() => {
    const previous = cache.current.refs;
    const same = previous
      && previous.length === rfNodes.length
      && rfNodes.every((n, i) => n.data === previous[i]);
    if (same) return cache.current.nodes;
    const refs = rfNodes.map((n) => n.data);
    cache.current = { refs, nodes: refs };
    return refs;
  }, [rfNodes]);

  const calendar = useMemo(() => resolveCalendar(settings), [settings?.calendar]);
  const eras = settings?.eras;

  return useMemo(
    () => buildChronology(nodes, calendar, eras),
    [nodes, calendar, eras]
  );
}
