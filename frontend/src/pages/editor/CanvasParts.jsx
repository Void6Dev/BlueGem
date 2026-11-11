// Мелкие части холста редактора: счётчик масштаба, отметка «далеко», сетка,
// мини-карта и таблицы типов узлов и связей для React Flow. У каждой своя
// подписка на холст — так колесо мыши перерисовывает только их, а не весь
// редактор.
import { useEffect } from "react";
import { Background, BackgroundVariant, useStore as useFlowStore } from "@xyflow/react";
import CustomNode, { FAR_ZOOM } from "@/components/CustomNode";
import GradientEdge from "@/components/GradientEdge";

export const nodeTypes = { custom: CustomNode };
export const edgeTypes = { gradient: GradientEdge };

/** Что показывает счётчик масштаба. Отдельный компонент с подпиской на холст:
 *  иначе каждый щелчок колеса перерисовывал бы весь редактор. */
export function ZoomPercent() {
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
export function FarZoomFlag({ targetRef }) {
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
export function CanvasGrid({ lite = false }) {
  // lite — телефон: одна сетка вместо двух, заливка узором во весь экран на
  // каждый кадр стоит там заметно дороже.
  const fine = useFlowStore((s) => !lite && s.transform[2] >= 0.45);
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
export const miniMapColor = (n) => n.data?.nodeType?.color || "#64748b";
// Мини-карта меньше штатной (200×150): в окне ноутбука та закрывала четверть
// холста, а для ориентира хватает и спичечного коробка. Размеры повторены в
// .sw-minimap-toggle (index.css) — кнопка стоит в её углу.
export const MINIMAP_STYLE = { margin: 16, width: 176, height: 116 };
export const PRO_OPTIONS = { hideAttribution: true };
