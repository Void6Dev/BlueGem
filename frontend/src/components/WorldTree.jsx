import { memo, useState } from "react";
import { ChevronRight, Plus, Shapes } from "lucide-react";
import { NodeIcon } from "@/components/NodeIcon";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n";

// Сколько тегов видно, пока фильтр не развёрнут. Больше — это уже стена
// из пилюль, за которой не видно самого дерева.
const TAGS_SHOWN = 8;

/**
 * Структура мира — левая панель.
 *
 * Раньше панель была набором несвязанных секций: палитра типов для создания,
 * облако тегов, список узлов. Тип узла в ней встречался дважды — плиткой в
 * палитре и заголовком в списке, — и это были два разных элемента с разным
 * поведением. Теперь тип — одна группа дерева: её заголовок показывает,
 * сколько таких узлов, «+» создаёт новый, заголовок можно утащить на холст,
 * а правый клик даёт всё, что с типом можно сделать.
 *
 * Пустые типы тоже видны: именно из них чаще всего и создают.
 */

const TreeRow = memo(function TreeRow({
  id, title, color, degree, active, away, onOpen, onContextMenu, untitled,
}) {
  return (
    <button
      type="button"
      data-testid={`node-list-item-${id}`}
      onClick={() => onOpen(id)}
      onContextMenu={(e) => onContextMenu(e, id)}
      className="sw-typed sw-list-item sw-tree-row"
      data-active={active}
      style={{ "--node-color": color }}
    >
      <span className={`text-[13px] truncate flex-1 ${title ? "" : "sw-untitled"}`}>
        {title || untitled}
      </span>
      {/* Узел с другого холста — в режиме «весь мир»: подпись страницы
          тише имени, но видна, иначе клик по нему неожиданно меняет холст. */}
      {away && <span className="sw-tree-away truncate">{away}</span>}
      {degree > 0 && <span className="sw-t-num sw-text-dim">{degree}</span>}
    </button>
  );
});

const TreeGroup = memo(function TreeGroup({
  type, nodes, open, dragging, degrees, activeId, awayOf,
  onToggle, onCreate, onDragStart, onDragEnd, onGroupMenu, onOpen, onContextMenu, untitled,
}) {
  const tr = useT();
  const empty = nodes.length === 0;
  return (
    <div className="sw-tree-group" data-testid={`tree-group-${type.id}`}>
      <div
        className={`sw-tree-head sw-typed ${empty ? "is-empty" : ""} ${dragging ? "is-dragging" : ""}`}
        style={{ "--node-color": type.color }}
        // Заголовок группы — то, что раньше было плиткой палитры: его тянут
        // на холст, и там появляется узел этого типа.
        draggable
        onDragStart={(e) => onDragStart(e, type.id)}
        onDragEnd={onDragEnd}
        onContextMenu={(e) => onGroupMenu(e, type)}
        title={tr("editor.dragTitle", { key: "" })}
      >
        <button
          type="button"
          data-testid={`tree-toggle-${type.id}`}
          onClick={() => onToggle(type.id)}
          className="sw-tree-toggle"
          aria-expanded={open}
        >
          <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-90" : ""} ${empty ? "opacity-0" : ""}`} />
          <span className="sw-tree-icon"><NodeIcon name={type.icon} className="w-2.5 h-2.5 text-white" /></span>
          <span className="truncate">{type.label}</span>
          <span className="sw-t-num sw-text-dim">{nodes.length}</span>
        </button>
        <button
          type="button"
          data-testid={`tree-add-${type.id}`}
          onClick={() => onCreate(type.id)}
          title={tr("editor.createOfType", { type: type.label })}
          className="sw-tree-add"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && !empty && (
        <div className="sw-tree-items">
          {nodes.map((n) => (
            <TreeRow
              key={n.id}
              id={n.id}
              title={n.title}
              color={type.color}
              degree={degrees.get(n.id) || 0}
              active={activeId === n.id}
              away={awayOf(n)}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              untitled={untitled}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default memo(function WorldTree({
  groups, filtering, degrees, activeId, collapsed, dragType, awayOf,
  scope, onScope, allTags, activeTags, onToggleTag, onResetTags,
  onToggleGroup, onCreate, onCreateType, onDragStart, onDragEnd, onGroupMenu,
  onOpen, onContextMenu,
}) {
  const tr = useT();
  const [allTagsOpen, setAllTagsOpen] = useState(false);
  const shownTags = allTagsOpen ? allTags : allTags.slice(0, TAGS_SHOWN);
  // Пока ищут или фильтруют, пустые группы — шум: показываем только те, где
  // что-то нашлось, и все они раскрыты, иначе найденное пряталось бы в
  // свёрнутой группе.
  const visible = filtering ? groups.filter((g) => g.nodes.length) : groups;

  return (
    <div className="sw-tree" data-testid="section-list">
      <div className="px-4 pb-3 flex items-center gap-2">
        <Segmented
          testIdPrefix="tree-scope"
          value={scope}
          onChange={onScope}
          className="flex-1"
          options={[
            { id: "canvas", label: tr("editor.scopeCanvas") },
            { id: "all", label: tr("editor.scopeAll") },
          ]}
        />
      </div>

      {allTags.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1 items-center" data-testid="tag-filter-bar">
          {shownTags.map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`tag-filter-${t}`}
              onClick={() => onToggleTag(t)}
              className="sw-tag-chip"
              data-on={activeTags.has(t)}
            >
              #{t}
            </button>
          ))}
          {allTags.length > TAGS_SHOWN && (
            <button type="button" onClick={() => setAllTagsOpen((v) => !v)} className="sw-tag-chip sw-text-dim">
              {allTagsOpen ? tr("editor.lessTags") : `+${allTags.length - TAGS_SHOWN}`}
            </button>
          )}
          {activeTags.size > 0 && (
            <button type="button" onClick={onResetTags} className="text-xs sw-accent-text ml-1">
              {tr("common.reset")}
            </button>
          )}
        </div>
      )}

      <div className="px-2">
        {filtering && visible.length === 0 && (
          <p className="text-xs sw-text-dim py-4 text-center">{tr("common.nothingFound")}</p>
        )}
        {visible.map(({ type, nodes }) => (
          <TreeGroup
            key={type.id}
            type={type}
            nodes={nodes}
            open={filtering || !collapsed[type.id]}
            dragging={dragType === type.id}
            degrees={degrees}
            activeId={activeId}
            awayOf={awayOf}
            onToggle={onToggleGroup}
            onCreate={onCreate}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onGroupMenu={onGroupMenu}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
            untitled={tr("common.untitled")}
          />
        ))}
        {!filtering && (
          <button type="button" data-testid="add-node-type-btn" onClick={onCreateType} className="sw-tree-newtype">
            <Shapes className="w-3.5 h-3.5" /> {tr("ctx.newType")}
          </button>
        )}
      </div>
    </div>
  );
});
