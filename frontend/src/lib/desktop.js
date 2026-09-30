// Тонкая обёртка над мостом Electron (см. electron/preload.js).
//
// Весь остальной код спрашивает `isDesktop` и вызывает функции отсюда: в
// браузере они честно возвращают null/false, и интерфейс сам выбирает
// запасной путь (обычная загрузка файла, <input type="file"> и так далее).
import { t } from "@/lib/i18n";

const bridge = typeof window !== "undefined" ? window.bluegem : null;

/** Приложение запущено внутри десктопной оболочки, а не во вкладке браузера. */
export const isDesktop = Boolean(bridge && bridge.isDesktop);

export const appVersion = bridge?.version || "";

/** Адрес встроенного сервера. Пусто — значит API на том же origin. */
export const apiBase = bridge?.apiBase || "";

/** Секрет, с которым встроенный сервер принимает запросы. */
export const apiToken = bridge?.token || "";

/** Фильтры системных диалогов; названия зависят от языка интерфейса. */
export function projectFilters() {
  return [
    // swproj — расширение прежних выгрузок, они должны открываться как раньше.
    { name: t("file.projectFilter"), extensions: ["bgproj", "swproj", "json"] },
    { name: t("file.allFiles"), extensions: ["*"] },
  ];
}

/**
 * Сохранить текст в файл системным диалогом.
 * @returns {Promise<{ok: boolean, canceled?: boolean, path?: string, error?: string}>}
 */
export function saveTextFile({ defaultPath, content, filters }) {
  if (!isDesktop) return Promise.resolve({ ok: false, error: t("errors.outsideApp") });
  return bridge.saveFile({ defaultPath, content, filters });
}

/** Выбрать файл проекта системным диалогом. */
export function pickProjectFile() {
  if (!isDesktop) return Promise.resolve({ ok: false, canceled: true });
  return bridge.openFile({ title: t("file.openTitle"), filters: projectFilters() });
}

/** Файл, с которым запустили приложение (двойной клик по .bgproj). */
export function takePendingProject() {
  if (!isDesktop) return Promise.resolve(null);
  return bridge.takePendingProject();
}

/** Подписка на открытие файла проекта уже во время работы. */
export function onOpenProject(handler) {
  return isDesktop ? bridge.onOpenProject(handler) : () => {};
}

/** Подписка на команды меню приложения ("new-project"). */
export function onMenuCommand(handler) {
  return isDesktop ? bridge.onMenuCommand(handler) : () => {};
}

/** Язык переключили в меню оболочки — интерфейс должен последовать за ним. */
export function onLanguage(handler) {
  return isDesktop ? bridge.onLanguage(handler) : () => {};
}

/**
 * Системный вопрос с кнопками. Возвращает индекс нажатой кнопки,
 * −1 — если спросить не у кого (запуск в браузере).
 */
export function ask(options) {
  return isDesktop ? bridge.ask(options) : Promise.resolve(-1);
}

/** Показать сохранённый файл в проводнике. */
export function reveal(target) {
  if (isDesktop && target) bridge.reveal(target);
}

/** Открыть ссылку в системном браузере (в вебе — обычная новая вкладка). */
export function openExternal(url) {
  if (isDesktop) bridge.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/* ------------------------------------------------------------------ */
/* Обновления                                                          */
/* ------------------------------------------------------------------ */

// В браузере обновлять нечего: страница и так всегда свежая. Поэтому все
// вызовы честно отвечают «нет данных», а интерфейс прячет кнопку.
const noUpdates = { repo: "", current: appVersion, releases: [], latest: null, error: "", checking: false };

export const updates = {
  supported: isDesktop && !!bridge.update,
  state: () => (isDesktop && bridge.update ? bridge.update.state() : Promise.resolve(noUpdates)),
  check: (options) => (isDesktop && bridge.update ? bridge.update.check(options) : Promise.resolve(noUpdates)),
  install: (tag) => (isDesktop && bridge.update
    ? bridge.update.install(tag)
    : Promise.resolve({ ok: false, error: "unsupported" })),
  onProgress: (handler) => (isDesktop && bridge.update ? bridge.update.onProgress(handler) : () => {}),
};

/**
 * Отправить отзыв письмом автору. Умеет это только оболочка: из браузера запрос
 * не уйдёт — чужой домен закроет его политикой CORS. Поэтому в браузере сразу
 * отдаём отказ, а интерфейс предлагает запасной путь.
 */
export function sendFeedback({ title, body, kind, email }) {
  if (isDesktop && bridge.sendFeedback) return bridge.sendFeedback({ title, body, kind, email });
  return Promise.resolve({ ok: false, error: "unsupported" });
}

/** Запасной путь: форма нового issue с уже подставленным текстом. */
export function openFeedbackIssue({ title, body, kind }) {
  if (isDesktop && bridge.feedbackUrl) return bridge.feedbackUrl({ title, body, kind });
  const params = new URLSearchParams({ title: title || "", body: body || "" });
  const url = `https://github.com/Void6Dev/BlueGem/issues/new?${params.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve({ ok: true, url });
}
