// Меню правого клика на холсте: узел, связь, пустое место, выделение.
//
// Вынесены из редактора как есть: это триста строк сборки пунктов, которым
// нужны действия редактора, но не его разметка. Каждое меню — useCallback с
// теми же зависимостями, что и раньше, так что ни одно не пересобирается
// чаще, чем до переноса.
import { useCallback, useRef } from "react";
import {
  Plus, Shapes, Crosshair, Unlink, Scissors, LayoutGrid, MoveHorizontal, Copy, Target, Layers,
  Trash2, Pencil, Eye, Maximize2, Minimize2, BookmarkPlus, Wand2, Map as MapIcon,
  SquareDashedMousePointer, ClipboardPaste, Undo2, ArrowLeftRight, Spline, Waypoints, Anchor, Minus,
} from "lucide-react";
import { DEFAULT_EDGE_COLOR, EDGE_SHAPES } from "@/lib/settings";
import { LAYOUTS } from "@/lib/layout";
import { NODE_H, NODE_W } from "@/pages/editor/model";

export function useCanvasMenus(ctx) {
  const {
    addCanvas, addConnectedNode, addEdgePoint, addNode, canvases, chainConnect, changeNodeType,
    changeSettings, clipboardRef, closeAll, copyNodes, createNodeType, deleteNode,
    deleteSelectedEdge, duplicateNode, expandedId, focusNode, mainCanvasId, mobile,
    moveNodesToCanvas, nodeTitles, openNodeById, pasteNodes, peekNode, quickSetRelType,
    relTypes, resizeNode, rf, rfEdges, runLayout, saveAsTemplate, selectAllVisible,
    setEdgeShape, setExpandedId, setLinkSource, setMenu, setNodeCardMode, setSelectedEdge,
    settings, straightenEdge, swapEdgeDirection, templateItems, tr, undo, undoRef, unlinkAll,
  } = ctx;

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

  /**
   * Телефон: в меню — только то, что там правда нужно. С компьютера пришли
   * пункты вроде «Вернуть ширину» и «Развернуть карточку» — на телефоне они
   * ничего не значат и только удлиняли список до четырнадцати строк.
   */
  const forPhone = useCallback((items, keep) => {
    if (!mobile) return items;
    const out = [];
    for (const it of items) {
      if (it.separator) {
        if (out.length && !out[out.length - 1].separator) out.push(it);
      } else if (keep.includes(it.id)) out.push(it);
    }
    while (out.length && out[out.length - 1].separator) out.pop();
    return out;
  }, [mobile]);

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
      items: forPhone([
        { id: "open", label: tr(mobile ? "mobile.open" : "ctx.openInEditor"), icon: Pencil, onSelect: () => openNodeById(node.id) },
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
        { id: "save-tpl", label: tr("templates.saveAs"), icon: BookmarkPlus, onSelect: () => saveAsTemplate(node.data) },
        { id: "focus", label: tr("ctx.center"), icon: Target, onSelect: () => focusNode(node.id) },
        ...(canvases.length > 1
          ? [{ id: "move-canvas", label: tr("ctx.moveToCanvas"), icon: Layers, items: canvasItems([node]) }]
          : []),
        { id: "sep-del", separator: true },
        { id: "del", label: tr("ctx.deleteNode"), icon: Trash2, danger: true, onSelect: () => deleteNode(node.id) },
      ], ["open", "node-type", "link-new", "dup", "save-tpl", "move-canvas", "del"]),
    });
  }, [rfEdges, nodeTitles, typeItems, canvasItems, cardModeItems, canvases.length, settings, changeNodeType,
      openNodeById, addConnectedNode, deleteSelectedEdge, unlinkAll, duplicateNode, focusNode, deleteNode,
      resizeNode, peekNode, forPhone, saveAsTemplate]);

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
      items: forPhone([
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
      ], ["rel-type", "swap", "goto-source", "goto-target", "del-edge"]),
    });
  }, [nodeTitles, closeAll, quickSetRelType, swapEdgeDirection, openNodeById, deleteSelectedEdge,
      rf, settings, relTypes, addEdgePoint, straightenEdge, setEdgeShape, forPhone]);

  const openPaneMenu = useCallback((e) => {
    e.preventDefault();
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const position = { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 };
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: forPhone([
        {
          id: "new-here",
          label: tr("ctx.createHere"),
          icon: Plus,
          items: [
            ...typeItems((t) => addNode(t, position), "new"),
            ...templateItems(position, "new"),
            { id: "sep-new-type", separator: true },
            { id: "make-type", label: tr("ctx.newType"), icon: Shapes, onSelect: createNodeType },
          ],
        },
        // Недоступное не показываем серым, а не показываем вовсе: два
        // погашенных пункта в каждом меню учили их не читать.
        ...(clipboardRef.current?.nodes?.length ? [{
          id: "paste",
          label: tr("ctx.paste"),
          icon: ClipboardPaste,
          hint: "Ctrl V",
          onSelect: pasteNodes,
        }] : []),
        ...(undoRef.current.length ? [{
          id: "undo", label: tr("palette.undo"), icon: Undo2, hint: "Ctrl Z", onSelect: undo,
        }] : []),
        { id: "sep-pane", separator: true },
        {
          id: "layout",
          label: tr("ctx.autoLayout"),
          icon: Wand2,
          items: LAYOUTS.map((l) => ({ id: `layout-${l.id}`, label: tr(l.labelKey), onSelect: () => runLayout(l.id) })),
        },
        { id: "fit", label: tr("editor.fitView"), icon: Maximize2, hint: "F", onSelect: () => rf.fitView({ padding: 0.2, duration: 400 }) },
        // Мини-карты на телефоне нет — нечего и переключать.
        ...(mobile ? [] : [{
          id: "minimap",
          label: tr("settings.showMiniMap"),
          icon: MapIcon,
          checked: settings.showMiniMap !== false,
          onSelect: () => changeSettings({ ...settings, showMiniMap: settings.showMiniMap === false }),
        }]),
        { id: "select-all", label: tr("ctx.selectAll"), icon: SquareDashedMousePointer, onSelect: selectAllVisible },
        // Новый холст, таймлайн, палитра и настройки стоят в верхней панели
        // на виду — в меню холста они только удлиняли список вдвое.
      ], ["new-here", "paste", "layout", "fit"]),
    });
  }, [rf, typeItems, addNode, runLayout, selectAllVisible, closeAll, createNodeType,
      pasteNodes, undo, addCanvas, settings, changeSettings, mobile, forPhone, templateItems]);

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

  return {
    typeItems, canvasItems, cardModeItems, forPhone, expandedRef,
    openNodeMenu, openNodeMenuById, openEdgeMenu, openPaneMenu, openSelectionMenu,
  };
}
