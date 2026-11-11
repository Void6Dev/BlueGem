import {
  ArrowLeft, CalendarRange, ChevronDown, MoreHorizontal, PanelLeft, PanelLeftClose,
  Plus, Search, Settings, Share2,
} from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n";

/**
 * Верхняя панель редактора — одна, закреплённая, на всю ширину окна.
 *
 * Раньше её работу делили четыре места: шапка боковой панели (проект, холсты),
 * плавающий тулбар над холстом из иконок без подписей, плавающий же ряд
 * холстов, появлявшийся только при свёрнутой панели, и кнопка таймлайна,
 * открывавшая его окном поверх всего. Где искать нужное, зависело от того,
 * что сейчас открыто. Теперь у каждой вещи одно место:
 *
 *   слева  — где я: «Проект / Холст ▾» — путь, а не ряд вкладок;
 *   центр  — как смотрю: холст или таймлайн;
 *   справа — что делаю: найти или выполнить команду, создать, настроить.
 *
 * Холсты — одна кнопка-переключатель со списком, а не полоса вкладок: на
 * проекте из девяти страниц полоса обрывалась на третьей, и где остальные,
 * было не видно. Вид карточек переехал в «⋯»: его меняют редко, а две иконки
 * без подписей в центре панели читались как ещё один непонятный переключатель.
 *
 * Выпадающие списки («Создать», «⋯») — то же меню, что по правому клику:
 * у него уже есть подменю, галочки и клавиатура, второе такое незачем.
 */
export default function EditorTopBar({
  projectName, sidebarOpen, onToggleSidebar, onBack,
  canvasLabel, canvasCount, canvasRename, onOpenCanvases, onRenameCanvas,
  view, onView,
  onOpenPalette, onOpenCreate, onOpenSettings, onOpenMore,
}) {
  const tr = useT();
  // Меню открывается под кнопкой, выровненным по её левому краю.
  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 6 };
  };

  return (
    <header className="sw-topbar sw-topbar-in" data-testid="editor-topbar">
      <div className="sw-topbar-left">
        <button
          type="button"
          data-testid={sidebarOpen ? "collapse-sidebar-btn" : "toggle-sidebar-btn"}
          onClick={onToggleSidebar}
          title={tr(sidebarOpen ? "editor.collapsePanel" : "editor.showPanel")}
          className="sw-topbar-icon"
        >
          {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
        </button>
        <button
          type="button"
          data-testid="back-btn"
          onClick={onBack}
          title={tr("common.projects")}
          className="sw-topbar-icon"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="sw-topbar-project" title={projectName}>{projectName}</h1>
        <span className="sw-topbar-crumb" aria-hidden="true">/</span>
        {/* Пока холст переименовывают, на месте кнопки стоит поле. */}
        {canvasRename || (
          <button
            type="button"
            data-testid="canvas-switcher"
            onClick={(e) => onOpenCanvases(at(e))}
            onDoubleClick={onRenameCanvas}
            title={tr("editor.canvasSwitchHint")}
            className="sw-canvas-switch"
          >
            <span className="sw-canvas-switch-dot" />
            <span className="truncate">{canvasLabel}</span>
            {canvasCount ? <span className="sw-canvas-switch-count">{canvasCount}</span> : null}
            <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
          </button>
        )}
      </div>

      <div className="sw-topbar-center">
        <Segmented
          testIdPrefix="view"
          value={view}
          onChange={onView}
          options={[
            { id: "canvas", label: tr("editor.viewCanvas"), icon: Share2 },
            { id: "timeline", label: tr("editor.timeline"), icon: CalendarRange },
          ]}
        />
      </div>

      <div className="sw-topbar-right">
        <button
          type="button"
          data-testid="open-palette-btn"
          onClick={onOpenPalette}
          className="sw-topbar-search"
          title={tr("editor.palette")}
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{tr("editor.findOrDo")}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          type="button"
          data-testid="create-btn"
          onClick={(e) => onOpenCreate(at(e))}
          className="sw-topbar-create"
        >
          <Plus className="w-4 h-4" />
          <span>{tr("editor.create")}</span>
          <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
        <button
          type="button"
          data-testid="open-settings-btn"
          onClick={onOpenSettings}
          title={tr("editor.settings")}
          className="sw-topbar-icon"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          type="button"
          data-testid="more-btn"
          onClick={(e) => onOpenMore(at(e))}
          title={tr("editor.more")}
          className="sw-topbar-icon"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
