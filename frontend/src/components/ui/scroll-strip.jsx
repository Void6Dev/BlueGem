import { useCallback, useEffect, useRef } from "react";
import { useSlidingThumb } from "@/lib/useSlidingThumb";

/**
 * Горизонтальная полоса без полосы прокрутки — для вкладок холстов.
 *
 * Полоса прокрутки здесь скрыта (на ряду вкладок она толще самих вкладок), и
 * без замены ей было не понять, что ряд вообще продолжается: девятая вкладка
 * просто обрывалась на «Персо». Поэтому:
 *  - край, за которым что-то есть, растворяется (data-fade → маска в index.css);
 *  - колесо мыши крутит ряд вбок — вертикального хода у него всё равно нет;
 *  - активная вкладка доезжает в видимую часть сама, иначе после переключения
 *    с палитры команд выбранный холст мог оказаться за краем.
 *
 * @param activeKey что считать активным: при его смене полоса доводит до
 *                  элемента с [data-active="true"].
 * @param thumb     подсвечивать активный элемент общим ползунком, который
 *                  переезжает между вкладками (см. lib/useSlidingThumb.js).
 */
export default function ScrollStrip({ className = "", activeKey, thumb = false, children, ...rest }) {
  const ref = useRef(null);
  useSlidingThumb(ref, [activeKey, thumb], '[data-active="true"]');

  // Атрибут, а не состояние: прокрутка приходит на каждый кадр, и
  // перерисовывать ради неё ряд вкладок незачем.
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    const fade = left && right ? "both" : left ? "left" : right ? "right" : "";
    if (el.dataset.fade !== fade) el.dataset.fade = fade;
  }, []);

  // Каждую перерисовку: вкладку добавили или переименовали — ширина ряда
  // сменилась, а размер самой полосы, за которым следит наблюдатель, нет.
  useEffect(sync);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sync]);

  useEffect(() => {
    const el = ref.current;
    const tab = el?.querySelector('[data-active="true"]');
    if (!el || !tab) return;
    // Положение считаем от самой полосы: offsetLeft отсчитывается от
    // ближайшего позиционированного предка, а полоса им не является.
    const pad = 24;
    const left = tab.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    const a = left - pad;
    const b = left + tab.offsetWidth + pad - el.clientWidth;
    if (a < el.scrollLeft) el.scrollTo({ left: a, behavior: "smooth" });
    else if (b > el.scrollLeft) el.scrollTo({ left: b, behavior: "smooth" });
  }, [activeKey]);

  // Колесо вешаем сами и не пассивным: React ставит wheel пассивным, и
  // preventDefault из onWheel не отменил бы прокрутку боковой панели под рядом.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={ref}
      onScroll={sync}
      className={`sw-scroll-strip sw-no-scrollbar overflow-x-auto ${thumb ? "sw-thumb-host" : ""} ${className}`}
      {...rest}
    >
      {thumb && <span className="sw-thumb" aria-hidden="true" />}
      {children}
    </div>
  );
}
