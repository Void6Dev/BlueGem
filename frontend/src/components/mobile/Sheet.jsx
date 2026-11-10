import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { haptic, pushBack } from "@/lib/platform";

/**
 * Шторка снизу — главный «слой» телефонного интерфейса.
 *
 * Всё, что на компьютере живёт панелью справа или окном по центру, на телефоне
 * выезжает снизу: туда достаёт большой палец, и холст над шторкой остаётся
 * виден. Правила те же, что у системных шторок Android:
 *
 *   — тянут за ручку или за шапку: вниз — закрыть, вверх — развернуть;
 *   — тянут и за содержимое, если оно прокручено до самого верха;
 *   — закрывает быстрый взмах, даже короткий, а медленный — только дальний;
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
const CLOSE_DISTANCE = 0.28; // доля высоты шторки
const CLOSE_VELOCITY = 0.55; // px/ms — быстрый взмах закрывает с любого места
const EXPAND_DISTANCE = 56;

/** Ближайший прокручиваемый предок в пределах шторки. */
function scrollParent(el, stop) {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === "auto" || oy === "scroll") return n;
    }
  }
  return null;
}

/** Поле ввода или что-то, что само ловит горизонтальный жест. */
function ownsGesture(el, stop) {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    const tag = n.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || n.isContentEditable) return true;
    if (n.dataset?.sheetNoDrag !== undefined) return true;
  }
  return false;
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
  const [phase, setPhase] = useState("enter"); // enter → open → leave
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Въезд: первый кадр — за краем, второй — на месте; переход делает CSS.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(frame);
  }, []);

  const timerRef = useRef(0);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setDragging(false);
    setPhase("leave");
    timerRef.current = setTimeout(() => onCloseRef.current?.(), DURATION - 60);
  }, []);
  // Шторку убрали снаружи раньше, чем доиграл уход, — опоздавший onClose
  // закрыл бы уже следующую, открытую на её месте.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // «Назад» на телефоне и Esc на клавиатуре — тот же выход, что и свайп.
  const backRef = useRef(null);
  backRef.current = onBack || close;
  useEffect(() => pushBack(() => backRef.current()), []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      backRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const height = () => sheetRef.current?.offsetHeight || 400;

  const begin = (y) => {
    gesture.current = { y0: y, last: y, t: performance.now(), v: 0, dy: 0 };
    setDragging(true);
  };
  const move = (y) => {
    const g = gesture.current;
    if (!g) return;
    const now = performance.now();
    const dt = Math.max(1, now - g.t);
    g.v = 0.7 * ((y - g.last) / dt) + 0.3 * g.v;
    g.last = y;
    g.t = now;
    let dy = y - g.y0;
    // Вверх шторка не едет, а упирается — с сопротивлением резинки.
    if (dy < 0) dy = -Math.sqrt(-dy) * (onExpand ? 4 : 2.2);
    g.dy = y - g.y0;
    setDrag(dy);
  };
  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (!g) return;
    const h = height();
    if (g.dy > h * CLOSE_DISTANCE || (g.v > CLOSE_VELOCITY && g.dy > 12)) {
      haptic("tick");
      close();
      return;
    }
    if (onExpand && (g.dy < -EXPAND_DISTANCE || (g.v < -CLOSE_VELOCITY && g.dy < -12))) {
      haptic("light");
      onExpand();
    }
    setDrag(0);
  };

  // Ручка и шапка: обычные pointer-события, жест целиком наш.
  const onHandleDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (ownsGesture(e.target, sheetRef.current)) return;
    if (e.target.closest("button, a, [role='button']") && !e.target.closest("[data-sheet-grip]")) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    begin(e.clientY);
  };

  // Содержимое: touch-события, потому что решать «листать или тянуть шторку»
  // надо в момент первого движения, а pointer-события к этому времени уже
  // отданы браузеру под прокрутку.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return undefined;
    let start = null;
    const onStart = (e) => {
      if (e.touches.length !== 1 || gesture.current) { start = null; return; }
      const t = e.touches[0];
      if (ownsGesture(e.target, el)) { start = null; return; }
      const scroller = scrollParent(e.target, el);
      start = { y: t.clientY, x: t.clientX, scroller, decided: false };
    };
    const onMove = (e) => {
      if (!start) return;
      const t = e.touches[0];
      const dy = t.clientY - start.y;
      const dx = t.clientX - start.x;
      if (!start.decided) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        start.decided = true;
        const atTop = !start.scroller || start.scroller.scrollTop <= 0;
        // Тянем шторку только вниз, только вертикально и только от верха списка.
        if (!(dy > 0 && atTop && Math.abs(dy) > Math.abs(dx))) { start = null; return; }
        begin(start.y);
      }
      e.preventDefault();
      move(t.clientY);
    };
    const onEnd = () => {
      if (start?.decided) end();
      start = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line
  }, []);

  const shown = phase === "open";
  const offset = shown ? `${drag}px` : "100%";
  const h = sheetRef.current?.offsetHeight || 1;
  const dim = shown ? Math.max(0, Math.min(1, 1 - drag / h)) : 0;

  return createPortal(
    <SheetContext.Provider value={{ close }}>
      {modal && (
        <div
          className="sw-sheet-backdrop"
          style={{
            zIndex: z,
            opacity: dim,
            transition: dragging ? "none" : `opacity ${DURATION}ms ${EASE}`,
          }}
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
          transform: `translate3d(0, ${offset}, 0)`,
          transition: dragging ? "none" : `transform ${DURATION}ms ${EASE}`,
          ...style,
        }}
      >
        {handle && (
          <div
            className="sw-sheet-grip"
            data-sheet-grip=""
            onPointerDown={onHandleDown}
            onPointerMove={(e) => gesture.current && move(e.clientY)}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <span />
          </div>
        )}
        {children}
      </div>
    </SheetContext.Provider>,
    document.body,
  );
}

