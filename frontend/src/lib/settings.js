export const FONT_OPTIONS = [
  { id: "Manrope", label: "Manrope" },
  { id: "Inter", label: "Inter" },
  { id: "Space Grotesk", label: "Space Grotesk" },
  { id: "Lora", label: "Lora (serif)" },
  { id: "JetBrains Mono", label: "JetBrains Mono" },
];

// Шрифты подключаются локально (см. src/fonts.js) вариативными версиями —
// у них имя семейства с суффиксом "Variable". Идентификаторы в настройках
// проектов при этом не меняются: они уже лежат в базе у пользователя.
const FONT_FAMILIES = {
  "Manrope": "'Manrope Variable', 'Manrope'",
  "Inter": "'Inter Variable', 'Inter'",
  "Space Grotesk": "'Space Grotesk Variable', 'Space Grotesk'",
  "Lora": "'Lora Variable', 'Lora'",
  "JetBrains Mono": "'JetBrains Mono Variable', 'JetBrains Mono'",
};

/** CSS-значение font-family для сохранённого идентификатора шрифта. */
export function fontStack(id, fallbackId = "Manrope") {
  const family = FONT_FAMILIES[id] || FONT_FAMILIES[fallbackId] || FONT_FAMILIES.Manrope;
  const fallback = id === "Lora" ? "serif" : id === "JetBrains Mono" ? "monospace" : "sans-serif";
  return `${family}, ${fallback}`;
}

// Заголовочный шрифт — отдельная настройка от интерфейсного: на кегле 20+ px
// нужен характер, в строке списка он мешает. Playfair Display больше не
// подключается (см. src/fonts.js), поэтому в списке его нет.
export const DISPLAY_FONT_OPTIONS = FONT_OPTIONS;

// Палитра типов узлов, нормированная по OKLCH: одинаковые L (0.62) и C (0.17),
// тон разнесён минимум на 32°. Прежние десять цветов сливались попарно
// (индиго/фиолетовый, два янтаря, зелёный/бирюза) и различались по светлоте —
// цветовое кодирование держится на разности тона, а не на количестве цветов.
export const TYPE_COLORS = [
  "#E8465E", // oklch(.62 .17 20)   — красный
  "#C98122", // oklch(.62 .17 62)   — янтарь
  "#5FAC33", // oklch(.62 .17 128)  — лайм
  "#17A46F", // oklch(.62 .17 155)  — зелёный
  "#00A9AD", // oklch(.62 .17 190)  — бирюза
  "#2E9BD6", // oklch(.62 .17 235)  — синий
  "#9A63E8", // oklch(.62 .17 295)  — фиолетовый
  "#E45699", // oklch(.62 .17 345)  — розовый
];

// Акцент интерфейса намеренно не совпадает ни с одним типом узла: акцентная
// кнопка не должна читаться как узел. Циан стоит первым — индиго сидел
// вплотную к синему и фиолетовому из TYPE_COLORS и в паре с ними сливался.
export const ACCENT_OPTIONS = ["#39BEE6", "#6366f1", ...TYPE_COLORS];

/** Читаемый цвет надписи поверх заливки акцентом.
 *
 *  Хардкод «белым по акценту» работал, пока акцент был тёмным индиго. Циан
 *  светлее (L≈0.74) — белым по нему не прочитать. Порог по воспринимаемой
 *  яркости, тёмный вариант — сам акцент, приглушённый до почти чёрного:
 *  нейтрально-чёрный на цветном фоне выглядит грязным пятном. */
export function accentForeground(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
  if (!m) return "#FFFFFF";
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  // sRGB → относительная яркость (WCAG).
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.42 ? `color-mix(in srgb, ${hex} 22%, #000)` : "#FFFFFF";
}

export const ICON_OPTIONS = [
  "User", "Users", "Flag", "MapPin", "Calendar", "FileText",
  "Sword", "Shield", "Crown", "Skull", "Heart", "Star",
  "Book", "Scroll", "Sparkles", "Globe", "Home", "Castle",
  "Zap", "Flame", "Gem", "Key", "Ship", "Mountain",
  "Trees", "Anchor", "Feather", "Moon",
];

// Relationship (edge) presets. id "" = обычная связь без типа.
// В базе хранится только id, поэтому подписи можно переводить свободно.
export const REL_TYPES = [
  { id: "", labelKey: "relTypes.plain", color: "#71717a" },
  { id: "ally", labelKey: "relTypes.ally", color: "#17A46F" },
  { id: "enemy", labelKey: "relTypes.enemy", color: "#E8465E" },
  { id: "family", labelKey: "relTypes.family", color: "#C98122" },
  { id: "owns", labelKey: "relTypes.owns", color: "#9A63E8" },
  { id: "member", labelKey: "relTypes.member", color: "#2E9BD6" },
  { id: "love", labelKey: "relTypes.love", color: "#E45699" },
  { id: "mentor", labelKey: "relTypes.mentor", color: "#5FAC33" },
  { id: "knows", labelKey: "relTypes.knows", color: "#00A9AD" },
];

// Линия в покое нейтральна для всех типов связей — цвет типа проявляется
// только под курсором и в выделении (см. --rel-color в index.css).
export const DEFAULT_EDGE_COLOR = "#71717a";

/**
 * Типы связей этого проекта: [{id, label, color}], первым — «обычная».
 *
 * Подписи типов — данные пользователя, поэтому набор заводит сервер на языке
 * интерфейса (как и типы узлов) и дальше он правится вместе с проектом.
 * Пустой набор означает проект старше этой настройки: берём встроенный список
 * и переводим словарём, как было раньше.
 *
 * «Обычная» синтезируется здесь и в настройках не хранится: это не тип, а его
 * отсутствие — пустой id, который нечего называть и незачем давать править.
 */
export function relTypesOf(settings, tr) {
  const plain = { id: "", label: tr("relTypes.plain"), color: DEFAULT_EDGE_COLOR };
  const own = settings?.relTypes;
  if (own?.length) {
    return [plain, ...own.map((r) => ({
      id: r.id,
      label: r.label || r.id,
      color: r.color || DEFAULT_EDGE_COLOR,
    }))];
  }
  return [plain, ...REL_TYPES.filter((r) => r.id).map((r) => ({
    id: r.id, label: tr(r.labelKey), color: r.color,
  }))];
}

// Формы линии. Список один на настройки и на меню связи: там он задаёт форму
// по умолчанию, здесь — форму одной конкретной линии.
export const EDGE_SHAPES = ["smoothstep", "default", "straight", "step"];

export const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "#39BEE6",
  font: "Manrope",
  displayFont: "Space Grotesk",
  edgeType: "smoothstep",
  // «Карточки» — прежний вид со всем содержимым; «граф» включают, когда узлов
  // становится много и важнее видеть связи.
  cardMode: "detailed",
  showGrid: true,
  showMiniMap: true,
  snapToGrid: false,
  animatedEdges: false,
  nodeTypes: [],
  // Подпись первого холста ставит сервер на языке интерфейса.
  canvases: [{ id: "main", label: "Main" }],
  // Типы связей: [{id, label, color}]. Пусто — проект старше настройки,
  // список берётся встроенный и переводится словарём (см. relTypesOf).
  relTypes: [],
  // Подсказки характеристик по типам узлов: {typeId: [ключи]}. Пусто —
  // проект старше этой настройки, подсказки возьмутся из словаря интерфейса.
  fieldTemplates: {},
  // Из какой заготовки вырос проект (см. TEMPLATES в backend/server.py).
  // Ничего не запрещает — по нему интерфейс подбирает подсказки под жанр.
  template: "blank",
};

const LS_KEY = "bluegem:appearance";
// Ключ прежнего имени приложения: читаем его, если своего ещё нет, чтобы после
// переименования первый экран не мигнул чужой темой.
const LEGACY_LS_KEY = "storyweave:appearance";

/** Remember the last appearance so the dashboard doesn't flash a wrong theme. */
export function rememberAppearance(settings) {
  if (!settings) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      theme: settings.theme, accent: settings.accent,
      font: settings.font, displayFont: settings.displayFont,
    }));
  } catch {
    /* private mode / quota — appearance simply won't persist */
  }
}

export function loadAppearance() {
  try {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LEGACY_LS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore malformed storage */
  }
  return {
    theme: DEFAULT_SETTINGS.theme, accent: DEFAULT_SETTINGS.accent,
    font: DEFAULT_SETTINGS.font, displayFont: DEFAULT_SETTINGS.displayFont,
  };
}

export function applySettings(settings, { remember = true } = {}) {
  if (!settings) return;
  const root = document.body;
  const light = settings.theme === "light";
  root.classList.toggle("sw-light", light);
  document.documentElement.classList.toggle("sw-light", light);
  const accent = settings.accent || DEFAULT_SETTINGS.accent;
  document.documentElement.style.setProperty("--sw-accent", accent);
  document.documentElement.style.setProperty("--sw-accent-fg", accentForeground(accent));
  document.documentElement.style.setProperty("--sw-font", fontStack(settings.font));
  document.documentElement.style.setProperty(
    "--sw-font-display",
    fontStack(settings.displayFont || DEFAULT_SETTINGS.displayFont, "Space Grotesk"),
  );
  // Keep the browser chrome (mobile address bar) in sync with the theme.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", light ? "#F7F7F6" : "#0A0A0F");
  if (remember) rememberAppearance(settings);
}

/** Called once at boot so the very first paint already uses the right theme. */
export function applyStoredAppearance() {
  applySettings(loadAppearance(), { remember: false });
}
