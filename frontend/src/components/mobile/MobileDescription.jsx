import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold, Check, CheckSquare, Heading, Italic, List, ListOrdered, Pencil, Quote, Strikethrough,
} from "lucide-react";
import Sheet from "@/components/mobile/Sheet";
import MarkdownView from "@/components/MarkdownView";
import { useT } from "@/lib/i18n";
import { haptic } from "@/lib/platform";

/**
 * Описание узла на телефоне.
 *
 * Читается собранным — заголовки, жирный, списки, [[ссылки]] плашками. Касание
 * открывает лист для письма во весь экран, и пишут в нём в обычное системное
 * поле ввода. Именно в обычное: редактор с живым оформлением держится на
 * contenteditable, а это самое хрупкое место телефонных клавиатур — на части
 * устройств русская раскладка в нём просто не печатала. Системное поле
 * работает с любой клавиатурой, любым языком, голосовым вводом и на самом
 * старом телефоне, и не тормозит на длинном тексте.
 *
 * Кнопки оформления — над клавиатурой; набрали [[ — над ними строка узлов.
 * «Готово» — и текст снова собран.
 */

const MARKER = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;

function lineBounds(v, s, e = s) {
  const from = v.lastIndexOf("\n", s - 1) + 1;
  const end = v.indexOf("\n", e);
  return [from, end === -1 ? v.length : end];
}

export default function MobileDescription({ value, onChange, nodes = [], onOpenNode, onCreateNode, placeholder }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="sw-mdesc"
        data-testid="mobile-desc"
        onClick={(e) => {
          // Ссылки и галочки внутри собранного текста живут своей жизнью.
          if (e.target.closest("a, button[data-node], [data-node-id], input")) return;
          haptic("light");
          setOpen(true);
        }}
      >
        {value?.trim() ? (
          <MarkdownView text={value} nodes={nodes} onOpenNode={onOpenNode} onCreateNode={onCreateNode} />
        ) : (
          <span className="sw-mdesc-empty">{placeholder || t("md.placeholder")}</span>
        )}
        <span className="sw-mdesc-pen"><Pencil className="w-3.5 h-3.5" /></span>
      </button>
      {open && (
        <Writer
          value={value || ""}
          onChange={onChange}
          nodes={nodes}
          placeholder={placeholder || t("md.placeholder")}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Writer({ value, onChange, nodes, placeholder, onClose }) {
  const t = useT();
  const ta = useRef(null);
  const [query, setQuery] = useState(null); // текст после [[ или null

  // Курсор — в конец, клавиатура — сразу: лист открыли, чтобы писать.
  useEffect(() => {
    const el = ta.current;
    if (!el) return undefined;
    const id = setTimeout(() => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 320);
    return () => clearTimeout(id);
  }, []);

  const titles = useMemo(() => nodes.map((n) => n.title).filter(Boolean), [nodes]);
  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.trim().toLowerCase();
    return titles
      .filter((x) => !q || x.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
      .slice(0, 12);
  }, [query, titles]);

  // Буквы идут только в поле. Наверх — в панель узла и на холст — текст
  // уходит после паузы в наборе и при закрытии: иначе каждая буква на слабом
  // телефоне пересобирала бы под листом всю панель с превью описания.
  const pending = useRef(null);
  const timer = useRef(0);
  const push = () => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    onChange(next);
  };
  const pushRef = useRef(push);
  pushRef.current = push;
  useEffect(() => () => pushRef.current(), []);
  const emit = (next) => {
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => pushRef.current(), 400);
  };

  const sync = () => {
    const el = ta.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const m = /\[\[([^\]\n]*)$/.exec(before);
    setQuery(m ? m[1] : null);
  };

  /** Заменить кусок текста и поставить выделение — одним шагом, с отменой. */
  const replace = (from, to, insert, selFrom, selTo = selFrom) => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(from, to);
    // execCommand оставляет правку в истории отмены поля; setRangeText — запасной путь.
    const ok = document.execCommand && document.execCommand("insertText", false, insert);
    if (!ok) el.setRangeText(insert, from, to, "end");
    el.setSelectionRange(selFrom, selTo);
    emit(el.value);
    sync();
  };

  const wrap = (before, after = before) => {
    const el = ta.current;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      replace(s - before.length, e + after.length, v.slice(s, e), s - before.length, e - before.length);
      return;
    }
    replace(s, e, before + v.slice(s, e) + after, s + before.length, e + before.length);
  };

  const prefix = (p) => {
    const el = ta.current;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const [from, to] = lineBounds(v, s, e);
    const lines = v.slice(from, to).split("\n");
    const same = (l) => (p === "1. " ? /^\s*\d+[.)] /.test(l) : l.trimStart().startsWith(p));
    const already = lines.every(same);
    let n = 0;
    const out = lines.map((l) => {
      const bare = l.replace(MARKER, "");
      if (already) return bare;
      n += 1;
      return (p === "1. " ? `${n}. ` : p) + bare;
    }).join("\n");
    replace(from, to, out, from + out.length);
  };

  const heading = () => {
    const el = ta.current;
    const { selectionStart: s, value: v } = el;
    const [from, to] = lineBounds(v, s);
    const line = v.slice(from, to);
    const m = /^\s{0,3}(#{1,6})\s+/.exec(line);
    const cur = m ? m[1].length : 0;
    const next = cur >= 3 ? 0 : cur + 1;
    const bare = line.replace(/^\s{0,3}#{1,6}\s+/, "");
    const out = (next ? `${"#".repeat(next)} ` : "") + bare;
    replace(from, to, out, from + out.length);
  };

  const pickNode = (title) => {
    const el = ta.current;
    const s = el.selectionStart;
    const start = el.value.lastIndexOf("[[", s);
    const close = el.value.slice(s, s + 2) === "]]" ? 2 : 0;
    const insert = `[[${title}]]`;
    haptic("tick");
    replace(start, s + close, insert, start + insert.length);
    setQuery(null);
  };

  // Enter в списке продолжает список; на пустом пункте — заканчивает его.
  const onKeyDown = (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = ta.current;
    const { selectionStart: s, selectionEnd: end, value: v } = el;
    if (s !== end) return;
    const [from] = lineBounds(v, s);
    const m = MARKER.exec(v.slice(from, s));
    if (!m) return;
    e.preventDefault();
    if (v.slice(from, s).length === m[0].length) {
      replace(from, s, "", from);
      return;
    }
    const next = m[0].replace(/\[[xX]\]/, "[ ]").replace(/^(\s*)(\d+)([.)])/, (_, sp, num, d) => `${sp}${Number(num) + 1}${d}`);
    replace(s, s, `\n${next}`, s + 1 + next.length);
  };

  const tools = [
    { id: "h", icon: Heading, run: heading },
    { id: "b", icon: Bold, run: () => wrap("**") },
    { id: "i", icon: Italic, run: () => wrap("*") },
    { id: "s", icon: Strikethrough, run: () => wrap("~~") },
    { id: "ul", icon: List, run: () => prefix("- ") },
    { id: "ol", icon: ListOrdered, run: () => prefix("1. ") },
    { id: "task", icon: CheckSquare, run: () => prefix("- [ ] ") },
    { id: "q", icon: Quote, run: () => prefix("> ") },
    { id: "wiki", label: "[[ ]]", run: () => wrap("[[", "]]") },
  ];
  // Кнопка не забирает фокус у поля — иначе пряталась бы клавиатура.
  const keep = (e) => e.preventDefault();

  return (
    <Sheet detent="full" z={80} onClose={onClose} testId="desc-writer" className="sw-writer">
      <div className="sw-sheet-head">
        <span className="sw-sheet-title">{t("common.description")}</span>
        <button type="button" className="sw-writer-done" onClick={onClose} data-testid="desc-writer-done">
          <Check className="w-4 h-4" /> {t("mobile.done")}
        </button>
      </div>
      <textarea
        ref={ta}
        className="sw-writer-input"
        data-testid="desc-writer-input"
        // Поле целиком во власти клавиатуры: React его не перезаписывает ни
        // на одной букве (см. lib/useImeSafe — почему это важно на Android).
        defaultValue={value}
        placeholder={placeholder}
        onChange={(e) => { emit(e.target.value); sync(); }}
        onSelect={sync}
        onKeyDown={onKeyDown}
        spellCheck
        autoCapitalize="sentences"
        autoCorrect="on"
      />
      {matches.length > 0 && (
        <div className="sw-writer-nodes" onPointerDown={keep} onMouseDown={keep} data-testid="desc-writer-nodes">
          {matches.map((title) => (
            <button key={title} type="button" onClick={() => pickNode(title)}>{title}</button>
          ))}
        </div>
      )}
      <div className="sw-writer-bar" onPointerDown={keep} onMouseDown={keep}>
        {tools.map((b) => (
          <button key={b.id} type="button" className="sw-lmd-kbtn" onClick={() => { haptic("tick"); b.run(); }}>
            {b.icon ? <b.icon className="w-[19px] h-[19px]" /> : <span className="text-[13px] font-semibold">{b.label}</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
