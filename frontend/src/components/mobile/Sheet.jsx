import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { haptic, pushBack } from "@/lib/platform";

/**
 * Шторка снизу — главный «слой» телефонного интерфейса.
 *
 * Всё, что на компьютере живёт панелью справа или окном по центру, на телефоне
 * выезжает снизу: туда достаёт большой палец, и холст над шторкой остаётся
 * виден. Правила:
 *
 *   — тянут за ручку и за шапку: вниз — закрыть, вверх — развернуть;
 *   — содержимое шторку не тянет никогда, оно только прокручивается. Раньше
 *     шторка ловила движение пальца вниз в начале списка — и на настоящем
 *     телефоне, где палец при нажатии всегда немного съезжает, превращала
 *     нажатия на кнопки в попытки её закрыть, а прокрутку — в рывки: каждое
 *     движение ждало решения скрипта. Теперь прокруткой целиком занимается
 *     система, без единого обработчика на пути;
 *   — закрывает быстрый взмах, даже короткий, а медленный — только дальний;
 *   — пока тянут, двигается сам элемент, без перерисовок React;
 *   — системная кнопка «назад» закрывает верхнюю шторку, а не уводит со страницы;
 *   — фон за модальной шторкой затемнён и закрывает её касанием.
 *
 * detent: "auto" — по содержимому (не выше экрана), "full" — во весь экран.
 * modal={false} — шторка не перекрывает холст: им можно пользоваться, пока она
 * открыта (быстрый просмотр узла).
 */

const SheetContext = createContext({ close: () => {} });

/** Закрыть шторку изнутри — с анимацией, как свайпом. */
export function useSheet() {
  return useContext(SheetContext);
}

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const DURATION = 300;
const TRANSITION = `transform ${DURATION}ms ${EASE}`;
const FADE = `opacity ${DURATION}ms ${EASE}`;
const CLOSE_DISTANCE = 0.28; // доля высоты шторки
const CLOSE_VELOCITY = 0.55; // px/ms — быстрый взмах закрывает с любого места
const EXPAND_DISTANCE = 56;
const SLOP = 8; // px — меньше этого палец просто нажимает, а не тянет

// За что можно тянуть. Шапки панелей помечают себя data-sheet-drag.
const DRAG_ZONE = "[data-sheet-grip], [data-sheet-drag], .sw-sheet-head, .sw-preview-head, .sw-as-head";

/** Поле ввода: в нём палец выделяет текст, а не тянет шторку. */
function ownsGesture(el, stop) {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    const tag = n.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || n.isContentEditable) return true;
    if (n.dataset?.sheetNoDrag !== undefined) return true;
  }
  return false;
}

/** Погасить клик и мышиные события, которые браузер пришлёт после жеста. */
function swallowNextClick() {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const types = ["click", "mousedown", "mouseup"];
  types.forEach((t) => window.addEventListener(t, stop, true));
  setTimeout(() => types.forEach((t) => window.removeEventListener(t, stop, true)), 450);
}

export default function Sheet({
  children,
  onClose,
  onBack,
  onExpand,
  detent = "auto",
  modal = true,
  testId,
  className = "",
  style,
  z = 60,
  handle = true,
  label,
}) {
  const sheetRef = useRef(null);
  const backdropRef = useRef(null);
  const [phase, setPhase] = useState("enter"); // enter → open → leave
  const gesture = useRef(null);
  const swallowClick = useRef(false);
  const closingRef = useRef(false);
  const timerRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onExpandRef = useRef(onExpand);
  onExpandRef.current = onExpand;

  // Въезд: первый кадр — за краем, второй — на месте; переход делает CSS.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(frame);
  }, []);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = sheetRef.current;
    if (el) el.style.transition = TRANSITION;
    if (backdropRef.current) backdropRef.current.style.transition = FADE;
    setPhase("leave");
    timerRef.current = setTimeout(() => onCloseRef.current?.(), DURATION - 60);
  }, []);
  // Шторку убрали снаружи раньше, чем доиграл уход, — опоздавший onClose
  // закрыл бы уже следующую, открытую на её месте.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // «Назад» на телефоне и Esc на клавиатуре — тот же выход, что и свайп.
  const backRef = useRef(null);
  backRef.current = onBack || close;
  const layer = useRef(null);
  useEffect(() => {
    layer.current = pushBack(() => backRef.current());
    return layer.current;
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Esc закрывает только верхний слой — как системная «назад».
      if (!layer.current?.isTop()) return;
      e.preventDefault();
      backRef.current();
    };
    // На перехвате: шторка решает раньше, чем общие обработчики редактора.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /** Сдвиг шторки пальцем — прямо в DOM, без перерисовки содержимого. */
  const place = (px, animate) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate ? TRANSITION : "none";
    el.style.transform = `translate3d(0, ${px}px, 0)`;
    const bd = backdropRef.current;
    if (bd) {
      const h = el.offsetHeight || 1;
      bd.style.transition = animate ? FADE : "none";
      bd.style.opacity = String(Math.max(0, Math.min(1, 1 - Math.max(0, px) / h)));
    }
  };

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const root = sheetRef.current;
    const zone = e.target.closest?.(DRAG_ZONE);
    if (!zone || !root?.contains(zone) || ownsGesture(e.target, root)) return;
    gesture.current = {
      id: e.pointerId, y0: e.clientY, last: e.clientY, t: performance.now(), v: 0, dy: 0, active: false,
    };
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dy = e.clientY - g.y0;
    if (!g.active) {
      // Палец едва сдвинулся — это ещё нажатие на кнопку в шапке.
      if (Math.abs(dy) < SLOP) return;
      g.active = true;
      try { sheetRef.current.setPointerCapture(e.pointerId); } catch { /* уже отпустили */ }
    }
    const now = performance.now();
    const dt = Math.max(1, now - g.t);
    g.v = 0.7 * ((e.clientY - g.last) / dt) + 0.3 * g.v;
    g.last = e.clientY;
    g.t = now;
    g.dy = dy;
    // Вверх шторка не едет, а упирается — с сопротивлением резинки.
    place(dy < 0 ? -Math.sqrt(-dy) * (onExpandRef.current ? 4 : 2.2) : dy, false);
  };

  const finish = (e, cancelled) => {
    const g = gesture.current;
    if (!g || (e && e.pointerId !== g.id)) return;
    gesture.current = null;
    if (!g.active) return;
    // Отпустили после протяжки — клик под пальцем не нужен. Ловим его на
    // всём окне: шторка могла уже закрыться или открыть вместо себя другую
    // (превью → редактор), и клик достался бы её полю ввода — на телефоне
    // это выскочившая сама по себе клавиатура.
    swallowClick.current = true;
    setTimeout(() => { swallowClick.current = false; }, 0);
    swallowNextClick();
    const h = sheetRef.current?.offsetHeight || 400;
    if (!cancelled && (g.dy > h * CLOSE_DISTANCE || (g.v > CLOSE_VELOCITY && g.dy > 16))) {
      haptic("tick");
      close();
      return;
    }
    if (!cancelled && onExpandRef.current
      && (g.dy < -EXPAND_DISTANCE || (g.v < -CLOSE_VELOCITY && g.dy < -16))) {
      haptic("light");
      onExpandRef.current();
    }
    place(0, true);
  };

  const shown = phase === "open";
  const ctx = useMemo(() => ({ close }), [close]);

  return createPortal(
    <SheetContext.Provider value={ctx}>
      {modal && (
        <div
          ref={backdropRef}
          className="sw-sheet-backdrop"
          style={{ zIndex: z, opacity: shown ? 1 : 0, transition: FADE }}
          onClick={close}
          data-testid={testId ? `${testId}-backdrop` : undefined}
        />
      )}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={modal || undefined}
        aria-label={label}
        data-testid={testId}
        data-detent={detent}
        className={`sw-sheet sw-panel ${modal ? "" : "is-floating"} ${className}`}
        style={{
          zIndex: z + 1,
          transform: shown ? "translate3d(0, 0px, 0)" : "translate3d(0, 100%, 0)",
          transition: TRANSITION,
          ...style,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {handle && (
          <div className="sw-sheet-grip" data-sheet-grip="">
            <span />
          </div>
        )}
        {children}
      </div>
    </SheetContext.Provider>,
    document.body,
  );
}
