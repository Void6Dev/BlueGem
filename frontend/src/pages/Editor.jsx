import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ReactFlow, ReactFlowProvider, Background, MiniMap, useReactFlow,
  useNodesState, useEdgesState, addEdge, BackgroundVariant, MarkerType,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { toast } from "sonner";
import {
  ArrowLeft, Settings, Plus, Search, Network, PanelLeftClose, PanelLeft,
  Layers, CalendarRange, X, Command, Download, Wand2, Keyboard, Maximize2,
  ChevronDown, ChevronUp, Minus, FileJson, FileText as FileTextIcon, Undo2, Tag,
  Link2, Unlink, Crosshair, Target, ArrowLeftRight, Pencil, Copy, Trash2,
  SquareDashedMousePointer, Spline, Waypoints, Scissors, Shapes, ChevronRight,
} from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { applySettings, applyStoredAppearance, DEFAULT_EDGE_COLOR, REL_TYPES } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { hotkey } from "@/lib/hotkey";
import { LAYOUTS } from "@/lib/layout";
import { downloadJson, downloadMarkdown } from "@/lib/exporters";
import CustomNode from "@/components/CustomNode";
import NodeEditorPanel from "@/components/NodeEditorPanel";
import EdgeEditorPanel from "@/components/EdgeEditorPanel";
import SettingsPanel from "@/components/SettingsPanel";
import CommandPalette from "@/components/CommandPalette";
import ContextMenu from "@/components/ContextMenu";
import ShortcutsDialog from "@/components/ShortcutsDialog";
import TimelinePanel from "@/components/timeline/TimelinePanel";
import { normalizeEras, resolveCalendar, useChronology } from "@/lib/chrono";
import { NodeIcon } from "@/components/NodeIcon";

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
const SIDEBAR_KEY = "bluegem:sidebar";
const NODE_W = 260;
const NODE_H = 150;
// Выше этого числа узлов вход не анимируется: staggered появление двухсот
// карточек — это мучительная секунда на каждом открытии проекта.
const ANIM_LIMIT = 40;

// Build a React Flow edge. Линия в покое нейтральна для всех типов связей:
// цвет типа живёт в --rel-color и проявляется под курсором и в выделении.
// Граф из разноцветных линий превращается в спагетти — этого не повторяем.
function toRfEdge(e, settings) {
  const color = e.color || DEFAULT_EDGE_COLOR;
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: settings?.edgeType || "smoothstep",
    animated: !!settings?.animatedEdges,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--sw-edge)" },
    style: { "--rel-color": color },
    data: { relType: e.relType || "", color: e.color || "" },
  };
}

const DEFAULT_SECTIONS = { palette: true, tags: true, list: true };

function readSidebarPrefs() {
  const fallback = { open: true, width: 268, sections: DEFAULT_SECTIONS };
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_KEY) || "{}");
    return { ...fallback, ...saved, sections: { ...DEFAULT_SECTIONS, ...(saved.sections || {}) } };
  } catch {
    return fallback;
  }
}

/** Сворачиваемая секция боковой панели. Разделителем служит воздух и метка:
 *  рамок и шевронов по умолчанию нет, шеврон приходит по наведению. */
function SidebarSection({ id, title, count, open, onToggle, children }) {
  const tr = useT();
  return (
    <div className="group pb-6">
      <button
        data-testid={`section-${id}`}
        onClick={onToggle}
        title={open ? tr("editor.collapse") : tr("editor.expand")}
        className="w-full flex items-center gap-1.5 px-4 h-6 sw-section-label transition-colors"
      >
        <ChevronRight
          className={`w-3 h-3 shrink-0 opacity-0 group-hover:opacity-70 transition-all duration-200
            ${open ? "rotate-90" : ""}`}
        />
        <span className="flex-1 text-left truncate">{title}</span>
        {count !== undefined && <span className="sw-t-num normal-case tracking-normal">{count}</span>}
      </button>
      {open && <div className="px-4 pt-2 animate-fade-up">{children}</div>}
    </div>
  );
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
  const [focusField, setFocusField] = useState(null);   // к какому полю подъехать в панели
  const [highlightType, setHighlightType] = useState(null); // только что созданный тип узла
  const [showSettings, setShowSettings] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [openMenu, setOpenMenu] = useState(null); // "layout" | "export" | null
  const [menu, setMenu] = useState(null);         // right-click menu descriptor
  const [linkSource, setLinkSource] = useState(null); // "connect from this node" mode
  const [dragType, setDragType] = useState(null); // тип, который тянут из палитры
  const [sidebar, setSidebar] = useState(readSidebarPrefs);
  const [search, setSearch] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);   // на каком совпадении стоим
  const [focusMode, setFocusMode] = useState(false); // показывать только соседей
  const [zoom, setZoom] = useState(1);
  const [activeTags, setActiveTags] = useState(() => new Set());
  const [currentCanvas, setCurrentCanvas] = useState("");
  const [renamingCanvas, setRenamingCanvas] = useState(null); // { id, label } вкладки на правке
  const paneRef = useRef(null);
  const searchRef = useRef(null);
  const undoRef = useRef([]);
  const visitedRef = useRef(false);   // по совпадениям поиска уже ходили?
  const projectSaveRef = useRef(null);

  const settings = project?.settings;
  const typesById = useMemo(
    () => (settings?.nodeTypes || []).reduce((a, t) => ({ ...a, [t.id]: t }), {}),
    [settings]
  );
  const canvases = settings?.canvases?.length
    ? settings.canvases
    : [{ id: "main", label: tr("editor.mainCanvas") }];
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
  const toggleSection = useCallback((id) => {
    setSidebar((s) => ({ ...s, sections: { ...s.sections, [id]: !s.sections[id] } }));
  }, []);

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
        const p = await api.getProject(id);
        setProject(p);
        applySettings(p.settings);
        const g = await api.getGraph(id);
        const tById = (p.settings.nodeTypes || []).reduce((a, t) => ({ ...a, [t.id]: t }), {});
        setRfNodes(g.nodes.map((n) => mapNode(n, tById)));
        setRfEdges(g.edges.map((e) => toRfEdge(e, p.settings)));
      } catch (e) {
        toast.error(apiErrorMessage(e, "errors.projectNotFound"));
        navigate("/");
      }
    })();
    // Leaving the editor: fall back to the remembered global appearance.
    return () => applyStoredAppearance();
    // eslint-disable-next-line
  }, [id]);

  // Re-apply node type visuals & edge type when settings change
  useEffect(() => {
    if (!settings) return;
    applySettings(settings);
    setRfNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, nodeType: typesById[n.data.typeId] || typesById["note"] || n.data.nodeType },
    })));
    setRfEdges((eds) => eds.map((e) => ({
      ...e,
      type: settings.edgeType || "smoothstep",
      animated: !!settings.animatedEdges,
    })));
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
    const n = rf.getNode(nodeId);
    if (!n) return;
    rf.setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom: 1.05, duration: 420 });
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
    focusNode(nodeId);
  }, [rf, focusNode, activeCanvas, mainCanvasId]);

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
    setFocusField({ field, at: Date.now() });
  }, [rf]);

  /**
   * Правка из панели попадает на холст сразу, в том же кадре: на сервер она
   * уедет автосохранением через секунду, но ждать этого, чтобы увидеть новое
   * название на карточке, незачем.
   */
  const patchNodeLocal = useCallback((nodeId, patch) => {
    setRfNodes((nds) => nds.map((n) => (n.id === nodeId
      ? { ...n, data: { ...n.data, ...patch } } : n)));
    setSelectedNode((sel) => (sel && sel.id === nodeId ? { ...sel, ...patch } : sel));
  }, [setRfNodes]);

  // Переименование прямо на карточке (двойной клик по названию).
  const renameNode = useCallback((nodeId, title) => {
    patchNodeLocal(nodeId, { title });
    api.updateNode(nodeId, { title }).catch((e) => toast.error(apiErrorMessage(e, "errors.saveNode")));
  }, [patchNodeLocal]);

  const addNode = useCallback(async (typeId, position, extra = {}) => {
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
      const node = await api.createNode(id, {
        typeId: src.typeId,
        title: `${src.title || tr("edge.node")} (${tr("dashboard.duplicate").toLowerCase()})`,
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
      setRfNodes((nds) => [...nds, mapNode(fixed, typesById)]);
      setSelectedEdge(null);
      setSelectedNode(node);
      toast.success(tr("editor.toasts.nodeDuplicated"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.duplicateNode"));
    }
    // eslint-disable-next-line
  }, [id, mapNode, typesById, activeCanvas]);

  /* ---------------- undo ---------------- */

  const restore = useCallback(async (entry) => {
    const idMap = {};
    try {
      const restored = [];
      for (const n of entry.nodes) {
        const created = await api.createNode(id, {
          typeId: n.typeId, title: n.title, description: n.description,
          fields: (n.fields || []).map((f) => ({ key: f.key, value: f.value })),
          position: n.position, tags: n.tags || [], image: n.image || "",
          date: n.date || "", dates: n.dates || [], canvas: n.canvas || "",
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
          ? { ...mapNode(fixed, typesById), position: x.position } : x)));
      }
      for (const e of entry.edges) {
        const source = idMap[e.source] || e.source;
        const target = idMap[e.target] || e.target;
        if (!rf.getNode(source) && !idMap[e.source]) continue;
        const edge = await api.createEdge(id, {
          source, target, label: e.label || "",
          relType: e.data?.relType || "", color: e.data?.color || "",
        });
        setRfEdges((eds) => [...eds.filter((x) => x.id !== edge.id), toRfEdge(edge, settings)]);
      }
      toast.success(tr("editor.toasts.restored"));
    } catch (err) {
      toast.error(apiErrorMessage(err, "errors.undo"));
    }
    // eslint-disable-next-line
  }, [id, mapNode, typesById, settings, rf]);

  const pushUndo = useCallback((entry) => {
    undoRef.current = [...undoRef.current.slice(-19), entry];
  }, []);

  const undo = useCallback(() => {
    const entry = undoRef.current.pop();
    if (!entry) return toast(tr("editor.toasts.nothingToRestore"));
    return restore(entry);
  }, [restore]);

  /* ---------------- react flow handlers ---------------- */

  const connectNodes = useCallback(async (source, target, patch = {}) => {
    if (!source || !target || source === target) return null;
    try {
      const edge = await api.createEdge(id, { source, target, ...patch });
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
  }, [id, settings, setRfEdges, updateNodeInternals]);

  const onConnect = useCallback(
    (conn) => connectNodes(conn.source, conn.target),
    [connectNodes]
  );

  // One handler for both: React Flow reports a node deletion together with the
  // edges it took down, so undo can restore the whole thing as a unit.
  const onDelete = useCallback(({ nodes = [], edges = [] }) => {
    if (!nodes.length && !edges.length) return;
    const ids = new Set(nodes.map((n) => n.id));
    pushUndo({ nodes: nodes.map((n) => n.data), edges });
    nodes.forEach((n) => api.deleteNode(n.id).catch(() => {}));
    edges.filter((e) => !ids.has(e.source) && !ids.has(e.target))
      .forEach((e) => api.deleteEdge(e.id).catch(() => {}));
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

  const onNodeDragStop = useCallback((_, node) => {
    api.updateNode(node.id, { position: node.position }).catch(() => {});
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
  }, [linkSource, connectNodes]);

  const onNodeDoubleClick = useCallback((_, node) => focusNode(node.id), [focusNode]);

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
        ? { ...mapNode(updated, typesById), position: n.position, selected: n.selected }
        : n)));
      if (opts.close) {
        setSelectedNode(null);
        toast.success(tr("editor.toasts.nodeSaved"));
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.saveNode"));
    }
  }, [mapNode, typesById, setRfNodes]);

  const deleteNode = useCallback(async (nodeId) => {
    const node = rf.getNode(nodeId);
    const touchedEdges = rfEdges.filter((e) => e.source === nodeId || e.target === nodeId);
    try {
      await api.deleteNode(nodeId);
      if (node) pushUndo({ nodes: [node.data], edges: touchedEdges });
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
      const updated = await api.updateEdge(edgeId, patch);
      setRfEdges((eds) => eds.map((e) => (e.id === edgeId ? toRfEdge(updated, settings) : e)));
      setSelectedEdge(null);
      toast.success(tr("editor.toasts.edgeUpdated"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.saveEdge"));
    }
  }, [settings, setRfEdges]);

  const deleteSelectedEdge = useCallback(async (edgeId) => {
    const edge = rfEdges.find((e) => e.id === edgeId);
    try {
      await api.deleteEdge(edgeId);
      if (edge) pushUndo({ nodes: [], edges: [edge] });
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
    const created = await addNode(typeId, {
      x: (src.position?.x || 0) + 340,
      y: (src.position?.y || 0) + (Math.random() * 120 - 60),
    });
    if (created) await connectNodes(src.id, created.id);
  }, [addNode, connectNodes]);

  const changeNodeType = useCallback(async (node, typeId) => {
    if ((node.data.typeId || "note") === typeId) return;
    try {
      const updated = await api.updateNode(node.id, { typeId });
      setRfNodes((nds) => nds.map((n) => (n.id === updated.id
        ? { ...mapNode(updated, typesById), position: n.position, selected: n.selected }
        : n)));
      setSelectedNode((sel) => (sel && sel.id === updated.id ? { ...sel, typeId } : sel));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.changeType"));
    }
  }, [mapNode, typesById, setRfNodes]);

  const unlinkAll = useCallback(async (nodeId) => {
    const mine = rfEdges.filter((e) => e.source === nodeId || e.target === nodeId);
    if (!mine.length) return;
    pushUndo({ nodes: [], edges: mine });
    await Promise.all(mine.map((e) => api.deleteEdge(e.id).catch(() => {})));
    setRfEdges((eds) => eds.filter((e) => !mine.some((m) => m.id === e.id)));
    toast.success(tr("editor.toasts.unlinked", { count: mine.length }), {
      action: { label: tr("common.restore"), onClick: undo },
    });
  }, [rfEdges, setRfEdges, pushUndo, undo]);

  const moveNodesToCanvas = useCallback(async (nodes, canvasId) => {
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
  }, [setRfNodes]);

  const quickSetRelType = useCallback(async (edge, relType) => {
    const preset = REL_TYPES.find((r) => r.id === relType);
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
  }, [settings, setRfEdges]);

  const swapEdgeDirection = useCallback(async (edge) => {
    try {
      const updated = await api.updateEdge(edge.id, { source: edge.target, target: edge.source });
      setRfEdges((eds) => eds.map((e) => (e.id === edge.id ? toRfEdge(updated, settings) : e)));
      toast.success(tr("editor.toasts.swapped"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.swapEdge"));
    }
  }, [settings, setRfEdges]);

  // Wire a multi-selection together in the order it was picked.
  const chainConnect = useCallback(async (nodes) => {
    let made = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      // eslint-disable-next-line no-await-in-loop
      if (await connectNodes(nodes[i].id, nodes[i + 1].id)) made += 1;
    }
    if (made) toast.success(tr("editor.toasts.chained", { count: made }));
  }, [connectNodes]);

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
    persistSettings({ ...settings, canvases: [...canvases, nc] });
    setCurrentCanvas(nc.id);
    setRenamingCanvas({ id: nc.id, label: nc.label });
  }, [settings, canvases, persistSettings, tr]);

  const commitCanvasName = useCallback(() => {
    if (!renamingCanvas) return;
    const label = renamingCanvas.label.trim();
    const current = canvases.find((c) => c.id === renamingCanvas.id);
    // Пустое имя — это отказ от переименования, а не безымянный холст.
    if (label && current && label !== current.label) {
      persistSettings({
        ...settings,
        canvases: canvases.map((c) => (c.id === renamingCanvas.id ? { ...c, label } : c)),
      });
    }
    setRenamingCanvas(null);
  }, [renamingCanvas, canvases, settings, persistSettings]);

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
    const visible = rfNodes.filter((n) => nodeCanvas(n) === activeCanvas);
    if (!visible.length) return;
    const edgesHere = rfEdges.filter((e) =>
      visible.some((n) => n.id === e.source) && visible.some((n) => n.id === e.target));
    const positions = layout.run(visible, edgesHere);
    const byId = new Map(positions.map((p) => [p.id, p.position]));
    setRfNodes((nds) => nds.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id) } : n)));
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 500 }), 60);
    try {
      await api.updatePositions(id, positions);
      toast.success(tr("editor.toasts.layout", { name: tr(layout.labelKey).toLowerCase() }));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.positions"));
    }
  }, [rfNodes, rfEdges, activeCanvas, nodeCanvas, setRfNodes, rf, id]);

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

  const q = search.trim().toLowerCase();
  const matchesSearch = useCallback((n) => {
    if (!q) return true;
    const d = n.data;
    return (d.title || "").toLowerCase().includes(q)
      || (d.description || "").toLowerCase().includes(q)
      || (d.tags || []).some((t) => t.toLowerCase().includes(q))
      || (d.fields || []).some((f) =>
          (f.key || "").toLowerCase().includes(q) || (f.value || "").toLowerCase().includes(q));
  }, [q]);
  const matchesTags = useCallback(
    (n) => activeTags.size === 0 || (n.data.tags || []).some((t) => activeTags.has(t)),
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

  const filtered = rfNodes.filter((n) => matchesSearch(n) && matchesTags(n) && nodeCanvas(n) === activeCanvas);
  const allTags = useMemo(
    () => Array.from(new Set(rfNodes.flatMap((n) => n.data.tags || []))).sort((a, b) => a.localeCompare(b, "ru")),
    [rfNodes]
  );

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
  const displayNodes = useMemo(() => rfNodes.map((n) => {
    const onCanvas = nodeCanvas(n) === activeCanvas;
    const passes = matchesTags(n) && matchesSearch(n);
    const linkable = !!linkSource && linkSource !== n.id;
    return {
      ...n,
      hidden: !onCanvas,
      className: linkable ? "sw-node-target" : undefined,
      data: {
        ...n.data,
        degree: degrees.get(n.id) || 0,
        dimmed: onCanvas && !passes,
        faded: !!neighbourIds && !neighbourIds.has(n.id),
        hit: onCanvas && !!q && passes,
        linking: linkSource === n.id,
        linkable,
        onRename: renameNode,
        onFocusField: focusNodeField,
      },
    };
  }), [rfNodes, activeCanvas, nodeCanvas, matchesTags, matchesSearch, degrees, q, linkSource,
      neighbourIds, renameNode, focusNodeField]);

  const visibleIds = useMemo(
    () => new Set(rfNodes.filter((n) => nodeCanvas(n) === activeCanvas).map((n) => n.id)),
    [rfNodes, activeCanvas, nodeCanvas]
  );
  // Толщина и цвет линии живут в CSS (состояния hover/selected) — здесь только
  // видимость и приглушение чужих связей.
  const displayEdges = useMemo(() => rfEdges.map((e) => {
    const mine = selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id);
    const outside = neighbourIds && !(neighbourIds.has(e.source) && neighbourIds.has(e.target));
    return {
      ...e,
      hidden: !visibleIds.has(e.source) || !visibleIds.has(e.target),
      className: [e.className, (selectedNode && !mine) || outside ? "sw-edge-faded" : ""]
        .filter(Boolean).join(" ") || undefined,
    };
  }), [rfEdges, visibleIds, selectedNode, neighbourIds]);

  const allNodesForPicker = useMemo(
    () => rfNodes.map((n) => ({
      id: n.id, title: n.data.title, nodeType: n.data.nodeType,
    })),
    [rfNodes]
  );

  const nodeTitles = useMemo(
    () => rfNodes.reduce((a, n) => ({ ...a, [n.id]: n.data.title }), {}),
    [rfNodes]
  );

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

  // Хронология проекта: даты разбираются один раз на изменение узлов, а не на
  // каждое движение по холсту (см. useChronology).
  const chrono = useChronology(rfNodes, settings);
  const calendar = useMemo(() => resolveCalendar(settings), [settings?.calendar]);
  const eras = useMemo(() => normalizeEras(settings?.eras), [settings?.eras]);

  const groupedList = useMemo(() => {
    const groups = new Map();
    filtered.forEach((n) => {
      const key = n.data.typeId || "note";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });
    return (settings?.nodeTypes || [])
      .filter((t) => groups.has(t.id))
      .map((t) => ({ type: t, nodes: groups.get(t.id) }))
      .concat(
        Array.from(groups.keys())
          .filter((k) => !(settings?.nodeTypes || []).some((t) => t.id === k))
          .map((k) => ({ type: { id: k, label: tr("editor.otherType"), color: "#64748b", icon: "FileText" }, nodes: groups.get(k) }))
      );
  }, [filtered, settings]);

  const typeUsage = useMemo(() => rfNodes.reduce((a, n) => {
    const k = n.data.typeId || "note";
    return { ...a, [k]: (a[k] || 0) + 1 };
  }, {}), [rfNodes]);
  const canvasUsage = useMemo(() => rfNodes.reduce((a, n) => {
    const k = nodeCanvas(n);
    return { ...a, [k]: (a[k] || 0) + 1 };
  }, {}), [rfNodes, nodeCanvas]);

  const toggleTag = (t) =>
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });

  const closeAll = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setShowSettings(false);
    setShowTimeline(false);
    setOpenMenu(null);
    setMenu(null);
    setLinkSource(null);
  }, []);

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
        onClick={() => setCurrentCanvas(c.id)}
        onDoubleClick={() => setRenamingCanvas({ id: c.id, label: c.label })}
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

  const openNodeMenu = useCallback((e, node) => {
    e.preventDefault();
    const mine = rfEdges.filter((x) => x.source === node.id || x.target === node.id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      header: node.data.title || tr("common.untitled"),
      headerColor: node.data.nodeType?.color,
      items: [
        { id: "open", label: tr("ctx.openInEditor"), icon: Pencil, onSelect: () => openNodeById(node.id) },
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
        { id: "dup", label: tr("ctx.duplicate"), icon: Copy, hint: "Ctrl D", onSelect: () => duplicateNode(node.data) },
        { id: "focus", label: tr("ctx.center"), icon: Target, onSelect: () => focusNode(node.id) },
        ...(canvases.length > 1
          ? [{ id: "move-canvas", label: tr("ctx.moveToCanvas"), icon: Layers, items: canvasItems([node]) }]
          : []),
        { id: "sep-del", separator: true },
        { id: "del", label: tr("ctx.deleteNode"), icon: Trash2, danger: true, onSelect: () => deleteNode(node.id) },
      ],
    });
  }, [rfEdges, nodeTitles, typeItems, canvasItems, canvases.length, settings, changeNodeType,
      openNodeById, addConnectedNode, deleteSelectedEdge, unlinkAll, duplicateNode, focusNode, deleteNode]);

  const openEdgeMenu = useCallback((e, edge) => {
    e.preventDefault();
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
          items: REL_TYPES.map((r) => ({
            id: `rel-${r.id || "none"}`,
            label: tr(r.labelKey),
            swatch: r.color,
            checked: (edge.data?.relType || "") === r.id,
            onSelect: () => quickSetRelType(edge, r.id),
          })),
        },
        { id: "swap", label: tr("ctx.swapDirection"), icon: ArrowLeftRight, onSelect: () => swapEdgeDirection(edge) },
        { id: "sep-edge", separator: true },
        { id: "goto-source", label: tr("ctx.goTo", { name: nodeTitles[edge.source] || tr("ctx.node") }), icon: Target, onSelect: () => openNodeById(edge.source) },
        { id: "goto-target", label: tr("ctx.goTo", { name: nodeTitles[edge.target] || tr("ctx.node") }), icon: Target, onSelect: () => openNodeById(edge.target) },
        { id: "sep-edge-del", separator: true },
        { id: "del-edge", label: tr("ctx.deleteEdge"), icon: Trash2, danger: true, onSelect: () => deleteSelectedEdge(edge.id) },
      ],
    });
  }, [nodeTitles, closeAll, quickSetRelType, swapEdgeDirection, openNodeById, deleteSelectedEdge]);

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
        { id: "sep-pane", separator: true },
        {
          id: "layout",
          label: tr("ctx.autoLayout"),
          icon: Wand2,
          items: LAYOUTS.map((l) => ({ id: `layout-${l.id}`, label: tr(l.labelKey), onSelect: () => runLayout(l.id) })),
        },
        { id: "fit", label: tr("editor.fitView"), icon: Maximize2, hint: "F", onSelect: () => rf.fitView({ padding: 0.2, duration: 400 }) },
        { id: "select-all", label: tr("ctx.selectAll"), icon: SquareDashedMousePointer, onSelect: selectAllVisible },
        { id: "sep-pane2", separator: true },
        { id: "palette", label: tr("ctx.commandPalette"), icon: Command, hint: "Ctrl K", onSelect: () => setShowPalette(true) },
        { id: "settings", label: tr("ctx.settings"), icon: Settings, onSelect: () => { closeAll(); setShowSettings(true); } },
      ],
    });
  }, [rf, typeItems, addNode, runLayout, selectAllVisible, closeAll, createNodeType]);

  const openSelectionMenu = useCallback((e, nodes) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      header: tr("ctx.selected", { count: tr("count.nodes", { count: nodes.length }) }),
      items: [
        { id: "chain", label: tr("ctx.chain"), icon: Waypoints, disabled: nodes.length < 2, onSelect: () => chainConnect(nodes) },
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
  }, [chainConnect, canvasItems, canvases.length, rf]);

  /* ---------------- command palette ---------------- */

  const commands = useMemo(() => [
    // Ids must stay unique — they become React keys in the palette list.
    ...(settings?.nodeTypes || []).slice(0, 9).map((t, i) => ({
      id: `new-${t.id}`,
      label: tr("palette.newNode", { type: t.label }),
      hint: t.id === "note" ? "N" : String(i + 1),
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

  const paletteNodes = useMemo(() => rfNodes.map((n) => ({
    id: n.id,
    title: n.data.title || tr("common.untitled"),
    subtitle: [typesById[n.data.typeId]?.label, ...(n.data.tags || []).map((t) => `#${t}`)]
      .filter(Boolean).join(" · "),
    color: n.data.nodeType?.color,
    iconName: n.data.nodeType?.icon,
    run: () => openNodeById(n.id),
  })), [rfNodes, typesById, openNodeById]);

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
        // Искать в свёрнутом списке бессмысленно — раскрываем его заодно.
        setSidebar((s) => ({ ...s, open: true, sections: { ...s.sections, list: true } }));
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
        duplicateNode(selectedNode || rfNodes.find((n) => n.selected)?.data);
        return;
      }
      if (mod) return;
      if (key === "g") { e.preventDefault(); setFocusMode((v) => !v); }
      else if (key === "n") { e.preventDefault(); addNode("note"); }
      else if (key === "f") { e.preventDefault(); rf.fitView({ padding: 0.2, duration: 400 }); }
      else if (key === "l") { e.preventDefault(); runLayout("layered"); }
      else if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); setShowShortcuts((v) => !v); }
      else if (/^[1-9]$/.test(key)) {
        const t = (settings?.nodeTypes || [])[Number(key) - 1];
        if (t) { e.preventDefault(); addNode(t.id); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNode, rfNodes, duplicateNode, addNode, runLayout, rf, settings, undo, closeAll, showPalette, showShortcuts]);

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

  // relative обязателен: правые панели — absolute right-0, и без него точкой
  // отсчёта им служит не эта коробка, а документ. Тогда overflow-hidden их не
  // обрезает (обрезка не действует на потомка, чей контейнер лежит выше), и на
  // время въезда панели документ становится шире окна — снизу вылезала
  // горизонтальная полоса, а страница могла уехать вбок.
  return (
    <div className="h-screen w-screen overflow-hidden relative flex sw-bg" onClick={() => setOpenMenu(null)}>
      {/* Left sidebar */}
      {sidebar.open && (
        <aside
          className="sw-sidebar sw-surface flex flex-col shrink-0 relative"
          style={{ width: sidebar.width }}
          data-testid="left-sidebar"
        >
          {/* Ни одной горизонтальной линии внутри: секции разделяет воздух и
              заголовок-метка. Линия — самый тяжёлый разделитель из возможных. */}
          <div className="px-5 pt-4 pb-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <button
                data-testid="back-btn"
                onClick={() => navigate("/")}
                className="flex items-center gap-1.5 sw-t-meta sw-text-dim hover:opacity-80 min-w-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{tr("common.projects")}</span>
                <ChevronRight className="w-3 h-3 opacity-50 shrink-0" />
              </button>
              <button
                data-testid="collapse-sidebar-btn"
                onClick={() => setSidebar((s) => ({ ...s, open: false }))}
                title={tr("editor.collapsePanel")}
                className="p-1.5 rounded-md sw-hover sw-text-dim shrink-0"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            <h1 className="font-serif-title text-2xl tracking-tight truncate" title={project.name}>{project.name}</h1>
            <p className="sw-t-num sw-text-dim mt-1">
              {tr("count.nodes", { count: rfNodes.length })} · {tr("count.edges", { count: rfEdges.length })}
            </p>
          </div>

          {/* Холсты — раньше висели плавающей менюшкой над канвасом */}
          <div className="flex items-center gap-1 px-4 pb-5 sw-no-scrollbar overflow-x-auto">
            <Layers className="w-3.5 h-3.5 sw-text-dim mx-1 shrink-0" />
            {canvases.map((c) => canvasTab(c, `canvas-tab-${c.id}`))}
            <button
              data-testid="add-canvas-btn"
              onClick={addCanvas}
              title={tr("editor.newCanvas")}
              className="px-1.5 py-1 rounded sw-text-dim sw-hover shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

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

          <div className="flex-1 sw-scroll-y px-1">
          {/* Palette */}
          <SidebarSection
            id="palette"
            title={tr("editor.addNode")}
            open={sidebar.sections.palette}
            onToggle={() => toggleSection("palette")}
          >
            <div className="grid grid-cols-2 gap-2">
              {settings.nodeTypes.map((t, i) => (
                <button
                  key={t.id}
                  data-testid={`add-node-${t.id}`}
                  draggable
                  onDragStart={(e) => onPaletteDragStart(e, t.id)}
                  onDragEnd={() => setDragType(null)}
                  onClick={() => addNode(t.id)}
                  title={tr("editor.dragTitle", { key: i < 9 ? tr("editor.dragKey", { key: i + 1 }) : "" })}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border sw-border-c text-xs sw-btn
                    cursor-grab active:cursor-grabbing hover:-translate-y-[1px]
                    ${dragType === t.id ? "opacity-50" : ""}`}
                >
                  <span className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: t.color }}>
                    <NodeIcon name={t.icon} className="w-3 h-3 text-white" />
                  </span>
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
              {/* Плитка «свой тип» стоит там же, где и остальные типы: путь к
                  собственному типу узла начинается оттуда, где его ищут. */}
              <button
                data-testid="add-node-type-btn"
                onClick={createNodeType}
                title={tr("editor.newTypeHint")}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-dashed
                  sw-border-c text-xs sw-btn sw-text-dim hover:-translate-y-[1px]"
              >
                <span className="w-5 h-5 rounded flex items-center justify-center shrink-0 border border-dashed sw-border-c">
                  <Plus className="w-3 h-3" />
                </span>
                <span className="truncate">{tr("editor.newType")}</span>
              </button>
            </div>
            <p className="mt-2 text-[11px] sw-text-dim">{tr("editor.dragHint")}</p>
          </SidebarSection>

          {/* Tags */}
          {allTags.length > 0 && (
            <SidebarSection
              id="tags"
              title={tr("editor.tags")}
              count={activeTags.size ? `${activeTags.size}/${allTags.length}` : allTags.length}
              open={sidebar.sections.tags}
              onToggle={() => toggleSection("tags")}
            >
              <div className="flex flex-wrap gap-1.5 items-center" data-testid="tag-filter-bar">
                <Tag className="w-3 h-3 sw-text-dim" />
                {allTags.map((t) => (
                  <button
                    key={t}
                    data-testid={`tag-filter-${t}`}
                    onClick={() => toggleTag(t)}
                    className="text-xs px-2 py-0.5 rounded-full border transition-colors"
                    style={{
                      borderColor: activeTags.has(t) ? "var(--sw-accent)" : "var(--sw-border)",
                      background: activeTags.has(t) ? "var(--sw-accent)" : "transparent",
                      color: activeTags.has(t) ? "#fff" : "var(--sw-text-dim)",
                    }}
                  >
                    #{t}
                  </button>
                ))}
                {activeTags.size > 0 && (
                  <button onClick={() => setActiveTags(new Set())} className="text-xs sw-text-dim underline underline-offset-2">
                    {tr("common.reset")}
                  </button>
                )}
              </div>
            </SidebarSection>
          )}

          {/* Node list */}
          <SidebarSection
            id="list"
            title={tr("editor.nodes")}
            count={filtered.length}
            open={sidebar.sections.list}
            onToggle={() => toggleSection("list")}
          >
            <div className="space-y-4">
              {filtered.length === 0 && (
                <p className="text-xs sw-text-dim py-4 text-center">
                  {q || activeTags.size ? (
                    <>
                      {tr("common.nothingFound")}
                      <span className="opacity-40"> · </span>
                      <button
                        onClick={() => { setSearch(""); setActiveTags(new Set()); }}
                        className="sw-accent-text"
                      >
                        {tr("editor.resetFilter")}
                      </button>
                    </>
                  ) : tr("editor.noNodes")}
                </p>
              )}
              {groupedList.map(({ type, nodes }) => (
                <div key={type.id}>
                  <p className="sw-section-label flex items-center gap-1.5 mb-1 px-1">
                    <span className="sw-typed sw-list-dot" style={{ "--node-color": type.color }} />
                    {type.label}
                    <span className="sw-t-num normal-case tracking-normal">{nodes.length}</span>
                  </p>
                  <div>
                    {/* В списке нужен только тон типа — форма иконки тут шум. */}
                    {nodes.map((n, i) => (
                      <button
                        key={n.id}
                        data-testid={`node-list-item-${n.id}`}
                        onClick={() => openNodeById(n.id)}
                        onContextMenu={(e) => openNodeMenu(e, n)}
                        className="sw-typed sw-list-item sw-slide-in"
                        data-active={selectedNode?.id === n.id}
                        style={{ "--node-color": type.color, animationDelay: `${Math.min(i * 18, 220)}ms` }}
                      >
                        <span className={`text-[13px] truncate flex-1 ${n.data.title ? "" : "sw-untitled"}`}>
                          {n.data.title || tr("common.untitled")}
                        </span>
                        {(degrees.get(n.id) || 0) > 0 && (
                          <span className="sw-t-num sw-text-dim">{degrees.get(n.id)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SidebarSection>
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
        className="flex-1 relative overflow-hidden"
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
          className={rfNodes.length >= ANIM_LIMIT ? "sw-no-node-anim" : ""}
          connectionRadius={28}
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDelete={onDelete}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => setLinkSource(null)}
          onInit={(inst) => setZoom(inst.getZoom())}
          onMove={(_, vp) => setZoom(vp.zoom)}
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
          deleteKeyCode={["Backspace", "Delete"]}
          multiSelectionKeyCode={["Shift"]}
          snapToGrid={!!settings.snapToGrid}
          snapGrid={[22, 22]}
          fitView
          minZoom={0.15}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          data-testid="react-flow-canvas"
        >
          {/* Две частоты сетки: крупная даёт масштабный ориентир при zoom-out,
              мелкая — точность при zoom-in. Одна сетка на всех масштабах либо
              сливается в шум, либо расползается. */}
          {settings.showGrid && (
            <>
              <Background
                id="coarse"
                variant={BackgroundVariant.Lines}
                gap={110}
                lineWidth={1}
                color="color-mix(in srgb, var(--sw-border) 22%, transparent)"
              />
              <Background
                id="fine"
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1.4}
                color="color-mix(in srgb, var(--sw-border) 55%, transparent)"
              />
            </>
          )}
          {settings.showMiniMap !== false && (
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => n.data?.nodeType?.color || "#64748b"}
              nodeBorderRadius={4}
              style={{ margin: 16 }}
              maskColor="color-mix(in srgb, var(--sw-bg) 62%, transparent)"
            />
          )}
        </ReactFlow>

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
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => rf.zoomIn({ duration: 160 })} title={tr("editor.zoomIn")}>
            <Plus className="w-3.5 h-3.5" />
          </button>
          <span className="sw-zoom-sep" />
          <button onClick={() => rf.fitView({ padding: 0.2, duration: 400 })} title={tr("editor.fitView")}>
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Top toolbar */}
        <div className="absolute top-4 left-4 right-4 flex items-start justify-between pointer-events-none gap-2">
          {/* Слева над холстом ничего не висит, пока панель открыта —
              переключатель холстов живёт в ней. Свернули — вернулись сюда. */}
          <div className="flex items-center gap-2 min-w-0">
            {!sidebar.open && (
              <>
                <button
                  data-testid="toggle-sidebar-btn"
                  onClick={() => setSidebar((s) => ({ ...s, open: true }))}
                  title={tr("editor.showPanel")}
                  className="pointer-events-auto p-2 rounded-lg sw-glass sw-btn shrink-0 animate-pop"
                >
                  <PanelLeft className="w-4 h-4" />
                </button>
                <div className="pointer-events-auto flex items-center gap-1 p-1 rounded-lg sw-glass overflow-x-auto max-w-[45vw] animate-pop">
                  <Layers className="w-3.5 h-3.5 sw-text-dim ml-1 shrink-0" />
                  {canvases.map((c) => canvasTab(c, `canvas-tab-float-${c.id}`))}
                  <button onClick={addCanvas} title={tr("editor.newCanvas")} className="px-1.5 py-1 rounded sw-text-dim sw-hover shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Тулбар — две сегментированные группы вместо шести отдельных пилюль:
              слева навигация и вид, справа вывод и настройки. Шесть возвышенных
              поверхностей в ряд читаются как шесть несвязанных объектов. */}
          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="pointer-events-auto sw-glass sw-toolgroup">
              <button
                data-testid="open-palette-btn"
                onClick={() => setShowPalette(true)}
                title={tr("editor.palette")}
                className="sw-toolbtn"
              >
                <Command className="w-4 h-4" /> <kbd className="hidden lg:inline">Ctrl K</kbd>
              </button>
              <span className="sw-tooldiv" />

              {/* Layout menu */}
              <div className="relative">
                <button
                  data-testid="layout-btn"
                  onClick={() => setOpenMenu(openMenu === "layout" ? null : "layout")}
                  title={tr("editor.layoutTitle")}
                  className="sw-toolbtn"
                  data-active={openMenu === "layout"}
                >
                  <Wand2 className="w-4 h-4" /> <span className="hidden lg:inline">{tr("editor.layout")}</span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
                {openMenu === "layout" && (
                  <div className="absolute right-0 mt-2 w-44 rounded-lg sw-glass py-1 animate-pop z-30">
                    {LAYOUTS.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => { setOpenMenu(null); runLayout(l.id); }}
                        className="w-full text-left px-3 py-1.5 text-sm sw-hover"
                      >
                        {tr(l.labelKey)}
                      </button>
                    ))}
                    <div className="my-1 border-t sw-border-c" />
                    <button
                      onClick={() => { setOpenMenu(null); rf.fitView({ padding: 0.2, duration: 400 }); }}
                      className="w-full text-left px-3 py-1.5 text-sm sw-hover flex items-center gap-2"
                    >
                      <Maximize2 className="w-3.5 h-3.5" /> {tr("editor.fitView")}
                    </button>
                  </div>
                )}
              </div>

              <button
                data-testid="open-timeline-btn"
                onClick={() => { closeAll(); setShowTimeline(true); }}
                className="sw-toolbtn"
              >
                <CalendarRange className="w-4 h-4" /> <span className="hidden lg:inline">{tr("editor.timeline")}</span>
              </button>
              <button
                data-testid="focus-mode-btn"
                onClick={() => setFocusMode((v) => !v)}
                title={tr("editor.focusModeHint")}
                className="sw-toolbtn"
                data-active={focusMode}
              >
                <Crosshair className="w-4 h-4" />
              </button>
            </div>

            <div className="pointer-events-auto sw-glass sw-toolgroup">
              {/* Export menu — единственная заливка в тулбаре: это то, что
                  выносит работу наружу. */}
              <div className="relative">
                <button
                  data-testid="export-btn"
                  onClick={() => setOpenMenu(openMenu === "export" ? null : "export")}
                  className="sw-toolbtn sw-toolbtn-primary"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden lg:inline">{tr("editor.export")}</span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
                {openMenu === "export" && (
                  <div className="absolute right-0 mt-2 w-52 rounded-lg sw-glass py-1 animate-pop z-30">
                    <button onClick={() => { setOpenMenu(null); exportAs("json"); }} className="w-full text-left px-3 py-1.5 text-sm sw-hover flex items-center gap-2">
                      <FileJson className="w-3.5 h-3.5" /> {tr("editor.exportJson")}
                    </button>
                    <button onClick={() => { setOpenMenu(null); exportAs("md"); }} className="w-full text-left px-3 py-1.5 text-sm sw-hover flex items-center gap-2">
                      <FileTextIcon className="w-3.5 h-3.5" /> {tr("editor.exportMd")}
                    </button>
                  </div>
                )}
              </div>
              <span className="sw-tooldiv" />
              <button
                data-testid="open-settings-btn"
                onClick={() => { closeAll(); setShowSettings(true); }}
                className="sw-toolbtn"
                title={tr("editor.settings")}
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                data-testid="open-shortcuts-btn"
                onClick={() => setShowShortcuts(true)}
                className="sw-toolbtn"
                title={tr("editor.shortcuts")}
              >
                <Keyboard className="w-4 h-4" />
              </button>
            </div>
          </div>
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
              <p className="font-serif-title text-2xl tracking-tight mb-1">{tr("editor.emptyCanvas")}</p>
              <p className="sw-text-dim text-sm">{tr("editor.emptyCanvasHint", { key: "N" })}</p>
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
              </div>
              <p className="mt-5 sw-t-meta sw-text-dim flex items-center justify-center gap-2 flex-wrap">
                <span>{tr("editor.emptyKeysNode")}</span><span className="opacity-40">·</span>
                <kbd>Ctrl K</kbd><span>{tr("editor.emptyKeysPalette")}</span><span className="opacity-40">·</span>
                <kbd>Space</kbd><span>{tr("editor.emptyKeysPan")}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right panels — panels slide in on open; they unmount immediately on
          close (framer's AnimatePresence keeps stale panels alive under React 19). */}
      <>
        {/* Без key: панель остаётся смонтированной между узлами. С ним каждое
            переключение проигрывало въезд справа заново — отсюда и рывки. */}
        {selectedNode && !showSettings && (
          <NodeEditorPanel
            node={selectedNode}
            nodeTypes={settings.nodeTypes}
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
            onClose={() => setSelectedNode(null)}
            onSave={saveNode}
            onDelete={deleteNode}
            onDuplicate={duplicateNode}
          />
        )}
        {selectedEdge && (
          <EdgeEditorPanel
            key={selectedEdge.id}
            edge={selectedEdge}
            nodeTitles={nodeTitles}
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
            highlightType={highlightType}
            onHighlighted={() => setHighlightType(null)}
            onChange={persistSettings}
            onClose={() => { setShowSettings(false); setHighlightType(null); }}
          />
        )}
        {showTimeline && (
          <TimelinePanel
            key="timeline"
            chrono={chrono}
            settings={settings}
            edges={rfEdges}
            typesById={typesById}
            onOpenNode={(nodeId) => { setShowTimeline(false); openNodeById(nodeId); }}
            onOpenSettings={() => { setShowTimeline(false); setShowSettings(true); }}
            onClose={() => setShowTimeline(false)}
          />
        )}
      </>

      {/* Overlays */}
      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        commands={commands}
        nodes={paletteNodes}
      />
      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
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
