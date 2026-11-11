import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Поле ввода, которое не спорит с телефонной клавиатурой.
 *
 * Клавиатура Android набирает слово «составом» (П → Пр → При…), а на пробеле
 * его фиксирует и нередко тут же исправляет: стирает набранное и вставляет
 * поправленное. Обычное управляемое поле React в этот момент может записать в
 * себя своё значение — на кадр отставшее от того, что уже показывает
 * клавиатура, — и набранное слово пропадает.
 *
 * Здесь поле принадлежит клавиатуре: React его не перезаписывает, а только
 * читает. Значение снаружи (очистили поле, открыли другой узел, отмена)
 * ставится, только если это действительно новое значение — не эхо того, что
 * человек только что набрал, — и не посреди составления слова.
 *
 * Возвращает свойства для <input>/<textarea>: ref, defaultValue, onChange,
 * onCompositionStart/End. Остальные свойства поля — как обычно.
 */
export function useImeSafe({ value, onChange, onCompositionStart, onCompositionEnd, ref: outerRef }) {
  const inner = useRef(null);
  const echo = useRef([]);
  const composing = useRef(false);

  const setRef = useCallback((el) => {
    inner.current = el;
    if (typeof outerRef === "function") outerRef(el);
    else if (outerRef) outerRef.current = el;
  }, [outerRef]);

  const text = value == null ? "" : String(value);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    if (el.value === text) { echo.current = []; return; }
    // Своё же недавнее значение пришло назад — поле уже впереди, не трогаем.
    if (composing.current || echo.current.includes(text)) return;
    el.value = text;
    echo.current = [];
  }, [text]);

  return {
    ref: setRef,
    defaultValue: text,
    onChange: (e) => {
      echo.current.push(e.target.value);
      if (echo.current.length > 40) echo.current.shift();
      onChange?.(e);
    },
    onCompositionStart: (e) => { composing.current = true; onCompositionStart?.(e); },
    onCompositionEnd: (e) => { composing.current = false; onCompositionEnd?.(e); },
  };
}
