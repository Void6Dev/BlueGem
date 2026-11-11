// Картинка холста: PNG — показать и отправить, SVG — вставить в документ
// без потери чёткости.
//
// Снимается то, что на холсте, а не экран: все карточки текущего холста
// целиком, с небольшим полем, независимо от того, куда сейчас прокручено и
// какой масштаб. Мини-карта, кнопки и панели в картинку не попадают — берётся
// только слой с карточками и линиями.
import { getNodesBounds } from "@xyflow/react";

const PADDING = 48;
// Длинная сторона картинки. Больше — файл на десятки мегабайт, а на экране
// всё равно не разглядеть; для печати есть SVG.
const MAX_SIDE = 4096;

// Какие CSS-свойства переносить в картинку. По умолчанию html-to-image
// переписывает в каждый элемент все ~400 вычисленных свойств, и SVG холста
// из десятка карточек весил шесть мегабайт. Карточкам и линиям нужен вот этот
// набор — раскладка, рамки, заливки, текст и штрихи SVG.
const STYLE_PROPS = [
  "display", "position", "top", "right", "bottom", "left", "z-index", "box-sizing",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "order",
  "align-items", "align-self", "align-content", "justify-content", "justify-items", "gap", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
  "overflow", "overflow-x", "overflow-y", "visibility", "opacity", "transform", "transform-origin",
  "color", "background-color", "background-image", "background-size", "background-position", "background-repeat",
  "background-clip",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
  "box-shadow", "outline-width", "outline-style", "outline-color", "outline-offset",
  "font-family", "font-size", "font-weight", "font-style", "font-variation-settings", "font-feature-settings",
  "line-height", "letter-spacing", "word-spacing", "text-align", "text-transform", "text-decoration-line",
  "text-decoration-color", "text-overflow", "text-indent", "white-space", "word-break", "overflow-wrap",
  "vertical-align", "list-style-type", "-webkit-line-clamp", "-webkit-box-orient",
  "object-fit", "object-position", "filter", "mix-blend-mode", "clip-path",
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
  "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "marker-start", "marker-end", "pointer-events",
];

/**
 * @param rf     экземпляр React Flow (useReactFlow)
 * @param format "png" | "svg"
 * @returns data:-адрес картинки
 */
/**
 * Шрифты только те, что стоят на карточках, и только латиница с кириллицей.
 *
 * Без этого html-to-image вшивает в картинку все шрифты приложения со всеми
 * наборами символов — SVG одного холста весил под семь мегабайт, из которых
 * сам рисунок занимал десятки килобайт.
 */
async function fontCssFor(layer, getFontEmbedCSS) {
  const families = new Set();
  for (const el of [layer, ...layer.querySelectorAll("*")]) {
    const first = getComputedStyle(el).fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (first) families.add(first.toLowerCase());
  }
  const css = await getFontEmbedCSS(layer);
  const faces = css.match(/@font-face\s*{[^}]*}/g) || [];
  return faces.filter((face) => {
    const fam = /font-family:\s*["']?([^;"']+)/i.exec(face)?.[1]?.trim().toLowerCase();
    if (!fam || !families.has(fam)) return false;
    const range = /unicode-range:\s*([^;}]+)/i.exec(face)?.[1] || "";
    return !range || /U\+0000-00FF|U\+0400-045F|U\+0301/i.test(range);
  }).join("\n");
}

export async function canvasImage(rf, format = "png", { background } = {}) {
  const { toSvg, getFontEmbedCSS } = await import("html-to-image");
  const nodes = rf.getNodes().filter((n) => !n.hidden);
  if (!nodes.length) throw new Error("empty");
  const bounds = getNodesBounds(nodes);
  const scale = Math.min(1, MAX_SIDE / Math.max(bounds.width + PADDING * 2, bounds.height + PADDING * 2));
  const width = Math.round((bounds.width + PADDING * 2) * scale);
  const height = Math.round((bounds.height + PADDING * 2) * scale);
  // Масштаб и сдвиг — свои, а не getViewportForBounds: та считает поле
  // в долях экрана и вписывает с запасом, а здесь размер картинки уже задан
  // ровно по карточкам с полем.
  const vp = {
    zoom: scale,
    x: (PADDING - bounds.x) * scale,
    y: (PADDING - bounds.y) * scale,
  };
  const layer = document.querySelector(".react-flow__viewport");
  if (!layer) throw new Error("no canvas");
  const bg = background || getComputedStyle(document.body).backgroundColor || "#111";
  const fontEmbedCSS = await fontCssFor(layer, getFontEmbedCSS).catch(() => undefined);
  const options = {
    fontEmbedCSS,
    // Один и тот же список для PNG и SVG: библиотека запоминает его при
    // первом вызове на всё время работы страницы.
    includeStyleProperties: STYLE_PROPS,
    backgroundColor: bg,
    width,
    height,
    // PNG — с двойной плотностью, чтобы текст на картинке читался.
    pixelRatio: format === "png" ? Math.min(2, MAX_SIDE / Math.max(width, height)) : 1,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
    },
    // Ручки связей и подсказки редактирования на картинке не нужны.
    filter: (el) => !(el.classList && (el.classList.contains("react-flow__handle")
      || el.classList.contains("react-flow__resize-control"))),
  };
  // Внутренние элементы SVG библиотека переносит без вычисленных стилей — а
  // цвет, толщину и пунктир линиям связей задают классы. На время снимка
  // пишем их прямо в элементы и потом возвращаем как было.
  const restore = [];
  for (const el of layer.querySelectorAll(".react-flow__edge path, .react-flow__edge circle, .react-flow__edges marker *")) {
    const cs = getComputedStyle(el);
    restore.push([el, el.getAttribute("style")]);
    for (const prop of ["stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
      "stroke-opacity", "fill", "fill-opacity", "opacity"]) {
      el.style.setProperty(prop, cs.getPropertyValue(prop));
    }
  }
  let svgUrl;
  try {
    svgUrl = await toSvg(layer, options);
  } finally {
    for (const [el, style] of restore) {
      if (style == null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
  }

  // Снимок всегда сначала в SVG: ссылки вроде url(#градиент) в вычисленных
  // стилях браузер отдаёт полным адресом страницы, и вне неё линии связей и
  // стрелки теряют цвет. Возвращаем им короткий вид, а PNG рисуем уже из
  // исправленного SVG.
  const comma = svgUrl.indexOf(",");
  const page = window.location.href.split("#")[0];
  const text = decodeURIComponent(svgUrl.slice(comma + 1)).split(`${page}#`).join("#");
  const fixed = `${svgUrl.slice(0, comma + 1)}${encodeURIComponent(text)}`;
  if (format === "svg") return fixed;
  return rasterize(fixed, width, height, options.pixelRatio, bg);
}

function rasterize(svgUrl, width, height, ratio, bg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("render failed"));
    img.src = svgUrl;
  });
}

/** data:… → Blob/текст для сохранения файлом. */
export function dataUrlToBytes(url) {
  const [head, body] = url.split(",", 2);
  if (/;base64$/.test(head)) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}
