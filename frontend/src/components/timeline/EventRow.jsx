import { memo } from "react";
import { AlertTriangle, GripVertical, Plus } from "lucide-react";
import { NodeIcon } from "@/components/NodeIcon";
import { laneX } from "./TimelineRail";

// Ряд события в вертикальной хронологии.
//
// Порядок читается сверху вниз, поэтому номер и дата стоят по краям, а
// название занимает всё, что между ними: длинные названия здесь помещаются
// целиком — ради этого шкала и переехала с горизонтали.
//
// Длительность потерялась бы при переходе с горизонтали, где её показывала
// сама длина полосы. Поэтому здесь она колонкой: полоска, нормированная на
// самое долгое событие в отборе, плюс те же слова рядом. Сравнение «война
// семь лет, перемирие три месяца» так же читается с одного взгляда, только
// по одной колонке, а не по всей ширине экрана.

const KIND_MARK = {
  approx: "≈",
  before: "<",
  after: ">",
  between: "~",
  unknown: "?",
};

function EventRowInner({
  item, order, dateText, spanText, spanRatio, y, height, lane,
  selected, focused, dimmed, highlighted, onPick, onHover,
  conflicts, ages, future, movable, dragging, onGripDown, onAdd, conflictText,
}) {
  const color = item.node?.nodeType?.color || "#64748b";
  const mark = KIND_MARK[item.start?.kind];

  const cls = [
    "tl-row",
    selected ? "tl-row-on" : "",
    focused ? "tl-row-focus" : "",
    highlighted ? "tl-row-lit" : "",
    future ? "tl-row-future" : "",
    dragging ? "tl-row-drag" : "",
  ].filter(Boolean).join(" ");

  // Ряд — не <button>: внутри него свои кнопки («+», ручка переноса), а
  // кнопка в кнопке — недопустимая разметка, которую браузеры чинят как попало.
  return (
    <div
      role="button"
      tabIndex={-1}
      className={cls}
      data-testid={`timeline-row-${item.nodeId}`}
      data-tl-key={item.key}
      style={{ top: y, height, "--tl-tone": color, opacity: dimmed ? 0.32 : 1 }}
      onClick={() => onPick(item)}
      onMouseEnter={() => onHover(item)}
      onMouseLeave={() => onHover(null)}
      title={`${item.node?.title || ""} · ${dateText}`}
    >
      {/* Номер по хронологии: на вопрос «что было раньше» отвечает он, а не
          сравнение дат в уме — особенно когда даты в разных эпохах. */}
      <span className="tl-row-order font-mono-sw">{order}</span>

      {/* Точка события на своей дорожке. Ствол и ветки рисует TimelineRail —
          они идут поперёк рядов, и ряду их не нарисовать. */}
      <span className="tl-row-rail" aria-hidden="true">
        <span className="tl-row-dot" style={{ left: laneX(lane) }} />
      </span>

      <span className="tl-row-main">
        {item.node?.nodeType?.icon && (
          <NodeIcon name={item.node.nodeType.icon} className="w-3.5 h-3.5 shrink-0 tl-row-icon" />
        )}
        <span className="tl-row-title truncate">{item.node?.title || ""}</span>
        {item.label && <span className="tl-row-key">{item.label}</span>}
        {conflicts?.length > 0 && (
          <span
            className="tl-row-warn"
            title={conflictText}
            data-testid={`timeline-conflict-${item.nodeId}`}
          >
            <AlertTriangle className="w-3 h-3" />
          </span>
        )}
        {/* Возраст участников в момент события: «Анне 18» видно прямо в
            списке, без захода в карточку. */}
        {ages?.length > 0 && (
          <span className="tl-row-ages">
            {ages.map((a) => (
              <span key={a.nodeId} className="tl-row-age" data-testid="timeline-age-chip">
                <span className="truncate">{a.title}</span>
                <b className="font-mono-sw">{a.exact ? "" : "≈"}{a.age}</b>
              </span>
            ))}
          </span>
        )}
      </span>

      {/* Полоска длительности. Мгновенному событию колонка достаётся пустой —
          пустота здесь и означает «случилось, а не длилось». */}
      <span className="tl-row-span">
        {spanRatio > 0 && (
          <span className="tl-row-span-bar" style={{ width: `${Math.max(spanRatio * 100, 4)}%` }} />
        )}
        {spanText && <span className="tl-row-span-text font-mono-sw">{spanText}</span>}
      </span>

      {/* Инструменты ряда: на компьютере видны под мышью, на телефоне — у
          выбранного ряда. */}
      <span className="tl-row-tools">
        {onAdd && (
          <button
            type="button"
            className="tl-row-tool"
            onClick={(e) => { e.stopPropagation(); onAdd(item); }}
            data-testid={`timeline-row-add-${item.nodeId}`}
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
        {movable && (
          <span
            className="tl-row-tool tl-row-grip"
            onPointerDown={(e) => onGripDown(e, item)}
            onClick={(e) => e.stopPropagation()}
            data-testid={`timeline-grip-${item.nodeId}`}
          >
            <GripVertical className="w-3 h-3" />
          </span>
        )}
      </span>

      <span className="tl-row-date font-mono-sw">
        {mark && <span className="tl-row-mark">{mark}</span>}
        {dateText}
      </span>
    </div>
  );
}

export const EventRow = memo(EventRowInner, (a, b) => (
  a.item === b.item
  && a.y === b.y
  && a.height === b.height
  && a.order === b.order
  && a.dateText === b.dateText
  && a.spanText === b.spanText
  && a.spanRatio === b.spanRatio
  && a.lane === b.lane
  && a.selected === b.selected
  && a.focused === b.focused
  && a.dimmed === b.dimmed
  && a.highlighted === b.highlighted
  && a.conflicts === b.conflicts
  && a.ages === b.ages
  && a.future === b.future
  && a.movable === b.movable
  && a.dragging === b.dragging
  && a.onAdd === b.onAdd
  && a.onGripDown === b.onGripDown
  && a.conflictText === b.conflictText
));

export default EventRow;
