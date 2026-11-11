import { useEffect, useRef } from "react";
import { haptic } from "@/lib/platform";

const HOLD_MS = 430;
const SLOP = 10; // px — дрожание пальца, которое ещё не считается движением

/**
 * Долгое нажатие пальцем — правая кнопка мыши телефона.
 *
 * Своё, а не системное contextmenu: в WebView оно приходит не везде и не
 * всегда, а кое-где ещё и выделяет текст под пальцем. Поэтому системное мы
 * гасим, пока палец на экране, и решаем сами: держали ~0,4 с, не двигая и
 * одним пальцем (два — это масштаб), — значит, меню.
 *
 * Клик, который браузер пришлёт следом за отпусканием, тоже гасим: иначе
 * вслед за меню открылся бы ещё и быстрый просмотр узла, а то и сработал бы
 * пункт самого меню, выехавшего под палец.
 *
 * onHold(target, { x, y }) — target: элемент под пальцем.
 */
export function useLongPress(ref, enabled, onHold) {
  const handler = useRef(onHold);
  handler.current = onHold;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;
    let timer = 0;
    let start = null;
    const pointers = new Set();
    let swallowUntil = 0;
    let lastTouch = 0;

    const cancel = () => {
      clearTimeout(timer);
      timer = 0;
      start = null;
    };

    const onDown = (e) => {
      if (e.pointerType !== "touch") return;
      lastTouch = Date.now();
      pointers.add(e.pointerId);
      if (pointers.size > 1) { cancel(); return; }
      start = { x: e.clientX, y: e.clientY, target: e.target };
      timer = setTimeout(() => {
        const s = start;
        cancel();
        if (!s) return;
        swallowUntil = Date.now() + 700;
        haptic("heavy");
        handler.current?.(s.target, { x: s.x, y: s.y });
      }, HOLD_MS);
    };
    const onMove = (e) => {
      if (!start || e.pointerType !== "touch") return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
    };
    const onUp = (e) => {
      pointers.delete(e.pointerId);
      cancel();
    };
    const onContext = (e) => {
      if (Date.now() - lastTouch < 1500) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onClick = (e) => {
      if (Date.now() < swallowUntil) {
        e.preventDefault();
        e.stopPropagation();
        swallowUntil = 0;
      }
    };

    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onMove, true);
    el.addEventListener("pointerup", onUp, true);
    el.addEventListener("pointercancel", onUp, true);
    el.addEventListener("contextmenu", onContext, true);
    // Клик ловим на всём окне: меню выезжает поверх пальца, и браузерный клик
    // после отпускания достался бы уже ему — пункту под пальцем или фону.
    window.addEventListener("click", onClick, true);
    return () => {
      cancel();
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointermove", onMove, true);
      el.removeEventListener("pointerup", onUp, true);
      el.removeEventListener("pointercancel", onUp, true);
      el.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [ref, enabled]);
}
