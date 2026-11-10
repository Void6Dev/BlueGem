import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, CalendarRange, Check, ChevronDown, Layers, ListTree, MoreHorizontal, Pencil,
  Plus, Search, Settings, Share2, Shapes, Undo2, X,
} from "lucide-react";
import Sheet, { useSheet } from "@/components/mobile/Sheet";
import { NodeIcon } from "@/components/NodeIcon";
import { haptic } from "@/lib/platform";
import { useT } from "@/lib/i18n";

/**
 * Редактор на телефоне: рама вокруг холста.
 *
 * Сверху — где я: назад, имя мира и страница (касание — список страниц),
 * поиск и настройки. Снизу, под большим пальцем, — что делаю: мир списком,
 * хронология, большой «+», отмена и всё остальное. Холст между ними целиком
 * отдан жестам: один палец двигает, два — масштабируют, касание — смотрит,
 * долгое нажатие — меню.
 */

export function MobileTopBar({
  projectName, canvasLabel, onBack, onCanvases, onSearch, onSettings,
}) {
  const t = useT();
  return (
    <header className="sw-mtop" data-testid="mobile-topbar">
      <button type="button" className="sw-icon-btn" onClick={onBack} data-testid="back-btn" aria-label={t("common.projects")}>
        <ArrowLeft className="w-[22px] h-[22px]" />
      </button>
      <button type="button" className="sw-mtop-title" onClick={onCanvases} data-testid="mobile-canvas-btn">
        <span className="sw-mtop-name">{projectName}</span>
        <span className="sw-mtop-canvas">
          <i />
          <span>{canvasLabel}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
        </span>
      </button>
      <button type="button" className="sw-icon-btn" onClick={onSearch} data-testid="open-palette-btn" aria-label={t("editor.findOrDo")}>
        <Search className="w-[21px] h-[21px]" />
      </button>
      <button type="button" className="sw-icon-btn" onClick={onSettings} data-testid="open-settings-btn" aria-label={t("editor.settings")}>
        <Settings className="w-[21px] h-[21px]" />
      </button>
    </header>
  );
}

export function MobileDock({
  hidden, view, onWorld, onTimeline, onCreate, onUndo, canUndo, onMore, nodeCount,
}) {
  const t = useT();
  const tap = (fn, kind = "tick") => () => { haptic(kind); fn(); };
  return (
    <nav className={`sw-mdock sw-glass ${hidden ? "is-hidden" : ""}`} data-testid="mobile-dock">
      <button type="button" className="sw-mdock-btn" onClick={tap(onWorld)} data-testid="dock-world">
        <ListTree />
        <span>{t("mobile.world")}</span>
        {nodeCount > 0 && <span className="sw-mdock-badge">{nodeCount > 99 ? "99+" : nodeCount}</span>}
      </button>
      <button
        type="button"
        className="sw-mdock-btn"
        data-active={view === "timeline"}
        onClick={tap(onTimeline)}
        data-testid="dock-timeline"
      >
        {view === "timeline" ? <Share2 /> : <CalendarRange />}
        <span>{view === "timeline" ? t("editor.viewCanvas") : t("mobile.time")}</span>
      </button>
      <button type="button" className="sw-mdock-add" onClick={tap(onCreate, "medium")} data-testid="dock-create" aria-label={t("editor.create")}>
        <Plus />
      </button>
      <button type="button" className="sw-mdock-btn" onClick={tap(onUndo)} disabled={!canUndo} data-testid="dock-undo">
        <Undo2 />
        <span>{t("mobile.undo")}</span>
      </button>
      <button type="button" className="sw-mdock-btn" onClick={tap(onMore)} data-testid="dock-more">
        <MoreHorizontal />
        <span>{t("mobile.more")}</span>
      </button>
    </nav>
  );
}

/** Плитка типа: узел создаётся одним касанием и сразу открывается на имени. */
function TypeTile({ type, onPick }) {
  const { close } = useSheet();
  return (
    <button
      type="button"
      className="sw-create-tile"
      style={{ "--node-color": type.color }}
      data-testid={`create-tile-${type.id}`}
      onClick={() => { onPick(type.id); close(); }}
    >
      <span className="sw-create-tile-icon"><NodeIcon name={type.icon} /></span>
      <span className="line-clamp-2">{type.label}</span>
    </button>
  );
}

export function CreateSheet({ types, onCreate, onCreateType, onAddCanvas, onClose }) {
  const t = useT();
  return (
    <Sheet onClose={onClose} testId="create-sheet" label={t("editor.create")}>
      <div className="sw-sheet-head">
        <span className="sw-sheet-title">{t("mobile.createTitle")}</span>
      </div>
      <div className="sw-sheet-body">
        <div className="sw-create-grid">
          {types.map((type) => <TypeTile key={type.id} type={type} onPick={onCreate} />)}
          <NewTypeTile onPick={onCreateType} />
        </div>
        <CreateRow onAddCanvas={onAddCanvas} />
      </div>
    </Sheet>
  );
}

function NewTypeTile({ onPick }) {
  const t = useT();
  const { close } = useSheet();
  return (
    <button
      type="button"
      className="sw-create-tile is-dashed"
      data-testid="create-tile-new-type"
      onClick={() => { close(); onPick(); }}
    >
      <span className="sw-create-tile-icon"><Shapes /></span>
      <span>{t("ctx.newType")}</span>
    </button>
  );
}

function CreateRow({ onAddCanvas }) {
  const t = useT();
  const { close } = useSheet();
  return (
    <div className="sw-create-row">
      <button type="button" onClick={() => { close(); onAddCanvas(); }} data-testid="create-canvas">
        <Layers className="w-[18px] h-[18px]" /> {t("editor.newCanvas")}
      </button>
    </div>
  );
}

/** Страницы мира: переключить, переименовать, завести новую. */
export function CanvasSheet({
  canvases, active, usage, renaming, onPick, onRename, onAdd, onClose,
}) {
  const t = useT();
  const [editing, setEditing] = useState(renaming || null);
  const inputRef = useRef(null);
  // Новую страницу заводят сразу с рабочим именем — и тут же дают его сменить.
  useEffect(() => { if (renaming) setEditing(renaming); }, [renaming?.id]); // eslint-disable-line
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing?.id]); // eslint-disable-line

  const commit = () => {
    if (editing) onRename(editing.id, editing.label);
    setEditing(null);
  };

  return (
    <Sheet onClose={onClose} testId="canvas-sheet" label={t("mobile.pages")}>
      <div className="sw-sheet-head">
        <span className="sw-sheet-title">{t("mobile.pages")}</span>
        <AddCanvasButton onAdd={onAdd} />
      </div>
      <div className="sw-sheet-body">
        <div className="sw-mlist">
          {canvases.map((c) => (editing?.id === c.id ? (
            <div key={c.id} className="sw-mrow" data-active="true">
              <input
                ref={inputRef}
                value={editing.label}
                onChange={(e) => setEditing({ id: c.id, label: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
                onBlur={commit}
                data-testid={`canvas-rename-${c.id}`}
              />
              <button type="button" className="sw-icon-btn" onPointerDown={(e) => e.preventDefault()} onClick={commit}>
                <Check className="w-5 h-5 sw-accent-text" />
              </button>
            </div>
          ) : (
            <CanvasRow
              key={c.id}
              canvas={c}
              active={c.id === active}
              count={usage[c.id] || 0}
              onPick={onPick}
              onEdit={() => setEditing({ id: c.id, label: c.label })}
            />
          )))}
        </div>
      </div>
    </Sheet>
  );
}

function AddCanvasButton({ onAdd }) {
  const t = useT();
  return (
    <button
      type="button"
      className="sw-icon-btn is-filled"
      onClick={() => { haptic("medium"); onAdd(); }}
      aria-label={t("editor.newCanvas")}
      data-testid="canvas-sheet-add"
    >
      <Plus className="w-5 h-5" />
    </button>
  );
}

function CanvasRow({ canvas, active, count, onPick, onEdit }) {
  const { close } = useSheet();
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="sw-mrow flex-1"
        data-active={active}
        data-testid={`canvas-row-${canvas.id}`}
        onClick={() => { haptic("tick"); onPick(canvas.id); close(); }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: active ? "var(--sw-accent)" : "var(--sw-border-strong)" }}
        />
        <span className="flex-1 truncate">{canvas.label}</span>
        {count > 0 && <span className="sw-mrow-meta">{count}</span>}
      </button>
      <button type="button" className="sw-icon-btn" onClick={onEdit} aria-label="rename" data-testid={`canvas-edit-${canvas.id}`}>
        <Pencil className="w-4 h-4" />
      </button>
    </div>
  );
}

/** Мир списком: поиск, теги, группы по типам — то, что на компьютере слева. */
export function WorldSheet({ search, onSearch, hits, children, onClose }) {
  const t = useT();
  return (
    <Sheet onClose={onClose} detent="full" testId="world-sheet" className="sw-world-sheet" label={t("mobile.world")}>
      <div className="sw-sheet-head">
        <span className="sw-sheet-title">{t("mobile.worldTitle")}</span>
      </div>
      <div className="sw-msearch">
        <Search className="sw-msearch-icon" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("editor.searchNodes")}
          enterKeyHint="search"
          data-testid="node-search"
        />
        {search ? (
          <button type="button" className="sw-icon-btn sw-msearch-clear" onClick={() => onSearch("")} aria-label="clear">
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>
      {search ? <p className="px-5 pb-2 text-xs sw-text-dim">{hits}</p> : null}
      <div className="sw-sheet-body pb-4">{children}</div>
    </Sheet>
  );
}
