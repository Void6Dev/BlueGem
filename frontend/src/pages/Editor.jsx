import {
  useEffect, useState, useCallback, useRef, useMemo, useDeferredValue, lazy, Suspense,
  startTransition,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ReactFlow, ReactFlowProvider, Background, MiniMap, useReactFlow, useStore as useFlowStore,
  useNodesState, useEdgesState, addEdge, BackgroundVariant, MarkerType, ConnectionMode,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { toast } from "sonner";
import {
  ArrowLeft, Settings, Plus, Search, Network,
  Layers, CalendarRange, X, Command, Download, Wand2, Keyboard, Maximize2,
  ChevronDown, ChevronUp, Minus, FileJson, FileText as FileTextIcon, Undo2,
  Link2, Unlink, Crosshair, Target, ArrowLeftRight, Pencil, Copy, Trash2,
  SquareDashedMousePointer, Spline, Waypoints, Scissors, Shapes,
  LayoutGrid, MoveHorizontal, Anchor, ClipboardPaste, Minimize2, Map as MapIcon, Eye, MoreHorizontal,
} from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import {
  applySettings, applyStoredAppearance, DEFAULT_EDGE_COLOR, EDGE_SHAPES, relTypesOf,
} from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { hotkey } from "@/lib/hotkey";
import { LAYOUTS } from "@/lib/layout";
import { pushEntry } from "@/lib/history";
import { downloadJson, downloadMarkdown } from "@/lib/exporters";
import CustomNode, { FAR_ZOOM } from "@/components/CustomNode";
import NodePreview from "@/components/NodePreview";
import EditorTopBar from "@/components/EditorTopBar";
import WorldTree from "@/components/WorldTree";
import GradientEdge from "@/components/GradientEdge";
import ContextMenu from "@/components/ContextMenu";
import { formatRange, normalizeEras, resolveCalendar, useChronology } from "@/lib/chrono";
import { NodeIcon } from "@/components/NodeIcon";

/* Панели и оверлеи — отдельными кусками сборки.
 *
 * Ни одна из них не нужна, чтобы показать холст, а весит эта компания больше
 * самого редактора: разбор markdown (react-markdown с micromark), анимации
 * (framer-motion), редакторы календаря и эпох. Пока они лежали в общем файле,
 * их разбирал и исполнял каждый запуск приложения — ради панели, которую могут
 * и не открыть.
 *
 * Задержки на первом открытии при этом нет: куски подтягиваются в простое,
 * сразу после того как холст показан (см. эффект с requestIdleCallback ниже). */
const NodeEditorPanel = lazy(() => import("@/components/NodeEditorPanel"));
const EdgeEditorPanel = lazy(() => import("@/components/EdgeEditorPanel"));
const SettingsPanel = lazy(() => import("@/components/SettingsPanel"));
const CommandPalette = lazy(() => import("@/components/CommandPalette"));
const ShortcutsDialog = lazy(() => import("@/components/ShortcutsDialog"));
const TimelinePanel = lazy(() => import("@/components/timeline/TimelinePanel"));

/** Подтянуть панели заранее, пока человек смотрит на холст. */
function warmPanels() {
  import("@/components/NodeEditorPanel");
  import("@/components/EdgeEditorPanel");
  import("@/components/CommandPalette");
  import("@/components/SettingsPanel");
  import("@/components/ShortcutsDialog");
  import("@/components/timeline/TimelinePanel");
}

/**
 * Перевести ссылки относительных дат на новые id узлов.
 *
 * Нужно везде, где узлы пересоздаются: копия, возврат удалённого.
 * Возвращает null, если менять было нечего, — чтобы не ходить на сервер зря.
 */
function remapDateRefs(dates, idMap) {
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

const nodeTypes = { custom: CustomNode };
const edgeTypes = { gradient: GradientEdge };
const SIDEBAR_KEY = "bluegem:sidebar";
const VIEW_KEY = "bluegem:view";

/** Где человек оставил холст в прошлый раз: свой ключ на каждый проект. */
function readView(projectId) {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    const v = all[projectId];
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeView(projectId, viewport) {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    all[projectId] = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    localStorage.setItem(VIEW_KEY, JSON.stringify(all));
  } catch {
    // Приватный режим или переполненное хранилище — потеря вида не повод падать.
  }
}
const NODE_W = 260;
const NODE_H = 150;
// Выше этого числа узлов вход не анимируется: staggered появление двухсот
// карточек — это мучительная секунда на каждом открытии проекта.
const ANIM_LIMIT = 40;
// Выше этого числа узлов React Flow держит в DOM только то, что попало в кадр.
// Своей виртуализации не пишем — она у библиотеки есть; порог нужен затем, что
// на маленьком графе монтирование при панорамировании стоит дороже, чем сотня
// готовых карточек, которые всё равно никто не пересобирает.
const CULL_LIMIT = 150;
// Один пустой массив на все карточки без соседей и без дат: свежий литерал
// в каждой проекции ломал бы сравнение по ссылке в самой карточке.
const EMPTY_LIST = [];
const EMPTY_OBJECT = {};

// Выше этого — «щадящий вид»: без бесконечных подсветок, без saturate() на
// каждой приглушённой карточке и без градиента в каждой линии. Смотри
// .sw-perf в index.css: там же перечислено, что именно гасится.
const PERF_LIMIT = 400;

/** Что показывает счётчик масштаба. Отдельный компонент с подпиской на холст:
 *  иначе каждый щелчок колеса перерисовывал бы весь редактор. */
function ZoomPercent() {
  const percent = useFlowStore((s) => Math.round(s.transform[2] * 100));
  return <>{percent}%</>;
}

/**
 * Отметка «холст отдалён» — класс .sw-far на холсте (см. index.css): связи
 * уходят на второй план за плашками узлов, подписи связей прячутся.
 * Отдельным компонентом и классом, а не состоянием редактора: подписка
 * срабатывает только на пересечении порога, и пересобирается один этот пустой
 * компонент, а не весь редактор.
 */
function FarZoomFlag({ targetRef }) {
  const far = useFlowStore((s) => s.transform[2] < FAR_ZOOM);
  useEffect(() => {
    targetRef.current?.classList.toggle("sw-far", far);
  }, [far, targetRef]);
  return null;
}

/**
 * Сетка холста. Две частоты: крупная даёт масштабный ориентир при отдалении,
 * мелкая — точность вблизи.
 *
 * Мелкая при этом рисуется только вблизи, и не ради красоты. Сетка — это
 * заливка узором во весь экран, и на каждый кадр движения она пересчитывается
 * заново; двух сеток разом — две заливки в кадр, и стоят они одинаково хоть
 * при пятидесяти карточках, хоть при пятистах. А на отдалении точки с шагом
 * в 22 единицы всё равно сходятся в серый шум: платить за них там не за что.
 *
 * Своя подписка на масштаб, а не значение из редактора: иначе каждый щелчок
 * колеса перерисовывал бы весь редактор.
 */
function CanvasGrid() {
  const fine = useFlowStore((s) => s.transform[2] >= 0.45);
  return (
    <>
      <Background
        id="coarse"
        variant={BackgroundVariant.Lines}
        gap={110}
        lineWidth={1}
        color="color-mix(in srgb, var(--sw-border) 22%, transparent)"
      />
      {fine && (
        <Background
          id="fine"
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.4}
          color="color-mix(in srgb, var(--sw-border) 55%, transparent)"
        />
      )}
    </>
  );
}

/** Цвет точки на мини-карте. Функция модульная, а не стрелка в разметке:
 *  новая на каждый рендер заставляла мини-карту обходить все узлы заново. */
const miniMapColor = (n) => n.data?.nodeType?.color || "#64748b";
// Мини-карта меньше штатной (200×150): в окне ноутбука та закрывала четверть
// холста, а для ориентира хватает и спичечного коробка. Размеры повторены в
// .sw-minimap-toggle (index.css) — кнопка стоит в её углу.
const MINIMAP_STYLE = { margin: 16, width: 176, height: 116 };
const PRO_OPTIONS = { hideAttribution: true };

/**
 * Содержимое узлов, не замечающее перетаскивания.
 *
 * React Flow подменяет объект узла на каждый кадр переноса, оставляя `data` тем
 * же. Всё, что считается по содержимому — теги, названия, соседи, — не должно
 * пересчитываться от того, что карточку подвинули на три пикселя. Сравниваем
 * ссылки на `data` (тот же приём, что в useChronology) и отдаём прежний список,
 * пока ни одна из них не сменилась.
 */
function useNodeContent(rfNodes) {
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
function useNodeFacts(rfNodes) {
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
function toRfEdge(e, settings) {
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
function copyTitle(title, taken) {
  const base = (title || "").replace(/\s*\(\d+\)\s*$/, "").trim();
  let n = 1;
  while (taken.has(`${base} (${n})`.toLowerCase())) n += 1;
  return `${base} (${n})`;
}

/** Изломы совпадают? Нужно, чтобы не писать в историю «правку», которой не было. */
function samePoints(a = [], b = []) {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

/** Строки дат совпадают? Та же роль, что и у sameNeighbours. */
function sameDateLines(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].key !== b[i].key || a[i].label !== b[i].label || a[i].text !== b[i].text) return false;
  }
  return true;
}

/** Списки соседей совпадают? По ним решается, перерисовывать ли карточку. */
function sameNeighbours(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.title !== y.title || x.outgoing !== y.outgoing
      || x.away !== y.away || x.rel !== y.rel || x.color !== y.color) return false;
  }
  return true;
}

function readSidebarPrefs() {
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

function EditorInner() {
  // tr, а не t: имя `t` в этом файле занято типами узлов и тегами.
  const tr = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const [project, setProject] = useState(null);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  // Узел, развёрнутый прямо на холсте (одиночный клик), и признак того, что
  // открыта правая панель (двойной клик). Раздельно: выделение узла само по
  // себе панель больше не открывает.
  const [expandedId, setExpandedId] = useState(null);
  // Узел в быстром просмотре (NodePreview): одиночный клик по карточке.
  const [previewId, setPreviewId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [focusField, setFocusField] = useState(null);   // к какому полю подъехать в панели
  const [highlightType, setHighlightType] = useState(null); // только что созданный тип узла
  const [showSettings, setShowSettings] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [menu, setMenu] = useState(null);         // right-click menu descriptor
  const [linkSource, setLinkSource] = useState(null); // "connect from this node" mode
  const [dragType, setDragType] = useState(null); // тип, который тянут из палитры
  const [sidebar, setSidebar] = useState(readSidebarPrefs);
  const [search, setSearch] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);   // на каком совпадении стоим
  const [focusMode, setFocusMode] = useState(false); // показывать только соседей
  const [activeTags, setActiveTags] = useState(() => new Set());
  const [currentCanvas, setCurrentCanvas] = useState("");
  const [renamingCanvas, setRenamingCanvas] = useState(null); // { id, label } вкладки на правке
  const paneRef = useRef(null);
  const searchRef = useRef(null);
  const undoRef = useRef([]);
  const visitedRef = useRef(false);   // по совпадениям поиска уже ходили?
  const projectSaveRef = useRef(null);

  const settings = project?.settings;
  // Свёртка через {...a} стоит O(n²) по количеству типов и пересобиралась на
  // каждый рендер редактора — обычный цикл делает то же за один проход.
  const typesById = useMemo(() => {
    const out = {};
    for (const t of settings?.nodeTypes || []) out[t.id] = t;
    return out;
  }, [settings]);
  // Типы связей проекта: набор один на меню линии, панель и выгрузку.
  // Стабильная ссылка нужна по той же причине, что и у холстов ниже.
  const relTypes = useMemo(() => relTypesOf(settings, tr), [settings, tr]);
  // Список холстов обязан быть стабильным: он лежит в зависимостях проекции
  // карточек, и новый массив на каждый рендер пересобирал бы их все.
  const canvases = useMemo(() => (settings?.canvases?.length
    ? settings.canvases
    : [{ id: "main", label: tr("editor.mainCanvas") }]), [settings, tr]);
  const mainCanvasId = canvases[0].id;
  const activeCanvas = canvases.some((c) => c.id === currentCanvas) ? currentCanvas : mainCanvasId;
  const nodeCanvas = useCallback((n) => n.data.canvas || mainCanvasId, [mainCanvasId]);

  const mapNode = useCallback((n, types) => ({
    id: n.id,
    type: "custom",
    position: n.position || { x: 0, y: 0 },
    data: { ...n, nodeType: types[n.typeId] || types["note"] || { color: "#64748b", icon: "FileText" } },
  }), []);

  // Пишем в localStorage с задержкой — иначе перетаскивание шторки бьёт по диску
  // на каждый кадр.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebar));
      } catch { /* приватный режим — ширина просто не запомнится */ }
    }, 250);
    return () => clearTimeout(t);
  }, [sidebar]);

  // Ширина меняется максимум раз в кадр: React Flow слушает размер холста через
  // ResizeObserver, и правка разметки на каждый mousemove роняет его в цикл
  // «ResizeObserver loop completed with undelivered notifications».
  const startSidebarResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebar.width;
    let frame = 0;
    let next = startW;
    const apply = () => {
      frame = 0;
      setSidebar((s) => (s.width === next ? s : { ...s, width: next }));
    };
    const move = (ev) => {
      next = Math.min(460, Math.max(210, startW + ev.clientX - startX));
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const up = () => {
      if (frame) cancelAnimationFrame(frame);
      apply();
      document.body.classList.remove("sw-resizing");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    document.body.classList.add("sw-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [sidebar.width]);

  useEffect(() => {
    (async () => {
      try {
        // Оба запроса уходят разом: граф не зависит от настроек, а ждать его
        // после проекта — лишний круг до сервера на каждом открытии.
        const projectPromise = api.getProject(id);
        const graphPromise = api.getGraph(id);
        const p = await projectPromise;
        setProject(p);
        applySettings(p.settings);
        const g = await graphPromise;
        const tById = {};
        for (const t of p.settings.nodeTypes || []) tById[t.id] = t;
        // Переходом, а не обычным обновлением. Во-первых, React волен прерывать
        // такую отрисовку — на тысяче карточек это разница между «окно не
        // отвечает» и «карточки появляются». Во-вторых, отложенные производные
        // (nodeFacts ниже) на переходе догоняют тем же проходом, а не вторым:
        // отставать здесь незачем — это не набор в поле, а разовая загрузка.
        startTransition(() => {
          setRfNodes(g.nodes.map((n) => mapNode(n, tById)));
          setRfEdges(g.edges.map((e) => toRfEdge(e, p.settings)));
        });
      } catch (e) {
        toast.error(apiErrorMessage(e, "errors.projectNotFound"));
        navigate("/");
      }
    })();
    // Leaving the editor: fall back to the remembered global appearance.
    return () => applyStoredAppearance();
    // eslint-disable-next-line
  }, [id]);

  // Панели подтягиваем, когда основному потоку нечем заняться: к первому
  // открытию они уже здесь, а к показу холста не имеют отношения.
  useEffect(() => {
    const idle = window.requestIdleCallback;
    if (!idle) { const t = setTimeout(warmPanels, 1200); return () => clearTimeout(t); }
    const handle = idle(warmPanels, { timeout: 3000 });
    return () => window.cancelIdleCallback?.(handle);
  }, []);

  // Re-apply node type visuals & edge type when settings change
  useEffect(() => {
    if (!settings) return;
    applySettings(settings);
    // Настройки меняются целым объектом — от смены акцента до переключателя
    // мини-карты. Подменять при этом данные всех узлов и связей значит
    // пересобирать весь холст на каждое движение ползунка цвета. Меняем только
    // то, что и правда стало другим, и возвращаем прежний список, если ничего.
    setRfNodes((nds) => {
      let touched = false;
      const next = nds.map((n) => {
        const nodeType = typesById[n.data.typeId] || typesById["note"] || n.data.nodeType;
        if (nodeType === n.data.nodeType) return n;
        touched = true;
        return { ...n, data: { ...n.data, nodeType } };
      });
      return touched ? next : nds;
    });
    // Тип ребра всегда наш: настройка edgeType задаёт лишь форму линии внутри
    // него. Присвоение её в type подменяло наш компонент штатным, и связь
    // теряла и градиент, и точки излома.
    setRfEdges((eds) => {
      let touched = false;
      const animated = !!settings.animatedEdges;
      const next = eds.map((e) => {
        // Своя форма связи важнее общей: настройка задаёт форму тем линиям,
        // которым её не задавали отдельно.
        const shape = e.data?.shapeOwn || settings.edgeType || "smoothstep";
        if (e.type === "gradient" && e.animated === animated && e.data?.shape === shape) return e;
        touched = true;
        return { ...e, type: "gradient", data: { ...e.data, shape }, animated };
      });
      return touched ? next : eds;
    });
    // eslint-disable-next-line
  }, [settings]);

  const persistSettings = useCallback(async (newSettings) => {
    setProject((p) => ({ ...p, settings: newSettings }));
    try {
      await api.updateProject(id, { settings: newSettings });
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.saveSettings"));
    }
  }, [id]);

  // Project name/description edits are debounced — the user is typing.
  const patchProject = useCallback((patch) => {
    setProject((p) => ({ ...p, ...patch }));
    clearTimeout(projectSaveRef.current);
    projectSaveRef.current = setTimeout(() => {
      api.updateProject(id, patch).catch((e) => toast.error(apiErrorMessage(e, "errors.saveProject")));
    }, 700);
  }, [id]);

  /* ---------------- graph helpers ---------------- */

  const centerOfView = useCallback((offsetIndex = 0) => {
    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const p = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    // Nudge each new node so a burst of them doesn't land in one stack.
    return { x: p.x - NODE_W / 2 + (offsetIndex % 5) * 28, y: p.y - NODE_H / 2 + (offsetIndex % 5) * 24 };
  }, [rf]);

  const focusNode = useCallback((nodeId) => {
    // Центрируем через три кадра, а не сразу. Панель узла закреплена и сужает
    // холст, а новую ширину React Flow узнаёт от наблюдателя за размером —
    // он в этом проекте отложен на кадр (lib/quietResizeObserver.js). Сразу
    // центр считался по прежней ширине, и узел, ради которого открыли
    // панель, оказывался у самого её края.
    const run = () => {
      const n = rf.getNode(nodeId);
      if (!n) return;
      const w = n.measured?.width || NODE_W;
      const h = n.measured?.height || NODE_H;
      rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 1.05, duration: 420 });
    };
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(run)));
  }, [rf]);

  const openNodeById = useCallback((nodeId) => {
    const found = rf.getNode(nodeId);
    if (!found) return;
    // Jumping to a node on another canvas should switch canvases too.
    const canvasOf = found.data.canvas || mainCanvasId;
    if (canvasOf !== activeCanvas) setCurrentCanvas(canvasOf);
    setSelectedEdge(null);
    setShowSettings(false);
    setShowTimeline(false);
    setSelectedNode(found.data);
    // Переход к узлу из списка, поиска или палитры — намеренный: здесь панель
    // нужна сразу, в отличие от простого клика по карточке.
    setPanelOpen(true);
    setPreviewId(null);
    focusNode(nodeId);
  }, [rf, focusNode, activeCanvas, mainCanvasId]);

  /**
   * Перевести быстрый просмотр на другой узел — по связи или [[ссылке]] из
   * превью. Холст подводит узел к центру, масштаб не трогаем: человек выбрал
   * его сам, и прыжок зума посреди чтения сбивает с места.
   */
  const peekNode = useCallback((nodeId) => {
    const found = rf.getNode(nodeId);
    if (!found) return;
    const canvasOf = found.data.canvas || mainCanvasId;
    if (canvasOf !== activeCanvas) setCurrentCanvas(canvasOf);
    setSelectedNode(found.data);
    setPreviewId(nodeId);
    // Выделение переезжает вместе с превью: иначе рамка оставалась на узле,
    // с которого ушли, и казалось, что смотрим всё ещё его. Новые объекты —
    // только у тех, чьё выделение и правда сменилось.
    setRfNodes((nds) => nds.map((n) => (!!n.selected === (n.id === nodeId) ? n : { ...n, selected: n.id === nodeId })));
    const w = found.measured?.width || NODE_W;
    const h = found.measured?.height || NODE_H;
    rf.setCenter(found.position.x + w / 2, found.position.y + h / 2, { zoom: rf.getZoom(), duration: 320 });
  }, [rf, activeCanvas, mainCanvasId, setRfNodes]);

  // Клик по названию или описанию на карточке открывает панель и подсказывает
  // ей, к какому полю подвести ползунок. Метка времени — чтобы повторный клик
  // по тому же полю снова сработал.
  const focusNodeField = useCallback((nodeId, field) => {
    const found = rf.getNode(nodeId);
    if (!found) return;
    setShowSettings(false);
    setShowTimeline(false);
    setSelectedEdge(null);
    setSelectedNode(found.data);
    setPanelOpen(true);
    setFocusField({ field, at: Date.now() });
  }, [rf]);

  /**
   * Правка из панели попадает на холст сразу, в том же кадре: на сервер она
   * уедет автосохранением через секунду, но ждать этого, чтобы увидеть новое
   * название на карточке, незачем.
   */
  const patchNodeLocal = useCallback((nodeId, patch) => {
    // Переходом: буква набирается в панели, а на холсте от неё меняется одна
    // карточка — но пересобрать ради этого приходится проекцию всего графа,
    // и React Flow заново примеряет весь список узлов. Пока это шло срочным
    // обновлением, каждое нажатие держало поток целиком; переход отдаёт ввод
    // вперёд, а холст догоняет в ближайшем окне. Видно то же самое: правка
    // доезжает до карточки за кадр-другой, а не через паузу, как было бы
    // с отложенной отправкой.
    startTransition(() => {
      setRfNodes((nds) => nds.map((n) => (n.id === nodeId
        ? { ...n, data: { ...n.data, ...patch } } : n)));
      setSelectedNode((sel) => (sel && sel.id === nodeId ? { ...sel, ...patch } : sel));
    });
  }, [setRfNodes]);

  /* ---------------- запись в историю ----------------
     Сама отмена (restore) живёт ниже — ей нужны настройки и карта типов. Запись
     стоит здесь, до первых правок графа: класть в историю умеет каждая из них. */

  const pushUndo = useCallback((entry) => {
    undoRef.current = pushEntry(undoRef.current, entry);
  }, []);

  /** Короткие обёртки: вид записи виден на месте вызова, а не в её полях. */
  const undoNodePatch = useCallback((items) => {
    if (items.length) pushUndo({ kind: "nodePatch", items });
  }, [pushUndo]);
  const undoEdgePatch = useCallback((items) => {
    if (items.length) pushUndo({ kind: "edgePatch", items });
  }, [pushUndo]);
  const undoCreated = useCallback((nodeIds, edgeIds = []) => {
    if (nodeIds.length || edgeIds.length) pushUndo({ kind: "created", nodeIds, edgeIds });
  }, [pushUndo]);
  /** Снимок настроек до правки: холсты, типы узлов, вид графа. */
  const undoSettings = useCallback(() => {
    if (settings) pushUndo({ kind: "settings", before: settings });
  }, [pushUndo, settings]);

  /** Правка настроек из панели — с записью в историю. */
  const changeSettings = useCallback((next) => {
    undoSettings();
    persistSettings(next);
  }, [undoSettings, persistSettings]);

  // Переименование прямо на карточке (двойной клик по названию).
  const renameNode = useCallback((nodeId, title) => {
    const was = rf.getNode(nodeId)?.data?.title ?? "";
    undoNodePatch([{ id: nodeId, before: { title: was } }]);
    patchNodeLocal(nodeId, { title });
    api.updateNode(nodeId, { title }).catch((e) => toast.error(apiErrorMessage(e, "errors.saveNode")));
  }, [patchNodeLocal, rf, undoNodePatch]);

  const resizeNode = useCallback((nodeId, width) => {
    undoNodePatch([{ id: nodeId, before: { width: rf.getNode(nodeId)?.data?.width || 0 } }]);
    patchNodeLocal(nodeId, { width });
    api.updateNode(nodeId, { width }).catch((e) => toast.error(apiErrorMessage(e, "errors.saveNode")));
  }, [patchNodeLocal, rf, undoNodePatch]);

  /** Правка даты из хронологии: там её меняют, не открывая панель узла. */
  const setNodeDates = useCallback((nodeId, dates) => {
    undoNodePatch([{ id: nodeId, before: { dates: rf.getNode(nodeId)?.data?.dates || [] } }]);
    patchNodeLocal(nodeId, { dates });
    api.updateNode(nodeId, { dates }).catch((e) => toast.error(apiErrorMessage(e, "errors.saveNode")));
  }, [patchNodeLocal, rf, undoNodePatch]);

  /** Вид одной карточки: "" — как в настройках проекта, иначе только её. */
  const setNodeCardMode = useCallback((nodeIds, cardMode) => {
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
    undoNodePatch(ids.map((nid) => ({
      id: nid, before: { cardMode: rf.getNode(nid)?.data?.cardModeOwn || "" },
    })));
    ids.forEach((nid) => {
      patchNodeLocal(nid, { cardMode });
      api.updateNode(nid, { cardMode }).catch((e) => toast.error(apiErrorMessage(e, "errors.saveNode")));
    });
  }, [patchNodeLocal, rf, undoNodePatch]);

  const addNode = useCallback(async (typeId, position, extra = {}, opts = {}) => {
    const t = typesById[typeId] || Object.values(typesById)[0];
    try {
      const node = await api.createNode(id, {
        typeId: t?.id || "note",
        title: extra.title ?? `${t?.label || tr("edge.node")}`,
        description: "",
        fields: [],
        position: position || centerOfView(rfNodes.length),
        canvas: activeCanvas,
        ...extra,
      });
      // Создание тоже откатывается — кроме случаев, когда вызвавший соберёт
      // свою запись из нескольких шагов (узел вместе со связью, вставка пачки).
      if (opts.undo !== false) undoCreated([node.id]);
      setRfNodes((nds) => [...nds, mapNode(node, typesById)]);
      setSelectedEdge(null);
      setSelectedNode(node);
      return node;
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.createNode"));
      return null;
    }
    // eslint-disable-next-line
  }, [id, typesById, activeCanvas, rfNodes.length, centerOfView, mapNode]);

  const duplicateNode = useCallback(async (src) => {
    if (!src) return;
    try {
      // Занятые имена спрашиваем у React Flow в момент нажатия — держать список
      // узлов в зависимостях значило бы пересобирать обработчик на каждый кадр
      // переноса карточки (тот же приём, что в copyNodes ниже).
      const taken = new Set(rf.getNodes().map((n) => (n.data.title || "").toLowerCase()));
      const node = await api.createNode(id, {
        typeId: src.typeId,
        title: copyTitle(src.title || tr("edge.node"), taken),
        description: src.description || "",
        fields: (src.fields || []).map((f) => ({ key: f.key, value: f.value })),
        position: { x: (src.position?.x || 0) + 48, y: (src.position?.y || 0) + 48 },
        tags: src.tags || [],
        image: src.image || "",
        date: src.date || "",
        dates: src.dates || [],
        canvas: src.canvas || activeCanvas,
      });
      // Дата, считавшаяся от самого узла («конец — через три года после
      // начала»), в копии должна считаться от копии, а не от оригинала.
      const remapped = remapDateRefs(node.dates, { [src.id]: node.id });
      const fixed = remapped ? await api.updateNode(node.id, { dates: remapped }) : node;
      undoCreated([node.id]);
      setRfNodes((nds) => [...nds, mapNode(fixed, typesById)]);
      setSelectedEdge(null);
      setSelectedNode(node);
      toast.success(tr("editor.toasts.nodeDuplicated"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.duplicateNode"));
    }
    // eslint-disable-next-line
  }, [id, mapNode, typesById, activeCanvas, rf]);

  /* ---------------- буфер узлов ---------------- */

  // Свой буфер, а не системный: в системный кладётся текст, а нам нужны поля,
  // теги и связи между скопированными узлами. Живёт до перезагрузки страницы.
  const clipboardRef = useRef(null);

  const copyNodes = useCallback(() => {
    // Как и расстановка, спрашиваем граф у React Flow в момент нажатия: списки
    // в зависимостях означали бы новый обработчик на каждый кадр переноса.
    const picked = rf.getNodes().filter((n) => n.selected && nodeCanvas(n) === activeCanvas);
    const chosen = picked.length ? picked : (selectedNode ? [{ data: selectedNode }] : []);
    if (!chosen.length) return;
    const ids = new Set(chosen.map((n) => n.data.id));
    clipboardRef.current = {
      nodes: chosen.map((n) => n.data),
      // Связи копируются только внутренние: висящий конец на той стороне
      // вставлять некуда, а тянуть за собой полграфа человек не просил.
      edges: rf.getEdges().filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
    toast.success(tr("editor.toasts.copied", { count: chosen.length }));
    // eslint-disable-next-line
  }, [rf, selectedNode, activeCanvas, nodeCanvas]);

  const pasteNodes = useCallback(async () => {
    const buf = clipboardRef.current;
    if (!buf || !buf.nodes.length) return;
    const idMap = {};
    // Вставка пачки — один шаг истории, а не двадцать: отменять её по узлу
    // никто не хочет.
    const madeEdges = [];
    // Имя нумеруется только если такое уже есть: вставка на чистый холст или
    // в другой проект должна сохранить имя как было, а не приписать «(1)»
    // на пустом месте.
    const taken = new Set(rf.getNodes().map((n) => (n.data.title || "").toLowerCase()));
    try {
      for (const n of buf.nodes) {
        const title = taken.has((n.title || "").toLowerCase())
          ? copyTitle(n.title || tr("edge.node"), taken)
          : n.title;
        taken.add((title || "").toLowerCase());
        // Смещение, чтобы копия не легла точно поверх оригинала и её было видно.
        const created = await api.createNode(id, {
          typeId: n.typeId, title, description: n.description,
          fields: (n.fields || []).map((f) => ({ key: f.key, value: f.value })),
          position: { x: (n.position?.x || 0) + 36, y: (n.position?.y || 0) + 36 },
          tags: n.tags || [], image: n.image || "", date: n.date || "",
          dates: n.dates || [], canvas: activeCanvas,
          width: n.width || 0, cardMode: n.cardMode || "",
        });
        idMap[n.id] = created.id;
        setRfNodes((nds) => [...nds, mapNode(created, typesById)]);
      }
      for (const e of buf.edges) {
        const edge = await api.createEdge(id, {
          source: idMap[e.source], target: idMap[e.target], label: e.label || "",
          relType: e.data?.relType || "", color: e.data?.color || "",
          shape: e.data?.shapeOwn || "",
          sourceHandle: e.sourceHandle || "", targetHandle: e.targetHandle || "",
        });
        madeEdges.push(edge.id);
        setRfEdges((eds) => [...eds.filter((x) => x.id !== edge.id), toRfEdge(edge, settings)]);
      }
      toast.success(tr("editor.toasts.pasted", { count: buf.nodes.length }));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.createNode"));
    }
    undoCreated(Object.values(idMap), madeEdges);
    // eslint-disable-next-line
  }, [id, activeCanvas, mapNode, typesById, settings, rf]);

  /* ---------------- undo ---------------- */

  /**
   * Откат одной записи истории. Что именно делать, говорит её kind.
   *
   * Раньше вид записи угадывался по тому, какое поле в ней заполнено, и любое
   * новое действие, не попавшее ни в одну ветку, молча не откатывалось. Теперь
   * ветка одна на вид записи, и добавить действие — значит завести запись
   * нужного вида, а не вспомнить про угадайку.
   */
  const restore = useCallback(async (entry) => {
    const idMap = {};
    try {
      // Возврат узлов на прежние места. Отдельная ветка: узлы никуда не
      // делись, воскрешать нечего — достаточно вернуть координаты.
      if (entry.kind === "positions") {
        setRfNodes((nds) => nds.map((n) => {
          const back = entry.positions.find((p) => p.id === n.id);
          return back ? { ...n, position: back.position } : n;
        }));
        await api.updatePositions(id, entry.positions);
        toast.success(tr("editor.toasts.moveUndone"));
        return;
      }
      // Откат правки узлов: пишем обратно то, что было до неё. Список, а не
      // один узел, — перенос выделения на другой холст правит их пачкой.
      if (entry.kind === "nodePatch") {
        const back = await Promise.all(entry.items.map((it) => api.updateNode(it.id, it.before)));
        const byId = new Map(back.map((n) => [n.id, n]));
        setRfNodes((nds) => nds.map((x) => (byId.has(x.id)
          ? { ...mapNode(byId.get(x.id), typesById), position: x.position, selected: x.selected, measured: x.measured }
          : x)));
        setSelectedNode((sel) => (sel && byId.has(sel.id) ? byId.get(sel.id) : sel));
        toast.success(tr("editor.toasts.undone"));
        return;
      }
      if (entry.kind === "edgePatch") {
        const back = await Promise.all(entry.items.map((it) => api.updateEdge(it.id, it.before)));
        const byId = new Map(back.map((e) => [e.id, e]));
        setRfEdges((eds) => eds.map((e) => (byId.has(e.id) ? toRfEdge(byId.get(e.id), settings) : e)));
        setSelectedEdge((sel) => (sel && byId.has(sel.id) ? null : sel));
        toast.success(tr("editor.toasts.undone"));
        return;
      }
      // Отмена создания: убрать то, что появилось. Связи снимаем первыми —
      // удаление узла и так уносит их, но так порядок не зависит от сервера.
      if (entry.kind === "created") {
        const edgeIds = entry.edgeIds || [];
        const nodeIds = entry.nodeIds || [];
        await Promise.all([
          ...edgeIds.map((eid) => api.deleteEdge(eid)),
          ...nodeIds.map((nid) => api.deleteNode(nid)),
        ]);
        setRfEdges((eds) => eds.filter((e) => !edgeIds.includes(e.id)
          && !nodeIds.includes(e.source) && !nodeIds.includes(e.target)));
        setRfNodes((nds) => nds.filter((n) => !nodeIds.includes(n.id)));
        setSelectedNode((sel) => (sel && nodeIds.includes(sel.id) ? null : sel));
        setSelectedEdge((sel) => (sel && edgeIds.includes(sel.id) ? null : sel));
        toast.success(tr("editor.toasts.undone"));
        return;
      }
      // Настройки проекта целиком: холсты, типы узлов, вид графа. Пишем весь
      // объект — разбирать, что именно в нём поменялось, незачем.
      if (entry.kind === "settings") {
        persistSettings(entry.before);
        toast.success(tr("editor.toasts.undone"));
        return;
      }
      const restored = [];
      for (const n of entry.nodes) {
        const created = await api.createNode(id, {
          typeId: n.typeId, title: n.title, description: n.description,
          fields: (n.fields || []).map((f) => ({ key: f.key, value: f.value })),
          position: n.position, tags: n.tags || [], image: n.image || "",
          date: n.date || "", dates: n.dates || [], canvas: n.canvas || "",
          width: n.width || 0, cardMode: n.cardMode || "",
        });
        idMap[n.id] = created.id;
        restored.push(created);
        setRfNodes((nds) => [...nds, mapNode(created, typesById)]);
      }
      // Ссылки относительных дат указывают на прежние id: узлы вернулись
      // под новыми. Переводим их после того, как созданы все, — цепочка могла
      // ссылаться вперёд.
      for (const created of restored) {
        const remapped = remapDateRefs(created.dates, idMap);
        if (!remapped) continue;
        const fixed = await api.updateNode(created.id, { dates: remapped });
        setRfNodes((nds) => nds.map((x) => (x.id === fixed.id
          ? { ...mapNode(fixed, typesById), position: x.position, measured: x.measured } : x)));
      }
      for (const e of entry.edges) {
        const source = idMap[e.source] || e.source;
        const target = idMap[e.target] || e.target;
        if (!rf.getNode(source) && !idMap[e.source]) continue;
        const edge = await api.createEdge(id, {
          source, target, label: e.label || "",
          relType: e.data?.relType || "", color: e.data?.color || "",
          points: e.data?.points || [], shape: e.data?.shapeOwn || "",
          sourceHandle: e.sourceHandle || "", targetHandle: e.targetHandle || "",
        });
        setRfEdges((eds) => [...eds.filter((x) => x.id !== edge.id), toRfEdge(edge, settings)]);
      }
      toast.success(tr("editor.toasts.restored"));
    } catch (err) {
      toast.error(apiErrorMessage(err, "errors.undo"));
    }
    // eslint-disable-next-line
  }, [id, mapNode, typesById, settings, rf, persistSettings]);

  const undo = useCallback(() => {
    const entry = undoRef.current.pop();
    if (!entry) return toast(tr("editor.toasts.nothingToRestore"));
    return restore(entry);
  }, [restore]);

  /* ---------------- react flow handlers ---------------- */

  const connectNodes = useCallback(async (source, target, patch = {}, opts = {}) => {
    if (!source || !target || source === target) return null;
    try {
      const edge = await api.createEdge(id, { source, target, ...patch });
      if (opts.undo !== false) undoCreated([], [edge.id]);
      // sw-edge-new: линия прочерчивается от источника к цели за 260 мс —
      // ощущение, что действие сработало, стоит четырёх строк CSS.
      setRfEdges((eds) => addEdge(
        { ...toRfEdge(edge, settings), className: "sw-edge-new" },
        eds.filter((e) => e.id !== edge.id)
      ));
      // Просим React Flow пересчитать координаты точек связи у обоих узлов:
      // размеры он снимает один раз, и первая линия иначе может уйти мимо точки.
      updateNodeInternals([source, target]);
      return edge;
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.createEdge"));
      return null;
    }
  }, [id, settings, setRfEdges, updateNodeInternals, undoCreated]);

  const onConnect = useCallback(
    (conn) => connectNodes(conn.source, conn.target, {
      sourceHandle: conn.sourceHandle || "",
      targetHandle: conn.targetHandle || "",
    }),
    [connectNodes]
  );

  /**
   * Точки излома связи. commit=false — это ещё тянут мышью: обновляем только
   * состояние, иначе на один перенос точки уходит сотня запросов. На сервер
   * пишем по отпусканию кнопки.
   */
  const pointsBeforeRef = useRef({});
  const onPointsChange = useCallback((edgeId, points, { commit } = {}) => {
    setRfEdges((eds) => eds.map((e) => {
      if (e.id !== edgeId) return e;
      // Каким излом был до того, как за него взялись. Снимаем здесь, внутри
      // обновления: к отпусканию кнопки прежние точки уже затёрты, а держать
      // ради этого весь список рёбер в зависимостях — значит пересоздавать
      // обработчик на каждое движение мыши.
      if (!pointsBeforeRef.current[edgeId]) pointsBeforeRef.current[edgeId] = e.data?.points || [];
      return { ...e, data: { ...e.data, points } };
    }));
    if (!commit) return;
    const before = pointsBeforeRef.current[edgeId];
    delete pointsBeforeRef.current[edgeId];
    // Нажали на опору и отпустили, не сдвинув, — ничего не менялось. Прежде
    // такое отпускание всё равно писало в историю запись с пустым «до», и
    // следующий Ctrl+Z распрямлял линию целиком, хотя её никто не трогал.
    if (!before || samePoints(before, points)) return;
    undoEdgePatch([{ id: edgeId, before: { points: before } }]);
    api.updateEdge(edgeId, { points }).catch((e) => toast.error(apiErrorMessage(e, "errors.saveEdge")));
  }, [setRfEdges, undoEdgePatch]);

  /** Убрать все изломы связи — «выпрямить» из меню. */
  const straightenEdge = useCallback((edge) => {
    undoEdgePatch([{ id: edge.id, before: { points: edge.data?.points || [] } }]);
    setRfEdges((eds) => eds.map((e) => (e.id === edge.id ? { ...e, data: { ...e.data, points: [] } } : e)));
    api.updateEdge(edge.id, { points: [] }).catch((e) => toast.error(apiErrorMessage(e, "errors.saveEdge")));
  }, [setRfEdges, undoEdgePatch]);

  /**
   * Поставить крепление там, где вызвали меню. Мышью его ставят протяжкой самой
   * линии (см. GradientEdge), но узнать об этом неоткуда — поэтому то же самое
   * есть и пунктом меню.
   */
  const addEdgePoint = useCallback((edge, at) => {
    const pt = { x: Math.round(at.x), y: Math.round(at.y) };
    const points = [...(edge.data?.points || [])];
    // Куда вставить: перед той опорой, которая дальше по пути от источника.
    const src = rf.getNode(edge.source)?.position || { x: 0, y: 0 };
    const dist = (p) => Math.hypot(p.x - src.x, p.y - src.y);
    const idx = points.findIndex((p) => dist(p) > dist(pt));
    const next = idx === -1 ? [...points, pt] : [...points.slice(0, idx), pt, ...points.slice(idx)];
    undoEdgePatch([{ id: edge.id, before: { points } }]);
    setRfEdges((eds) => eds.map((e) => (e.id === edge.id ? { ...e, data: { ...e.data, points: next } } : e)));
    api.updateEdge(edge.id, { points: next }).catch((e) => toast.error(apiErrorMessage(e, "errors.saveEdge")));
  }, [rf, setRfEdges, undoEdgePatch]);

  /** Форма именно этой линии; "" — вернуться к общей из настроек. */
  const setEdgeShape = useCallback(async (edge, shape) => {
    undoEdgePatch([{ id: edge.id, before: { shape: edge.data?.shapeOwn || "" } }]);
    try {
      const updated = await api.updateEdge(edge.id, { shape });
      setRfEdges((eds) => eds.map((e) => (e.id === edge.id ? toRfEdge(updated, settings) : e)));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.saveEdge"));
    }
  }, [settings, setRfEdges, undoEdgePatch]);

  // One handler for both: React Flow reports a node deletion together with the
  // edges it took down, so undo can restore the whole thing as a unit.
  const onDelete = useCallback(({ nodes = [], edges = [] }) => {
    if (!nodes.length && !edges.length) return;
    const ids = new Set(nodes.map((n) => n.id));
    pushUndo({ kind: "restore", nodes: nodes.map((n) => n.data), edges });
    // Одно сообщение на всю неудавшуюся пачку: если сервер лёг, десять
    // одинаковых тостов подряд пользы не добавят.
    let failed = false;
    const report = () => { if (!failed) { failed = true; toast.error(tr("errors.deleteNode")); } };
    nodes.forEach((n) => api.deleteNode(n.id).catch(report));
    edges.filter((e) => !ids.has(e.source) && !ids.has(e.target))
      .forEach((e) => api.deleteEdge(e.id).catch(report));
    setSelectedNode((sel) => (sel && ids.has(sel.id) ? null : sel));
    setSelectedEdge((sel) => (sel && edges.some((e) => e.id === sel.id) ? null : sel));
    const what = [
      nodes.length ? tr("count.nodes", { count: nodes.length }) : null,
      edges.length ? tr("count.edges", { count: edges.length }) : null,
    ].filter(Boolean).join(", ");
    toast.success(tr("editor.toasts.deleted", { what }), {
      action: { label: tr("common.restore"), onClick: undo },
    });
  }, [pushUndo, undo]);

  /**
   * Перенос узлов. React Flow тащит всё выделение, а сообщает только про тот
   * узел, за который взялись, — если сохранять его одного, остальные после
   * перезагрузки прыгают на прежнее место. Поэтому пишем всё выделение разом
   * пакетным запросом.
   */
  const onNodeDragStop = useCallback((_, node, dragged) => {
    const moved = (dragged && dragged.length ? dragged : [node]);
    const positions = moved.map((n) => ({ id: n.id, position: n.position }));
    // Перенос — обычная правка, и её тоже нужно уметь отменить.
    pushUndo({
      kind: "positions",
      positions: moved.map((n) => ({ id: n.id, position: dragStartRef.current.get(n.id) || n.position })),
    });
    const request = positions.length === 1
      ? api.updateNode(positions[0].id, { position: positions[0].position })
      : api.updatePositions(id, positions);
    request.catch((e) => toast.error(apiErrorMessage(e, "errors.saveNode")));
  }, [id, pushUndo]);

  // Вид холста читаем один раз при монтировании: перечитывать его на каждый
  // кадр незачем, а defaultViewport всё равно применяется только на старте.
  const [savedView] = useState(() => readView(id));
  const viewRef = useRef(null);

  /**
   * «Холст едет» — классом, а не состоянием.
   *
   * Пока идёт движение, часть оформления гасится (см. .sw-moving в index.css):
   * это те эффекты, которые пересчитываются на каждый кадр и стоят одинаково
   * при пятидесяти карточках и при пятистах. Классом — потому что onMove
   * приходит на каждый кадр, и setState здесь пересобирал бы весь редактор
   * шестьдесят раз в секунду, то есть лечил бы рывки рывками.
   *
   * Снимаем по таймеру, а не по onMoveEnd: конец жеста приходит не всегда —
   * прерванный зум колесом, увод курсора за окно, — и класс оставался бы
   * висеть, тихо забрав у холста половину оформления.
   */
  /**
   * Пересчёт точек связи — одной пачкой на всех.
   *
   * updateNodeInternals из React Flow принимает список, но карточки звали его
   * поодиночке, каждая про себя. А внутри у него на каждый вызов свой поиск по
   * DOM и своё обновление хранилища — и вот это второе стоит дорого не само по
   * себе: на любое изменение хранилища каждая связь заново считает положение
   * своих концов, каждая карточка — свою ступень детализации, мини-карта —
   * границы всего графа. Шестьдесят вызовов подряд превращаются в шестьдесят
   * таких обходов вместо одного.
   *
   * Случается это не в редкий момент, а в самый частый: ступень детализации
   * меняется от зума, то есть все карточки просят пересчёт одновременно, прямо
   * посреди движения холста. Отсюда и ощущение, что при каждом движении граф
   * «весь перепроверяется и переставляется».
   */
  const measureRef = useRef({ ids: new Set(), frame: 0 });
  const requestMeasure = useCallback((nodeId) => {
    const q = measureRef.current;
    q.ids.add(nodeId);
    if (q.frame) return;
    q.frame = requestAnimationFrame(() => {
      q.frame = 0;
      const ids = Array.from(q.ids);
      q.ids.clear();
      if (ids.length) updateNodeInternals(ids);
    });
  }, [updateNodeInternals]);
  useEffect(() => () => {
    if (measureRef.current.frame) cancelAnimationFrame(measureRef.current.frame);
  }, []);

  const moveRef = useRef({ on: false, timer: 0 });
  const markMoving = useCallback(() => {
    const m = moveRef.current;
    if (!m.on) {
      m.on = true;
      paneRef.current?.classList.add("sw-moving");
    }
    clearTimeout(m.timer);
    m.timer = setTimeout(() => {
      m.on = false;
      paneRef.current?.classList.remove("sw-moving");
    }, 160);
  }, []);
  useEffect(() => () => clearTimeout(moveRef.current.timer), []);

  // Где узлы стояли до переноса — иначе отменять некуда.
  const dragStartRef = useRef(new Map());
  const onNodeDragStart = useCallback((_, node, dragged) => {
    const moved = (dragged && dragged.length ? dragged : [node]);
    dragStartRef.current = new Map(moved.map((n) => [n.id, { ...n.position }]));
  }, []);

  const onNodeClick = useCallback((_, node) => {
    // While "связать с…" is armed, the next node click closes the link.
    if (linkSource) {
      if (linkSource !== node.id) connectNodes(linkSource, node.id).then((e) => e && toast.success(tr("editor.toasts.edgeCreated")));
      setLinkSource(null);
      return;
    }
    setShowSettings(false);
    setShowTimeline(false);
    setSelectedEdge(null);
    setSelectedNode(node.data);
    // Одиночный клик открывает быстрый просмотр рядом с карточкой, а панель
    // справа не трогает: чаще всего нужно просто заглянуть в узел, и ради
    // этого не стоит отдавать треть экрана редактору. Раньше клик разворачивал
    // саму карточку, и она ложилась поверх соседей; разворот на холсте
    // остался в меню узла.
    setPreviewId((cur) => (cur === node.id ? null : node.id));
    setPanelOpen(false);
  }, [linkSource, connectNodes]);

  const onNodeDoubleClick = useCallback((_, node) => {
    setPreviewId(null);
    setPanelOpen(true);
    focusNode(node.id);
  }, [focusNode]);

  const onEdgeClick = useCallback((_, edge) => {
    setSelectedNode(null);
    setShowSettings(false);
    setShowTimeline(false);
    setSelectedEdge(edge);
  }, []);

  /* ---------------- drag & drop из палитры ---------------- */

  const DND_MIME = "application/bluegem-node-type";

  const onPaletteDragStart = useCallback((e, typeId) => {
    e.dataTransfer.setData(DND_MIME, typeId);
    e.dataTransfer.effectAllowed = "copy";
    setDragType(typeId);
  }, []);

  const onCanvasDragOver = useCallback((e) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onCanvasDrop = useCallback((e) => {
    const typeId = e.dataTransfer.getData(DND_MIME);
    setDragType(null);
    if (!typeId) return;
    e.preventDefault();
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // Узел появляется ровно под курсором, а не углом к нему.
    addNode(typeId, { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 });
  }, [rf, addNode]);

  const onPaneDoubleClick = useCallback((event) => {
    const position = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode("note", { x: position.x - NODE_W / 2, y: position.y - NODE_H / 2 });
  }, [rf, addNode]);

  /* ---------------- persistence ---------------- */

  const saveNode = useCallback(async (draft, opts = {}) => {
    try {
      // Что было до правки — чтобы Ctrl+Z вернул прежнее содержимое, а не
      // только воскрешал удалённое.
      const was = rf.getNode(draft.id)?.data;
      if (was) {
        undoNodePatch([{ id: draft.id, before: {
          typeId: was.typeId, title: was.title, description: was.description,
          fields: (was.fields || []).map((f) => ({ key: f.key, value: f.value })),
          tags: was.tags || [], image: was.image || "", date: was.date || "",
          dates: was.dates || [], canvas: was.canvas || "",
        } }]);
      }
      // measured переносим намеренно: узел пересобирается через mapNode, а без
      // прежних размеров React Flow считает его необмеренным — заново меряет
      // точки связи и обязательно рисует его, даже если он далеко за кадром.
      const updated = await api.updateNode(draft.id, {
        typeId: draft.typeId,
        title: draft.title,
        description: draft.description,
        fields: (draft.fields || []).map((f) => ({ key: f.key, value: f.value })),
        tags: draft.tags,
        image: draft.image,
        date: draft.date,
        dates: draft.dates || [],
        canvas: draft.canvas,
      });
      setRfNodes((nds) => nds.map((n) => (n.id === updated.id
        ? { ...mapNode(updated, typesById), position: n.position, selected: n.selected, measured: n.measured }
        : n)));
      if (opts.close) {
        setSelectedNode(null);
        toast.success(tr("editor.toasts.nodeSaved"));
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.saveNode"));
    }
  }, [mapNode, typesById, setRfNodes, rf, undoNodePatch]);

  const deleteNode = useCallback(async (nodeId) => {
    const node = rf.getNode(nodeId);
    const touchedEdges = rfEdges.filter((e) => e.source === nodeId || e.target === nodeId);
    try {
      await api.deleteNode(nodeId);
      if (node) pushUndo({ kind: "restore", nodes: [node.data], edges: touchedEdges });
      setRfNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setRfEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
      toast.success(tr("editor.toasts.nodeDeleted"), { action: { label: tr("common.restore"), onClick: undo } });
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.deleteNode"));
    }
  }, [rf, rfEdges, setRfNodes, setRfEdges, pushUndo, undo]);

  const saveEdge = useCallback(async (edgeId, patch) => {
    try {
      // Что было до правки — по тем же полям, которые она меняет.
      const was = rfEdges.find((e) => e.id === edgeId);
      if (was) {
        const before = { label: was.label || "", relType: was.data?.relType || "", color: was.data?.color || "" };
        undoEdgePatch([{ id: edgeId, before: Object.fromEntries(
          Object.keys(patch).filter((k) => k in before).map((k) => [k, before[k]])
        ) }]);
      }
      const updated = await api.updateEdge(edgeId, patch);
      setRfEdges((eds) => eds.map((e) => (e.id === edgeId ? toRfEdge(updated, settings) : e)));
      setSelectedEdge(null);
      toast.success(tr("editor.toasts.edgeUpdated"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.saveEdge"));
    }
  }, [settings, setRfEdges, rfEdges, undoEdgePatch]);

  const deleteSelectedEdge = useCallback(async (edgeId) => {
    const edge = rfEdges.find((e) => e.id === edgeId);
    try {
      await api.deleteEdge(edgeId);
      if (edge) pushUndo({ kind: "restore", nodes: [], edges: [edge] });
      setRfEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setSelectedEdge(null);
      toast.success(tr("editor.toasts.edgeDeleted"), { action: { label: tr("common.restore"), onClick: undo } });
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.deleteEdge"));
    }
  }, [rfEdges, setRfEdges, pushUndo, undo]);

  /* ---------------- context-menu operations ---------------- */

  // Create a node already wired to the one you right-clicked.
  const addConnectedNode = useCallback(async (src, typeId) => {
    // Узел и связь к нему — один шаг: отменять их порознь бессмысленно.
    const created = await addNode(typeId, {
      x: (src.position?.x || 0) + 340,
      y: (src.position?.y || 0) + (Math.random() * 120 - 60),
    }, {}, { undo: false });
    if (!created) return;
    const edge = await connectNodes(src.id, created.id, {}, { undo: false });
    undoCreated([created.id], edge ? [edge.id] : []);
  }, [addNode, connectNodes, undoCreated]);

  const changeNodeType = useCallback(async (node, typeId) => {
    if ((node.data.typeId || "note") === typeId) return;
    undoNodePatch([{ id: node.id, before: { typeId: node.data.typeId || "note" } }]);
    try {
      const updated = await api.updateNode(node.id, { typeId });
      setRfNodes((nds) => nds.map((n) => (n.id === updated.id
        ? { ...mapNode(updated, typesById), position: n.position, selected: n.selected, measured: n.measured }
        : n)));
      setSelectedNode((sel) => (sel && sel.id === updated.id ? { ...sel, typeId } : sel));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.changeType"));
    }
  }, [mapNode, typesById, setRfNodes, undoNodePatch]);

  const unlinkAll = useCallback(async (nodeId) => {
    const mine = rfEdges.filter((e) => e.source === nodeId || e.target === nodeId);
    if (!mine.length) return;
    pushUndo({ kind: "restore", nodes: [], edges: mine });
    const results = await Promise.allSettled(mine.map((e) => api.deleteEdge(e.id)));
    if (results.some((r) => r.status === "rejected")) toast.error(tr("errors.deleteEdge"));
    setRfEdges((eds) => eds.filter((e) => !mine.some((m) => m.id === e.id)));
    toast.success(tr("editor.toasts.unlinked", { count: mine.length }), {
      action: { label: tr("common.restore"), onClick: undo },
    });
  }, [rfEdges, setRfEdges, pushUndo, undo]);

  const moveNodesToCanvas = useCallback(async (nodes, canvasId) => {
    undoNodePatch(nodes.map((n) => ({ id: n.id, before: { canvas: n.data.canvas || mainCanvasId } })));
    try {
      await Promise.all(nodes.map((n) => api.updateNode(n.id, { canvas: canvasId })));
      const ids = new Set(nodes.map((n) => n.id));
      setRfNodes((nds) => nds.map((n) => (ids.has(n.id)
        ? { ...n, data: { ...n.data, canvas: canvasId } } : n)));
      setSelectedNode((sel) => (sel && ids.has(sel.id) ? { ...sel, canvas: canvasId } : sel));
      toast.success(tr("editor.toasts.moved"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.moveCanvas"));
    }
  }, [setRfNodes, undoNodePatch, mainCanvasId]);

  const quickSetRelType = useCallback(async (edge, relType) => {
    const preset = relTypes.find((r) => r.id === relType);
    undoEdgePatch([{ id: edge.id, before: {
      relType: edge.data?.relType || "", color: edge.data?.color || "", label: edge.label || "",
    } }]);
    try {
      const updated = await api.updateEdge(edge.id, {
        relType,
        color: preset?.color || "",
        label: edge.label?.trim() ? edge.label : (relType ? preset?.label : ""),
      });
      setRfEdges((eds) => eds.map((e) => (e.id === edge.id ? toRfEdge(updated, settings) : e)));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.changeEdge"));
    }
  }, [settings, relTypes, setRfEdges, undoEdgePatch]);

  const swapEdgeDirection = useCallback(async (edge) => {
    undoEdgePatch([{ id: edge.id, before: { source: edge.source, target: edge.target } }]);
    try {
      const updated = await api.updateEdge(edge.id, { source: edge.target, target: edge.source });
      setRfEdges((eds) => eds.map((e) => (e.id === edge.id ? toRfEdge(updated, settings) : e)));
      toast.success(tr("editor.toasts.swapped"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.swapEdge"));
    }
  }, [settings, setRfEdges, undoEdgePatch]);

  // Wire a multi-selection together in the order it was picked.
  const chainConnect = useCallback(async (nodes) => {
    const made = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      // eslint-disable-next-line no-await-in-loop
      const edge = await connectNodes(nodes[i].id, nodes[i + 1].id, {}, { undo: false });
      if (edge) made.push(edge.id);
    }
    // Цепочка — один шаг: собирали её одним действием, разбирать по звену незачем.
    undoCreated([], made);
    if (made.length) toast.success(tr("editor.toasts.chained", { count: made.length }));
  }, [connectNodes, undoCreated]);

  const selectAllVisible = useCallback(() => {
    setRfNodes((nds) => nds.map((n) => ({ ...n, selected: nodeCanvas(n) === activeCanvas })));
  }, [setRfNodes, nodeCanvas, activeCanvas]);

  /* ---------------- canvases, layout, export ---------------- */

  // Холст создаётся сразу, с рабочим именем, и тут же открывается на
  // переименование прямо во вкладке. Раньше здесь стоял window.prompt — в
  // оболочке Electron он просто не работает и валил интерфейс ошибкой.
  const addCanvas = useCallback(() => {
    const nc = {
      id: `canvas-${Date.now()}`,
      label: tr("editor.canvasNumbered", { number: canvases.length + 1 }),
    };
    undoSettings();
    persistSettings({ ...settings, canvases: [...canvases, nc] });
    setCurrentCanvas(nc.id);
    setRenamingCanvas({ id: nc.id, label: nc.label });
  }, [settings, canvases, persistSettings, tr, undoSettings]);

  const commitCanvasName = useCallback(() => {
    if (!renamingCanvas) return;
    const label = renamingCanvas.label.trim();
    const current = canvases.find((c) => c.id === renamingCanvas.id);
    // Пустое имя — это отказ от переименования, а не безымянный холст.
    if (label && current && label !== current.label) {
      undoSettings();
      persistSettings({
        ...settings,
        canvases: canvases.map((c) => (c.id === renamingCanvas.id ? { ...c, label } : c)),
      });
    }
    setRenamingCanvas(null);
  }, [renamingCanvas, canvases, settings, persistSettings, undoSettings]);

  // Свой тип узла раньше жил только в глубине настроек. Теперь до него ведут
  // три коротких пути (плитка в палитре, палитра команд, меню холста), и все
  // они заканчиваются одинаково: тип создан, настройки открыты на нём, курсор
  // стоит в названии — остаётся напечатать своё.
  const createNodeType = useCallback(() => {
    const newType = {
      id: `custom-${Date.now()}`,
      label: tr("settings.newType"),
      color: "#0ea5e9",
      icon: "Star",
    };
    undoSettings();
    persistSettings({ ...settings, nodeTypes: [...(settings?.nodeTypes || []), newType] });
    setSelectedNode(null);
    setSelectedEdge(null);
    setShowTimeline(false);
    setMenu(null);
    setHighlightType(newType.id);
    setShowSettings(true);
    // eslint-disable-next-line
  }, [settings, persistSettings]);

  const runLayout = useCallback(async (layoutId = "layered") => {
    const layout = LAYOUTS.find((l) => l.id === layoutId) || LAYOUTS[0];
    // Граф берём у React Flow в момент запуска: держать списки в зависимостях
    // значило бы пересобирать расстановку (и всё, что её зовёт, — вплоть до
    // слушателя клавиш) на каждый кадр перетаскивания.
    const rfNodesNow = rf.getNodes();
    const rfEdgesNow = rf.getEdges();
    const visible = rfNodesNow.filter((n) => nodeCanvas(n) === activeCanvas);
    if (!visible.length) return;
    // Через множество, а не поиском по списку на каждое ребро: на тысяче узлов
    // и полутора тысячах связей это была пара миллионов сравнений.
    const here = new Set(visible.map((n) => n.id));
    const edgesHere = rfEdgesNow.filter((e) => here.has(e.source) && here.has(e.target));
    const positions = layout.run(visible, edgesHere);
    // Расстановка двигает весь холст разом — без записи в историю её нечем
    // отменить, а промахнуться раскладкой проще всего.
    pushUndo({ kind: "positions", positions: visible.map((n) => ({ id: n.id, position: n.position })) });
    const byId = new Map(positions.map((p) => [p.id, p.position]));
    // Переходом: расстановка двигает весь холст разом, и на большом графе это
    // единственное обновление, которое и правда стоит целого кадра. Пусть его
    // можно прервать — щелчок по кнопке важнее, чем успеть за один проход.
    startTransition(() => {
      setRfNodes((nds) => nds.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id) } : n)));
    });
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 500 }), 60);
    try {
      await api.updatePositions(id, positions);
      toast.success(tr("editor.toasts.layout", { name: tr(layout.labelKey).toLowerCase() }));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.positions"));
    }
  }, [activeCanvas, nodeCanvas, setRfNodes, rf, id, pushUndo]);

  const exportAs = useCallback(async (kind) => {
    try {
      const snapshot = await api.exportProject(id);
      const res = kind === "md" ? await downloadMarkdown(snapshot) : await downloadJson(snapshot);
      if (res?.canceled) return; // передумали в диалоге сохранения — это не ошибка
      // В приложении полезно видеть, куда именно лёг файл.
      const where = res?.path ? ` → ${res.path}` : "";
      toast.success(tr(kind === "md" ? "editor.toasts.exportedMd" : "editor.toasts.exported", { where }));
    } catch (e) {
      toast.error(e?.message || apiErrorMessage(e, "errors.export"));
    }
  }, [id]);

  /* ---------------- derived data ---------------- */

  // Содержимое узлов отдельно от их положения: перенос карточки по холсту не
  // должен пересчитывать ни теги, ни соседей, ни поисковый указатель.
  // Отстаёт на проход по той же причине, что и nodeFacts ниже: поисковый
  // указатель строится по всем узлам, а набор в описании не должен его ждать.
  const nodeContent = useDeferredValue(useNodeContent(rfNodes));
  // Список по «фактам» об узле: он не меняется, пока правят описание.
  const nodeFactsNow = useNodeFacts(rfNodes);
  /**
   * ...и он же, отстающий на проход, — для всего, что считается по проекту
   * целиком.
   *
   * Разница видна на переименовании. Название узла — это факт: от него зависят
   * соседи (их подписывают именем), список в панели, поисковый указатель,
   * хронология (относительная дата зовёт узел по имени), палитра. Пока всё это
   * считалось тем же проходом, что и сама буква, каждое нажатие на графе
   * в пятьсот узлов стоило пятидесяти шести миллисекунд — то есть набор имени
   * шёл рывками, хотя менялась одна строка.
   *
   * useDeferredValue разводит их по разным проходам. Буква и карточка под
   * курсором обновляются сразу; всё, что считается по всему проекту, догоняет
   * в ближайшем простое — а если человек продолжает печатать, React бросает
   * недосчитанное и начинает заново. Тот же приём, что и с поисковой строкой
   * ниже, и по той же причине.
   */
  const nodeFacts = useDeferredValue(nodeFactsNow);

  /**
   * Поисковый указатель: на каждый узел одна строка в нижнем регистре.
   *
   * Раньше поиск на каждый рендер приводил к нижнему регистру название,
   * описание, все теги и все поля каждого узла — то есть перебирал весь проект
   * заново по нескольку раз на один символ. Теперь строка склеивается один раз
   * на изменение содержимого, а сам поиск — это подстрока в готовой строке.
   */
  const haystacks = useRef(new Map());
  const searchIndex = useMemo(() => {
    // Строку пересобираем только тому узлу, чьё содержимое сменилось: правка
    // одного описания не повод заново приводить к нижнему регистру весь проект.
    const kept = haystacks.current;
    const map = new Map();
    for (const d of nodeContent) {
      const was = kept.get(d.id);
      if (was && was.src === d) { map.set(d.id, was); continue; }
      let s = `${d.title || ""}\n${d.description || ""}`;
      for (const t of d.tags || []) s += `\n${t}`;
      for (const f of d.fields || []) s += `\n${f.key || ""}\n${f.value || ""}`;
      map.set(d.id, { src: d, hay: s.toLowerCase() });
    }
    haystacks.current = map;
    return map;
  }, [nodeContent]);

  // Набор в поле обязан быть мгновенным, а перекраска графа под запрос — нет.
  // useDeferredValue разводит их по разным проходам: буквы появляются сразу,
  // холст догоняет следующим кадром и на тысяче узлов не держит ввод.
  const typedQuery = search.trim().toLowerCase();
  const q = useDeferredValue(typedQuery);

  const searchHits = useMemo(() => {
    if (!q) return null;
    const set = new Set();
    for (const [nodeId, entry] of searchIndex) if (entry.hay.includes(q)) set.add(nodeId);
    return set;
  }, [searchIndex, q]);

  // Обе проверки принимают содержимое узла (n.data), а не узел React Flow:
  // положение на холсте к отбору отношения не имеет, а по содержимому они
  // одинаково годятся и для карточек, и для списка в панели.
  const matchesSearch = useCallback((d) => !searchHits || searchHits.has(d.id), [searchHits]);
  const matchesTags = useCallback(
    (d) => activeTags.size === 0 || (d.tags || []).some((t) => activeTags.has(t)),
    [activeTags]
  );

  const degrees = useMemo(() => {
    const map = new Map();
    rfEdges.forEach((e) => {
      map.set(e.source, (map.get(e.source) || 0) + 1);
      map.set(e.target, (map.get(e.target) || 0) + 1);
    });
    return map;
  }, [rfEdges]);

  // Список в панели — по содержимому узлов, а не по узлам React Flow: положение
  // на холсте на список не влияет, и пересобирать его на каждый кадр переноса
  // значит перерисовывать тысячу строк ради того, что список даже не показывает.
  const filtered = useMemo(
    () => nodeFacts.filter((d) => matchesSearch(d) && matchesTags(d)
      && (d.canvas || mainCanvasId) === activeCanvas),
    [nodeFacts, matchesSearch, matchesTags, activeCanvas, mainCanvasId]
  );
  const allTags = useMemo(() => {
    const set = new Set();
    for (const d of nodeFacts) for (const t of d.tags || []) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [nodeFacts]);

  // Поиск в поле и перелёт по совпадениям — одна сущность, а не две: Enter и
  // ↓/↑ водят по найденному прямо из поля, счётчик показывает, где мы.
  const gotoMatch = useCallback((delta) => {
    if (!filtered.length) return;
    // Первый Enter ведёт к первому совпадению, а не ко второму.
    const next = visitedRef.current
      ? ((searchIdx + delta) % filtered.length + filtered.length) % filtered.length
      : 0;
    visitedRef.current = true;
    setSearchIdx(next);
    focusNode(filtered[next].id);
  }, [filtered, searchIdx, focusNode]);

  // Строка запроса изменилась — счёт начинается заново.
  useEffect(() => { setSearchIdx(0); visitedRef.current = false; }, [q, activeTags]);

  // Соседи выделенного узла — главный рабочий жест: «что связано с этим
  // персонажем». В фокус-режиме сам узел и его прямые соседи остаются в полной
  // яркости, остальной граф уходит, но не исчезает.
  const neighbourIds = useMemo(() => {
    if (!focusMode || !selectedNode) return null;
    const set = new Set([selectedNode.id]);
    rfEdges.forEach((e) => {
      if (e.source === selectedNode.id) set.add(e.target);
      if (e.target === selectedNode.id) set.add(e.source);
    });
    return set;
  }, [focusMode, selectedNode, rfEdges]);

  // Nodes stay on the canvas but recede when filtered out — context is preserved.
  // Хронология проекта: даты разбираются один раз на изменение узлов, а не на
  // каждое движение по холсту (см. useChronology). Стоит до раскладки карточек:
  // развёрнутая карточка показывает разобранные даты.
  const chrono = useChronology(nodeFacts, settings);
  const calendar = useMemo(() => resolveCalendar(settings), [settings?.calendar]);
  const eras = useMemo(() => normalizeEras(settings?.eras), [settings?.eras]);

  /**
   * Даты узла готовыми строками. Собираем на всю хронологию разом, а не в самой
   * карточке: разбор даты стоит поиска по эпохам и чужим узлам, и делать это на
   * каждую перерисовку каждой карточки — то же самое, что считать заново.
   * В карте только те узлы, у которых даты есть.
   */
  const datesRef = useRef(new Map());
  const dateLinesByNode = useMemo(() => {
    const ctx = {
      eraName: (id) => chrono.eras.byId.get(id)?.name || "",
      nodeTitle: (id) => chrono.byNode.get(id)?.[0]?.node?.title || "",
    };
    const was = datesRef.current;
    const out = new Map();
    for (const [nodeId, list] of chrono.byNode) {
      const lines = list.map((it) => ({
        key: it.key,
        label: it.label || "",
        text: formatRange(chrono.calendar, it.entry, { ...ctx, selfId: nodeId }),
      })).filter((d) => d.text);
      // Как и с соседями: строки дат уходят в карточку массивом, и новый
      // массив — это перерисовка карточки. Хронология пересчитывается целиком
      // от любой правки даты или названия, но у большинства узлов после этого
      // выходят те же самые строки; им и отдаём прежний массив.
      const old = was.get(nodeId);
      out.set(nodeId, old && sameDateLines(old, lines) ? old : lines);
    }
    datesRef.current = out;
    return out;
  }, [chrono]);

  /**
   * Соседи каждого узла — для развёрнутой карточки и для метки «связи на другом
   * холсте». Считаем одним проходом по всем рёбрам: делать это внутри карточки
   * значило бы обойти список рёбер столько раз, сколько на холсте узлов.
   */
  const linksRef = useRef(new Map());
  const linksByNode = useMemo(() => {
    const byId = new Map(nodeFacts.map((d) => [d.id, d]));
    const map = new Map();
    const push = (id, entry) => {
      if (!map.has(id)) map.set(id, { neighbours: [], cross: 0 });
      const bucket = map.get(id);
      bucket.neighbours.push(entry);
      if (entry.away) bucket.cross += 1;
    };
    // Подписи типов связей — по карте, а не поиском по списку на каждое ребро.
    // У «обычной» подписи нет: связь без типа не должна называть себя никак.
    const relLabel = new Map(relTypes.map((r) => [r.id, r.id ? r.label : ""]));
    rfEdges.forEach((e) => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) return;
      // Холсты сравниваем здесь, где известны оба: у самого узла поле canvas
      // бывает пустым, и сравнение с ним дало бы ложное «на другом холсте».
      const away = (a.canvas || mainCanvasId) !== (b.canvas || mainCanvasId);
      // Чем связь названа: своей подписью, иначе — названием типа связи.
      // Без неё список соседей отвечает «с кем», но не «кем ему приходится».
      const rel = e.label?.trim() || relLabel.get(e.data?.relType || "") || "";
      push(e.source, {
        id: e.target, title: b.title, outgoing: true, away, rel,
        color: b.nodeType?.color || "",
      });
      push(e.target, {
        id: e.source, title: a.title, outgoing: false, away, rel,
        color: a.nodeType?.color || "",
      });
    });
    // Списки соседей выдаются карточкам как есть, и новый массив означает для
    // карточки новый объект узла. Переименовали один узел — меняются соседи
    // только у тех, с кем он связан; у остальных список тот же по составу,
    // и отдавать им новый массив значит перерисовать весь граф ради чужого
    // имени. Поэтому там, где состав совпал, возвращаем прежний список.
    const was = linksRef.current;
    for (const [nodeId, bucket] of map) {
      const old = was.get(nodeId);
      if (old && old.cross === bucket.cross && sameNeighbours(old.neighbours, bucket.neighbours)) {
        map.set(nodeId, old);
      }
    }
    linksRef.current = map;
    return map;
  }, [nodeFacts, rfEdges, mainCanvasId, relTypes, tr]);

  /** Всё, что в проекции карточки не зависит от конкретного узла. */
  const nodeView = useMemo(() => ({
    activeCanvas, mainCanvasId, degrees, linksByNode, dateLinesByNode, canvases,
    matchesTags, matchesSearch, neighbourIds, linkSource, expandedId,
    highlight: !!q,
    cardMode: settings?.cardMode || "detailed",
    onOpenNode: openNodeById, onRename: renameNode, onResize: resizeNode,
    onFocusField: focusNodeField, onMeasure: requestMeasure,
  }), [activeCanvas, mainCanvasId, degrees, linksByNode, dateLinesByNode, canvases,
      matchesTags, matchesSearch, neighbourIds, linkSource, expandedId, q,
      settings?.cardMode, openNodeById, renameNode, resizeNode, focusNodeField,
      requestMeasure]);

  const nodeProjection = useRef(new Map());
  /**
   * Карточки для холста.
   *
   * Здесь решается, перерисуется ли граф целиком. React Flow оставляет узел в
   * покое ровно до тех пор, пока объект узла тот же самый (см. adoptUserNodes
   * с checkEquality): значит, новый объект надо отдавать только тому узлу, у
   * которого и правда что-то изменилось.
   *
   * Поэтому вычисленное состояние карточки сравнивается по значению с прежним,
   * а не по «менялось ли вообще хоть что-нибудь общее». Разница видна на любом
   * рабочем жесте: развернуть одну карточку — это две новых карточки, а не
   * тысяча; сузить поиск с «те» до «тен» — только те, что вышли из отбора.
   * Сравнение стоит десятка проверок примитивов на узел, то есть неизмеримо
   * мало против пересборки поддерева.
   */
  const displayNodes = useMemo(() => {
    const v = nodeView;
    const prev = nodeProjection.current;
    const byId = new Map();
    const out = new Array(rfNodes.length);
    for (let i = 0; i < rfNodes.length; i++) {
      const n = rfNodes[i];
      const d = n.data;
      const onCanvas = (d.canvas || v.mainCanvasId) === v.activeCanvas;
      const passes = v.matchesTags(d) && v.matchesSearch(d);
      const linkable = !!v.linkSource && v.linkSource !== n.id;
      const links = v.linksByNode.get(n.id);
      const neighbours = links?.neighbours || EMPTY_LIST;
      const crossLinks = links?.cross || 0;
      const dateLines = v.dateLinesByNode.get(n.id) || EMPTY_LIST;
      const degree = v.degrees.get(n.id) || 0;
      const dimmed = onCanvas && !passes;
      const faded = !!v.neighbourIds && !v.neighbourIds.has(n.id);
      const hit = onCanvas && v.highlight && passes;
      const linking = v.linkSource === n.id;
      const expanded = v.expandedId === n.id;
      // Вид карточки: свой у узла, если его задали, иначе общий из настроек.
      // Общий — это значение по умолчанию, а не приговор всему холсту: узел,
      // на который смотрят подробно, не обязан тащить за собой остальные.
      const cardMode = d.cardMode || v.cardMode;
      // Страница узла нужна лишь там, где страниц больше одной: иначе это
      // подпись «Основной» на каждой карточке проекта.
      const canvasLabel = v.canvases.length > 1
        ? v.canvases.find((c) => c.id === (d.canvas || v.mainCanvasId))?.label || ""
        : "";

      const kept = prev.get(n.id);
      const p = kept?.node.data;
      if (kept && kept.src === n && kept.node.hidden === !onCanvas
        && p.degree === degree && p.dimmed === dimmed && p.faded === faded && p.hit === hit
        && p.linking === linking && p.linkable === linkable && p.expanded === expanded
        && p.cardMode === cardMode && p.neighbours === neighbours && p.crossLinks === crossLinks
        && p.dateLines === dateLines && p.canvasLabel === canvasLabel
        && p.onOpenNode === v.onOpenNode && p.onRename === v.onRename
        && p.onResize === v.onResize && p.onFocusField === v.onFocusField
        && p.onMeasure === v.onMeasure) {
        byId.set(n.id, kept);
        out[i] = kept.node;
        continue;
      }

      const node = {
        ...n,
        hidden: !onCanvas,
        className: linkable ? "sw-node-target" : undefined,
        data: {
          ...d,
          degree, dimmed, faded, hit, linking, linkable, expanded, cardMode,
          // Заданный вид отдельно от вычисленного: меню и история должны знать,
          // стоит ли на узле своё значение, а не то, чем оно обернулось.
          cardModeOwn: d.cardMode || "",
          neighbours,
          // Связи, уходящие на другие холсты: на самом холсте их не видно, и без
          // метки узел выглядит одиноким, хотя связан.
          crossLinks,
          dateLines,
          canvasLabel,
          onOpenNode: v.onOpenNode,
          onRename: v.onRename,
          onResize: v.onResize,
          onFocusField: v.onFocusField,
          onMeasure: v.onMeasure,
        },
      };
      byId.set(n.id, { src: n, node });
      out[i] = node;
    }
    nodeProjection.current = byId;
    return out;
  }, [rfNodes, nodeView]);

  const visibleIds = useMemo(() => {
    const set = new Set();
    for (const d of nodeFacts) if ((d.canvas || mainCanvasId) === activeCanvas) set.add(d.id);
    return set;
  }, [nodeFacts, activeCanvas, mainCanvasId]);

  // Толщина и цвет линии живут в CSS (состояния hover/selected) — здесь только
  // видимость и приглушение чужих связей. Проекция с той же оговоркой, что и у
  // карточек: пока общая часть не менялась, ребро остаётся прежним объектом —
  // иначе перенос одного узла перерисовывал бы все линии проекта.
  const edgeView = useMemo(() => ({
    visibleIds, selectedId: selectedNode?.id || null, neighbourIds, onPointsChange,
  }), [visibleIds, selectedNode?.id, neighbourIds, onPointsChange]);

  const edgeProjection = useRef(new Map());
  const displayEdges = useMemo(() => {
    const v = edgeView;
    const prev = edgeProjection.current;
    const byId = new Map();
    const out = new Array(rfEdges.length);
    for (let i = 0; i < rfEdges.length; i++) {
      const e = rfEdges[i];
      const mine = v.selectedId && (e.source === v.selectedId || e.target === v.selectedId);
      const outside = v.neighbourIds
        && !(v.neighbourIds.has(e.source) && v.neighbourIds.has(e.target));
      const hidden = !v.visibleIds.has(e.source) || !v.visibleIds.has(e.target);
      const className = [e.className, (v.selectedId && !mine) || outside ? "sw-edge-faded" : ""]
        .filter(Boolean).join(" ") || undefined;
      // Та же оговорка, что и у карточек: пока у линии ничего не поменялось,
      // она остаётся прежним объектом и React Flow её не трогает. Иначе
      // выделение одного узла перерисовывало бы все связи проекта, а каждая
      // из них — это построение пути и, у подписанных, замер длины кривой.
      const kept = prev.get(e.id);
      if (kept && kept.src === e && kept.edge.hidden === hidden
        && kept.edge.className === className && kept.edge.data.onPointsChange === v.onPointsChange) {
        byId.set(e.id, kept);
        out[i] = kept.edge;
        continue;
      }
      const edge = {
        ...e,
        hidden,
        data: { ...e.data, onPointsChange: v.onPointsChange },
        className,
      };
      byId.set(e.id, { src: e, edge });
      out[i] = edge;
    }
    edgeProjection.current = byId;
    return out;
  }, [rfEdges, edgeView]);

  // Список для выбора узла в панели и на шкале. Собирается, только когда его
  // и правда кто-то показывает: это объект на каждый узел проекта, а правки
  // графа идут постоянно — платить за них тысячей объектов ради закрытой
  // панели незачем.
  const pickerNeeded = panelOpen || showTimeline || !!previewId;

  // Выделенные узлы — для панели мультивыделения. Пересчёт на каждый кадр
  // переноса — это один проход фильтром, дешевле любого кэша.
  const multiSelected = useMemo(() => rfNodes.filter((n) => n.selected), [rfNodes]);
  const allNodesForPicker = useMemo(
    () => (pickerNeeded
      ? nodeFacts.map((d) => ({ id: d.id, title: d.title, nodeType: d.nodeType }))
      : EMPTY_LIST),
    [nodeFacts, pickerNeeded]
  );

  // Обычный объект, но набранный циклом: свёртка через {...a} копировала карту
  // целиком на каждый узел — полмиллиона присваиваний на графе в тысячу узлов.
  const nodeTitles = useMemo(() => {
    const out = {};
    for (const d of nodeFacts) out[d.id] = d.title;
    return out;
  }, [nodeFacts]);

  const connections = useMemo(() => {
    if (!selectedNode) return [];
    return rfEdges
      .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
      .map((e) => {
        const outgoing = e.source === selectedNode.id;
        const otherId = outgoing ? e.target : e.source;
        return {
          edgeId: e.id, id: otherId, outgoing,
          title: nodeTitles[otherId],
          label: e.label || "",
          color: e.data?.color || DEFAULT_EDGE_COLOR,
        };
      });
  }, [selectedNode, rfEdges, nodeTitles]);

  // Дерево структуры мира: все типы проекта, в том числе пустые, — из пустой
  // группы как раз и создают. В режиме «весь мир» — узлы всех холстов, иначе
  // те же, что ищет поиск по холсту.
  const treeScopeAll = sidebar.scope === "all";
  const groupedList = useMemo(() => {
    const source = treeScopeAll
      ? nodeFacts.filter((d) => matchesSearch(d) && matchesTags(d))
      : filtered;
    const groups = new Map();
    source.forEach((d) => {
      const key = d.typeId || "note";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    });
    return (settings?.nodeTypes || [])
      .map((t) => ({ type: t, nodes: groups.get(t.id) || EMPTY_LIST }))
      .concat(
        Array.from(groups.keys())
          .filter((k) => !(settings?.nodeTypes || []).some((t) => t.id === k))
          .map((k) => ({ type: { id: k, label: tr("editor.otherType"), color: "#64748b", icon: "FileText" }, nodes: groups.get(k) }))
      );
  }, [filtered, settings, treeScopeAll, nodeFacts, matchesSearch, matchesTags]);

  // Подпись холста у узла с чужой страницы — только в режиме «весь мир».
  const treeAwayOf = useCallback((d) => {
    if (!treeScopeAll) return "";
    const c = d.canvas || mainCanvasId;
    return c === activeCanvas ? "" : (canvases.find((x) => x.id === c)?.label || "");
  }, [treeScopeAll, mainCanvasId, activeCanvas, canvases]);

  const toggleTreeGroup = useCallback((typeId) => {
    setSidebar((s) => ({ ...s, collapsed: { ...(s.collapsed || {}), [typeId]: !s.collapsed?.[typeId] } }));
  }, []);

  // Оба счётчика — циклом, а не свёрткой через {...a}: та копировала весь
  // объект на каждый узел, то есть считала за O(n²) там, где хватает прохода.
  const typeUsage = useMemo(() => {
    const out = {};
    for (const d of nodeFacts) {
      const k = d.typeId || "note";
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }, [nodeFacts]);
  const canvasUsage = useMemo(() => {
    const out = {};
    for (const d of nodeFacts) {
      const k = d.canvas || mainCanvasId;
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }, [nodeFacts, mainCanvasId]);
  // Сколько связей носит каждый тип: настройки спрашивают перед удалением.
  const relUsage = useMemo(() => {
    const out = {};
    for (const e of rfEdges) {
      const k = e.data?.relType || "";
      if (k) out[k] = (out[k] || 0) + 1;
    }
    return out;
  }, [rfEdges]);

  /**
   * Насколько граф велик — настолько скромнее оформление.
   *
   * Не «красиво против быстро», а разное на разных размерах: бесконечная
   * подсветка найденного и saturate() на приглушённых карточках стоят кадра
   * на сотне узлов и половины секунды на тысяче, а разглядеть их там всё
   * равно нельзя — на таком масштабе карточка размером с ноготь. Что именно
   * гасится, перечислено в .sw-perf (index.css).
   */
  const flowClass = useMemo(() => [
    rfNodes.length >= ANIM_LIMIT ? "sw-no-node-anim" : "",
    rfNodes.length >= PERF_LIMIT ? "sw-perf" : "",
  ].filter(Boolean).join(" "), [rfNodes.length]);

  const toggleTag = (t) =>
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });

  const closeAll = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setPanelOpen(false);
    setExpandedId(null);
    setPreviewId(null);
    setShowSettings(false);
    setShowTimeline(false);
    setMenu(null);
    setLinkSource(null);
  }, []);

  // Правый клик по группе типа в дереве: всё, что можно сделать с типом, —
  // создать узел, свернуть группу, настроить сам тип.
  const openTypeMenu = useCallback((e, type) => {
    e.preventDefault();
    const folded = !!sidebar.collapsed?.[type.id];
    setMenu({
      x: e.clientX,
      y: e.clientY,
      header: type.label,
      headerColor: type.color,
      items: [
        { id: "type-create", label: tr("editor.createOfType", { type: type.label }), icon: Plus, onSelect: () => addNode(type.id) },
        {
          id: "type-fold",
          label: tr(folded ? "editor.expand" : "editor.collapse"),
          icon: folded ? Maximize2 : Minimize2,
          onSelect: () => toggleTreeGroup(type.id),
        },
        { id: "sep-type", separator: true },
        {
          id: "type-edit",
          label: tr("editor.editType"),
          icon: Settings,
          onSelect: () => { closeAll(); setHighlightType(type.id); setShowSettings(true); },
        },
      ],
    });
  }, [sidebar.collapsed, addNode, toggleTreeGroup, closeAll]);

  /* ---------------- canvas tabs ---------------- */

  // Полоска холстов есть и в боковой панели, и плавающая над холстом, когда
  // панель свёрнута. Вкладку рисуем одним кодом, иначе переименование пришлось
  // бы поддерживать в двух местах.
  const canvasTab = (c, testId) => {
    if (renamingCanvas?.id === c.id) {
      return (
        <input
          key={c.id}
          data-testid={`${testId}-rename`}
          autoFocus
          value={renamingCanvas.label}
          onChange={(e) => setRenamingCanvas({ id: c.id, label: e.target.value })}
          onFocus={(e) => e.target.select()}
          onBlur={commitCanvasName}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitCanvasName(); }
            // stopPropagation: иначе Esc дойдёт до общего обработчика и закроет
            // заодно все панели редактора.
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setRenamingCanvas(null); }
          }}
          className="px-2 py-1 rounded-md text-xs bg-transparent border sw-border-c outline-none w-28 shrink-0"
        />
      );
    }
    return (
      <button
        key={c.id}
        data-testid={testId}
        data-active={c.id === activeCanvas}
        onClick={() => setCurrentCanvas(c.id)}
        onDoubleClick={() => setRenamingCanvas({ id: c.id, label: c.label })}
        // Вкладка холста ведёт на холст и из таймлайна: выбрали страницу —
        // значит, хотят её видеть.
        onClickCapture={() => setShowTimeline(false)}
        title={tr("editor.renameCanvasHint")}
        // Выбранный холст — поверхность и точка акцента, а не заливка целиком:
        // сплошной акцент кричит громче, чем стоит переключатель вкладок.
        className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs whitespace-nowrap
          transition-colors shrink-0 sw-hover"
        style={{
          background: c.id === activeCanvas ? "var(--sw-surface-2)" : "transparent",
          color: c.id === activeCanvas ? "var(--sw-text)" : "var(--sw-text-dim)",
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: c.id === activeCanvas ? "var(--sw-accent)" : "var(--sw-border-strong)" }}
        />
        {c.label}
        {canvasUsage[c.id] ? <span className="ml-1.5 opacity-60 font-mono-sw">{canvasUsage[c.id]}</span> : null}
      </button>
    );
  };

  /* ---------------- right-click menus ---------------- */

  const typeItems = useCallback((onPick, prefix) => (settings?.nodeTypes || []).map((t) => ({
    id: `${prefix}-${t.id}`,
    label: t.label,
    swatch: t.color,
    onSelect: () => onPick(t.id),
  })), [settings]);

  const canvasItems = useCallback((nodes) => canvases.map((c) => ({
    id: `to-canvas-${c.id}`,
    label: c.label,
    disabled: nodes.every((n) => (n.data.canvas || mainCanvasId) === c.id),
    onSelect: () => moveNodesToCanvas(nodes, c.id),
  })), [canvases, mainCanvasId, moveNodesToCanvas]);

  /**
   * Вид карточки для выбранных узлов. «Как в настройках» — не третий вид, а
   * отказ от своего: узел снова слушается общей настройки проекта.
   */
  const cardModeItems = useCallback((nodes, prefix) => {
    const ids = nodes.map((n) => n.id);
    const same = (v) => nodes.every((n) => (n.data.cardModeOwn || "") === v);
    const common = tr(`settings.cardStyles.${(settings?.cardMode || "detailed") === "compact" ? "compact" : "detailed"}`);
    return [
      {
        id: `${prefix}-cm-inherit`,
        label: tr("ctx.cardModeInherit", { mode: common.toLowerCase() }),
        checked: same(""),
        onSelect: () => setNodeCardMode(ids, ""),
      },
      { id: `${prefix}-cm-sep`, separator: true },
      {
        id: `${prefix}-cm-detailed`,
        label: tr("settings.cardStyles.detailed"),
        checked: same("detailed"),
        onSelect: () => setNodeCardMode(ids, "detailed"),
      },
      {
        id: `${prefix}-cm-compact`,
        label: tr("settings.cardStyles.compact"),
        checked: same("compact"),
        onSelect: () => setNodeCardMode(ids, "compact"),
      },
    ];
  }, [settings, setNodeCardMode, tr]);

  // Что сейчас развёрнуто — читаем из ref, а не из зависимостей. Иначе
  // обработчик меню менялся на каждый разворот карточки, а вместе с ним
  // пересобирался список узлов в панели: тысяча строк на один щелчок.
  const expandedRef = useRef(null);
  expandedRef.current = expandedId;

  const openNodeMenu = useCallback((e, node) => {
    e.preventDefault();
    const mine = rfEdges.filter((x) => x.source === node.id || x.target === node.id);
    const isExpanded = expandedRef.current === node.id;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      header: node.data.title || tr("common.untitled"),
      headerColor: node.data.nodeType?.color,
      items: [
        { id: "open", label: tr("ctx.openInEditor"), icon: Pencil, onSelect: () => openNodeById(node.id) },
        { id: "peek", label: tr("ctx.preview"), icon: Eye, onSelect: () => peekNode(node.id) },
        {
          id: "expand",
          label: tr(isExpanded ? "ctx.collapseCard" : "ctx.expandCard"),
          icon: isExpanded ? Minimize2 : Maximize2,
          onSelect: () => setExpandedId((cur) => (cur === node.id ? null : node.id)),
        },
        {
          id: "node-type",
          label: tr("ctx.changeType"),
          icon: Shapes,
          items: (settings?.nodeTypes || []).map((t) => ({
            id: `settype-${t.id}`,
            label: t.label,
            swatch: t.color,
            checked: (node.data.typeId || "note") === t.id,
            onSelect: () => changeNodeType(node, t.id),
          })),
        },
        { id: "sep-links", separator: true },
        { id: "link", label: tr("ctx.linkTo"), icon: Crosshair, hint: tr("ctx.linkToHint"), onSelect: () => setLinkSource(node.id) },
        { id: "link-new", label: tr("ctx.newLinkedNode"), icon: Plus, items: typeItems((t) => addConnectedNode(node, t), "linknew") },
        {
          id: "unlink-one",
          label: tr("ctx.removeLink"),
          icon: Unlink,
          disabled: !mine.length,
          items: mine.map((edge) => {
            const outgoing = edge.source === node.id;
            const other = outgoing ? edge.target : edge.source;
            return {
              id: `unlink-${edge.id}`,
              label: `${outgoing ? "→" : "←"} ${nodeTitles[other] || tr("ctx.node")}${edge.label ? ` (${edge.label})` : ""}`,
              swatch: edge.data?.color || DEFAULT_EDGE_COLOR,
              onSelect: () => deleteSelectedEdge(edge.id),
            };
          }),
        },
        { id: "unlink-all", label: tr("ctx.unlinkAll", { count: mine.length }), icon: Scissors, disabled: !mine.length, onSelect: () => unlinkAll(node.id) },
        { id: "sep-node", separator: true },
        { id: "card-mode", label: tr("ctx.cardMode"), icon: LayoutGrid, items: cardModeItems([node], "node") },
        {
          id: "reset-width",
          label: tr("ctx.resetWidth"),
          icon: MoveHorizontal,
          disabled: !node.data.width,
          onSelect: () => resizeNode(node.id, 0),
        },
        { id: "sep-node2", separator: true },
        { id: "dup", label: tr("ctx.duplicate"), icon: Copy, hint: "Ctrl D", onSelect: () => duplicateNode(node.data) },
        { id: "focus", label: tr("ctx.center"), icon: Target, onSelect: () => focusNode(node.id) },
        ...(canvases.length > 1
          ? [{ id: "move-canvas", label: tr("ctx.moveToCanvas"), icon: Layers, items: canvasItems([node]) }]
          : []),
        { id: "sep-del", separator: true },
        { id: "del", label: tr("ctx.deleteNode"), icon: Trash2, danger: true, onSelect: () => deleteNode(node.id) },
      ],
    });
  }, [rfEdges, nodeTitles, typeItems, canvasItems, cardModeItems, canvases.length, settings, changeNodeType,
      openNodeById, addConnectedNode, deleteSelectedEdge, unlinkAll, duplicateNode, focusNode, deleteNode,
      resizeNode, peekNode]);

  // Список в панели знает про узел только его id — сам узел спрашиваем здесь.
  // Так список не зависит от объектов React Flow и переживает перенос карточек
  // без единой перерисовки.
  const openNodeMenuById = useCallback((e, nodeId) => {
    const node = rf.getNode(nodeId);
    if (node) openNodeMenu(e, node);
  }, [rf, openNodeMenu]);

  const openEdgeMenu = useCallback((e, edge) => {
    e.preventDefault();
    // Куда ткнули на самой линии — сюда встанет крепление из меню.
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const points = edge.data?.points || [];
    setMenu({
      x: e.clientX,
      y: e.clientY,
      header: `${nodeTitles[edge.source] || "?"} → ${nodeTitles[edge.target] || "?"}`,
      headerColor: edge.data?.color || DEFAULT_EDGE_COLOR,
      items: [
        { id: "edit-edge", label: tr("ctx.editEdge"), icon: Pencil, onSelect: () => { closeAll(); setSelectedEdge(edge); } },
        {
          id: "rel-type",
          label: tr("ctx.edgeType"),
          icon: Spline,
          items: relTypes.map((r) => ({
            id: `rel-${r.id || "none"}`,
            label: r.label,
            swatch: r.color,
            checked: (edge.data?.relType || "") === r.id,
            onSelect: () => quickSetRelType(edge, r.id),
          })),
        },
        { id: "swap", label: tr("ctx.swapDirection"), icon: ArrowLeftRight, onSelect: () => swapEdgeDirection(edge) },
        { id: "sep-edge-shape", separator: true },
        // Крепления ставятся протяжкой самой линии, но узнать об этом неоткуда —
        // поэтому то же самое лежит и в меню, вместе со «выпрямить».
        {
          id: "edge-points",
          label: tr("ctx.edgePoints", { count: points.length }),
          icon: Anchor,
          items: [
            { id: "point-add", label: tr("ctx.addPoint"), icon: Anchor, onSelect: () => addEdgePoint(edge, at) },
            {
              id: "point-clear",
              label: tr("ctx.straighten"),
              icon: Minus,
              disabled: !points.length,
              onSelect: () => straightenEdge(edge),
            },
          ],
        },
        {
          id: "edge-shape",
          label: tr("ctx.edgeShape"),
          icon: Spline,
          items: [
            {
              id: "shape-inherit",
              label: tr("ctx.shapeInherit", { shape: tr(`settings.edgeStyles.${settings?.edgeType || "smoothstep"}`).toLowerCase() }),
              checked: !edge.data?.shapeOwn,
              onSelect: () => setEdgeShape(edge, ""),
            },
            { id: "shape-sep", separator: true },
            ...EDGE_SHAPES.map((s) => ({
              id: `shape-${s}`,
              label: tr(`settings.edgeStyles.${s}`),
              checked: edge.data?.shapeOwn === s,
              onSelect: () => setEdgeShape(edge, s),
            })),
          ],
        },
        { id: "sep-edge", separator: true },
        { id: "goto-source", label: tr("ctx.goTo", { name: nodeTitles[edge.source] || tr("ctx.node") }), icon: Target, onSelect: () => openNodeById(edge.source) },
        { id: "goto-target", label: tr("ctx.goTo", { name: nodeTitles[edge.target] || tr("ctx.node") }), icon: Target, onSelect: () => openNodeById(edge.target) },
        { id: "sep-edge-del", separator: true },
        { id: "del-edge", label: tr("ctx.deleteEdge"), icon: Trash2, danger: true, onSelect: () => deleteSelectedEdge(edge.id) },
      ],
    });
  }, [nodeTitles, closeAll, quickSetRelType, swapEdgeDirection, openNodeById, deleteSelectedEdge,
      rf, settings, relTypes, addEdgePoint, straightenEdge, setEdgeShape]);

  const openPaneMenu = useCallback((e) => {
    e.preventDefault();
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const position = { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 };
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          id: "new-here",
          label: tr("ctx.createHere"),
          icon: Plus,
          items: [
            ...typeItems((t) => addNode(t, position), "new"),
            { id: "sep-new-type", separator: true },
            { id: "make-type", label: tr("ctx.newType"), icon: Shapes, onSelect: createNodeType },
          ],
        },
        {
          id: "paste",
          label: tr("ctx.paste"),
          icon: ClipboardPaste,
          hint: "Ctrl V",
          disabled: !clipboardRef.current?.nodes?.length,
          onSelect: pasteNodes,
        },
        { id: "undo", label: tr("palette.undo"), icon: Undo2, hint: "Ctrl Z", disabled: !undoRef.current.length, onSelect: undo },
        { id: "sep-pane", separator: true },
        {
          id: "layout",
          label: tr("ctx.autoLayout"),
          icon: Wand2,
          items: LAYOUTS.map((l) => ({ id: `layout-${l.id}`, label: tr(l.labelKey), onSelect: () => runLayout(l.id) })),
        },
        { id: "fit", label: tr("editor.fitView"), icon: Maximize2, hint: "F", onSelect: () => rf.fitView({ padding: 0.2, duration: 400 }) },
        {
          id: "minimap",
          label: tr("settings.showMiniMap"),
          icon: MapIcon,
          checked: settings.showMiniMap !== false,
          onSelect: () => changeSettings({ ...settings, showMiniMap: settings.showMiniMap === false }),
        },
        { id: "select-all", label: tr("ctx.selectAll"), icon: SquareDashedMousePointer, onSelect: selectAllVisible },
        { id: "sep-pane2", separator: true },
        { id: "new-canvas", label: tr("editor.newCanvas"), icon: Layers, onSelect: addCanvas },
        { id: "timeline", label: tr("editor.timeline"), icon: CalendarRange, onSelect: () => { closeAll(); setShowTimeline(true); } },
        { id: "sep-pane3", separator: true },
        { id: "palette", label: tr("ctx.commandPalette"), icon: Command, hint: "Ctrl K", onSelect: () => setShowPalette(true) },
        { id: "settings", label: tr("ctx.settings"), icon: Settings, onSelect: () => { closeAll(); setShowSettings(true); } },
      ],
    });
  }, [rf, typeItems, addNode, runLayout, selectAllVisible, closeAll, createNodeType,
      pasteNodes, undo, addCanvas, settings, changeSettings]);

  const openSelectionMenu = useCallback((e, nodes) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      header: tr("ctx.selected", { count: tr("count.nodes", { count: nodes.length }) }),
      items: [
        { id: "chain", label: tr("ctx.chain"), icon: Waypoints, disabled: nodes.length < 2, onSelect: () => chainConnect(nodes) },
        { id: "copy-many", label: tr("ctx.copy"), icon: Copy, hint: "Ctrl C", onSelect: copyNodes },
        { id: "card-mode-many", label: tr("ctx.cardMode"), icon: LayoutGrid, items: cardModeItems(nodes, "sel") },
        ...(canvases.length > 1
          ? [{ id: "move-canvas-many", label: tr("ctx.moveToCanvas"), icon: Layers, items: canvasItems(nodes) }]
          : []),
        { id: "sep-sel", separator: true },
        {
          id: "del-many",
          label: tr("ctx.deleteSelected", { count: nodes.length }),
          icon: Trash2,
          danger: true,
          onSelect: () => rf.deleteElements({ nodes: nodes.map((n) => ({ id: n.id })) }),
        },
      ],
    });
  }, [chainConnect, canvasItems, cardModeItems, canvases.length, rf, copyNodes]);

  /* ---------------- command palette ---------------- */

  const commands = useMemo(() => [
    // Ids must stay unique — they become React keys in the palette list.
    ...(settings?.nodeTypes || []).slice(0, 9).map((t, i) => ({
      id: `new-${t.id}`,
      label: tr("palette.newNode", { type: t.label }),
      hint: t.id === "note" ? "Ctrl+N" : `Ctrl+${i + 1}`,
      icon: Plus,
      run: () => addNode(t.id),
    })),
    { id: "new-type", label: tr("palette.newType"), icon: Shapes, run: createNodeType },
    { id: "layout", label: tr("palette.layoutLayered"), hint: "L", icon: Wand2, run: () => runLayout("layered") },
    { id: "layout-grid", label: tr("palette.layoutGrid"), icon: Wand2, run: () => runLayout("grid") },
    { id: "layout-circle", label: tr("palette.layoutCircle"), icon: Wand2, run: () => runLayout("circle") },
    { id: "fit", label: tr("palette.fit"), hint: "F", icon: Maximize2, run: () => rf.fitView({ padding: 0.2, duration: 400 }) },
    { id: "timeline", label: tr("palette.timeline"), icon: CalendarRange, run: () => { closeAll(); setShowTimeline(true); } },
    { id: "settings", label: tr("palette.settings"), icon: Settings, run: () => { closeAll(); setShowSettings(true); } },
    { id: "export-json", label: tr("palette.exportJson"), icon: FileJson, run: () => exportAs("json") },
    { id: "export-md", label: tr("palette.exportMd"), icon: FileTextIcon, run: () => exportAs("md") },
    { id: "undo", label: tr("palette.undo"), hint: "Ctrl+Z", icon: Undo2, run: undo },
    { id: "shortcuts", label: tr("palette.shortcuts"), hint: "?", icon: Keyboard, run: () => setShowShortcuts(true) },
    { id: "home", label: tr("palette.home"), icon: ArrowLeft, run: () => navigate("/") },
  ], [settings, addNode, runLayout, rf, closeAll, exportAs, undo, navigate, tr, createNodeType]);

  // Как и allNodesForPicker: пока палитра закрыта, её список не нужен никому,
  // а стоит он объекта и замыкания на каждый узел проекта — на каждую правку.
  const paletteNodes = useMemo(() => (showPalette ? nodeFacts.map((d) => ({
    id: d.id,
    title: d.title || tr("common.untitled"),
    subtitle: [typesById[d.typeId]?.label, ...(d.tags || []).map((t) => `#${t}`)]
      .filter(Boolean).join(" · "),
    color: d.nodeType?.color,
    iconName: d.nodeType?.icon,
    run: () => openNodeById(d.id),
  })) : EMPTY_LIST),
  // eslint-disable-next-line
  [showPalette, nodeFacts, typesById, openNodeById]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const tag = (el.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      // Клавишу берём по физической позиции: на кириллице e.key — «и», а не "b".
      const key = hotkey(e);

      if (mod && key === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        if (showPalette || showShortcuts) { setShowPalette(false); setShowShortcuts(false); return; }
        closeAll();
        return;
      }
      if (mod && key === "f") {
        e.preventDefault();
        // Поиск живёт в боковой панели — свёрнутую раскрываем заодно.
        setSidebar((s) => ({ ...s, open: true }));
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (mod && key === "z" && !typing) {
        e.preventDefault();
        undo();
        return;
      }
      if (typing || showPalette) return;
      if (mod && key === "d") {
        e.preventDefault();
        // Узлы спрашиваем у React Flow, а не держим их в зависимостях эффекта:
        // иначе слушатель клавиш переподписывался бы на каждый кадр переноса
        // карточки по холсту.
        duplicateNode(selectedNode || rf.getNodes().find((n) => n.selected)?.data);
        return;
      }
      if (mod && key === "c") { e.preventDefault(); copyNodes(); return; }
      if (mod && key === "v") { e.preventDefault(); pasteNodes(); return; }
      // Создание узлов — под Ctrl: голые N и цифры мешали печатать в холсте
      // и срабатывали случайно.
      if (mod && key === "n") { e.preventDefault(); addNode("note"); return; }
      if (mod && /^[1-9]$/.test(key)) {
        const t = (settings?.nodeTypes || [])[Number(key) - 1];
        if (t) { e.preventDefault(); addNode(t.id); }
        return;
      }
      if (mod) return;
      if (key === "g") { e.preventDefault(); setFocusMode((v) => !v); }
      else if (key === "f") { e.preventDefault(); rf.fitView({ padding: 0.2, duration: 400 }); }
      else if (key === "l") { e.preventDefault(); runLayout("layered"); }
      else if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); setShowShortcuts((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNode, duplicateNode, addNode, runLayout, rf, settings, undo, closeAll,
      showPalette, showShortcuts, copyNodes, pasteNodes]);

  // Скелетон вместо спиннера: спиннер сообщает «ждите», скелетон — «уже почти».
  if (!project) {
    return (
      <div className="min-h-screen sw-bg relative overflow-hidden" data-testid="editor-skeleton">
        <div className="sw-canvas-bg" />
        <div className="sw-canvas-vignette" />
        <div className="absolute inset-0">
          {[
            { top: "26%", left: "18%", w: 260, h: 150 },
            { top: "46%", left: "44%", w: 260, h: 190 },
            { top: "22%", left: "66%", w: 260, h: 130 },
          ].map((box) => (
            <div
              key={box.left}
              className="sw-skeleton absolute"
              style={{ top: box.top, left: box.left, width: box.w, height: box.h, borderRadius: 14, filter: "blur(1px)" }}
            />
          ))}
        </div>
        <span className="absolute bottom-6 left-1/2 -translate-x-1/2 text-sm sw-text-dim">
          {tr("editor.loading")}
        </span>
      </div>
    );
  }

  // Меню верхней панели. Собираются на отрисовке, а не заранее: это пара
  // десятков объектов, и открывают их кликом, а не на каждый кадр.
  const createMenuItems = [
    { id: "create-title", title: tr("editor.addNode") },
    ...(settings.nodeTypes || []).map((t, i) => ({
      id: `create-${t.id}`,
      label: t.label,
      swatch: t.color,
      hint: i < 9 ? String(i + 1) : undefined,
      onSelect: () => addNode(t.id),
    })),
    { id: "create-type", label: tr("ctx.newType"), icon: Shapes, onSelect: createNodeType },
    { id: "sep-create", separator: true },
    { id: "create-canvas", label: tr("editor.newCanvas"), icon: Layers, onSelect: addCanvas },
  ];
  // «⋯» — всё, что нужно не каждую минуту: раскладка, режимы, выгрузка.
  // Раньше это были шесть иконок без подписей прямо над холстом.
  const moreMenuItems = [
    {
      id: "more-layout",
      label: tr("editor.layout"),
      icon: Wand2,
      hint: "L",
      items: LAYOUTS.map((l) => ({ id: `more-layout-${l.id}`, label: tr(l.labelKey), onSelect: () => runLayout(l.id) })),
    },
    { id: "more-fit", label: tr("editor.fitView"), icon: Maximize2, hint: "F", onSelect: () => rf.fitView({ padding: 0.2, duration: 400 }) },
    { id: "more-focus", label: tr("editor.focusMode"), icon: Crosshair, hint: "G", checked: focusMode, onSelect: () => setFocusMode((v) => !v) },
    {
      id: "more-minimap",
      label: tr("settings.showMiniMap"),
      icon: MapIcon,
      checked: settings.showMiniMap !== false,
      onSelect: () => changeSettings({ ...settings, showMiniMap: settings.showMiniMap === false }),
    },
    { id: "sep-more", separator: true },
    {
      id: "more-export",
      label: tr("editor.export"),
      icon: Download,
      items: [
        { id: "more-export-json", label: tr("editor.exportJson"), icon: FileJson, onSelect: () => exportAs("json") },
        { id: "more-export-md", label: tr("editor.exportMd"), icon: FileTextIcon, onSelect: () => exportAs("md") },
      ],
    },
    { id: "sep-more2", separator: true },
    { id: "more-shortcuts", label: tr("palette.shortcuts"), icon: Keyboard, hint: "?", onSelect: () => setShowShortcuts(true) },
  ];

  // relative обязателен: правые панели — absolute right-0, и без него точкой
  // отсчёта им служит не эта коробка, а документ. Тогда overflow-hidden их не
  // обрезает (обрезка не действует на потомка, чей контейнер лежит выше), и на
  // время въезда панели документ становится шире окна — снизу вылезала
  // горизонтальная полоса, а страница могла уехать вбок.
  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col sw-bg">
      <EditorTopBar
        projectName={project.name}
        sidebarOpen={sidebar.open}
        onToggleSidebar={() => setSidebar((s) => ({ ...s, open: !s.open }))}
        onBack={() => navigate("/")}
        canvases={canvases}
        activeCanvas={activeCanvas}
        renderCanvasTab={canvasTab}
        onAddCanvas={addCanvas}
        view={showTimeline ? "timeline" : "canvas"}
        onView={(v) => {
          if (v === "timeline") { closeAll(); setShowTimeline(true); } else setShowTimeline(false);
        }}
        cardMode={settings?.cardMode || "detailed"}
        onCardMode={(id) => changeSettings({ ...settings, cardMode: id })}
        onOpenPalette={() => setShowPalette(true)}
        onOpenCreate={({ x, y }) => setMenu({ x, y, items: createMenuItems })}
        onOpenSettings={() => { closeAll(); setShowSettings(true); }}
        onOpenMore={({ x, y }) => setMenu({ x, y, items: moreMenuItems })}
      />
      {/* Рабочая область под панелью. relative обязателен: правые панели —
          absolute right-0, и точкой отсчёта им служит она, а не окно. */}
      <div className="flex-1 min-h-0 relative flex overflow-hidden">
      {/* Left sidebar */}
      {sidebar.open && (
        <aside
          className="sw-sidebar sw-surface flex flex-col shrink-0 relative"
          style={{ width: sidebar.width }}
          data-testid="left-sidebar"
        >
          {/* Проект и холсты живут в верхней панели (EditorTopBar): боковая —
              это структура мира, а не «где я». */}
          <div className="pt-4" />

          {/* Поиск живёт вне сворачиваемых секций — до него всегда один Ctrl+F.
              Enter и ↓/↑ водят по совпадениям прямо отсюда. */}
          <div className="px-5 pb-5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 sw-text-dim pointer-events-none" />
              <input
                ref={searchRef}
                data-testid="node-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
                  if (e.key === "ArrowDown") { e.preventDefault(); gotoMatch(1); }
                  if (e.key === "ArrowUp") { e.preventDefault(); gotoMatch(-1); }
                  if (e.key === "Escape") { e.preventDefault(); setSearch(""); e.currentTarget.blur(); }
                }}
                placeholder={tr("editor.searchNodes")}
                className="sw-search"
              />
              {/* Подсказка клавиши гаснет при вводе — на её месте счётчик и ×. */}
              {!search ? (
                <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">Ctrl F</kbd>
              ) : (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  <span className="sw-t-num sw-text-dim" data-testid="search-hits">
                    {filtered.length ? `${searchIdx + 1} / ${filtered.length}` : "0"}
                  </span>
                  <button onClick={() => setSearch("")} className="p-0.5 rounded sw-text-dim hover:opacity-70">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Структура мира: типы деревом, теги фильтром, узлы по группам.
              Палитры «Добавить узел» больше нет — создают из группы («+» или
              перетаскиванием её заголовка), из «Создать» наверху и из меню. */}
          <div className="flex-1 sw-scroll-y pb-4">
            <WorldTree
              groups={groupedList}
              filtering={!!q || activeTags.size > 0}
              degrees={degrees}
              activeId={selectedNode?.id || null}
              collapsed={sidebar.collapsed || EMPTY_OBJECT}
              dragType={dragType}
              awayOf={treeAwayOf}
              scope={sidebar.scope || "canvas"}
              onScope={(scope) => setSidebar((s) => ({ ...s, scope }))}
              allTags={allTags}
              activeTags={activeTags}
              onToggleTag={toggleTag}
              onResetTags={() => setActiveTags(new Set())}
              onToggleGroup={toggleTreeGroup}
              onCreate={(typeId) => addNode(typeId)}
              onCreateType={createNodeType}
              onDragStart={onPaletteDragStart}
              onDragEnd={() => setDragType(null)}
              onGroupMenu={openTypeMenu}
              onOpen={openNodeById}
              onContextMenu={openNodeMenuById}
            />
          </div>

          {/* Drag handle */}
          <div
            role="separator"
            aria-label={tr("editor.panelWidth")}
            onMouseDown={startSidebarResize}
            onDoubleClick={() => setSidebar((s) => ({ ...s, width: 268 }))}
            title={tr("editor.panelWidthHint")}
            className="sw-resizer absolute top-0 right-0 w-1.5 h-full cursor-col-resize"
          />
        </aside>
      )}

      {/* Canvas.
          overflow-hidden обязателен: правые панели въезжают из-за края через
          transform, и без обрезки контейнер получает прокручиваемую область
          шириной в панель. Она невидима, но любой focus() внутри неё уводит
          вбок весь экран. */}
      <div
        className="sw-canvas-host flex-1 relative overflow-hidden"
        ref={paneRef}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
        onDoubleClick={(e) => {
          // Only an empty-pane double click creates a node.
          if (e.target.classList?.contains("react-flow__pane")) onPaneDoubleClick(e);
        }}
      >
        {/* Слои холста живут под React Flow: градиент, виньетка и зерно не
            должны перехватывать ни один клик. */}
        <div className="sw-canvas-bg" />
        <div className="sw-canvas-vignette" />
        <div className="sw-canvas-grain" />

        <ReactFlow
          className={flowClass}
          connectionRadius={28}
          // Loose: тянуть связь можно от любой стороны узла к любой. В строгом
          // режиме точка слева умеет только принимать, и граф раскладывается
          // единственным способом — слева направо.
          connectionMode={ConnectionMode.Loose}
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDelete={onDelete}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => { setLinkSource(null); setPreviewId(null); }}
          // Ни одного setState на кадр движения холста: масштаб в счётчике
          // читает сам счётчик (см. ZoomPercent), а вид запоминается по
          // остановке. Раньше onMove дёргал состояние редактора на каждый
          // щелчок колеса — и вместе с ним пересобирались все карточки.
          onMove={(_, vp) => { viewRef.current = vp; markMoving(); }}
          // Перенос карточки — то же движение: под ней перерисовывается всё,
          // над чем она проезжает, вместе с её тенью и бликом.
          onNodeDrag={markMoving}
          onMoveEnd={(_, vp) => writeView(id, vp)}
          // Холст поехал — меню больше не относится к тому, что под ним.
          onMoveStart={() => setMenu(null)}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick}
          onNodeContextMenu={openNodeMenu}
          onEdgeContextMenu={openEdgeMenu}
          onPaneContextMenu={openPaneMenu}
          onSelectionContextMenu={openSelectionMenu}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          deleteKeyCode={["Backspace", "Delete"]}
          multiSelectionKeyCode={["Shift"]}
          snapToGrid={!!settings.snapToGrid}
          snapGrid={[22, 22]}
          // Возвращаемся туда, где холст оставили. fitView только для проекта,
          // открытого впервые: иначе каждое открытие сбрасывает вид, и на
          // большом графе приходится заново искать место работы.
          defaultViewport={savedView || undefined}
          fitView={!savedView}
          minZoom={0.15}
          maxZoom={2.5}
          // Виртуализация — своя, библиотечная: в DOM живёт только то, что
          // попало в кадр. На малых графах не включаем — там монтирование при
          // панорамировании стоит дороже, чем готовые карточки.
          onlyRenderVisibleElements={rfNodes.length >= CULL_LIMIT}
          proOptions={PRO_OPTIONS}
          data-testid="react-flow-canvas"
        >
          <FarZoomFlag targetRef={paneRef} />
          {settings.showGrid && <CanvasGrid />}
          {settings.showMiniMap !== false && (
            <MiniMap
              pannable
              zoomable
              // Функция и стиль модульные: новые на каждый рендер редактора
              // заставляли мини-карту обходить все узлы заново.
              nodeColor={miniMapColor}
              nodeBorderRadius={4}
              style={MINIMAP_STYLE}
              maskColor="color-mix(in srgb, var(--sw-bg) 62%, transparent)"
            />
          )}
          {/* Кнопка сразу за мини-картой, соседом в DOM: по наведению на карту
              она проявляется через селектор «+» (index.css). Скрытая карта
              оставляет вместо себя значок — убрать её насовсем можно было и
              раньше, а вот найти, как вернуть, — только в настройках. */}
          <button
            type="button"
            data-testid="minimap-toggle-btn"
            className={`sw-minimap-toggle ${settings.showMiniMap !== false ? "is-open" : "sw-glass"}`}
            title={tr(settings.showMiniMap !== false ? "editor.hideMiniMap" : "editor.showMiniMap")}
            onClick={() => changeSettings({ ...settings, showMiniMap: settings.showMiniMap === false })}
          >
            {settings.showMiniMap !== false ? <Minus className="w-3 h-3" /> : <MapIcon className="w-4 h-4" />}
          </button>
        </ReactFlow>

        {/* Выбрано несколько узлов — действия с ними сверху холста. Раньше
            всё это жило только в меню правой кнопки по выделению, и что с
            выделением вообще можно что-то сделать, было не видно. */}
        {multiSelected.length > 1 && !showTimeline && (
          <div className="sw-selbar sw-glass" data-testid="selection-bar" onClick={(e) => e.stopPropagation()}>
            <span className="sw-selbar-count">
              {tr("ctx.selected", { count: tr("count.nodes", { count: multiSelected.length }) })}
            </span>
            <span className="sw-selbar-sep" />
            <button
              type="button"
              data-testid="selection-chain"
              onClick={() => chainConnect(multiSelected)}
              className="sw-preview-act"
            >
              <Waypoints className="w-3.5 h-3.5" /> {tr("ctx.chain")}
            </button>
            <button
              type="button"
              data-testid="selection-delete"
              onClick={() => rf.deleteElements({ nodes: multiSelected.map((n) => ({ id: n.id })) })}
              className="sw-preview-act text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" /> {tr("common.delete")}
            </button>
            <button
              type="button"
              data-testid="selection-more"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openSelectionMenu({ preventDefault() {}, clientX: r.left, clientY: r.bottom + 6 }, multiSelected);
              }}
              title={tr("editor.more")}
              className="sw-preview-act"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            <span className="sw-selbar-sep" />
            <button
              type="button"
              data-testid="selection-clear"
              onClick={() => setRfNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)))}
              title={tr("ctx.selectionClear")}
              className="sw-preview-act"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Быстрый просмотр — сосед холста, а не его потомок: колесо и клики
            внутри превью не должны доходить до панорамирования и выделения.
            Данные берём из проекции карточек — там уже собраны соседи и даты. */}
        {previewId && multiSelected.length <= 1 && (() => {
          const data = displayNodes.find((n) => n.id === previewId)?.data;
          return data ? (
            <NodePreview
              node={data}
              nodes={allNodesForPicker}
              onOpenEditor={openNodeById}
              onOpenNode={openNodeById}
              onPeek={peekNode}
              onClose={() => setPreviewId(null)}
              // «Связать»: превью уходит, чтобы не заслонять узел, по
              // которому сейчас щёлкнут вторым.
              onLink={(nodeId) => { setPreviewId(null); setLinkSource(nodeId); }}
              onTypeMenu={(pos, nodeId) => {
                const n = rf.getNode(nodeId);
                if (!n) return;
                const cur = `pv-type-${n.data.typeId || "note"}`;
                setMenu({
                  ...pos,
                  items: typeItems((typeId) => changeNodeType(n, typeId), "pv-type")
                    .map((it) => ({ ...it, checked: it.id === cur })),
                });
              }}
              onMore={(pos, nodeId) => {
                const n = rf.getNode(nodeId);
                if (n) openNodeMenu({ preventDefault() {}, clientX: pos.x, clientY: pos.y }, n);
              }}
            />
          ) : null;
        })()}

        {/* Контролы зума: горизонтальная пилюля, процент кликабелен (сброс к
            100 %) и набран табличными цифрами — не дёргается при зуме. */}
        <div className="absolute bottom-4 left-4 z-10 sw-glass sw-zoom" data-testid="zoom-controls">
          <button onClick={() => rf.zoomOut({ duration: 160 })} title={tr("editor.zoomOut")}>
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            className="sw-zoom-value"
            data-testid="zoom-value"
            onClick={() => rf.zoomTo(1, { duration: 240 })}
            title={tr("editor.zoomReset")}
          >
            <ZoomPercent />
          </button>
          <button onClick={() => rf.zoomIn({ duration: 160 })} title={tr("editor.zoomIn")}>
            <Plus className="w-3.5 h-3.5" />
          </button>
          <span className="sw-zoom-sep" />
          <button onClick={() => rf.fitView({ padding: 0.2, duration: 400 })} title={tr("editor.fitView")}>
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Куда бросать узел из палитры */}
        {dragType && (
          <div
            className="absolute inset-3 rounded-2xl border-2 border-dashed pointer-events-none z-10 flex items-end justify-center pb-8"
            style={{
              borderColor: typesById[dragType]?.color || "var(--sw-accent)",
              background: "color-mix(in srgb, var(--sw-accent) 5%, transparent)",
            }}
            data-testid="drop-hint"
          >
            <span className="px-3 py-1.5 rounded-full sw-glass text-xs">
              {tr("editor.dropHere", { type: typesById[dragType]?.label || tr("ctx.node") })}
            </span>
          </div>
        )}

        {/* Link mode hint */}
        {linkSource && (
          <div
            className="absolute bottom-4 left-1/2 px-3.5 py-2 rounded-full sw-glass text-xs flex items-center gap-2 z-10 sw-rise"
            data-testid="link-mode-bar"
          >
            <Link2 className="w-3.5 h-3.5 sw-accent-text" />
            {tr("editor.linkHint", { name: nodeTitles[linkSource] || tr("ctx.node") })}
            <button onClick={() => setLinkSource(null)} className="sw-accent-text">{tr("editor.linkCancel")}</button>
          </div>
        )}

        {/* Search status bar */}
        {(q || activeTags.size > 0) && !linkSource && (
          <div className="absolute bottom-4 left-1/2 px-3 py-1.5 rounded-full sw-glass text-xs flex items-center gap-2 z-10 sw-rise">
            <Search className="w-3 h-3 sw-text-dim" />
            {tr("editor.found", { count: filtered.length, total: visibleIds.size })}
            {filtered.length > 0 && (
              <>
                <span className="sw-tooldiv" />
                <span className="sw-t-num sw-text-dim" data-testid="search-counter">
                  {searchIdx + 1} / {filtered.length}
                </span>
                <button onClick={() => gotoMatch(-1)} title={tr("editor.prevMatch")} className="sw-text-dim hover:opacity-70">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => gotoMatch(1)} title={tr("editor.nextMatch")} className="sw-text-dim hover:opacity-70">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button onClick={() => { setSearch(""); setActiveTags(new Set()); }} className="sw-accent-text">
              {tr("common.reset")}
            </button>
          </div>
        )}

        {/* Пустой холст — не пустая чернота, а место, откуда видно, что делать
            дальше: четыре типа под рукой и строка хоткеев. */}
        {rfNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center max-w-md px-6 animate-fade-up">
              <Network className="w-10 h-10 sw-text-dim mx-auto mb-4" />
              <p className="sw-display text-2xl tracking-tight mb-1">{tr("editor.emptyCanvas")}</p>
              <p className="sw-text-dim text-sm">{tr("editor.emptyCanvasHint", { key: "Ctrl+N" })}</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 pointer-events-auto">
                {(settings.nodeTypes || []).slice(0, 4).map((t) => (
                  <button
                    key={t.id}
                    data-testid={`empty-add-${t.id}`}
                    onClick={() => addNode(t.id)}
                    className="sw-typed flex items-center gap-2 h-8 px-3 rounded-lg border sw-border-c text-xs sw-btn"
                    style={{ "--node-color": t.color }}
                  >
                    <span className="w-4 h-4 rounded flex items-center justify-center" style={{ background: "var(--node-tone)" }}>
                      <NodeIcon name={t.icon} className="w-2.5 h-2.5 text-white" />
                    </span>
                    {t.label}
                  </button>
                ))}
                {/* Шаблон «свой набор» заводит проект вовсе без типов, и без
                    этой кнопки с пустого холста некуда идти: плитки нет,
                    подменю «создать узел» пустое. */}
                {(settings.nodeTypes || []).length === 0 && (
                  <button
                    data-testid="empty-add-type"
                    onClick={createNodeType}
                    className="flex items-center gap-2 h-8 px-3 rounded-lg border border-dashed sw-border-c text-xs sw-btn"
                  >
                    <Plus className="w-3.5 h-3.5" /> {tr("editor.newType")}
                  </button>
                )}
              </div>
              <p className="mt-5 sw-t-meta sw-text-dim flex items-center justify-center gap-2 flex-wrap">
                <span>{tr("editor.emptyKeysNode")}</span><span className="opacity-40">·</span>
                <kbd>Ctrl K</kbd><span>{tr("editor.emptyKeysPalette")}</span><span className="opacity-40">·</span>
                <kbd>Space</kbd><span>{tr("editor.emptyKeysPan")}</span>
              </p>
            </div>
          </div>
        )}

        {/* Таймлайн — второй вид того же мира, а не окно поверх всего: он
            занимает место холста под верхней панелью, а переключают его там же,
            где выбирают вид. Холст под ним остаётся смонтированным — вернуться
            на него стоит одного кадра, а не пересборки графа. */}
        {showTimeline && (
          <Suspense fallback={null}>
            <TimelinePanel
              key="timeline"
              chrono={chrono}
              settings={settings}
              edges={rfEdges}
              typesById={typesById}
              allNodes={allNodesForPicker}
              onOpenNode={(nodeId) => { setShowTimeline(false); openNodeById(nodeId); }}
              onOpenSettings={() => { setShowTimeline(false); setShowSettings(true); }}
              onChangeDates={setNodeDates}
              onClose={() => setShowTimeline(false)}
            />
          </Suspense>
        )}
      </div>

      {/* Right panels — закреплены в ряду рядом с холстом (.sw-dock), холст
          сужается под них. They unmount immediately on close (framer's
          AnimatePresence keeps stale panels alive under React 19).
          Suspense без заглушки: куски уже подтянуты в простое, а мигать
          заполнителем там, где панель и так въезжает справа, незачем. */}
      <Suspense fallback={null}>
        {/* Без key: панель остаётся смонтированной между узлами. С ним каждое
            переключение проигрывало въезд справа заново — отсюда и рывки. */}
        {selectedNode && panelOpen && !showSettings && (
          <NodeEditorPanel
            node={selectedNode}
            nodeTypes={settings.nodeTypes}
            fieldTemplates={settings.fieldTemplates}
            allNodes={allNodesForPicker}
            calendar={calendar}
            eras={eras}
            allTags={allTags}
            connections={connections}
            onOpenNode={openNodeById}
            onCreateNode={(title) => addNode("note", undefined, { title })}
            canvases={canvases}
            focusField={focusField}
            onLiveChange={patchNodeLocal}
            onClose={() => { setPanelOpen(false); setSelectedNode(null); }}
            onSave={saveNode}
            onDelete={deleteNode}
            onDuplicate={duplicateNode}
            onChangeType={(typeId) => {
              const n = rf.getNode(selectedNode.id);
              if (n) changeNodeType(n, typeId);
            }}
            onLink={(targetId) => connectNodes(selectedNode.id, targetId)
              .then((e) => e && toast.success(tr("editor.toasts.edgeCreated")))}
            onUnlink={deleteSelectedEdge}
          />
        )}
        {selectedEdge && (
          <EdgeEditorPanel
            key={selectedEdge.id}
            edge={selectedEdge}
            nodeTitles={nodeTitles}
            relTypes={relTypes}
            onOpenNode={openNodeById}
            onClose={() => setSelectedEdge(null)}
            onSave={saveEdge}
            onDelete={deleteSelectedEdge}
          />
        )}
        {showSettings && (
          <SettingsPanel
            key="settings"
            settings={settings}
            project={project}
            onProjectChange={patchProject}
            typeUsage={typeUsage}
            canvasUsage={canvasUsage}
            relUsage={relUsage}
            highlightType={highlightType}
            onHighlighted={() => setHighlightType(null)}
            onChange={changeSettings}
            onClose={() => { setShowSettings(false); setHighlightType(null); }}
          />
        )}
        {/* Overlays. Оба монтируются только открытыми: закрытый оверлей всё
            равно рисовал null, но держал в редакторе свой кусок сборки и свои
            подписки. */}
        {showPalette && (
          <CommandPalette
            open
            onClose={() => setShowPalette(false)}
            commands={commands}
            nodes={paletteNodes}
          />
        )}
        {showShortcuts && <ShortcutsDialog open onClose={() => setShowShortcuts(false)} />}
      </Suspense>
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

export default function Editor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}
