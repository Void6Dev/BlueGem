import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge, EdgeLabelRenderer, Position, useReactFlow, useStore,
  getSmoothStepPath, getBezierPath, getStraightPath,
} from "@xyflow/react";

// Линия узел→узел.
//
// Две вещи, которых не умеет штатное ребро React Flow:
//
// 1. Переливается из цвета исходного узла в цвет целевого. Раньше все связи были
//    одного серого цвета, и на плотном графе нельзя было понять, откуда линия
//    пришла, не проследив её глазами до конца.
// 2. Помнит точки излома. Автоматический путь на плотном холсте проходит сквозь
//    чужие карточки, и обойти их было нечем.
//
// Точки живут в data.points в координатах холста — не в экранных: иначе излом
// уезжал бы при любом зуме.
//
// Взаимодействие устроено как в векторных редакторах: линию просто тянут в том
// месте, за которое взялись, и там появляется опора. Ни выделять связь заранее,
// ни целиться в кнопку «добавить» не нужно — под курсором ездит призрак будущей
// точки, показывая, где именно линия согнётся.

const HANDLE_R = 5;
// Порог, после которого нажатие считается протяжкой. Без него любой клик по
// линии оставлял бы опору — в том числе клик, которым связь просто выделяют.
const DRAG_MIN = 4;
// Прилипание к соседям по пути (в экранных пикселях, делим на зум): почти
// прямой участок дотягивается до прямого сам, руками этого не добиться.
const SNAP = 7;
// Брошенная обратно на линию опора убирается: разогнуть — то же движение, что
// и согнуть, отдельного «удалить» искать не надо.
const MERGE = 5;
// Выше этого числа узлов перелив выключается: держать в SVG по объявлению
// градиента на каждую линию — это тысяча лишних узлов документа, а разглядеть
// переход цвета на линии длиной в палец всё равно нельзя. Линия берёт цвет
// своего истока — «откуда пришла» читается и так. Держать в согласии
// с PERF_LIMIT в pages/Editor.jsx.
const PERF_LIMIT = 400;
// То же самое, но по числу связей. Порог свой, потому что дело не в узлах:
// градиентная обводка — самый дорогой способ нарисовать линию (у каждой своё
// объявление и своя заливка), и платит за неё холст ровно столько раз, сколько
// на нём линий. Полторы сотни связей — это уже клубок, в котором перелив не
// читается: там связь называет себя цветом истока, и этого хватает.
const EDGE_LIMIT = 150;

/** Свести путь к точкам: сегменты между изломами считаются по очереди. */
function buildPath({ points, sx, sy, tx, ty, sourcePosition, targetPosition, shape }) {
  if (!points.length) return segment(sx, sy, tx, ty, sourcePosition, targetPosition, shape);

  // Через изломы ведём прямыми: кривая между заданными руками точками виляет
  // мимо них и выглядит как ошибка, а не как намерение.
  const all = [{ x: sx, y: sy }, ...points, { x: tx, y: ty }];
  return all.map((p, i) => (i ? `L ${p.x},${p.y}` : `M ${p.x},${p.y}`)).join(" ");
}

function segment(sx, sy, tx, ty, sourcePosition, targetPosition, shape) {
  const args = {
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition, targetPosition,
  };
  if (shape === "straight") return getStraightPath(args)[0];
  // Названия форм пришли из настроек и повторяют штатные типы React Flow:
  // default — это безье. Без этой ветки две кнопки из четырёх рисовали одно и
  // то же, и выбор формы выглядел сломанным.
  if (shape === "default" || shape === "bezier") return getBezierPath(args)[0];
  return getSmoothStepPath({ ...args, borderRadius: shape === "step" ? 0 : 12 })[0];
}

/** Середина пути — под ней рисуем подпись. */
function midpoint(points, sx, sy, tx, ty) {
  if (!points.length) return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
  const i = Math.floor((points.length - 1) / 2);
  if (points.length % 2) return points[i];
  return { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
}

/**
 * Куда цеплять конец связи, у которой есть опоры: сторону узла выбираем по
 * направлению на ближайшую опору. Пока конец держался за ту точку, за которую
 * связь когда-то провели, линия к опоре по другую сторону ныряла под карточку —
 * видимая часть обрывалась у её края, и связь выглядела недотянутой.
 */
function sideAnchor(rect, toward) {
  if (!rect) return null;
  const left = toward.x < rect.x + rect.w / 2;
  return {
    x: left ? rect.x : rect.x + rect.w,
    y: rect.y + rect.h / 2,
    pos: left ? Position.Left : Position.Right,
  };
}

/** Расстояние от точки до отрезка — им выбираем, в какой участок вставить опору. */
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ближайшая к курсору точка самой линии. Считаем по нарисованному пути, а не по
 * отрезку «начало—конец»: у ступеней и кривых это разные места, и призрак иначе
 * висел бы в стороне от линии, за которую тянут.
 */
function closestOnPath(el, p) {
  // Длину пути помним на самом элементе: getTotalLength обходит кривую заново
  // на каждый вызов, а вызывается он на каждое движение мыши над линией.
  const d = el.getAttribute("d");
  if (el.__lenFor !== d) {
    el.__lenFor = d;
    el.__len = el.getTotalLength();
  }
  const total = el.__len;
  if (!total) return null;
  let at = 0;
  let step = total / 24;
  // Сначала грубо по всей длине, потом дважды уточняем вокруг найденного:
  // сорок замеров вместо тысячи, а промах меньше пикселя.
  for (let pass = 0, from = 0, to = total; pass < 3; pass++) {
    let best = Infinity;
    for (let l = from; l <= to; l += step) {
      const q = el.getPointAtLength(l);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < best) { best = d; at = l; }
    }
    from = Math.max(0, at - step);
    to = Math.min(total, at + step);
    step = (to - from) / 12 || 1;
  }
  const q = el.getPointAtLength(at);
  return { x: q.x, y: q.y };
}

function GradientEdge(props) {
  const {
    id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    source, target, label, selected, markerEnd, style, data = {},
  } = props;

  const rf = useReactFlow();
  const points = useMemo(() => data.points || [], [data.points]);
  const [dragging, setDragging] = useState(-1);
  const [hover, setHover] = useState(null);
  const movedRef = useRef(false);

  // Всё, что ребро спрашивает у холста, — одной подпиской и одной строкой.
  //
  // Подписок здесь было три, и это стоило дорого не само по себе, а из-за того,
  // когда они срабатывают: хранилище React Flow меняется на каждый кадр
  // панорамирования и зума, и каждый такой кадр прогонял по три селектора на
  // каждую связь проекта. На девяти сотнях линий это две с половиной тысячи
  // проходов по nodeLookup в кадр — при том, что ответ почти всегда прежний.
  //
  // Габариты узлов считаем, только когда у линии есть опоры: без них конец
  // держится за выбранный человеком бок узла, и снимать координаты незачем —
  // а это самая дорогая часть селектора.
  const hasPoints = points.length > 0;
  const snapshot = useStore(
    useCallback((s) => {
      const a = s.nodeLookup.get(source);
      const b = s.nodeLookup.get(target);
      const ca = a?.data?.nodeType?.color || "";
      const cb = b?.data?.nodeType?.color || "";
      // Перелив выключается на большом графе — но перерисовываться на каждое
      // добавление узла ради этого незачем, поэтому в строке лежит признак,
      // а не размер.
      const big = (s.nodeLookup.size >= PERF_LIMIT || s.edgeLookup.size >= EDGE_LIMIT) ? "1" : "";
      if (!hasPoints) return `${ca}|${cb}|${big}||`;
      const box = (n) => {
        if (!n) return "";
        const p = n.internals?.positionAbsolute || n.position;
        return `${p.x},${p.y},${n.measured?.width || 0},${n.measured?.height || 0}`;
      };
      return `${ca}|${cb}|${big}|${box(a)}|${box(b)}`;
    }, [source, target, hasPoints])
  );
  const [fromColor, toColor, big, srcBox, tgtBox] = snapshot.split("|");
  const plain = !!big;
  const [srcRect, tgtRect] = useMemo(() => [srcBox, tgtBox].map((s) => {
    if (!s) return null;
    const [x, y, w, h] = s.split(",").map(Number);
    return w && h ? { x, y, w, h } : null;
  }), [srcBox, tgtBox]);

  const sAnchor = points.length ? sideAnchor(srcRect, points[0]) : null;
  const tAnchor = points.length ? sideAnchor(tgtRect, points[points.length - 1]) : null;
  const sx = sAnchor ? sAnchor.x : sourceX;
  const sy = sAnchor ? sAnchor.y : sourceY;
  const tx = tAnchor ? tAnchor.x : targetX;
  const ty = tAnchor ? tAnchor.y : targetY;

  // Концы нужны обработчикам протяжки, а те живут на window и видят только тот
  // рендер, в котором подписались. Через ref они всегда читают свежие.
  const endsRef = useRef({ sx, sy, tx, ty });
  endsRef.current = { sx, sy, tx, ty };

  // Своя окраска связи (заданная в панели ребра) важнее цвета узлов: её
  // выставили руками, значит хотели именно её.
  const own = data.color || "";
  const gradientId = `edge-grad-${id}`;
  const gradient = !own && !plain && fromColor && toColor && fromColor !== toColor;
  const stroke = own
    ? own
    : (gradient ? `url(#${gradientId})` : (fromColor || "var(--sw-edge)"));

  const path = buildPath({
    points, sx, sy, tx, ty,
    sourcePosition: sAnchor ? sAnchor.pos : sourcePosition,
    targetPosition: tAnchor ? tAnchor.pos : targetPosition,
    shape: data.shape,
  });

  const hitRef = useRef(null);
  const active = selected || !!hover || dragging >= 0;

  // Середину кривой считаем по самой кривой: у smoothstep и безье она заметно
  // в стороне от середины отрезка «начало—конец», и подпись висела рядом
  // с линией, а не на ней.
  const [curveMid, setCurveMid] = useState(null);
  useEffect(() => {
    const el = hitRef.current;
    // Замер стоит перерисовки, поэтому считаем, только когда середина нужна.
    if (!el || !label || points.length) return;
    const p = el.getPointAtLength(el.getTotalLength() / 2);
    setCurveMid((prev) => (
      prev && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5 ? prev : { x: p.x, y: p.y }
    ));
  }, [path, label, points.length]);

  const mid = points.length
    ? midpoint(points, sx, sy, tx, ty)
    : (curveMid || { x: (sx + tx) / 2, y: (sy + ty) / 2 });

  /** В какой участок пути попадает точка — туда и вставится новая опора. */
  const segmentIndex = useCallback((pt) => {
    const { sx: ax, sy: ay, tx: bx, ty: by } = endsRef.current;
    const chain = [{ x: ax, y: ay }, ...points, { x: bx, y: by }];
    let at = 0;
    let best = Infinity;
    for (let i = 0; i < chain.length - 1; i++) {
      const d = distToSegment(pt, chain[i], chain[i + 1]);
      if (d < best) { best = d; at = i; }
    }
    return at;
  }, [points]);

  /**
   * Перетаскивание опоры. Считаем в координатах холста — зум не мешает.
   *
   * @param base список точек, от которого пляшем: при добавлении новой опоры
   *             она ещё не доехала до props, и брать текущий было бы поздно.
   */
  const beginDrag = useCallback((index, base, e) => {
    e.stopPropagation();
    e.preventDefault?.();
    // Указатель захватываем на окно: иначе стоит увести курсор за пределы
    // маленькой точки, и события перестают приходить — тянешь, а не тянется.
    setDragging(index);
    setHover(null);
    movedRef.current = false;

    const neighbours = () => {
      const { sx: ax, sy: ay, tx: bx, ty: by } = endsRef.current;
      return [
        index > 0 ? base[index - 1] : { x: ax, y: ay },
        index < base.length - 1 ? base[index + 1] : { x: bx, y: by },
      ];
    };

    const at = (ev) => {
      const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const pt = { x: Math.round(p.x), y: Math.round(p.y) };
      // Прилипание к соседям: почти прямой участок делаем прямым.
      const near = SNAP / (rf.getZoom() || 1);
      for (const n of neighbours()) {
        if (Math.abs(pt.x - n.x) <= near) pt.x = n.x;
        if (Math.abs(pt.y - n.y) <= near) pt.y = n.y;
      }
      return base.map((old, i) => (i === index ? pt : old));
    };

    const move = (ev) => {
      movedRef.current = true;
      data.onPointsChange?.(id, at(ev), { commit: false });
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(-1);
      let next = movedRef.current ? at(ev) : base;
      // Опора, вернувшаяся на прямую между соседями, больше ничего не держит —
      // убираем её, иначе на линии копится невидимый мусор.
      const [a, b] = neighbours();
      if (movedRef.current && distToSegment(next[index], a, b) * (rf.getZoom() || 1) <= MERGE) {
        next = next.filter((_, i) => i !== index);
      }
      // На сервер уходит только отпускание кнопки: писать каждое движение мыши
      // значит слать сотню запросов на один перенос точки.
      data.onPointsChange?.(id, next, { commit: true });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [id, rf, data]);

  /**
   * Какая опора под курсором. Всё взаимодействие идёт по самой линии, а точки
   * мышь не ловят: пока они ловили, наведение прыгало между линией и точкой —
   * точка появлялась, забирала курсор у линии, линия «теряла» наведение, точка
   * исчезала. Здесь же решается, тянут существующую опору или ставят новую.
   */
  const pointAt = useCallback((flow) => {
    const near = (HANDLE_R * 2.2) / (rf.getZoom() || 1);
    let idx = -1;
    let best = near;
    points.forEach((q, i) => {
      const d = Math.hypot(q.x - flow.x, q.y - flow.y);
      if (d <= best) { best = d; idx = i; }
    });
    return idx;
  }, [points, rf]);

  /**
   * Нажатие на линию. На существующей опоре — тянем её. На чистом месте опора
   * появляется не сразу: сначала ждём, что курсор действительно поедет. Иначе
   * одиночный клик — которым связь выделяют или открывают её меню — каждый раз
   * оставлял бы точку.
   *
   * Событие наружу не глушим: клик должен дойти до React Flow и выделить связь.
   */
  const onLineDown = useCallback((e) => {
    if (e.button !== 0) return;
    const el = hitRef.current;
    const start = { x: e.clientX, y: e.clientY };
    const flow = rf.screenToFlowPosition(start);

    const hit = pointAt(flow);
    if (hit >= 0) { beginDrag(hit, points, e); return; }

    // Гнём линию ровно там, где взялись, — не там, куда попал курсор мимо неё.
    const grab = (el && closestOnPath(el, flow)) || flow;
    const pt = { x: Math.round(grab.x), y: Math.round(grab.y) };
    const at = segmentIndex(pt);

    const move = (ev) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_MIN) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const next = [...points.slice(0, at), pt, ...points.slice(at)];
      data.onPointsChange?.(id, next, { commit: false });
      beginDrag(at, next, ev);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [id, points, rf, data, beginDrag, segmentIndex, pointAt]);

  /** Двойной клик по опоре убирает её — на случай, если тащить некуда. */
  const onLineDoubleClick = useCallback((e) => {
    const hit = pointAt(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    if (hit < 0) return;
    e.stopPropagation();
    data.onPointsChange?.(id, points.filter((_, i) => i !== hit), { commit: true });
  }, [id, points, rf, data, pointAt]);

  /**
   * Призрак будущей опоры едет по линии за курсором.
   *
   * Не чаще кадра — и это не вежливость, а необходимость. Поиск ближайшей
   * точки пути стоит трёх десятков getPointAtLength, то есть трёх десятков
   * геометрических расчётов по кривой, а событий указателя приходит вдвое
   * больше, чем кадров. Пока считалось на каждое событие, достаточно было
   * провести мышью над графом, где линий много, чтобы холст встал: курсор над
   * связью почти всегда, и каждая под ним пересчитывала себя и перерисовывалась
   * заново.
   */
  const hoverFrame = useRef(0);
  const hoverAt = useRef(null);
  useEffect(() => () => { if (hoverFrame.current) cancelAnimationFrame(hoverFrame.current); }, []);

  const onLineMove = useCallback((e) => {
    if (dragging >= 0) return;
    hoverAt.current = { x: e.clientX, y: e.clientY };
    if (hoverFrame.current) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const el = hitRef.current;
      const at = hoverAt.current;
      if (!el || !at) return;
      const flow = rf.screenToFlowPosition(at);
      // Над поставленной опорой призрака нет — там подсвечена сама опора, и
      // видно, что нажатие возьмёт её, а не поставит вторую рядом.
      const hit = pointAt(flow);
      if (hit >= 0) { setHover((prev) => (prev?.idx === hit ? prev : { idx: hit })); return; }
      const p = closestOnPath(el, flow);
      if (!p) return;
      setHover((prev) => (
        prev && prev.idx < 0 && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5
          ? prev
          : { x: p.x, y: p.y, idx: -1 }
      ));
    });
  }, [rf, dragging, pointAt]);

  const onLineLeave = useCallback(() => {
    if (hoverFrame.current) { cancelAnimationFrame(hoverFrame.current); hoverFrame.current = 0; }
    hoverAt.current = null;
    setHover(null);
  }, []);

  return (
    <>
      {/* Градиент объявляем в пользовательских координатах: концы линии заданы
          в тех же единицах, что и узлы, поэтому переход всегда идёт вдоль неё. */}
      {gradient && (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={sx} y1={sy} x2={tx} y2={ty}
          >
            <stop offset="0%" stopColor={fromColor} />
            <stop offset="100%" stopColor={toColor} />
          </linearGradient>
        </defs>
      )}

      {/* Цвет отдаём стилю переменной, а не прямым stroke: инлайновое значение
          перебивало таблицу стилей, и связь переставала отзываться на курсор. */}
      {/* interactionWidth={0}: BaseEdge рисует свою широкую подложку для
          попадания мышью, и вместе с нашей их выходило по две на связь. Две
          подложки — это вдвое больше проверок попадания на каждое движение
          мыши по холсту, а работает всё равно только наша: на ней обработчики. */}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={0}
        style={{ ...style, "--sw-edge-self": stroke }}
      />

      {/* Широкая невидимая копия пути: попасть по двухпиксельной линии нельзя,
          а тянут именно за неё. */}
      <path
        ref={hitRef}
        className="react-flow__edge-interaction nodrag nopan"
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ cursor: dragging >= 0 ? "grabbing" : "grab" }}
        onPointerDown={onLineDown}
        onPointerMove={onLineMove}
        onDoubleClick={onLineDoubleClick}
        onPointerLeave={onLineLeave}
      />

      <EdgeLabelRenderer>
        {label && (
          <div
            className="sw-edge-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          >
            {label}
          </div>
        )}

        {/* Опоры показываем у выделенной связи и у той, что под курсором: точки
            на каждом ребре превращают холст в решето. Мышь сквозь них проходит —
            берут их нажатием на линию (см. onLineDown). */}
        {active && points.map((p, i) => (
          <div
            key={`${id}-p-${i}`}
            data-testid={`edge-point-${id}-${i}`}
            className={`sw-edge-point ${(hover?.idx === i || dragging === i) ? "is-hot" : ""}`}
            style={{
              transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
              width: HANDLE_R * 2,
              height: HANDLE_R * 2,
            }}
          />
        ))}

        {/* Призрак: показывает, где линия согнётся, если потянуть отсюда. */}
        {hover && hover.idx < 0 && dragging < 0 && (
          <div
            data-testid={`edge-add-point-${id}`}
            className="sw-edge-point is-add"
            style={{ transform: `translate(-50%, -50%) translate(${hover.x}px, ${hover.y}px)` }}
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(GradientEdge);
