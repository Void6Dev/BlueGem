/**
 * Разметка для карточки на холсте — своим разбором, без react-markdown.
 *
 * Почему не библиотека. На холсте карточек столько же, сколько узлов в проекте,
 * и все они появляются разом: при открытии проекта и при каждом пересечении
 * порога детализации (см. lodOf в CustomNode). react-markdown на каждой из них
 * поднимает micromark и mdast — полный разбор CommonMark с плагинами. Замер на
 * проекте в пятьсот узлов: одно движение колеса через порог 0.55 держало
 * основной поток 1150 мс. То есть щелчок мышью — и приложение на секунду
 * мёртвое. Здесь тот же текст разбирается однопроходным сканером за проценты
 * от этого времени.
 *
 * Почему это не потеря. Поддержан тот синтаксис, которым в этом приложении и
 * пишут: заголовки, списки и задачи, цитаты, код, таблицы, линейки, выделения,
 * ссылки, [[ссылки на узлы]] и сноски. Всё это — то, что умеет вставить сам
 * блокнот; ничего, чего он не умеет, в описаниях и не появляется.
 *
 * Разбор один на оба места, где показывается разметка: карточку холста и
 * панель справа. Разница между ними ровно одна и живёт в `opts.doc`: в панели
 * ссылки живые и картинки видны, на карточке они подсвеченный текст — кликом
 * по карточке владеет холст.
 */
import { createElement, memo } from "react";

// Готовые деревья по тексту, из которого они собраны. Кеш переживает
// размонтирование карточки — а оно случается на каждом пересечении порога
// детализации и на каждом уходе узла за край экрана (виртуализация React Flow).
// Без него зум туда-обратно платил бы за разбор дважды.
const cache = new Map();
// Ограничение на случай долгой правки описания: каждая набранная буква даёт
// новую строку, и без предела карта росла бы до конца сеанса.
const CACHE_MAX = 1000;

// Разметка внутри строки. Одним проходом: чередование дороже разбора по частям,
// но зато строка обходится ровно один раз.
// Порядок ветвей важен — код должен победить всё остальное, иначе `**` внутри
// обратных кавычек разберётся как жирный.
// Вложенность даётся ценой двух оговорок, и обе намеренные.
// Во-первых, жирный берёт содержимое лениво до ближайшей пары звёздочек —
// иначе «**жирный с *курсивом* внутри**» разваливался на середине.
// Во-вторых, у курсива и открывающая, и закрывающая звёздочка обязаны быть
// одиночными ((?!\*)), а внутрь пускается пара — иначе «*курсив с **жирным**
// внутри*» закрывался о первую же звёздочку жирного.
// Разметка внутри строки и не переходит на другую: разбор идёт построчно.
const INLINE = new RegExp([
  "(`+)([^`]+?)\\1",                            // `код`
  "\\*\\*([^\\n]+?)\\*\\*",                     // **жирный**
  "__([^\\n]+?)__",                             // __жирный__
  "\\*(?!\\*)((?:[^*\\n]|\\*\\*)+?)\\*(?!\\*)", // *курсив*
  "(?<![\\w\\\\])_(?!_)((?:[^_\\n]|__)+?)_(?!_)(?!\\w)", // _курсив_ (не в snake_case)
  "~~([^\\n]+?)~~",                             // ~~зачёркнутый~~
  "==([^\\n]+?)==",                             // ==выделенный==
  "!?\\[\\[([^\\]]+?)\\]\\]",                   // [[Название узла]]
  "!?\\[([^\\]]*?)\\]\\(([^)]*?)\\)",           // [текст](адрес)
  "(https?://[^\\s<>]+)",                       // голая ссылка
  "\\[\\^([^\\]\\s]+?)\\]",                     // [^1] — сноска
].join("|"), "g");

// Номера сносок на время одного разбора: в тексте они зовутся как угодно
// ([^дом], [^1]), а показываются по порядку появления — так их и читают.
let footnotes = null;
function footnoteNumber(name) {
  if (!footnotes.has(name)) footnotes.set(name, footnotes.size + 1);
  return footnotes.get(name);
}

/**
 * Настройки разбора на время одного вызова.
 *
 * `doc` — просмотр в панели: там ссылки живые, картинки показываются, а по
 * [[Названию]] можно перейти к узлу или завести недостающий. На карточке
 * холста всё это ссылками не работает — кликом владеет холст, — поэтому там
 * они просто подсвеченный текст.
 */
let opts = { doc: false };

function link(text, href, key) {
  if (!opts.doc) return <span key={key} className="sw-accent-text">{text}</span>;
  if (href && /^https?:\/\//.test(href)) {
    return (
      <a key={key} href={href} target="_blank" rel="noreferrer" className="sw-accent-text underline">
        {text}
      </a>
    );
  }
  return <span key={key} className="sw-accent-text">{text}</span>;
}

/** [[Название узла]] — переход к узлу, а если такого нет, предложение завести. */
function wiki(name, key) {
  const clean = name.trim();
  if (!opts.doc) return <span key={key} className="sw-accent-text">{clean}</span>;
  const id = opts.nodesByTitle?.[clean.toLowerCase()];
  if (id) {
    return (
      <button
        key={key}
        type="button"
        onClick={(e) => { e.preventDefault(); opts.onOpenNode?.(id); }}
        className="sw-accent-text underline underline-offset-2 hover:opacity-80"
      >
        {clean}
      </button>
    );
  }
  return (
    <button
      key={key}
      type="button"
      title={opts.onCreateNode ? opts.createTitle?.(clean) : opts.missingTitle}
      onClick={(e) => { e.preventDefault(); opts.onCreateNode?.(clean); }}
      className="sw-text-dim underline decoration-dashed underline-offset-2 hover:sw-accent-text"
    >
      {clean}
    </button>
  );
}

/** Разметка внутри строки → массив детей React. */
function inline(text, key) {
  // Быстрый выход: у большинства строк никакой разметки нет, и запускать по ним
  // регулярное выражение с десятью ветвями незачем.
  if (!/[`*_~=[\]]|https?:\/\//.test(text)) return text;

  // Сначала весь проход, потом сборка — и ни одного вложенного вызова между
  // ними. Регулярное выражение здесь одно на модуль и с флагом g, то есть со
  // своей позицией внутри; разбор вложенного куска прямо в цикле сбрасывал бы
  // эту позицию и уводил внешний проход в середину уже разобранного.
  const found = [];
  INLINE.lastIndex = 0;
  let m;
  while ((m = INLINE.exec(text)) !== null) {
    found.push({ at: m.index, end: INLINE.lastIndex, g: m });
    // Пустое совпадение сдвигаем руками, иначе цикл встанет на месте.
    if (m.index === INLINE.lastIndex) INLINE.lastIndex += 1;
  }
  if (!found.length) return text;

  const out = [];
  let last = 0;
  for (let i = 0; i < found.length; i += 1) {
    const { at, end, g } = found[i];
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}i${i}`;
    if (g[2] !== undefined) out.push(<code key={k}>{g[2]}</code>);
    else if (g[3] !== undefined) out.push(<strong key={k}>{inline(g[3], k)}</strong>);
    else if (g[4] !== undefined) out.push(<strong key={k}>{inline(g[4], k)}</strong>);
    else if (g[5] !== undefined) out.push(<em key={k}>{inline(g[5], k)}</em>);
    else if (g[6] !== undefined) out.push(<em key={k}>{inline(g[6], k)}</em>);
    else if (g[7] !== undefined) out.push(<del key={k}>{inline(g[7], k)}</del>);
    else if (g[8] !== undefined) out.push(<mark key={k}>{inline(g[8], k)}</mark>);
    else if (g[9] !== undefined) out.push(wiki(g[9], k));
    else if (g[10] !== undefined) {
      // Картинка отличается от ссылки одним знаком, и он остался в совпадении.
      if (text[at] === "!") {
        if (opts.doc && g[11]) out.push(<img key={k} src={g[11]} alt={g[10]} loading="lazy" />);
      } else out.push(link(g[10] || g[11], g[11], k));
    }
    else if (g[12] !== undefined) out.push(link(g[12], g[12], k));
    else if (g[13] !== undefined) {
      out.push(<sup key={k} className="sw-md-fn">{footnoteNumber(g[13])}</sup>);
    }
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Абзац: одиночный перевод строки — это перевод строки, а не пробел. */
function paragraph(lines, key) {
  const kids = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i) kids.push(<br key={`${key}b${i}`} />);
    kids.push(inline(lines[i], `${key}l${i}`));
  }
  return kids;
}

const RE_HEAD = /^ {0,3}(#{1,6})\s+(.*)$/;
const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_UL = /^(\s*)([-*+])\s+(.*)$/;
const RE_OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const RE_FENCE = /^\s*(```|~~~)/;
const RE_QUOTE = /^ {0,3}> ?(.*)$/;
const RE_TASK = /^\[([ xX])\]\s+/;
// Расшифровка сноски: [^имя]: текст. Отдельным блоком, а не абзацем — иначе
// она склеивалась бы с текстом над ней и выглядела частью изложения.
const RE_FNDEF = /^ {0,3}\[\^([^\]\s]+?)\]:\s*(.*)$/;

/** Начинается ли строка новым блоком — по ней заканчивается абзац. */
function starts(line) {
  return !line.trim() || RE_HEAD.test(line) || RE_HR.test(line) || RE_FENCE.test(line)
    || RE_QUOTE.test(line) || RE_UL.test(line) || RE_OL.test(line) || RE_FNDEF.test(line)
    || /^\s*\|/.test(line);
}

/**
 * Блоки. Обычный проход по строкам с курсором: каждый блок сам решает,
 * сколько строк забрать.
 */
function blocks(lines, from, to, prefix) {
  const out = [];
  let i = from;
  let n = 0;
  const key = () => `${prefix}${n++}`;

  while (i < to) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    const fence = RE_FENCE.exec(line);
    if (fence) {
      const mark = fence[1];
      const body = [];
      i += 1;
      while (i < to && !lines[i].trimStart().startsWith(mark)) { body.push(lines[i]); i += 1; }
      i += 1; // закрывающая ограда
      out.push(<pre key={key()}><code>{body.join("\n")}</code></pre>);
      continue;
    }

    const head = RE_HEAD.exec(line);
    if (head) {
      const k = key();
      out.push(createElement(`h${head[1].length}`, { key: k }, inline(head[2], k)));
      i += 1;
      continue;
    }

    if (RE_HR.test(line)) { out.push(<hr key={key()} />); i += 1; continue; }

    const fn = RE_FNDEF.exec(line);
    if (fn) {
      const rest = [fn[2]];
      i += 1;
      while (i < to && lines[i].trim() && !starts(lines[i])) { rest.push(lines[i].trim()); i += 1; }
      const k = key();
      out.push(
        <p key={k} className="sw-md-fndef">
          <span className="sw-md-fn">{footnoteNumber(fn[1])}</span>
          {" "}
          {paragraph(rest, k)}
        </p>
      );
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const inner = [];
      while (i < to && RE_QUOTE.test(lines[i])) { inner.push(RE_QUOTE.exec(lines[i])[1]); i += 1; }
      const k = key();
      out.push(<blockquote key={k}>{blocks(inner, 0, inner.length, `${k}q`)}</blockquote>);
      continue;
    }

    // Таблица GFM. Разбираем только то, чем она и бывает в карточке: шапка,
    // строка-разделитель, ряды. Без выравнивания по двоеточиям — на ширине
    // в две сотни пикселей его всё равно не видно.
    if (/^\s*\|/.test(line) && i + 1 < to && /^[\s|:-]+$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const cells = (s) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head2 = cells(line);
      i += 2;
      const rows = [];
      while (i < to && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      const k = key();
      out.push(
        <table key={k}>
          <thead>
            <tr>{head2.map((c, j) => <th key={`${k}h${j}`}>{inline(c, `${k}h${j}`)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={`${k}r${ri}`}>
                {r.map((c, j) => <td key={`${k}r${ri}c${j}`}>{inline(c, `${k}r${ri}c${j}`)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    const ul = RE_UL.exec(line);
    const ol = ul ? null : RE_OL.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      const items = [];
      // Вложенность списка на карточке не разбираем: у неё ширина в две сотни
      // пикселей, и второй уровень там всё равно неотличим от первого.
      while (i < to) {
        const m = ordered ? RE_OL.exec(lines[i]) : RE_UL.exec(lines[i]);
        if (!m) break;
        const rest = [m[3]];
        i += 1;
        // Продолжение пункта — строки без своего маркера и без нового блока.
        while (i < to && lines[i].trim() && !starts(lines[i])) { rest.push(lines[i].trim()); i += 1; }
        items.push(rest);
      }
      const k = key();
      const kids = items.map((rest, idx) => {
        const task = RE_TASK.exec(rest[0]);
        const first = task ? rest[0].slice(task[0].length) : rest[0];
        return (
          <li key={`${k}li${idx}`}>
            {task && (
              <input type="checkbox" readOnly checked={task[1] !== " "} />
            )}
            {paragraph([first, ...rest.slice(1)], `${k}li${idx}`)}
          </li>
        );
      });
      out.push(createElement(ordered ? "ol" : "ul", { key: k }, kids));
      continue;
    }

    const para = [line];
    i += 1;
    while (i < to && !starts(lines[i])) { para.push(lines[i]); i += 1; }
    const k = key();
    out.push(<p key={k}>{paragraph(para, k)}</p>);
  }

  return out;
}

/**
 * Разобрать текст в дерево React.
 *
 * Без настроек — вид для карточки: он и кешируется, потому что зависит только
 * от самого текста. Просмотр в панели (`doc`) держит в себе обработчики и карту
 * названий, поэтому не кешируется — да и незачем: документ на экране один.
 */
export function renderMarkdown(text, options) {
  const src = text || "";
  const doc = !!options?.doc;
  if (!doc) {
    const hit = cache.get(src);
    if (hit) return hit;
  }
  opts = options || { doc: false };
  footnotes = new Map();
  const lines = src.split("\n");
  const tree = blocks(lines, 0, lines.length, "m");
  opts = { doc: false };
  if (!doc) {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(src, tree);
  }
  return tree;
}

/**
 * Разметка карточки на холсте.
 *
 * memo по одной строке: карточка перерисовывается на каждое выделение, поиск и
 * наведение, а текст при этом тот же — и дерево пересобирать незачем.
 */
const MiniMarkdown = memo(function MiniMarkdown({ text }) {
  return (
    <div className="sw-md sw-md-compact text-xs leading-relaxed pointer-events-none">
      {renderMarkdown(text)}
    </div>
  );
});

export default MiniMarkdown;
