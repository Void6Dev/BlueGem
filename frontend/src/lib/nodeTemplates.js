// Свои шаблоны узлов: узел, сохранённый как заготовка.
//
// Набор подсказок характеристик для типа уже есть (settings.fieldTemplates),
// но он про ключи, а не про узел целиком. Шаблон — это готовый узел: тип,
// название, описание с разметкой, характеристики со значениями, теги, вид
// карточки. «Персонаж-NPC» с пустыми «Хочет / Боится / Голос» и тегом #npc,
// «Сессия» с заготовкой плана — то, что в мире создаётся десятками.
//
// Живут в настройках проекта (settings.nodeTemplates): переезжают вместе с
// файлом и синхронизацией. Картинки и даты в шаблон не идут — первая
// принадлежит конкретному узлу, вторые бессмысленны вне его истории.

export function makeTemplate(data, label) {
  return {
    id: `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: String(label || data?.title || "").trim() || "Template",
    typeId: data?.typeId || "note",
    title: data?.title || "",
    description: data?.description || "",
    fields: (data?.fields || []).map((f) => ({ key: f.key || "", value: f.value || "" })),
    tags: [...(data?.tags || [])],
    cardMode: data?.cardModeOwn ?? data?.cardMode ?? "",
    width: data?.width || 0,
  };
}

/** Поля нового узла из шаблона — то, что уходит в api.createNode. */
export function nodeFromTemplate(tpl) {
  return {
    typeId: tpl.typeId || "note",
    title: tpl.title || tpl.label || "",
    description: tpl.description || "",
    fields: (tpl.fields || []).map((f) => ({ key: f.key || "", value: f.value || "" })),
    tags: [...(tpl.tags || [])],
    cardMode: tpl.cardMode || "",
    width: tpl.width || 0,
  };
}

export const templatesOf = (settings) => (Array.isArray(settings?.nodeTemplates) ? settings.nodeTemplates : []);
