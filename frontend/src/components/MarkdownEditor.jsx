import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import MarkdownView from "@/components/MarkdownView";
import { hotkey } from "@/lib/hotkey";
import { useT } from "@/lib/i18n";

/**
 * Описание узла как блокнот: текст всё время виден готовым, а не разметкой.
 * Правится только тот абзац, в котором стоит курсор, — остальной документ
 * остаётся набранным. Так исчезает переключатель «правка / просмотр»: человек
 * пишет прямо в том, что читает.
 *
 * Источник правды — по-прежнему markdown-строка. Мы лишь режем её на блоки,
 * и обратно склеиваем пустой строкой между ними.
 */

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
// Маркер строки списка или цитаты — то, что Enter должен продолжить сам.
const MARKER = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+\. |> )/;

/** Разбор markdown на блоки: абзац, заголовок, список, цитата, код, таблица. */
export function splitBlocks(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  let cur = [];
  let fence = null;
  const flush = () => { if (cur.length) out.push(cur.join("\n")); cur = []; };
  for (const line of lines) {
    // Внутри ``` пустая строка ничего не разделяет — код это один блок.
    if (fence) {
      cur.push(line);
      if (line.trim().startsWith(fence)) { fence = null; flush(); }
      continue;
    }
    const f = line.match(FENCE);
    if (f) { flush(); fence = f[1]; cur.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    // Заголовок и линейка живут отдельно, даже если написаны вплотную к тексту:
    // иначе клик по заголовку открывал бы на правку весь следующий абзац.
    if (HEADING.test(line) || HR.test(line)) { flush(); out.push(line); continue; }
    cur.push(line);
  }
  flush();
  return out;
}

/** Текст от начала блока до точки клика — по нему ищем место в разметке. */
function plainPrefixAt(el, x, y) {
  const doc = el.ownerDocument;
  let range = null;
  if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y);
  else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) { range = doc.createRange(); range.setStart(p.offsetNode, p.offset); }
  }
  if (!range || !el.contains(range.startContainer)) return null;
  const pre = doc.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString();
}

// Курсор ставим туда, куда человек ткнул, а не в конец абзаца. В набранном
// тексте нет звёздочек и решёток, поэтому идём по разметке и по видимому
// тексту двумя указателями, пропуская в разметке всё, что не совпало.
function rawOffset(raw, plain) {
  if (!plain) return 0;
  const ws = (c) => /\s/.test(c);
  let i = 0;
  let j = 0;
  while (i < raw.length && j < plain.length) {
    if (raw[i] === plain[j] || (ws(raw[i]) && ws(plain[j]))) { i += 1; j += 1; }
    else i += 1;
  }
  return i;
}

function grow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

const MarkdownEditor = forwardRef(function MarkdownEditor(
  {
    value,
    onChange,
    nodes = [],
    onOpenNode,
    onCreateNode,
    onPaste,
    placeholder,
    className = "",
    listClassName = "",
    toolbar = true,
    // В узкой панели кнопки уезжают вбок одной строкой, а не занимают три:
    // место там дороже, и это тот же приём, что у подсказок тегов.
    toolbarScroll = false,
  },
  ref
) {
  const tr = useT();
  const [blocks, setBlocks] = useState(() => splitBlocks(value));
  const [active, setActive] = useState(null); // индекс блока под курсором
  const [text, setText] = useState("");
  const taRef = useRef(null);
  const rootRef = useRef(null);
  const emitted = useRef(value);
  const pendingCaret = useRef(null);
  const pendingCmd = useRef(null);
  const blocksRef = useRef(blocks);
  const activeRef = useRef(active);
  const textRef = useRef(text);
  blocksRef.current = blocks;
  activeRef.current = active;
  textRef.current = text;

  // Текст пришёл извне (открыли другой узел, откатили правку) — пересобираем.
  // Свои же изменения сюда не попадают: их строку мы помним в emitted.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setBlocks(splitBlocks(value));
    setActive(null);
  }, [value]);

  const emit = useCallback((arr) => {
    const next = arr.filter((b) => b.trim()).join("\n\n");
    emitted.current = next;
    onChange(next);
  }, [onChange]);

  // Правку блока держим отдельно от массива: пока курсор внутри, документ не
  // переразбивается, и индексы блоков не разъезжаются под руками.
  const startEdit = useCallback((i, caret) => {
    // Уходя из блока, кладём его текст обратно в массив. Полагаться на blur
    // нельзя: он приходит не всегда и не первым, а потерянный абзац — это
    // потерянный абзац.
    const cur = activeRef.current;
    let arr = cur === null
      ? blocksRef.current
      : blocksRef.current.map((b, idx) => (idx === cur ? textRef.current : b));
    if (!arr.length) arr = [""];
    const idx = Math.max(0, Math.min(i, arr.length - 1));
    setBlocks(arr);
    setActive(idx);
    setText(arr[idx]);
    pendingCaret.current = caret;
  }, []);

  const commit = useCallback(() => {
    const i = activeRef.current;
    if (i === null) return;
    const arr = blocksRef.current.map((b, idx) => (idx === i ? textRef.current : b));
    setBlocks(arr);
    setActive(null);
    emit(arr);
  }, [emit]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (activeRef.current !== null) { taRef.current?.focus({ preventScroll: true }); return; }
      startEdit(Math.max(0, blocksRef.current.length - 1), "end");
    },
    element: () => rootRef.current,
  }), [startEdit]);

  const attach = useCallback((el) => {
    taRef.current = el;
    if (!el) return;
    grow(el);
    el.focus({ preventScroll: true });
    const c = pendingCaret.current;
    pendingCaret.current = null;
    const pos = c === "start" ? 0
      : c === "end" || c == null ? el.value.length
      : Math.max(0, Math.min(c, el.value.length));
    el.setSelectionRange(pos, pos);
    const cmd = pendingCmd.current;
    pendingCmd.current = null;
    if (cmd) cmd();
  }, []);

  /* ---------------- правки текста ---------------- */

  const apply = (next, from, to) => {
    setText(next);
    const arr = blocksRef.current.map((b, idx) => (idx === activeRef.current ? next : b));
    emit(arr);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (from != null) el.setSelectionRange(from, to ?? from);
      grow(el);
    });
  };

  const wrap = (before, after = before) => {
    const el = taRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    // Повторное нажатие на выделенном снимает разметку, а не удваивает её.
    const inside = v.slice(s, e);
    if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      const next = v.slice(0, s - before.length) + inside + v.slice(e + after.length);
      apply(next, s - before.length, e - before.length);
      return;
    }
    const next = v.slice(0, s) + before + inside + after + v.slice(e);
    apply(next, s + before.length, e + before.length);
  };

  // Заголовок, список, цитата — префикс каждой задетой строки, а не обёртка
  // выделения: на нескольких строках обёртка легла бы в середину текста.
  const prefixLines = (prefix, strip = MARKER) => {
    const el = taRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const from = v.lastIndexOf("\n", s - 1) + 1;
    const toRaw = v.indexOf("\n", e);
    const to = toRaw === -1 ? v.length : toRaw;
    const lines = v.slice(from, to).split("\n");
    const already = lines.every((l) => l.startsWith(prefix));
    let n = 0;
    const patched = lines
      .map((l) => {
        const bare = strip ? l.replace(strip, "") : l;
        if (already) return bare;
        n += 1;
        return (prefix === "1. " ? `${n}. ` : prefix) + bare;
      })
      .join("\n");
    const next = v.slice(0, from) + patched + v.slice(to);
    apply(next, from + patched.length);
  };

  const heading = (level) => {
    const el = taRef.current;
    if (!el) return;
    const { selectionStart: s, value: v } = el;
    const from = v.lastIndexOf("\n", s - 1) + 1;
    const toRaw = v.indexOf("\n", s);
    const to = toRaw === -1 ? v.length : toRaw;
    const line = v.slice(from, to);
    const bare = line.replace(/^\s{0,3}#{1,6}\s+/, "");
    const same = new RegExp(`^\\s{0,3}#{${level}}\\s`).test(line);
    const patched = same ? bare : `${"#".repeat(level)} ${bare}`;
    const next = v.slice(0, from) + patched + v.slice(to);
    apply(next, from + patched.length);
  };

  const insertText = (chunk, caretBack = 0) => {
    const el = taRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const next = v.slice(0, s) + chunk + v.slice(e);
    apply(next, s + chunk.length - caretBack);
  };

  /** Новый блок под текущим: линейка, таблица, код — отдельные абзацы. */
  const insertBlock = (chunk, caret = "end") => {
    const i = activeRef.current;
    const arr = [...blocksRef.current];
    const at = i === null ? arr.length : i + 1;
    if (i !== null) arr[i] = textRef.current;
    arr.splice(at, 0, chunk);
    setBlocks(arr);
    emit(arr);
    setActive(at);
    setText(chunk);
    pendingCaret.current = caret;
  };

  const splitAt = (v, pos) => {
    const i = activeRef.current;
    const arr = [...blocksRef.current];
    arr[i] = v.slice(0, pos);
    arr.splice(i + 1, 0, v.slice(pos));
    setBlocks(arr);
    emit(arr);
    setActive(i + 1);
    setText(v.slice(pos));
    pendingCaret.current = "start";
  };

  const mergeUp = () => {
    const i = activeRef.current;
    if (i <= 0) return;
    const arr = [...blocksRef.current];
    const prev = arr[i - 1];
    const mine = textRef.current;
    const merged = mine ? `${prev}\n${mine}` : prev;
    arr.splice(i, 1);
    arr[i - 1] = merged;
    setBlocks(arr);
    emit(arr);
    setActive(i - 1);
    setText(merged);
    pendingCaret.current = prev.length + (mine ? 1 : 0);
  };

  const move = (dir) => {
    const i = activeRef.current;
    const next = i + dir;
    if (next < 0 || next >= blocksRef.current.length) return false;
    const arr = blocksRef.current.map((b, idx) => (idx === i ? textRef.current : b));
    setBlocks(arr);
    emit(arr);
    setActive(next);
    setText(arr[next]);
    pendingCaret.current = dir > 0 ? "start" : "end";
    return true;
  };

  /* ---------------- клавиатура ---------------- */

  const onKeyDown = (e) => {
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value: v } = el;
    const mod = e.ctrlKey || e.metaKey;
    const k = hotkey(e);

    if (mod && !e.altKey) {
      const map = {
        b: () => wrap("**"),
        i: () => wrap("*"),
        e: () => wrap("`"),
        u: () => wrap("~~"),
      };
      if (e.shiftKey) {
        if (k === "k") { e.preventDefault(); wrap("[[", "]]"); return; }
        if (k === "l") { e.preventDefault(); prefixLines("- "); return; }
        if (k === "t") { e.preventDefault(); prefixLines("- [ ] "); return; }
        if (k === "q") { e.preventDefault(); prefixLines("> "); return; }
      } else if (/^[1-6]$/.test(k)) {
        e.preventDefault();
        heading(Number(k));
        return;
      } else if (map[k]) {
        e.preventDefault();
        map[k]();
        return;
      }
      return; // Ctrl+S и прочее — не наше дело
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      commit();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !mod) {
      // В коде Enter — просто перенос строки, блок остаётся одним.
      if (FENCE.test(v)) return;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const line = v.slice(lineStart, s);
      const m = line.match(MARKER);
      if (m) {
        e.preventDefault();
        const marker = m[0];
        if (line.length === marker.length) {
          // Пустой пункт — список закончился, начинаем обычный абзац.
          const cut = v.slice(0, lineStart) + v.slice(s);
          splitAt(cut, lineStart);
          return;
        }
        const nextMarker = marker
          .replace(/\[[xX]\]/, "[ ]")
          .replace(/^(\s*)(\d+)\./, (_, sp, num) => `${sp}${Number(num) + 1}.`);
        insertText(`\n${nextMarker}`);
        return;
      }
      e.preventDefault();
      splitAt(v, s);
      return;
    }

    if (e.key === "Backspace" && s === 0 && en === 0) { e.preventDefault(); mergeUp(); return; }
    if (e.key === "ArrowUp" && v.lastIndexOf("\n", s - 1) === -1) { if (move(-1)) e.preventDefault(); return; }
    if (e.key === "ArrowDown" && v.indexOf("\n", s) === -1) { if (move(1)) e.preventDefault(); return; }
    if (e.key === "ArrowLeft" && s === 0 && en === 0) { if (move(-1)) e.preventDefault(); return; }
    if (e.key === "ArrowRight" && s === v.length && en === v.length) { if (move(1)) e.preventDefault(); }
  };

  /* ---------------- клики по набранному тексту ---------------- */

  const onBlockClick = (e, i) => {
    // Ссылку на узел и галочку в списке отдаём их обработчикам.
    if (e.target.closest("a, button, input")) return;
    // Человек выделял текст мышью, а не ставил курсор — не мешаем копировать.
    if (window.getSelection && String(window.getSelection()) !== "") return;
    const host = e.currentTarget;
    const prefix = plainPrefixAt(host, e.clientX, e.clientY);
    startEdit(i, prefix == null ? "end" : rawOffset(blocksRef.current[i] || "", prefix));
  };

  /* ---------------- панель разметки ---------------- */

  const run = (fn) => {
    if (taRef.current && activeRef.current !== null) { fn(); return; }
    pendingCmd.current = fn;
    startEdit(Math.max(0, blocksRef.current.length - 1), "end");
  };

  const tools = [
    [
      { label: "H1", title: `${tr("md.h1")} · Ctrl+1`, run: () => heading(1) },
      { label: "H2", title: `${tr("md.h2")} · Ctrl+2`, run: () => heading(2) },
      { label: "H3", title: `${tr("md.h3")} · Ctrl+3`, run: () => heading(3) },
    ],
    [
      { label: "B", title: `${tr("md.bold")} · Ctrl+B`, cls: "font-bold", run: () => wrap("**") },
      { label: "I", title: `${tr("md.italic")} · Ctrl+I`, cls: "italic", run: () => wrap("*") },
      { label: "S", title: `${tr("md.strike")} · Ctrl+U`, cls: "line-through", run: () => wrap("~~") },
      { label: "</>", title: `${tr("md.code")} · Ctrl+E`, run: () => wrap("`") },
    ],
    [
      { label: "•", title: `${tr("md.bullet")} · Ctrl+Shift+L`, run: () => prefixLines("- ") },
      { label: "1.", title: tr("md.numbered"), run: () => prefixLines("1. ") },
      { label: "☑", title: `${tr("md.task")} · Ctrl+Shift+T`, run: () => prefixLines("- [ ] ") },
      { label: "“", title: `${tr("md.quote")} · Ctrl+Shift+Q`, run: () => prefixLines("> ") },
    ],
    [
      { label: "[[ ]]", title: `${tr("md.nodeLink")} · Ctrl+Shift+K`, run: () => wrap("[[", "]]") },
      { label: "🔗", title: tr("md.link"), run: () => insertText("[](https://)", 1) },
      { label: "{ }", title: tr("md.codeBlock"), run: () => insertBlock("```\n\n```", 4) },
      { label: "▦", title: tr("md.table"), run: () => insertBlock(`| ${tr("md.col")} | ${tr("md.col")} |\n| --- | --- |\n|  |  |`, 0) },
      { label: "—", title: tr("md.hr"), run: () => insertBlock("---") },
    ],
  ];

  const empty = blocks.length === 0 || (blocks.length === 1 && !blocks[0].trim());

  return (
    <div ref={rootRef} className={className} data-testid="markdown-editor">
      {toolbar && (
        <div
          className={`flex items-center gap-1 shrink-0 ${
            toolbarScroll ? "flex-nowrap overflow-x-auto sw-no-scrollbar" : "flex-wrap"
          }`}
        >
          {tools.map((group, gi) => (
            <div key={gi} className="flex items-center gap-1 shrink-0">
              {gi > 0 && <span className="w-px h-4 mx-0.5" style={{ background: "var(--sw-border)" }} />}
              {group.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  title={b.title}
                  // Кнопка не должна забирать фокус: иначе к моменту нажатия
                  // выделение в тексте уже потеряно и оборачивать нечего.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(b.run)}
                  className={`min-w-[1.9rem] px-1.5 py-1 rounded border sw-border-c text-[11px] sw-text-dim sw-btn font-mono-sw ${b.cls || ""}`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className={`sw-mde ${listClassName}`}>
        {empty && active === null ? (
          <button
            type="button"
            data-testid="md-empty"
            onClick={() => startEdit(0, 0)}
            className="w-full text-left text-sm sw-text-dim py-1"
          >
            {placeholder || tr("md.placeholder")}
          </button>
        ) : (
          blocks.map((b, i) =>
            i === active ? (
              <textarea
                key={`edit-${i}`}
                ref={attach}
                data-testid="md-input"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  emit(blocksRef.current.map((x, idx) => (idx === i ? e.target.value : x)));
                  grow(e.target);
                }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={commit}
                rows={1}
                spellCheck
                className="sw-mde-input w-full bg-transparent resize-none overflow-hidden outline-none font-mono-sw"
              />
            ) : (
              <div
                key={`view-${i}`}
                role="presentation"
                data-testid="md-block"
                onClick={(e) => onBlockClick(e, i)}
                className={`sw-mde-block ${b.trim() ? "" : "sw-mde-empty"}`}
              >
                {b.trim() ? (
                  <MarkdownView text={b} nodes={nodes} onOpenNode={onOpenNode} onCreateNode={onCreateNode} />
                ) : null}
              </div>
            )
          )
        )}
        {/* Клик по пустому месту под текстом — новый абзац в конце. */}
        <div
          role="presentation"
          data-testid="md-tail"
          onClick={() => {
            const arr = blocksRef.current;
            if (arr.length && !arr[arr.length - 1].trim()) startEdit(arr.length - 1, "end");
            else if (arr.length) insertBlock("");
            else startEdit(0, 0);
          }}
          className="sw-mde-tail"
        />
      </div>
    </div>
  );
});

export default MarkdownEditor;
