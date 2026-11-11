import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Bold, Check, CheckSquare, Code2, FileText, Heading, Italic, Link2, List, ListOrdered,
  Minus, Quote, Strikethrough, Table2,
} from "lucide-react";
import {
  Annotation, Compartment, EditorSelection, EditorState, Prec, StateEffect, Transaction,
} from "@codemirror/state";
import {
  Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder as cmPlaceholder, tooltips,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { LanguageSupport, syntaxTree } from "@codemirror/language";
import { markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { useT } from "@/lib/i18n";
import { haptic, useIsMobile } from "@/lib/platform";
import "@/components/markdown-editor.css";

/**
 * Описание узла — блокнот с живым оформлением, как в Obsidian.
 *
 * Пишут обычный текст, а видят его уже оформленным: заголовок крупным, жирный
 * жирным, пункты списка с точками, задачи с галочками, [[ссылки на узлы]]
 * плашками. Значки разметки появляются только в той строке, где стоит курсор,
 * — там их и правят; в остальных строках их нет. Ушли из поля — весь текст
 * показан собранным.
 *
 * Прошлый блокнот превращал абзац под пальцем в поле с сырой разметкой и
 * обратно; на телефоне это было мучением. Здесь поле одно на весь текст,
 * и это CodeMirror — тот же движок, что у Obsidian: ввод с телефонной
 * клавиатуры, автозамена, выделение и отмена работают так, как ждёт система.
 *
 * Хранится по-прежнему markdown, знак в знак: редактор ничего не переписывает
 * сам, только показывает. Старые описания открываются как были.
 */

/* ------------------------------------------------------------------ */
/* Живое оформление                                                    */
/* ------------------------------------------------------------------ */

const refresh = StateEffect.define();
// Текст, пришедший снаружи (отмена в редакторе узла, откат), — не правка
// человека: его не надо ни отдавать обратно, ни класть в историю отмены.
const external = Annotation.define();
const hide = Decoration.replace({});
const mark = (cls) => Decoration.mark({ class: cls });
const lineDeco = (cls) => Decoration.line({ class: cls });
const MARKER = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;
const WIKI = /\[\[([^\]\n]+?)\]\]/g;

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-bullet";
    s.textContent = "•";
    return s;
  }
}

class CheckWidget extends WidgetType {
  constructor(checked, pos) {
    super();
    this.checked = checked;
    this.pos = pos;
  }
  eq(o) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM(view) {
    const box = document.createElement("span");
    box.className = `cm-md-check${this.checked ? " is-on" : ""}`;
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    const toggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      haptic("tick");
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    };
    box.addEventListener("mousedown", toggle);
    return box;
  }
  ignoreEvent() { return true; }
}

class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-hr";
    return s;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });

/** Строки, в которых сейчас курсор или выделение: в них разметка видна. */
function activeLines(view) {
  const out = new Set();
  if (!view.hasFocus) return out;
  const { doc } = view.state;
  for (const r of view.state.selection.ranges) {
    const last = doc.lineAt(r.to).number;
    for (let n = doc.lineAt(r.from).number; n <= last; n += 1) out.add(n);
  }
  return out;
}

function inCode(tree, pos) {
  for (let n = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "InlineCode" || n.name === "FencedCode" || n.name === "CodeBlock") return true;
  }
  return false;
}

function build(view, ctx) {
  const { state } = view;
  const { doc } = state;
  const tree = syntaxTree(state);
  const active = activeLines(view);
  const isActive = (pos) => active.has(doc.lineAt(pos).number);
  const out = [];
  const lines = (from, to, cls) => {
    const last = doc.lineAt(to).number;
    for (let n = doc.lineAt(from).number; n <= last; n += 1) out.push(lineDeco(cls).range(doc.line(n).from));
  };
  /** Значок разметки: вне строки с курсором — спрятать, в ней — приглушить. */
  const markOrHide = (from, to, withSpace = false) => {
    if (to <= from) return;
    if (isActive(from)) { out.push(mark("cm-md-mark").range(from, to)); return; }
    const end = withSpace && doc.sliceString(to, to + 1) === " " ? to + 1 : to;
    out.push(hide.range(from, end));
  };

  for (const { from, to } of view.visibleRanges) {
    // [[Ссылки]] — первыми: разбор markdown видит в них обычные скобки, и
    // его правила для ссылок их задевать не должны.
    const wiki = [];
    const text = doc.sliceString(from, to);
    WIKI.lastIndex = 0;
    for (let m = WIKI.exec(text); m; m = WIKI.exec(text)) {
      const a = from + m.index;
      const b = a + m[0].length;
      if (inCode(tree, a)) continue;
      wiki.push([a, b]);
      const title = m[1].trim();
      const known = ctx.current.byTitle.has(title.toLowerCase());
      const live = !isActive(a);
      const cls = `cm-md-wiki${known ? "" : " is-missing"}${live ? " is-link" : ""}`;
      const attrs = { class: cls, "data-wiki": title };
      if (live) {
        out.push(hide.range(a, a + 2));
        out.push(Decoration.mark({ attributes: attrs }).range(a + 2, b - 2));
        out.push(hide.range(b - 2, b));
      } else {
        out.push(Decoration.mark({ attributes: attrs }).range(a, b));
      }
    }
    const clash = (a, b) => wiki.some(([x, y]) => a < y && b > x);

    tree.iterate({
      from,
      to,
      enter: (node) => {
        const { name } = node;
        if (clash(node.from, node.to) && /^(Link|LinkMark|URL|LinkLabel)$/.test(name)) return false;
        const h = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (h) { lines(node.from, node.to, `cm-md-h${h[1]}`); return undefined; }
        switch (name) {
          case "HeaderMark":
            if (node.node.parent?.name.startsWith("ATX")) markOrHide(node.from, node.to, true);
            else out.push(mark("cm-md-mark").range(node.from, node.to));
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
            markOrHide(node.from, node.to);
            break;
          case "CodeMark":
            if (node.node.parent?.name === "InlineCode") markOrHide(node.from, node.to);
            else lines(node.from, node.to, "cm-md-fence");
            break;
          case "CodeInfo":
            out.push(mark("cm-md-mark").range(node.from, node.to));
            break;
          case "StrongEmphasis": out.push(mark("cm-md-strong").range(node.from, node.to)); break;
          case "Emphasis": out.push(mark("cm-md-em").range(node.from, node.to)); break;
          case "Strikethrough": out.push(mark("cm-md-strike").range(node.from, node.to)); break;
          case "InlineCode": out.push(mark("cm-md-code").range(node.from, node.to)); break;
          case "Link": out.push(mark("cm-md-link").range(node.from, node.to)); break;
          case "LinkMark":
            if (node.node.parent?.name === "Link") markOrHide(node.from, node.to);
            break;
          case "URL":
            if (node.node.parent?.name === "Link") markOrHide(node.from, node.to);
            break;
          case "LinkTitle":
            markOrHide(node.from, node.to);
            break;
          case "Blockquote": lines(node.from, node.to, "cm-md-quote"); break;
          case "QuoteMark": markOrHide(node.from, node.to, true); break;
          case "ListMark": {
            const item = node.node.parent;
            const list = item?.parent?.name;
            // У задачи вместо точки — галочка, как в Obsidian: две отметки
            // на одной строке только спорили бы друг с другом.
            if (list === "BulletList" && !isActive(node.from) && item?.getChild("Task")) {
              markOrHide(node.from, node.to, true);
            } else if (list === "BulletList" && !isActive(node.from)) out.push(bullet.range(node.from, node.to));
            else out.push(mark(list === "OrderedList" ? "cm-md-olmark" : "cm-md-mark").range(node.from, node.to));
            break;
          }
          case "TaskMarker":
            if (!isActive(node.from)) {
              const checked = /x/i.test(doc.sliceString(node.from, node.to));
              out.push(Decoration.replace({ widget: new CheckWidget(checked, node.from) }).range(node.from, node.to));
            }
            break;
          case "FencedCode":
          case "CodeBlock":
            lines(node.from, node.to, "cm-md-codeblock");
            break;
          case "HorizontalRule":
            if (!isActive(node.from)) out.push(rule.range(node.from, node.to));
            else out.push(mark("cm-md-mark").range(node.from, node.to));
            break;
          case "Table": lines(node.from, node.to, "cm-md-table"); break;
          default:
        }
        return undefined;
      },
    });
  }
  return Decoration.set(out, true);
}

function livePreview(ctx) {
  return ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = build(view, ctx); }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged
        || syntaxTree(u.startState) !== syntaxTree(u.state)
        || u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))) {
        this.decorations = build(u.view, ctx);
      }
    }
  }, {
    decorations: (v) => v.decorations,
    eventHandlers: {
      // [[Ссылка]] вне строки с курсором — переход к узлу, как в Obsidian.
      // Чтобы поправить саму ссылку, ставят курсор в её строку.
      mousedown(e) {
        const el = e.target.closest?.(".cm-md-wiki.is-link");
        if (!el) return false;
        e.preventDefault();
        ctx.current.follow(el.dataset.wiki);
        return true;
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Правки по кнопкам и клавишам                                         */
/* ------------------------------------------------------------------ */

function wrap(view, before, after = before) {
  const { state } = view;
  view.dispatch(state.changeByRange((r) => {
    const outside = state.sliceDoc(r.from - before.length, r.from) === before
      && state.sliceDoc(r.to, r.to + after.length) === after;
    if (outside) {
      return {
        changes: [{ from: r.from - before.length, to: r.from }, { from: r.to, to: r.to + after.length }],
        range: EditorSelection.range(r.from - before.length, r.to - before.length),
      };
    }
    return {
      changes: [{ from: r.from, insert: before }, { from: r.to, insert: after }],
      range: EditorSelection.range(r.from + before.length, r.to + before.length),
    };
  }), { scrollIntoView: true, userEvent: "input.format" });
  view.focus();
  return true;
}

/** Заголовок, список, цитата — префикс каждой задетой строки; повтор снимает. */
function prefixLines(view, prefix) {
  const { state } = view;
  const nums = new Set();
  for (const r of state.selection.ranges) {
    const last = state.doc.lineAt(r.to).number;
    for (let n = state.doc.lineAt(r.from).number; n <= last; n += 1) nums.add(n);
  }
  const ls = [...nums].sort((a, b) => a - b).map((n) => state.doc.line(n));
  const same = (text) => (prefix === "1. " ? /^\s*\d+[.)] /.test(text) && !/\[[ xX]\]/.test(text) : text.trimStart().startsWith(prefix));
  const already = ls.every((l) => same(l.text));
  let k = 0;
  const changes = ls.map((l) => {
    const m = MARKER.exec(l.text);
    const len = m ? m[0].length : 0;
    if (already) return { from: l.from, to: l.from + len, insert: "" };
    k += 1;
    return { from: l.from, to: l.from + len, insert: prefix === "1. " ? `${k}. ` : prefix };
  });
  applyKeepingCaret(view, changes);
  return true;
}

/**
 * Правка в начале строк с курсором, который едет вместе с текстом.
 * Без этого вставка ровно в позицию курсора оставляет его перед вставленным
 * («## » оказывалось после набранного заголовка).
 */
function applyKeepingCaret(view, spec) {
  const { state } = view;
  const changes = state.changes(spec);
  view.dispatch({
    changes,
    selection: state.selection.map(changes, 1),
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
}

/** level: 1–6, или "cycle" — нет → H1 → H2 → H3 → нет (кнопка на телефоне). */
function heading(view, level) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = /^\s{0,3}(#{1,6})\s+/.exec(line.text);
  const cur = m ? m[1].length : 0;
  const next = level === "cycle" ? (cur >= 3 ? 0 : cur + 1) : (cur === level ? 0 : level);
  applyKeepingCaret(view, {
    from: line.from, to: line.from + (m ? m[0].length : 0), insert: next ? `${"#".repeat(next)} ` : "",
  });
  return true;
}

/** Линейка, таблица, блок кода: с пустой строкой сверху и снизу. */
function insertBlock(view, chunk, caretBack = 0) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const before = line.text.trim() ? "\n\n" : "";
  const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  const after = nextLine && nextLine.text.trim() ? "\n\n" : "";
  const insert = before + chunk + after;
  const at = line.to + before.length + chunk.length - caretBack;
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: at }, scrollIntoView: true });
  view.focus();
  return true;
}

function insertText(view, text, caretBack = 0) {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length - caretBack } });
  view.focus();
  return true;
}

/** [[ — подсказка из названий узлов проекта. */
function wikiCompletion(ctx) {
  return (context) => {
    const m = context.matchBefore(/\[\[[^\]\n]*$/);
    if (!m) return null;
    const q = m.text.slice(2).trim().toLowerCase();
    const titles = ctx.current.titles;
    const picked = (q ? titles.filter((t) => t.toLowerCase().includes(q)) : titles)
      .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
      .slice(0, 40);
    if (!picked.length) return null;
    return {
      from: m.from + 2,
      filter: false,
      options: picked.map((title) => ({
        label: title,
        type: "text",
        apply: (view, _c, from, to) => {
          const close = view.state.sliceDoc(to, to + 2) === "]]" ? "" : "]]";
          view.dispatch({
            changes: { from, to, insert: title + close },
            selection: { anchor: from + title.length + 2 },
          });
        },
      })),
    };
  };
}

const formatKeymap = [
  { key: "Mod-b", run: (v) => wrap(v, "**") },
  { key: "Mod-i", run: (v) => wrap(v, "*") },
  { key: "Mod-e", run: (v) => wrap(v, "`") },
  { key: "Mod-u", run: (v) => wrap(v, "~~") },
  { key: "Mod-Shift-k", run: (v) => wrap(v, "[[", "]]") },
  { key: "Mod-Shift-l", run: (v) => prefixLines(v, "- ") },
  { key: "Mod-Shift-t", run: (v) => prefixLines(v, "- [ ] ") },
  { key: "Mod-Shift-q", run: (v) => prefixLines(v, "> ") },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ key: `Mod-${n}`, run: (v) => heading(v, n) })),
  // Esc — выйти из правки, не закрывая панель: это решение принимает человек.
  { key: "Escape", run: (v) => { v.contentDOM.blur(); return true; } },
];

/* ------------------------------------------------------------------ */
/* Компонент                                                           */
/* ------------------------------------------------------------------ */

const SOURCE_KEY = "bluegem:mdSource";
const preview = new Compartment();

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
    toolbarScroll = false,
    large = false,
  },
  ref
) {
  const tr = useT();
  const mobile = useIsMobile();
  const hostRef = useRef(null);
  const rootRef = useRef(null);
  const viewRef = useRef(null);
  const emitted = useRef(value || "");
  const [focused, setFocused] = useState(false);
  const [source, setSource] = useState(() => {
    try { return localStorage.getItem(SOURCE_KEY) === "1"; } catch { return false; }
  });

  // Всё, что меняется без пересоздания редактора: узлы, обработчики.
  const ctx = useRef({ byTitle: new Map(), titles: [], follow: () => {} });
  const handlers = useRef({ onChange, onPaste });
  handlers.current = { onChange, onPaste };
  const byTitle = useMemo(() => {
    const map = new Map();
    for (const n of nodes) if (n.title) map.set(n.title.trim().toLowerCase(), n.id);
    return map;
  }, [nodes]);
  ctx.current.byTitle = byTitle;
  ctx.current.titles = useMemo(() => nodes.map((n) => n.title).filter(Boolean), [nodes]);
  ctx.current.follow = (title) => {
    const id = byTitle.get(String(title || "").trim().toLowerCase());
    if (id) onOpenNode?.(id);
    else if (title) onCreateNode?.(title);
  };

  // Редактор — один на всё время жизни компонента.
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value || "",
        extensions: [
          history(),
          EditorView.lineWrapping,
          new LanguageSupport(markdownLanguage),
          Prec.high(keymap.of([...formatKeymap, ...markdownKeymap])),
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
          autocompletion({ override: [wikiCompletion(ctx)], icons: false, activateOnTyping: true }),
          // Подсказки — в корне страницы: внутри шторки у предков есть
          // transform, и position: fixed отсчитывался бы не от экрана.
          tooltips({ parent: document.body, position: "fixed" }),
          preview.of(source ? [] : livePreview(ctx)),
          cmPlaceholder(placeholder || tr("md.placeholder")),
          EditorView.contentAttributes.of({
            spellcheck: "true", autocorrect: "on", autocapitalize: "sentences", "data-testid": "md-input",
          }),
          // Телефон: курсор не должен прятаться под панелью кнопок над
          // клавиатурой. Запас снизу у самого поля (см. markdown-editor.css)
          // той же высоты — иначе нижние строки короткого поля считались бы
          // «за краем», и подсказка [[узлов]] у них не показывалась.
          EditorView.scrollMargins.of((v) => (
            v.hasFocus && document.documentElement.classList.contains("sw-is-mobile") ? { bottom: 64 } : null
          )),
          EditorView.updateListener.of((u) => {
            if (u.focusChanged) setFocused(u.view.hasFocus);
            if (!u.docChanged) return;
            if (u.transactions.some((t) => t.annotation(external))) return;
            const text = u.state.doc.toString();
            emitted.current = text;
            handlers.current.onChange?.(text);
          }),
          EditorView.domEventHandlers({
            paste: (e) => { handlers.current.onPaste?.(e); return e.defaultPrevented; },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line
  }, []);

  // Текст пришёл извне (другой узел, откат правки) — заменяем целиком.
  useEffect(() => {
    const view = viewRef.current;
    const next = value || "";
    if (!view || next === emitted.current) return;
    emitted.current = next;
    const head = Math.min(view.state.selection.main.head, next.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: head },
      annotations: [external.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  // Названия узлов сменились — перекрасить [[ссылки]] (есть такой узел или нет).
  useEffect(() => { viewRef.current?.dispatch({ effects: refresh.of(null) }); }, [byTitle]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
    },
    element: () => rootRef.current,
  }), []);

  const toggleSource = () => {
    const next = !source;
    setSource(next);
    try { localStorage.setItem(SOURCE_KEY, next ? "1" : "0"); } catch { /* приватный режим */ }
    viewRef.current?.dispatch({ effects: preview.reconfigure(next ? [] : livePreview(ctx)) });
  };

  const act = (fn) => () => { const v = viewRef.current; if (v) { haptic("tick"); fn(v); } };
  const tools = [
    { id: "h", icon: Heading, title: tr("md.h1"), run: (v) => heading(v, mobile ? "cycle" : 1) },
    { id: "b", icon: Bold, title: `${tr("md.bold")} · Ctrl+B`, run: (v) => wrap(v, "**") },
    { id: "i", icon: Italic, title: `${tr("md.italic")} · Ctrl+I`, run: (v) => wrap(v, "*") },
    { id: "s", icon: Strikethrough, title: `${tr("md.strike")} · Ctrl+U`, run: (v) => wrap(v, "~~") },
    { id: "ul", icon: List, title: `${tr("md.bullet")} · Ctrl+Shift+L`, run: (v) => prefixLines(v, "- ") },
    { id: "ol", icon: ListOrdered, title: tr("md.numbered"), run: (v) => prefixLines(v, "1. ") },
    { id: "task", icon: CheckSquare, title: `${tr("md.task")} · Ctrl+Shift+T`, run: (v) => prefixLines(v, "- [ ] ") },
    { id: "q", icon: Quote, title: `${tr("md.quote")} · Ctrl+Shift+Q`, run: (v) => prefixLines(v, "> ") },
    { id: "wiki", label: "[[ ]]", title: `${tr("md.nodeLink")} · Ctrl+Shift+K`, run: (v) => wrap(v, "[[", "]]") },
    { id: "code", icon: Code2, title: `${tr("md.code")} · Ctrl+E`, run: (v) => wrap(v, "`") },
    { id: "link", icon: Link2, title: tr("md.link"), run: (v) => insertText(v, "[](https://)", 1), desktop: true },
    { id: "table", icon: Table2, title: tr("md.table"), run: (v) => insertBlock(v, `| ${tr("md.col")} | ${tr("md.col")} |\n| --- | --- |\n|  |  |`), desktop: true },
    { id: "hr", icon: Minus, title: tr("md.hr"), run: (v) => insertBlock(v, "---"), desktop: true },
  ];
  // Кнопка не должна забирать фокус у текста: иначе выделение уже потеряно,
  // а на телефоне ещё и прячется клавиатура.
  const keep = (e) => e.preventDefault();

  const SourceIcon = source ? FileText : Code2;

  return (
    <div ref={rootRef} className={`sw-lmd ${large ? "is-large" : ""} ${className}`} data-testid="markdown-editor">
      {toolbar && !mobile && (
        <div
          className={`sw-lmd-tools ${toolbarScroll ? "is-scroll" : ""}`}
          onMouseDown={keep}
        >
          {tools.map((b) => (
            <button
              key={b.id}
              type="button"
              title={b.title}
              data-testid={`md-tool-${b.id}`}
              onClick={act(b.run)}
              className="sw-lmd-tool"
            >
              {b.icon ? <b.icon className="w-3.5 h-3.5" /> : b.label}
            </button>
          ))}
          <button
            type="button"
            data-testid="md-source-toggle"
            title={tr(source ? "md.document" : "md.source")}
            onClick={toggleSource}
            className={`sw-lmd-tool ml-auto ${source ? "is-on" : ""}`}
          >
            <SourceIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div ref={hostRef} className={`sw-lmd-host ${listClassName}`} />

      {/* Телефон: кнопки оформления — над клавиатурой, пока пишут. Справа
          «Готово» прячет клавиатуру и показывает текст собранным. */}
      {mobile && focused && createPortal(
        <div className="sw-lmd-kbar" data-testid="md-keyboard-bar" onPointerDown={keep} onMouseDown={keep}>
          <div className="sw-lmd-kbar-scroll">
            {tools.filter((b) => !b.desktop).map((b) => (
              <button key={b.id} type="button" onClick={act(b.run)} aria-label={b.title} className="sw-lmd-kbtn">
                {b.icon ? <b.icon className="w-[19px] h-[19px]" /> : <span className="text-[13px] font-semibold">{b.label}</span>}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="sw-lmd-kdone"
            data-testid="md-done"
            onClick={() => viewRef.current?.contentDOM.blur()}
          >
            <Check className="w-[18px] h-[18px]" />
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
});

export default MarkdownEditor;
