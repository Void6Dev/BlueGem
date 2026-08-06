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
export function fontStack(id) {
  const family = FONT_FAMILIES[id] || FONT_FAMILIES.Manrope;
  const fallback = id === "Lora" ? "serif" : id === "JetBrains Mono" ? "monospace" : "sans-serif";
  return `${family}, ${fallback}`;
}

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

// Индиго остаётся акцентом интерфейса и намеренно не совпадает ни с одним
// типом узла: акцент UI и цвет типа не должны конфликтовать.
export const ACCENT_OPTIONS = ["#6366f1", ...TYPE_COLORS];

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

export const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "#6366f1",
  font: "Manrope",
  edgeType: "smoothstep",
  showGrid: true,
  showMiniMap: true,
  snapToGrid: false,
  animatedEdges: false,
  nodeTypes: [],
  // Подпись первого холста ставит сервер на языке интерфейса.
  canvases: [{ id: "main", label: "Main" }],
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
      theme: settings.theme, accent: settings.accent, font: settings.font,
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
  return { theme: DEFAULT_SETTINGS.theme, accent: DEFAULT_SETTINGS.accent, font: DEFAULT_SETTINGS.font };
}

export function applySettings(settings, { remember = true } = {}) {
  if (!settings) return;
  const root = document.body;
  const light = settings.theme === "light";
  root.classList.toggle("sw-light", light);
  document.documentElement.classList.toggle("sw-light", light);
  document.documentElement.style.setProperty("--sw-accent", settings.accent || "#6366f1");
  document.documentElement.style.setProperty("--sw-font", fontStack(settings.font));
  // Keep the browser chrome (mobile address bar) in sync with the theme.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", light ? "#F7F7F6" : "#0A0A0A");
  if (remember) rememberAppearance(settings);
}

/** Called once at boot so the very first paint already uses the right theme. */
export function applyStoredAppearance() {
  applySettings(loadAppearance(), { remember: false });
}
