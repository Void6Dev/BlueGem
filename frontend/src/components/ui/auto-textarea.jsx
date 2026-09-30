import * as React from "react";
import { cn } from "@/lib/utils";

// Поле ввода, растущее под текст.
//
// Обычный input — одна строка без переноса: длинное имя или значение уезжает
// горизонтально, и виден только его хвост. Здесь textarea, которая переносит
// текст и подгоняет высоту под содержимое, оставаясь внешне тем же полем.
//
// Высоту считаем от scrollHeight, предварительно сбросив её: без сброса поле
// умеет только расти — при удалении текста оно осталось бы прежней высоты.

const AutoTextarea = React.forwardRef(({
  className, value, minRows = 1, maxRows = 12, onKeyDown, singleLine, ...props
}, ref) => {
  const inner = React.useRef(null);
  // Чужой ref не должен отбирать наш: пробрасываем оба на один узел.
  const setRefs = React.useCallback((el) => {
    inner.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  }, [ref]);

  const resize = React.useCallback(() => {
    const el = inner.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = "auto";
    const wanted = el.scrollHeight + border;
    const max = line * maxRows + pad + border;
    el.style.height = `${Math.min(wanted, max)}px`;
    // Упёрлись в потолок — дальше прокрутка внутри поля, иначе панель
    // растянется на весь экран от одного длинного описания.
    el.style.overflowY = wanted > max ? "auto" : "hidden";
  }, [maxRows]);

  React.useLayoutEffect(resize, [value, resize]);

  return (
    <textarea
      ref={setRefs}
      rows={minRows}
      value={value}
      onKeyDown={(e) => {
        // В однострочном режиме Enter — это «готово», а не перенос строки:
        // в названии узла перевод строки не нужен, но переносить длинное
        // название по ширине поля всё равно надо.
        if (singleLine && e.key === "Enter" && !e.shiftKey) e.preventDefault();
        onKeyDown?.(e);
      }}
      className={cn(
        "flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
        "ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
AutoTextarea.displayName = "AutoTextarea";

export { AutoTextarea };
