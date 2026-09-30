import { memo } from "react";
import { LANE_W, RAIL_X, ROW_H } from "./useTimelineRows";

// Рельс времени: ствол и ветки к одновременным событиям.
//
// Устроен как граф истории правок. Ствол — само течение времени, он идёт
// сверху вниз без разрывов. Гроздь событий, случившихся в один и тот же
// момент, расходится по параллельным дорожкам и сходится обратно: пока они
// шли простым столбиком, «одновременно» и «одно за другим» выглядели
// одинаково, а это разные вещи.
//
// Ствол — обычный div во всю высоту: он непрерывен, и гонять на него SVG
// незачем. В SVG попадают только ветки, и только те, что сейчас в кадре.

/** Центр дорожки по её номеру. */
export const laneX = (lane) => RAIL_X + (lane || 0) * LANE_W;

/** Ширина колонки рельса при заданном числе дорожек. */
export const railWidth = (maxLane) => RAIL_X * 2 + (maxLane || 0) * LANE_W;

function TimelineRailInner({ rows, maxLane, height }) {
  const paths = [];
  for (const row of rows) {
    if (row.kind !== "event" || !row.lane || row.branchTop == null) continue;
    const x = laneX(row.lane);
    const y = row.y + ROW_H / 2;
    // Уход со ствола и возврат на него: половина расстояния по вертикали —
    // на изгиб. Так ветка отходит плавно и не спорит с соседней.
    const outMid = (row.branchTop + y) / 2;
    const inMid = (y + row.branchBottom) / 2;
    paths.push(
      <path
        key={`${row.id}-out`}
        className="tl-branch"
        d={`M ${RAIL_X} ${row.branchTop} C ${RAIL_X} ${outMid}, ${x} ${outMid}, ${x} ${y}`}
      />,
      <path
        key={`${row.id}-in`}
        className="tl-branch"
        d={`M ${x} ${y} C ${x} ${inMid}, ${RAIL_X} ${inMid}, ${RAIL_X} ${row.branchBottom}`}
      />
    );
  }

  // Слой стоит там же, где колонка рельса внутри ряда (--tl-rail-left), —
  // иначе ствол ушёл бы к левому краю, а точки остались бы на своих местах.
  return (
    <div className="tl-rail-layer" aria-hidden="true">
      <span className="tl-trunk" style={{ left: RAIL_X, height }} />
      {paths.length > 0 && (
        // SVG во всю высоту содержимого, но с путями только видимого окна:
        // координаты у путей те же, что у рядов, и пересчитывать их при
        // прокрутке не нужно.
        <svg className="tl-rail-svg" width={railWidth(maxLane)} height={height}>
          {paths}
        </svg>
      )}
    </div>
  );
}

export const TimelineRail = memo(TimelineRailInner);
export default TimelineRail;
