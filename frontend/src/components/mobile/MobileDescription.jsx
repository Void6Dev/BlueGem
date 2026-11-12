import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold, Check, CheckSquare, Heading, Italic, List, ListOrdered, Quote, Strikethrough,
} from "lucide-react";
import MarkdownView from "@/components/MarkdownView";
import { useT } from "@/lib/i18n";
import { haptic, useBackHandler } from "@/lib/platform";

/**
 * Текст узла на телефоне — прямо на странице узла, как в заметках.
 *
 * Пока не пишут, текст собран: заголовки, жирный, списки, [[ссылки]]. Касание
 * — и на том же месте обычное системное поле с тем же текстом, а над
 * клавиатурой кнопки оформления и, после [[, строка узлов. «Готово» или
 * касание мимо — и текст снова собран. Никаких отдельных окон.
 *
 * Поле именно системное и неуправляемое: React в него не пишет ни буквы, поэтому
 * клавиатура телефона (любая, с автозаменой, на любом языке) не теряет набранное.
 */

const MARKER = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;

function lineBounds(v, s, e = s) {
  const from = v.lastIndexOf("\n", s - 1) + 1;
  const end = v.indexOf("\n", e);
  return [from, end === -1 ? v.length : end];
}

export default function MobileDescription({ value, onChange, nodes = [], onOpenNode, onCreateNode, placeholder }) {
  const t = useT();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <InlineWriter
        value={value || ""}
        onChange={onChange}
        nodes={nodes}
        placeholder={placeholder || t("mobile.writeHere")}
        onDone={() => setEditing(false)}
      />
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className="sw-mdesc"
      data-testid="mobile-desc"
      onClick={(e) => {
        // Ссылки внутри собранного текста ведут к узлам, а не в правку.
        if (e.target.closest("a, button, input")) return;
        haptic("light");
        setEditing(true);
      }}
    >
      {value?.trim() ? (
        <MarkdownView
          text={value}
          nodes={nodes}
          // Касание ссылки — короткий отклик пальцу: переход случился, а не
          // текст ушёл в правку.
          onOpenNode={(nid) => { haptic("tick"); onOpenNode?.(nid); }}
          onCreateNode={onCreateNode}
        />
      ) : (
        <span className="sw-mdesc-empty">{placeholder || t("mobile.writeHere")}</span>
      )}
    </div>
  );
}

function InlineWriter({ value, onChange, nodes, placeholder, onDone }) {
  const t = useT();
  const ta = useRef(null);
  const [query, setQuery] = useState(null);

  // Текст уходит наверх после паузы и при выходе — не на каждую букву.
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

  const grow = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    grow();
    el.focus({ preventScroll: false });
    el.setSelectionRange(el.value.length, el.value.length);
    document.documentElement.classList.add("sw-writing");
    return () => document.documentElement.classList.remove("sw-writing");
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

  const emit = (next) => {
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => pushRef.current(), 400);
  };

  const sync = () => {
    const el = ta.current;
    if (!el) return;
    const m = /\[\[([^\]\n]*)$/.exec(el.value.slice(0, el.selectionStart));
    setQuery(m ? m[1] : null);
  };

  const replace = (from, to, insert, selFrom, selTo = selFrom) => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(from, to);
    const ok = document.execCommand && document.execCommand("insertText", false, insert);
    if (!ok) el.setRangeText(insert, from, to, "end");
    el.setSelectionRange(selFrom, selTo);
    grow();
    emit(el.value);
    sync();
  };

  const wrap = (before, after = before) => {
    const { selectionStart: s, selectionEnd: e, value: v } = ta.current;
    if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      replace(s - before.length, e + after.length, v.slice(s, e), s - before.length, e - before.length);
      return;
    }
    replace(s, e, before + v.slice(s, e) + after, s + before.length, e + before.length);
  };

  const prefix = (p) => {
    const { selectionStart: s, selectionEnd: e, value: v } = ta.current;
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
    const { selectionStart: s, value: v } = ta.current;
    const [from, to] = lineBounds(v, s);
    const line = v.slice(from, to);
    const m = /^\s{0,3}(#{1,6})\s+/.exec(line);
    const next = (m ? m[1].length : 0) >= 3 ? 0 : (m ? m[1].length : 0) + 1;
    const out = (next ? `${"#".repeat(next)} ` : "") + line.replace(/^\s{0,3}#{1,6}\s+/, "");
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

  const onKeyDown = (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const { selectionStart: s, selectionEnd: end, value: v } = ta.current;
    if (s !== end) return;
    const [from] = lineBounds(v, s);
    const m = MARKER.exec(v.slice(from, s));
    if (!m) return;
    e.preventDefault();
    if (v.slice(from, s).length === m[0].length) { replace(from, s, "", from); return; }
    const next = m[0].replace(/\[[xX]\]/, "[ ]").replace(/^(\s*)(\d+)([.)])/, (_, sp, num, d) => `${sp}${Number(num) + 1}${d}`);
    replace(s, s, `\n${next}`, s + 1 + next.length);
  };

  const finish = () => {
    pushRef.current();
    onDone();
  };
  // «Назад» на телефоне — закончить писать, а не закрыть весь узел.
  useBackHandler(() => ta.current?.blur());

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
  // Кнопки не забирают фокус у поля — иначе пряталась бы клавиатура.
  const keep = (e) => e.preventDefault();

  return (
    <>
      <textarea
        ref={ta}
        className="sw-mdesc-input"
        data-testid="desc-writer-input"
        defaultValue={value}
        placeholder={placeholder}
        rows={3}
        onInput={(e) => { grow(); emit(e.currentTarget.value); sync(); }}
        onSelect={sync}
        onKeyDown={onKeyDown}
        onBlur={finish}
        spellCheck
        autoCapitalize="sentences"
        autoCorrect="on"
      />
      {createPortal(
        <div className="sw-kbar" onPointerDown={keep} onMouseDown={keep} data-testid="md-keyboard-bar">
          {matches.length > 0 && (
            <div className="sw-writer-nodes" data-testid="desc-writer-nodes">
              {matches.map((title) => (
                <button key={title} type="button" onClick={() => pickNode(title)}>{title}</button>
              ))}
            </div>
          )}
          <div className="sw-kbar-row">
            <div className="sw-kbar-tools">
              {tools.map((b) => (
                <button key={b.id} type="button" className="sw-kbtn" onClick={() => { haptic("tick"); b.run(); }}>
                  {b.icon ? <b.icon className="w-[19px] h-[19px]" /> : <span className="text-[13px] font-semibold">{b.label}</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="sw-kdone"
              data-testid="desc-writer-done"
              onClick={() => ta.current?.blur()}
              aria-label={t("mobile.done")}
            >
              <Check className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
