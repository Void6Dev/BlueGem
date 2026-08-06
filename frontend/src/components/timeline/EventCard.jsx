import { memo } from "react";
import { NodeIcon } from "@/components/NodeIcon";
import { DETAIL, WIDTH_PX } from "./useTimelineLayout";

// Событие на шкале.
//
// Одно и то же событие показывается по-разному в зависимости от того, сколько
// ему досталось места: карточка с названием и датой, узкая плашка с одним
// названием или просто точка. Переключает уровень раскладка — здесь только
// отрисовка.
//
// Полоса (событие с началом и концом) рисуется во всю свою длину; точечное
// событие — карточкой постоянной ширины. Размытые края у приблизительных дат
// не украшение: они показывают, что «около 300 года» — это не точка.

const KIND_MARK = {
  approx: "≈",
  before: "<",
  after: ">",
  between: "~",
  unknown: "?",
};

function EventCardInner({
  entry, detail, zoom, origin, dateText, selected, dimmed, highlighted, onOpen, onHover,
}) {
  const { item, u0, u1, spanU, y } = entry;
  const left = (u0 - origin) * zoom;
  // Ширина — от настоящего масштаба, а не от огрублённого, которым раскладка
  // раздаёт ряды: иначе карточка дышала бы на каждом щелчке колеса.
  const width = Math.max(spanU * zoom, WIDTH_PX[detail]);
  const barWidth = spanU > 0 ? Math.max(spanU * zoom, 3) : 0;
  const color = item.node?.nodeType?.color || "#64748b";
  const mark = KIND_MARK[item.start?.kind];

  const common = {
    "data-tl-card": item.key,
    "data-testid": `timeline-card-${item.nodeId}`,
    onClick: () => onOpen(item),
    onMouseEnter: () => onHover(item),
    onMouseLeave: () => onHover(null),
    style: { left, top: y },
  };

  if (detail === DETAIL.DOT) {
    return (
      <button
        type="button"
        {...common}
        title={`${item.node?.title || ""} · ${dateText}`}
        className="tl-dot"
        style={{ ...common.style, background: color, opacity: dimmed ? 0.25 : 1 }}
      />
    );
  }

  const chip = detail === DETAIL.CHIP;
  return (
    <button
      type="button"
      {...common}
      title={`${item.node?.title || ""} · ${dateText}`}
      className={`tl-card${chip ? " tl-card-chip" : ""}${selected ? " tl-card-on" : ""}`}
      style={{
        ...common.style,
        width,
        opacity: dimmed ? 0.28 : 1,
        borderColor: highlighted || selected ? color : undefined,
        boxShadow: highlighted ? `0 0 0 1px ${color}, var(--sw-shadow-md)` : undefined,
      }}
    >
      {/* Полоса длительности: видно, что событие тянулось, а не случилось. */}
      {barWidth > 0 && (
        <span className="tl-card-span" style={{ width: barWidth, background: color }} />
      )}
      <span className="tl-card-tick" style={{ background: color }} />
      <span className="tl-card-body">
        <span className="tl-card-title">
          {item.node?.nodeType?.icon && !chip && (
            <NodeIcon name={item.node.nodeType.icon} className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate">{item.node?.title || ""}</span>
        </span>
        {!chip && (
          <span className="tl-card-date font-mono-sw">
            {mark && <span className="tl-card-mark">{mark}</span>}
            {dateText}
            {item.label && <span className="tl-card-key">{item.label}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Карточка перерисовывается редко: при панораме двигается вся полоса целиком,
 * а не каждая карточка по отдельности. Поэтому сравнение по значимым полям
 * окупается — во время зума на экране их полторы сотни.
 */
export const EventCard = memo(EventCardInner, (a, b) => (
  a.entry.item === b.entry.item
  && a.entry.u0 === b.entry.u0
  && a.entry.u1 === b.entry.u1
  && a.entry.y === b.entry.y
  && a.detail === b.detail
  && a.zoom === b.zoom
  && a.origin === b.origin
  && a.dateText === b.dateText
  && a.selected === b.selected
  && a.dimmed === b.dimmed
  && a.highlighted === b.highlighted
));
