// Данные редактора вне компонента: как узлы и связи из хранилища становятся
// узлами и линиями React Flow, сравнения «изменилось ли» и запомненные
// настройки вида. Всё здесь — чистые функции и пара хуков-кэшей, поэтому их
// можно читать и проверять отдельно от трёх тысяч строк редактора.
import { useMemo, useRef } from "react";
import { MarkerType } from "@xyflow/react";
import { DEFAULT_EDGE_COLOR } from "@/lib/settings";

/**
 * Перевести ссылки относительных дат на новые id узлов.
 *
 * Нужно везде, где узлы пересоздаются: копия, возврат удалённого.
 * Возвращает null, если менять было нечего, — чтобы не ходить на сервер зря.
 */
export function remapDateRefs(dates, idMap) {
  if (!Array.isArray(dates) || !dates.length) return null;
  let touched = false;
  const out = dates.map((entry) => {
    const next = { ...entry };
    for (const edge of ["start", "end"]) {
      const value = next[edge];
      const mapped = value?.rel?.nodeId && idMap[value.rel.nodeId];
      if (!mapped) continue;
      next[edge] = { ...value, rel: { ...value.rel, nodeId: mapped } };
      touched = true;
    }
    return next;
  });
  return touched ? out : null;
}

export const SIDEBAR_KEY = "bluegem:sidebar";
export const VIEW_KEY = "bluegem:view";

/** Где человек оставил холст в прошлый раз: свой ключ на каждый проект. */
export function readView(projectId) {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    const v = all[projectId];
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeView(projectId, viewport) {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    all[projectId] = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    localStorage.setItem(VIEW_KEY, JSON.stringify(all));
  } catch {
    // Приватный режим или переполненное хранилище — потеря вида не повод падать.
  }
}
export const NODE_W = 260;
export const NODE_H = 150;
// Выше этого числа узлов вход не анимируется: staggered появление двухсот
// карточек — это мучительная секунда на каждом открытии проекта.
export const ANIM_LIMIT = 40;
// Выше этого числа узлов React Flow держит в DOM только то, что попало в кадр.
// Своей виртуализации не пишем — она у библиотеки есть; порог нужен затем, что
// на маленьком графе монтирование при панорамировании стоит дороже, чем сотня
// готовых карточек, которые всё равно никто не пересобирает.
export const CULL_LIMIT = 150;
// Один пустой массив на все карточки без соседей и без дат: свежий литерал
// в каждой проекции ломал бы сравнение по ссылке в самой карточке.
export const EMPTY_LIST = [];
export const EMPTY_OBJECT = {};

// Выше этого — «щадящий вид»: без бесконечных подсветок, без saturate() на
// каждой приглушённой карточке и без градиента в каждой линии. Смотри
// .sw-perf в index.css: там же перечислено, что именно гасится.
export const PERF_LIMIT = 400;

/**
 * Содержимое узлов, не замечающее перетаскивания.
 *
 * React Flow подменяет объект узла на каждый кадр переноса, оставляя `data` тем
 * же. Всё, что считается по содержимому — теги, названия, соседи, — не должно
 * пересчитываться от того, что карточку подвинули на три пикселя. Сравниваем
 * ссылки на `data` (тот же приём, что в useChronology) и отдаём прежний список,
 * пока ни одна из них не сменилась.
 */
export function useNodeContent(rfNodes) {
  const cache = useRef(null);
  return useMemo(() => {
    const prev = cache.current;
    if (prev && prev.length === rfNodes.length && rfNodes.every((n, i) => n.data === prev[i])) {
      return prev;
    }
    const next = rfNodes.map((n) => n.data);
    cache.current = next;
    return next;
  }, [rfNodes]);
}

// Поля, от которых зависит всё, что показывается не в самой карточке: список
// в панели, соседи, теги, счётчики, палитра команд, хронология. Описание и
// характеристики сюда не входят — и в этом весь смысл (см. useNodeFacts).
const FACT_KEYS = ["title", "typeId", "tags", "canvas", "nodeType", "dates"];

/**
 * То же, но по перечисленным полям, а не по объекту `data` целиком.
 *
 * Разница решающая. Правка в панели узла уходит на холст тем же кадром, то есть
 * подменяет `data` на каждую набранную букву. Пока производные считались от
 * `data`, каждая буква описания пересобирала соседей — а соседи выдаются
 * карточкам массивом, и новый массив означал новый объект узла для каждой из
 * них. Одна буква стоила тысячи перерисовок.
 *
 * Возвращаются те же объекты `data`, но список сохраняет прежние ссылки, пока
 * ни одно из перечисленных полей не менялось. Договор такой же, как у
 * useChronology: читать из этого списка можно только перечисленные поля —
 * остальные в нём могут быть от предыдущей правки.
 */
export function useNodeFacts(rfNodes) {
  const cache = useRef(null);
  return useMemo(() => {
    const width = FACT_KEYS.length;
    const prev = cache.current;
    let same = prev && prev.list.length === rfNodes.length;
    for (let i = 0; same && i < rfNodes.length; i += 1) {
      const d = rfNodes[i].data;
      if (d === prev.list[i]) continue;
      for (let k = 0; k < width; k += 1) {
        if (prev.marks[i * width + k] !== d[FACT_KEYS[k]]) { same = false; break; }
      }
    }
    if (same) return prev.list;
    const marks = new Array(rfNodes.length * width);
    const list = new Array(rfNodes.length);
    for (let i = 0; i < rfNodes.length; i += 1) {
      const d = rfNodes[i].data;
      list[i] = d;
      for (let k = 0; k < width; k += 1) marks[i * width + k] = d[FACT_KEYS[k]];
    }
    cache.current = { marks, list };
    return list;
  }, [rfNodes]);
}

// Build a React Flow edge. Линия в покое нейтральна для всех типов связей:
// цвет типа живёт в --rel-color и проявляется под курсором и в выделении.
// Граф из разноцветных линий превращается в спагетти — этого не повторяем.
export function toRfEdge(e, settings) {
  const color = e.color || DEFAULT_EDGE_COLOR;
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    // Стороны узлов, между которыми связь провели. Без них React Flow цепляет
    // линию к первой точке узла — то есть к левой, что бы ни соединяли.
    sourceHandle: e.sourceHandle || undefined,
    targetHandle: e.targetHandle || undefined,
    label: e.label,
    // Свой тип ребра: переливается из цвета исходного узла в цвет целевого и
    // помнит точки излома. Прежний edgeType из настроек стал формой линии
    // внутри него — она по-прежнему настраивается, но рисует уже наше ребро.
    type: "gradient",
    animated: !!settings?.animatedEdges,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--sw-edge)" },
    style: { "--rel-color": color },
    data: {
      relType: e.relType || "",
      color: e.color || "",
      points: e.points || [],
      // Форма своя, если её задали этой связи; иначе общая из настроек.
      shape: e.shape || settings?.edgeType || "smoothstep",
      shapeOwn: e.shape || "",
    },
  };
}

/**
 * Имя копии: «Крепость» → «Крепость (1)», следующая → «Крепость (2)».
 *
 * Номер, а не слово. Слово в скобках копилось: копия копии называлась
 * «Крепость (дублировать) (дублировать)», и к третьему разу от имени в карточке
 * не оставалось ничего, кроме скобок. Номер у уже пронумерованной копии
 * заменяется, а не дописывается, — поэтому цепочка не растёт.
 *
 * Берётся первый свободный номер, а не следующий за наибольшим: после удаления
 * пятой копии шестая незачем.
 *
 * @param {string} title имя оригинала
 * @param {Set<string>} taken занятые имена в нижнем регистре
 */
export function copyTitle(title, taken) {
  const base = (title || "").replace(/\s*\(\d+\)\s*$/, "").trim();
  let n = 1;
  while (taken.has(`${base} (${n})`.toLowerCase())) n += 1;
  return `${base} (${n})`;
}

/** Изломы совпадают? Нужно, чтобы не писать в историю «правку», которой не было. */
export function samePoints(a = [], b = []) {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

/** Строки дат совпадают? Та же роль, что и у sameNeighbours. */
export function sameDateLines(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].key !== b[i].key || a[i].label !== b[i].label || a[i].text !== b[i].text) return false;
  }
  return true;
}

/** Списки соседей совпадают? По ним решается, перерисовывать ли карточку. */
export function sameNeighbours(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.title !== y.title || x.outgoing !== y.outgoing
      || x.away !== y.away || x.rel !== y.rel || x.color !== y.color) return false;
  }
  return true;
}

export function readSidebarPrefs() {
  // scope — что показывает дерево: текущий холст или весь мир; collapsed —
  // свёрнутые группы типов, по id типа.
  const fallback = { open: true, width: 268, scope: "canvas", collapsed: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_KEY) || "{}");
    return { ...fallback, ...saved };
  } catch {
    return fallback;
  }
}
