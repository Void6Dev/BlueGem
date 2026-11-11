// Данные шаблонов проектов — зеркало backend/server.py.
//
// На телефоне Python-сервера нет: проекты живут прямо в приложении (см.
// lib/local/api.js). Чтобы новый проект на Android заводился ровно таким же,
// как на компьютере, заготовки повторены здесь один в один. Правите шаблон
// в server.py — поправьте и здесь, иначе проекты с двух платформ разойдутся.

export const DEFAULT_LANG = "en";
export const DEFAULT_TEMPLATE = "blank";

// Палитра нормирована по OKLCH — см. TYPE_COLORS в lib/settings.js.
export const NODE_TYPE_COLORS = {
  character: ["#E8465E", "User"],
  faction: ["#9A63E8", "Flag"],
  location: ["#17A46F", "MapPin"],
  event: ["#C98122", "Calendar"],
  note: ["#6B7280", "FileText"],
  quest: ["#C98122", "Scroll"],
  creature: ["#5FAC33", "Skull"],
  item: ["#E45699", "Gem"],
  lore: ["#00A9AD", "Book"],
};

export const NODE_TYPE_LABELS = {
  en: {
    character: "Character", faction: "Faction", location: "Location", event: "Event",
    note: "Note", quest: "Quest", creature: "Creature", item: "Item", lore: "Lore",
  },
  ru: {
    character: "Персонаж", faction: "Фракция", location: "Локация", event: "Событие",
    note: "Заметка", quest: "Квест", creature: "Существо", item: "Предмет", lore: "Лор",
  },
};

export const MAIN_CANVAS_LABELS = { en: "Main", ru: "Основной" };

export const DEFAULT_TYPE_IDS = ["character", "faction", "location", "event", "note"];

export const PAGE_LABELS = {
  en: {
    campaign: "Campaign", world: "World", characters: "Characters", locations: "Locations",
    factions: "Factions", quests: "Quests", timeline: "Timeline", sessions: "Sessions", lore: "Lore",
  },
  ru: {
    campaign: "Кампания", world: "Мир", characters: "Персонажи", locations: "Локации",
    factions: "Фракции", quests: "Квесты", timeline: "Хронология", sessions: "Сессии", lore: "Лор",
  },
};

export const REL_TYPE_COLORS = {
  ally: "#17A46F", enemy: "#E8465E", family: "#C98122", owns: "#9A63E8",
  member: "#2E9BD6", love: "#E45699", mentor: "#5FAC33", knows: "#00A9AD",
  serves: "#5FAC33", guards: "#C98122", hides: "#6B7A8F",
  owes: "#E45699", betrayed: "#B4462E",
};

export const REL_TYPE_LABELS = {
  en: {
    ally: "Ally", enemy: "Enemy", family: "Family", owns: "Owns", member: "Member of",
    love: "Love", mentor: "Mentor", knows: "Knows of", serves: "Serves", guards: "Guards",
    hides: "Hides", owes: "Owes", betrayed: "Betrayed",
  },
  ru: {
    ally: "Союзник", enemy: "Враг", family: "Родня", owns: "Владеет", member: "Состоит в",
    love: "Любовь", mentor: "Наставник", knows: "Знает о", serves: "Служит", guards: "Охраняет",
    hides: "Скрывает", owes: "Должен", betrayed: "Предал",
  },
};

export const DEFAULT_REL_TYPE_IDS = ["ally", "enemy", "family", "owns", "member", "love", "mentor", "knows"];
export const DND_REL_TYPE_IDS = ["ally", "enemy", "member", "owns", "serves", "guards",
  "hides", "owes", "betrayed", "knows"];

export const FIELD_TEMPLATES = {
  en: {
    character: ["Age", "Role", "Status", "Appearance", "Goal"],
    faction: ["Leader", "Headquarters", "Size", "Goal"],
    location: ["Region", "Population", "Climate", "Ruler"],
    event: ["Place", "Participants", "Outcome"],
    note: ["Source", "Status"],
  },
  ru: {
    character: ["Возраст", "Роль", "Статус", "Внешность", "Цель"],
    faction: ["Лидер", "Штаб", "Численность", "Цель"],
    location: ["Регион", "Население", "Климат", "Правитель"],
    event: ["Место", "Участники", "Итог"],
    note: ["Источник", "Статус"],
  },
};

const DND_FIELD_TEMPLATES = {
  en: {
    character: ["Wants", "Fears", "Knows", "Voice", "Attitude"],
    faction: ["Wants", "Opposed by", "Leader", "Reach", "If unchecked"],
    location: ["First look", "What's wrong", "Hooks", "In charge"],
    quest: ["Hook", "Giver", "Reward", "Complication", "If ignored"],
    creature: ["Statblock", "Number", "Tactics", "Wants", "Weakness"],
    item: ["Effect", "Where it is", "Who wants it", "History", "Attunement"],
    lore: ["Who tells it", "How true", "What it explains", "Where written"],
    note: ["Session", "Status"],
  },
  ru: {
    character: ["Хочет", "Боится", "Знает", "Голос", "Отношение"],
    faction: ["Хочет", "Кто мешает", "Лидер", "Влияние", "Если не мешать"],
    location: ["С порога", "Что не так", "Зацепки", "Кто здесь главный"],
    quest: ["Зацепка", "Кто дал", "Награда", "Осложнение", "Если не придут"],
    creature: ["Статблок", "Сколько", "Тактика", "Чего хочет", "Слабость"],
    item: ["Что делает", "Где сейчас", "Кому нужен", "История", "Требует настройки"],
    lore: ["Кто рассказывает", "Насколько правда", "Что объясняет", "Где записано"],
    note: ["Сессия", "Статус"],
  },
};

const TEMPLATE_FIELD_TEMPLATES = { dnd: DND_FIELD_TEMPLATES };

export const TEMPLATES = {
  blank: { types: DEFAULT_TYPE_IDS, rels: DEFAULT_REL_TYPE_IDS, pages: ["main"], starter: false },
  dnd: {
    types: ["character", "faction", "location", "quest", "creature", "item", "lore", "note"],
    rels: DND_REL_TYPE_IDS,
    pages: ["campaign", "world", "characters", "locations", "factions",
      "quests", "timeline", "sessions", "lore"],
    starter: true,
  },
  custom: { types: [], rels: DEFAULT_REL_TYPE_IDS, pages: ["main"], starter: false },
};

export function nodeTypesFor(lang, ids = DEFAULT_TYPE_IDS) {
  const labels = NODE_TYPE_LABELS[lang] || NODE_TYPE_LABELS[DEFAULT_LANG];
  return ids.filter((key) => NODE_TYPE_COLORS[key]).map((key) => ({
    id: key, label: labels[key], color: NODE_TYPE_COLORS[key][0], icon: NODE_TYPE_COLORS[key][1],
  }));
}

export function relTypesFor(lang, ids) {
  const labels = REL_TYPE_LABELS[lang] || REL_TYPE_LABELS[DEFAULT_LANG];
  return ids.filter((key) => REL_TYPE_COLORS[key])
    .map((key) => ({ id: key, label: labels[key], color: REL_TYPE_COLORS[key] }));
}

export function canvasesFor(template, lang) {
  const pages = (TEMPLATES[template] || TEMPLATES[DEFAULT_TEMPLATE]).pages;
  const labels = PAGE_LABELS[lang] || PAGE_LABELS[DEFAULT_LANG];
  const main = MAIN_CANVAS_LABELS[lang] || MAIN_CANVAS_LABELS[DEFAULT_LANG];
  return pages.map((p) => ({ id: p, label: p === "main" ? main : labels[p] }));
}

export function fieldTemplatesFor(template, lang, typeIds) {
  const pick = (source) => source[lang] || source[DEFAULT_LANG] || {};
  const base = pick(FIELD_TEMPLATES);
  const special = pick(TEMPLATE_FIELD_TEMPLATES[template] || {});
  const out = {};
  for (const typeId of typeIds) {
    const keys = special[typeId] || base[typeId];
    if (keys) out[typeId] = [...keys];
  }
  return out;
}

/** Настройки по умолчанию — те же, что DEFAULT_SETTINGS в server.py. */
export const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "#39BEE6",
  font: "Manrope",
  displayFont: "Space Grotesk",
  edgeType: "smoothstep",
  showGrid: true,
  showMiniMap: true,
  snapToGrid: false,
  animatedEdges: false,
  nodeTypes: nodeTypesFor(DEFAULT_LANG),
  canvases: [{ id: "main", label: MAIN_CANVAS_LABELS[DEFAULT_LANG] }],
  relTypes: [],
  fieldTemplates: {},
  template: DEFAULT_TEMPLATE,
  calendar: null,
  eras: [],
};

export function settingsForTemplate(template, lang = DEFAULT_LANG) {
  const id = TEMPLATES[template] ? template : DEFAULT_TEMPLATE;
  const spec = TEMPLATES[id];
  return {
    ...DEFAULT_SETTINGS,
    nodeTypes: nodeTypesFor(lang, spec.types),
    relTypes: relTypesFor(lang, spec.rels),
    canvases: canvasesFor(id, lang),
    fieldTemplates: fieldTemplatesFor(id, lang, spec.types),
    template: id,
  };
}

/* ---------------- пример кампании ---------------- */

// (ключ, тип, x, y, теги)
export const DND_STARTER_NODES = [
  ["vale", "location", 80, 40, ["region"]],
  ["town", "location", 420, 40, ["town"]],
  ["barrow", "location", 760, 40, ["dungeon"]],
  ["harbourmaster", "character", 420, 300, ["npc"]],
  ["warden", "character", 80, 300, ["npc"]],
  ["pact", "faction", 760, 300, ["cult"]],
  ["villain", "character", 420, 560, ["villain"]],
  ["crown", "item", 80, 560, ["artefact"]],
  ["quest", "quest", 760, 560, ["active"]],
];

// (откуда, куда, тип связи)
export const DND_STARTER_EDGES = [
  ["town", "vale", ""], ["barrow", "vale", ""], ["harbourmaster", "town", ""],
  ["warden", "town", ""], ["pact", "barrow", ""], ["villain", "pact", "member"],
  ["harbourmaster", "pact", ""], ["crown", "warden", "owns"], ["quest", "barrow", ""],
];

export const DND_STARTER_DATES = {
  barrow: [["construction", { kind: "before", y: 900 }]],
  crown: [["created", { kind: "approx", y: 1020, spread: { amount: 30, unit: "year" } }]],
  town: [["created", { kind: "between", y: 1080, y2: 1110 }]],
  villain: [["birth", { kind: "exact", y: 1141 }]],
  warden: [["birth", { kind: "exact", y: 1149 }]],
  harbourmaster: [["birth", { kind: "exact", y: 1158, m: 4, d: 12 }]],
  pact: [["created", { kind: "exact", y: 1179, m: 11 }]],
  quest: [["date", { kind: "exact", rel: { node: "pact", amount: 6, unit: "year", dir: "after" } }]],
};

export const DND_STARTER_TEXT = {
  en: {
    vale: ["Thundertree Vale", "Pine-dark valley between the coast road and the barrow hills. Everything in this campaign happens inside it."],
    town: ["Brackenford", "Fishing town of nine hundred. One inn, one temple, one harbourmaster — and every one of them owes somebody."],
    barrow: ["Ashen Barrow", "Sealed tomb under the ridge. Something inside has started counting days."],
    harbourmaster: ["Maelor Vance", "Harbourmaster of Brackenford. Sells the party passage north; sells word of their passage the same evening."],
    warden: ["Sister Ilva", "Temple warden who knows what was buried and will not say it aloud."],
    pact: ["The Ember Pact", "Smugglers turned zealots. They want the barrow open before midwinter."],
    villain: ["Korrath the Hollow", "The Pact's founder. Was a knight of the crown before the crown broke."],
    crown: ["The Sundered Crown", "Half a circlet of pale gold. The other half is in the barrow."],
    quest: ["Silence the Barrow", "Reach the tomb before the Pact finishes the seal-breaking rite."],
  },
  ru: {
    vale: ["Громовая долина", "Тёмная от сосен долина между прибрежной дорогой и курганными холмами. Всё в этой кампании происходит внутри неё."],
    town: ["Брекенфорд", "Рыбацкий городок на девятьсот душ. Одна таверна, один храм, один начальник порта — и каждый из них кому-то должен."],
    barrow: ["Пепельный курган", "Запечатанная гробница под хребтом. Что-то внутри начало считать дни."],
    harbourmaster: ["Мейлор Вэнс", "Начальник порта Брекенфорда. Продаёт отряду проход на север; тем же вечером продаёт весть об этом проходе."],
    warden: ["Сестра Ильва", "Хранительница храма. Знает, что похоронено под хребтом, и вслух не скажет."],
    pact: ["Пакт Углей", "Контрабандисты, ставшие фанатиками. Хотят вскрыть курган до середины зимы."],
    villain: ["Коррат Полый", "Основатель Пакта. Был рыцарем короны, пока корона не раскололась."],
    crown: ["Расколотая корона", "Половина венца из бледного золота. Вторая половина — в кургане."],
    quest: ["Заставить курган молчать", "Добраться до гробницы раньше, чем Пакт закончит обряд снятия печати."],
  },
};
