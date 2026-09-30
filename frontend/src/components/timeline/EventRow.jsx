import { memo } from "react";
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
}) {
  const color = item.node?.nodeType?.color || "#64748b";
  const mark = KIND_MARK[item.start?.kind];

  const cls = [
    "tl-row",
    selected ? "tl-row-on" : "",
    focused ? "tl-row-focus" : "",
    highlighted ? "tl-row-lit" : "",
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
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
      </span>

      {/* Полоска длительности. Мгновенному событию колонка достаётся пустой —
          пустота здесь и означает «случилось, а не длилось». */}
      <span className="tl-row-span">
        {spanRatio > 0 && (
          <span className="tl-row-span-bar" style={{ width: `${Math.max(spanRatio * 100, 4)}%` }} />
        )}
        {spanText && <span className="tl-row-span-text font-mono-sw">{spanText}</span>}
      </span>

      <span className="tl-row-date font-mono-sw">
        {mark && <span className="tl-row-mark">{mark}</span>}
        {dateText}
      </span>
    </button>
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
));

export default EventRow;
