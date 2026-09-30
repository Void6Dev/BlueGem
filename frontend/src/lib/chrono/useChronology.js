import { useMemo, useRef } from "react";
import { resolveCalendar } from "./calendar";
import { buildChronology } from "./resolve";

// Поля узла, от которых зависит хронология и то, что показывает шкала:
// сами даты, название (им подписана относительная дата), тип, теги и страница
// (по ним шкала фильтрует и группирует). Описание и характеристики сюда не
// входят намеренно — см. комментарий к useChronology.
const WATCHED = ["dates", "title", "typeId", "tags", "canvas"];

/**
 * Хронология проекта, пересчитанная ровно тогда, когда она изменилась.
 *
 * Тонкость вот в чём. Содержимое узлов приходит из редактора, а он подменяет
 * список на каждое движение по холсту. Считать всю хронологию заново на каждый
 * такой кадр нельзя — тридцать тысяч событий разбираются полторы сотни
 * миллисекунд, и мышь встанет колом.
 *
 * Сравнивать объекты `data` целиком оказалось мало: правка в панели узла уходит
 * на холст тем же кадром, то есть подменяет `data` на каждую набранную букву —
 * и набор описания перестраивал всю хронологию по разу на символ. Поэтому
 * сверяем не объект целиком, а те поля, от которых шкала и правда зависит
 * (WATCHED). Описание и характеристики проходят мимо.
 *
 * @param {object[]} nodeData содержимое узлов (те самые объекты `data`)
 * @param {object} settings  настройки проекта: календарь и эпохи
 */
export function useChronology(nodeData, settings) {
  const cache = useRef({ marks: null, nodes: null });

  const nodes = useMemo(() => {
    const width = WATCHED.length;
    const previous = cache.current.marks;
    let same = previous && previous.length === nodeData.length * width;
    for (let i = 0; same && i < nodeData.length; i += 1) {
      const d = nodeData[i];
      for (let k = 0; k < width; k += 1) {
        if (previous[i * width + k] !== d[WATCHED[k]]) { same = false; break; }
      }
    }
    if (same) return cache.current.nodes;

    const marks = new Array(nodeData.length * width);
    const list = new Array(nodeData.length);
    for (let i = 0; i < nodeData.length; i += 1) {
      const d = nodeData[i];
      list[i] = d;
      for (let k = 0; k < width; k += 1) marks[i * width + k] = d[WATCHED[k]];
    }
    cache.current = { marks, nodes: list };
    return list;
  }, [nodeData]);

  const calendar = useMemo(() => resolveCalendar(settings), [settings?.calendar]);
  const eras = settings?.eras;

  return useMemo(
    () => buildChronology(nodes, calendar, eras),
    [nodes, calendar, eras]
  );
}
