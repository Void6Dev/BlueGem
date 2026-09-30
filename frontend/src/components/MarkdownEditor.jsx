import {
  forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo,
  useRef, useState,
} from "react";
import { Code2, FileText } from "lucide-react";
import { renderMarkdown } from "@/lib/miniMarkdown";
import { hotkey } from "@/lib/hotkey";
import { useT } from "@/lib/i18n";

/**
 * Описание узла — блокнот.
 *
 * Прошлая попытка выглядела так: поле ввода и подсветка разметки, лежащие друг
 * на друге. Строки совпадали до пикселя, курсор вставал куда надо — и всё
 * равно человек всё время смотрел на разметку, а не на текст. Звёздочки,
 * решётки и квадратные скобки нельзя было спрятать: спрятать знак значит
 * сдвинуть текст относительно поля ввода и потерять то самое совпадение.
 *
 * Здесь другая модель. Документ показан собранным — тем же разбором, что и на
 * карточке холста и в панели просмотра, — а правится тот блок, в который
 * ткнули: абзац, заголовок, пункт списка, таблица. Он один на всё время правки
 * превращается в обычное поле ввода со своей разметкой, остальные остаются
 * текстом. Ушли из блока — он снова собрался.
 *
 * Почему блоком, а не всем документом целиком: поле ввода остаётся настоящей
 * textarea. Курсор, выделение, отмена, автозамена и ввод иероглифов работают
 * сами — ничего из этого не пришлось бы переписывать, а в contenteditable
 * пришлось бы всё.
 *
 * Разметка целиком никуда не делась: кнопка справа показывает весь документ
 * исходником — с подсветкой, как было. Это и запасной выход, и способ выделить
 * и скопировать всё разом.
 */

const FENCE = /^\s*(```|~~~)/;
// Маркер строки списка или цитаты — то, что Enter должен продолжить сам.
const MARKER = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+\. |> )/;
const HEADING = /^(\s{0,3}#{1,6}\s+)(.*)$/;
const QUOTE = /^(\s*>\s?)(.*)$/;
const BULLET = /^(\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)(.*)$/;
const HR = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const SOURCE_KEY = "bluegem:mdSource";

/**
 * Разбить документ на блоки.
 *
 * Блок — то, что человек правит целиком. Границей служит пустая строка, внутри
 * ограды из кавычек её нет. Пустые строки остаются в конце своего блока,
 * поэтому склейка блоков возвращает исходный текст знак в знак — на этом всё
 * и держится: править можно один блок, а сохраняется всегда весь документ.
 */
export function splitBlocks(text) {
  const src = text || "";
  const out = [];
  let start = 0;
  let i = 0;
  let fence = null;
  let content = false;
  for (;;) {
    const nl = src.indexOf("\n", i);
    const end = nl === -1 ? src.length : nl;
    const line = src.slice(i, end);
    const f = FENCE.exec(line);
    if (fence) { if (f) fence = null; } else if (f) fence = f[1];
    const blank = !line.trim();
    if (!fence && blank && content) {
      const stop = nl === -1 ? src.length : nl + 1;
      out.push(src.slice(start, stop));
      start = stop;
      content = false;
    } else if (!blank) content = true;
    if (nl === -1) break;
    i = nl + 1;
  }
  if (start < src.length || !out.length) out.push(src.slice(start));
  // Пустые строки, набежавшие между блоками, отдаём предыдущему: сами по себе
  // они не блок, но из склейки исчезнуть не должны.
  const merged = [];
  for (const b of out) {
    if (!b.trim() && merged.length) merged[merged.length - 1] += b;
    else merged.push(b);
  }
  return merged;
}

/**
 * Склеить блоки обратно в документ.
 *
 * Не просто join: блок мог остаться без пустой строки на конце — например,
 * если его выделили целиком и набрали заново. Тогда он слипся бы со
 * следующим, и два абзаца стали бы одним прямо под руками. Разделитель
 * дописываем только там, где его не хватает.
 */
function joinBlocks(bs) {
  let out = "";
  for (let i = 0; i < bs.length; i += 1) {
    const b = bs[i];
    out += b;
    if (i < bs.length - 1 && b.trim() && !b.endsWith("\n")) out += "\n\n";
  }
  return out;
}

/**
 * Смещение в разметке по смещению в собранном тексте.
 *
 * Собранный текст — подпоследовательность разметки: разбор знаки убирает, но
 * не добавляет. Значит, достаточно идти по обеим строкам сразу, пропуская
 * в разметке всё, что до следующей совпавшей буквы, — и ткнувший в середину
 * абзаца попадает курсором ровно туда, куда ткнул.
 */
function sourceOffset(src, visible, upto) {
  let si = 0;
  for (let vi = 0; vi < upto && vi < visible.length; vi += 1) {
    const ch = visible[vi];
    while (si < src.length && src[si] !== ch) si += 1;
    si += 1;
  }
  return Math.min(si, src.length);
}

/** Сколько знаков собранного текста левее точки, куда ткнули. */
function visibleOffsetAt(root, x, y) {
  const range = document.caretRangeFromPoint
    ? document.caretRangeFromPoint(x, y)
    : document.caretPositionFromPoint?.(x, y);
  if (!range) return null;
  const node = range.startContainer || range.offsetNode;
  const offset = range.startOffset ?? range.offset ?? 0;
  if (!node || !root.contains(node)) return null;
  let seen = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cur = walker.nextNode();
  while (cur) {
    if (cur === node) return seen + offset;
    seen += cur.textContent.length;
    cur = walker.nextNode();
  }
  return seen;
}

/* ---------------- подсветка разметки (режим «разметка целиком») ----------------
   Порядок важен: `код` ловим первым, иначе звёздочки внутри него станут
   разметкой. Жирный до курсива по той же причине. */
const HL_INLINE = new RegExp([
  "`[^`\\n]+`",
  "\\*\\*[^\\n]+?\\*\\*",
  "__[^\\n]+?__",
  "~~[^\\n]+?~~",
  "\\*[^*\\n]+\\*",
  "\\[\\[[^\\]\\n]+\\]\\]",
  "\\[\\^[^\\]\\s]+\\]",
  "\\[[^\\]\\n]*\\]\\([^)\\n]*\\)",
].join("|"), "g");

/** Знак разметки и его содержимое: снаружи гасим, внутри показываем. */
function paired(tok, n, cls, key) {
  return (
    <span key={key} className={cls}>
      <span className="sw-hl-mark">{tok.slice(0, n)}</span>
      {tok.slice(n, tok.length - n)}
      <span className="sw-hl-mark">{tok.slice(tok.length - n)}</span>
    </span>
  );
}

function inlineToken(tok, key) {
  if (tok.startsWith("`")) return paired(tok, 1, "sw-hl-code", key);
  if (tok.startsWith("**") || tok.startsWith("__")) return paired(tok, 2, "sw-hl-strong", key);
  if (tok.startsWith("~~")) return paired(tok, 2, "sw-hl-del", key);
  if (tok.startsWith("[[")) return paired(tok, 2, "sw-hl-wiki", key);
  if (tok.startsWith("[^")) return <span key={key} className="sw-hl-wiki">{tok}</span>;
  if (tok.startsWith("[")) {
    const cut = tok.indexOf("](");
    return (
      <span key={key}>
        <span className="sw-hl-mark">[</span>
        <span className="sw-hl-wiki">{tok.slice(1, cut)}</span>
        <span className="sw-hl-mark">{tok.slice(cut)}</span>
      </span>
    );
  }
  return paired(tok, 1, "sw-hl-em", key);
}

function hlInline(text, key) {
  if (!text) return text;
  const out = [];
  let last = 0;
  for (const m of text.matchAll(HL_INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(inlineToken(m[0], `${key}-${m.index}`));
    last = m.index + m[0].length;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Одна строка документа. Внутри блока кода разметки нет — там текст дословный. */
function hlLine(text, key, inFence) {
  if (inFence || FENCE.test(text)) return <span className="sw-hl-fence">{text}</span>;
  if (HR.test(text)) return <span className="sw-hl-mark">{text}</span>;
  const h = text.match(HEADING);
  if (h) {
    return (
      <span className="sw-hl-head">
        <span className="sw-hl-mark">{h[1]}</span>
        {hlInline(h[2], key)}
      </span>
    );
  }
  const q = text.match(QUOTE);
  if (q) {
    return (
      <span className="sw-hl-quote">
        <span className="sw-hl-mark">{q[1]}</span>
        {hlInline(q[2], key)}
      </span>
    );
  }
  const b = text.match(BULLET);
  if (b) {
    return (
      <>
        <span className="sw-hl-bullet">{b[1]}</span>
        {hlInline(b[2], key)}
      </>
    );
  }
  if (text.trimStart().startsWith("|")) return <span className="sw-hl-table">{text}</span>;
  return hlInline(text, key);
}

/**
 * Подсветка. Перерисовывается на каждый набранный знак, поэтому вынесена в
 * отдельный memo: пока строка не менялась, дерево не пересобирается.
 */
const Highlight = memo(function Highlight({ text }) {
  const lines = text.split("\n");
  let fence = false;
  return (
    <div className="sw-mde-hl sw-mde-type" aria-hidden="true">
      {lines.map((raw, i) => {
        const opening = FENCE.test(raw);
        const inside = fence;
        if (opening) fence = !fence;
        return (
          // Перенос дописываем сами: без него строки склеились бы в одну.
          <span key={i}>{hlLine(raw, `l${i}`, inside && !opening)}{"\n"}</span>
        );
      })}
    </div>
  );
});

/** Заголовок правится своим кеглем: иначе щелчок по нему ронял бы строку вниз. */
function blockClass(source) {
  const h = HEADING.exec(source);
  if (h) return `sw-mde-h sw-mde-h${h[1].trim().length}`;
  if (QUOTE.test(source)) return "sw-mde-q";
  if (FENCE.test(source)) return "sw-mde-pre";
  return "";
}

/**
 * Собранный блок. memo по строке разметки: пока блок не правили, его дерево не
 * пересобирается — а пересобираться иначе пришлось бы всему документу на
 * каждую букву в соседнем абзаце.
 */
const Block = memo(function Block({ source, index, onActivate, view }) {
  const ref = useRef(null);
  const blank = !source.trim();

  // По отпусканию, а не по нажатию: иначе из собранного текста нельзя было бы
  // выделить кусок мышью — правка перехватывала бы протяжку в самом начале.
  // Выделили — значит выделяли, а не правили.
  const onMouseUp = (e) => {
    // Ссылка на узел остаётся ссылкой: по ней переходят, а не правят её.
    if (e.button !== 0 || e.target.closest("a, button, input")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const root = ref.current;
    const at = root ? visibleOffsetAt(root, e.clientX, e.clientY) : null;
    onActivate(index, at === null ? null : sourceOffset(source, root.textContent, at));
  };

  return (
    <div
      ref={ref}
      data-testid={`md-block-${index}`}
      className={`sw-mde-block sw-md sw-md-doc ${blank ? "is-blank" : ""}`}
      onMouseUp={onMouseUp}
    >
      {blank ? <p>&nbsp;</p> : renderMarkdown(source, view)}
    </div>
  );
});

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
  const [blocks, setBlocks] = useState(() => splitBlocks(value || ""));
  const [active, setActive] = useState(-1);
  // Режим разметки запоминается на всё приложение: это привычка человека,
  // а не свойство конкретного узла.
  const [source, setSource] = useState(() => {
    try {
      return localStorage.getItem(SOURCE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const taRef = useRef(null);
  const rootRef = useRef(null);
  const emitted = useRef(value);
  const pendingCaret = useRef(null);
  const pendingCmd = useRef(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // Текст пришёл извне (открыли другой узел, откатили правку) — принимаем.
  // Свои же изменения сюда не попадают: их строку мы помним в emitted.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setBlocks(splitBlocks(value || ""));
    setActive(-1);
  }, [value]);

  const emit = useCallback((next) => {
    emitted.current = next;
    onChange(next);
  }, [onChange]);

  /** Заменить разметку одного блока, не трогая остальные. */
  const setBlock = useCallback((index, text) => {
    const next = blocksRef.current.slice();
    next[index] = text;
    setBlocks(next);
    emit(joinBlocks(next));
  }, [emit]);

  const activate = useCallback((index, caret) => {
    pendingCaret.current = caret;
    setActive(index);
  }, []);

  /**
   * Ушли из блока. Через сравнение с текущим, а не просто в «никто не правится»:
   * щелчок по соседнему блоку сначала назначает правимым его, и только потом
   * прежнее поле теряет фокус — без сверки оно погасило бы уже чужой выбор.
   */
  const deactivate = useCallback((index) => {
    setActive((cur) => (cur === index ? -1 : cur));
  }, []);

  // Поле ввода появилось — ставим в него курсор туда, куда ткнули.
  useLayoutEffect(() => {
    if (active < 0) return;
    const el = taRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const at = pendingCaret.current;
    pendingCaret.current = null;
    const pos = at === null || at === undefined ? el.value.length : Math.min(at, el.value.length);
    el.setSelectionRange(pos, pos);
    const cmd = pendingCmd.current;
    pendingCmd.current = null;
    cmd?.();
  }, [active]);

  // Высота поля — по тексту: блок в документе не прокручивается внутри себя,
  // он просто занимает столько строк, сколько в нём есть.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el || active < 0 || source) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [active, source, blocks]);

  // Вышли из правки — документ пересобираем: границы блоков могли сдвинуться.
  // Сравнение по содержимому обязательно: без него обновление зациклится.
  useEffect(() => {
    if (active >= 0 || source) return;
    setBlocks((bs) => {
      const fresh = splitBlocks(joinBlocks(bs));
      const same = fresh.length === bs.length && fresh.every((b, i) => b === bs[i]);
      return same ? bs : fresh;
    });
  }, [active, source]);

  const openEditor = useCallback((cmd) => {
    pendingCmd.current = cmd || null;
    if (source) {
      setSource(false);
      try { localStorage.setItem(SOURCE_KEY, "0"); } catch { /* приватный режим */ }
    }
    setActive((cur) => (cur >= 0 ? cur : Math.max(0, blocksRef.current.length - 1)));
  }, [source]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (taRef.current) taRef.current.focus({ preventScroll: true });
      else openEditor();
    },
    element: () => rootRef.current,
  }), [openEditor]);

  /* ---------------- правки текста ---------------- */

  const apply = (next, from, to) => {
    const el = taRef.current;
    if (source) {
      setBlocks([next]);
      emit(next);
    } else {
      setBlock(active, next);
    }
    if (!el) return;
    // Значение ставим сразу, не дожидаясь перерисовки: иначе выделение легло бы
    // на прежний текст и уехало бы на длину вставки.
    el.value = next;
    el.focus({ preventScroll: true });
    if (from != null) el.setSelectionRange(from, to ?? from);
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
    const l = v.slice(from, to);
    const bare = l.replace(/^\s{0,3}#{1,6}\s+/, "");
    const same = new RegExp(`^\\s{0,3}#{${level}}\\s`).test(l);
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

  /**
   * Линейка, таблица, блок кода: им нужна пустая строка сверху и снизу, иначе
   * markdown приклеит их к соседнему абзацу. Вставляем с конца текущей строки,
   * а не прямо под курсором, — разрывать фразу пополам никто не просил.
   */
  const insertBlock = (chunk, caretBack = 0) => {
    const el = taRef.current;
    if (!el) return;
    const { selectionStart: s, value: v } = el;
    const eol = v.indexOf("\n", s) === -1 ? v.length : v.indexOf("\n", s);
    const head = v.slice(0, eol);
    const tail = v.slice(eol);
    const before = head.trim() ? "\n\n" : "";
    const next = head + before + chunk + (tail.trim() ? "\n\n" : "") + tail.replace(/^\n+/, "");
    const at = head.length + before.length + chunk.length - caretBack;
    apply(next, at);
  };

  /** Сдвиг выделенных строк списка вправо или влево — Tab и Shift+Tab. */
  const shiftLines = (out) => {
    const el = taRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const from = v.lastIndexOf("\n", s - 1) + 1;
    const toRaw = v.indexOf("\n", e);
    const to = toRaw === -1 ? v.length : toRaw;
    const patched = v.slice(from, to).split("\n")
      .map((l) => (out ? l.replace(/^ {1,2}/, "") : `  ${l}`))
      .join("\n");
    const next = v.slice(0, from) + patched + v.slice(to);
    apply(next, from, from + patched.length);
  };

  /* ---------------- клавиатура ---------------- */

  const onKeyDown = (e) => {
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: sEnd, value: v } = el;
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

    // Tab в блокноте — это отступ пункта, а не прыжок на следующее поле.
    // Уйти с поля клавиатурой всё равно можно: Escape, потом Tab.
    if (e.key === "Tab") {
      e.preventDefault();
      shiftLines(e.shiftKey);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      el.blur();
      // Не только blur: закрывать правку по одной лишь потере фокуса — значит
      // зависеть от того, что фокус вообще куда-то ушёл. Escape обязан
      // возвращать документ сам.
      if (!source) deactivate(active);
      return;
    }

    // Стрелками ходим по документу, а не только внутри блока: на границе
    // соседний блок открывается сам. Иначе клавиатурой из абзаца не выйти.
    if (!source && (e.key === "ArrowUp" || e.key === "ArrowDown") && s === sEnd) {
      const up = e.key === "ArrowUp";
      const edge = up ? v.lastIndexOf("\n", s - 1) === -1 : v.indexOf("\n", s) === -1;
      const next = active + (up ? -1 : 1);
      if (edge && next >= 0 && next < blocksRef.current.length) {
        e.preventDefault();
        activate(next, up ? undefined : 0);
        return;
      }
    }

    // Enter — обычный перенос строки. Отдельно только списки: продолжать
    // нумерацию и галочки руками никто не станет.
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      if (FENCE.test(v.slice(v.lastIndexOf("\n", s - 1) + 1))) return;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const l = v.slice(lineStart, s);
      const m = l.match(MARKER);
      if (!m) return;
      e.preventDefault();
      const marker = m[0];
      if (l.length === marker.length) {
        // Пустой пункт — список закончился, маркер убираем.
        const next = `${v.slice(0, lineStart)}\n${v.slice(s)}`;
        apply(next, lineStart + 1);
        return;
      }
      const nextMarker = marker
        .replace(/\[[xX]\]/, "[ ]")
        .replace(/^(\s*)(\d+)\./, (_, sp, num) => `${sp}${Number(num) + 1}.`);
      insertText(`\n${nextMarker}`);
    }
  };

  /* ---------------- панель разметки ---------------- */

  const run = (fn) => {
    if (!source && active >= 0 && taRef.current) { fn(); return; }
    openEditor(fn);
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
      { label: "[^]", title: tr("md.footnote"), run: () => insertText("[^1]") },
      { label: "{ }", title: tr("md.codeBlock"), run: () => insertBlock("```\n\n```", 4) },
      { label: "▦", title: tr("md.table"), run: () => insertBlock(`| ${tr("md.col")} | ${tr("md.col")} |\n| --- | --- |\n|  |  |`) },
      { label: "—", title: tr("md.hr"), run: () => insertBlock("---") },
    ],
  ];

  const toggleSource = () => {
    const next = !source;
    // Из разметки — собираем документ заново; в разметку — склеиваем как есть.
    setBlocks((bs) => (next ? [joinBlocks(bs)] : splitBlocks(joinBlocks(bs))));
    setActive(-1);
    setSource(next);
    try { localStorage.setItem(SOURCE_KEY, next ? "1" : "0"); } catch { /* приватный режим */ }
  };

  // Одним объектом и по памяти: он лежит в свойствах каждого собранного блока,
  // и новый на каждый набранный знак пересобирал бы весь документ.
  const view = useMemo(() => {
    const byTitle = {};
    for (const n of nodes) if (n.title) byTitle[n.title.trim().toLowerCase()] = n.id;
    return {
      doc: true,
      nodesByTitle: byTitle,
      onOpenNode,
      onCreateNode,
      createTitle: (title) => tr("markdown.createNode", { title }),
      missingTitle: tr("markdown.missingNode"),
    };
  }, [nodes, onOpenNode, onCreateNode, tr]);

  const SourceIcon = source ? FileText : Code2;
  const text = joinBlocks(blocks);

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
          <button
            type="button"
            data-testid="md-source-toggle"
            title={tr(source ? "md.document" : "md.source")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleSource}
            className="ml-auto shrink-0 flex items-center gap-1 px-1.5 py-1 rounded border sw-border-c text-[11px] sw-text-dim sw-btn"
            style={source ? { color: "var(--sw-accent)", borderColor: "var(--sw-accent)" } : undefined}
          >
            <SourceIcon className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className={`sw-mde ${listClassName}`}>
        {source ? (
          /* Подсветка и поле ввода — один слой на другом. Высоту задаёт
             подсветка, поле растянуто по всему блоку: щелчок ниже последней
             строки ставит курсор в конец, и никакой подгонки высоты не нужно. */
          <div className="sw-mde-stack">
            <Highlight text={text} />
            <textarea
              ref={taRef}
              data-testid="md-input"
              className="sw-mde-input sw-mde-type"
              value={text}
              placeholder={placeholder || tr("md.placeholder")}
              onChange={(e) => { setBlocks([e.target.value]); emit(e.target.value); }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              spellCheck
            />
          </div>
        ) : (
          <div
            className="sw-mde-doc"
            data-testid="md-doc"
            // Щелчок ниже последнего блока ставит курсор в конец документа —
            // как в блокноте, где под текстом всегда есть куда ткнуть.
            onMouseUp={(e) => {
              if (e.target !== e.currentTarget) return;
              const sel = window.getSelection();
              if (sel && !sel.isCollapsed) return;
              activate(blocksRef.current.length - 1, undefined);
            }}
          >
            {blocks.length === 1 && !blocks[0].trim() && active < 0 ? (
              <p
                className="sw-mde-placeholder"
                onMouseDown={(e) => { e.preventDefault(); activate(0, 0); }}
              >
                {placeholder || tr("md.placeholder")}
              </p>
            ) : blocks.map((src, i) => (i === active ? (
              <textarea
                key={`edit-${i}`}
                ref={taRef}
                data-testid="md-input"
                className={`sw-mde-edit sw-md-doc ${blockClass(src)}`}
                value={src}
                rows={1}
                onChange={(e) => setBlock(i, e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={() => deactivate(i)}
                spellCheck
              />
            ) : (
              <Block
                key={i}
                index={i}
                source={src}
                onActivate={activate}
                view={view}
              />
            )))}
          </div>
        )}
      </div>
    </div>
  );
});

export default MarkdownEditor;
