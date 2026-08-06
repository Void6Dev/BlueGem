"use strict";
/**
 * Мост между окном и основным процессом.
 *
 * В окно попадает только этот объект — ни node, ни ipcRenderer напрямую
 * интерфейсу не видны (contextIsolation + sandbox включены в main.js).
 * Интерфейс проверяет `window.bluegem` и, если его нет, работает как
 * обычная веб-страница — тот же код открывается в браузере при разработке.
 */
const { contextBridge, ipcRenderer } = require("electron");

// Синхронно: адрес сервера и токен нужны ещё до того, как выполнится код React.
const config = ipcRenderer.sendSync("bg:config") || {};

contextBridge.exposeInMainWorld("bluegem", {
  isDesktop: true,
  version: config.version || "",
  platform: config.platform || process.platform,
  /** Базовый адрес встроенного сервера; пусто — значит тот же origin. */
  apiBase: config.apiBase || "",
  /** Общий секрет: без него сервер не отвечает на /api. */
  token: config.token || "",
  dataDir: config.dataDir || "",

  /** Системный диалог сохранения. Возвращает { ok, canceled, path, error }. */
  saveFile: (options) => ipcRenderer.invoke("bg:save-file", options),
  /** Системный диалог открытия. Возвращает { ok, canceled, path, content, error }. */
  openFile: (options) => ipcRenderer.invoke("bg:open-file", options),
  /** Файл, с которым приложение запустили (двойной клик по .bgproj), если он был. */
  takePendingProject: () => ipcRenderer.invoke("bg:take-pending-project"),
  /** Системный вопрос с кнопками. Возвращает индекс нажатой кнопки. */
  ask: (options) => ipcRenderer.invoke("bg:ask", options),
  /** Показать файл в проводнике. */
  reveal: (target) => ipcRenderer.invoke("bg:reveal", target),
  /** Открыть ссылку во внешнем браузере. */
  openExternal: (url) => ipcRenderer.invoke("bg:open-external", url),
  /** Показать файл лога в проводнике (нужно странице ошибки). */
  openLog: () => ipcRenderer.invoke("bg:open-log"),
  /** Перезапустить приложение целиком (кнопка на странице ошибки). */
  restart: () => ipcRenderer.invoke("bg:restart"),
  /** Сообщить оболочке выбранный язык: меню и диалоги следуют за интерфейсом. */
  setLanguage: (lang) => ipcRenderer.invoke("bg:set-language", lang),

  /** Проект, открытый через «Открыть…» или ассоциацию файлов. */
  onOpenProject: (handler) => subscribe("bg:open-project", handler),
  /** Команды из меню приложения: "new-project", "import-project". */
  onMenuCommand: (handler) => subscribe("bg:menu", handler),
  /** Язык переключили в меню оболочки — интерфейсу нужно подхватить. */
  onLanguage: (handler) => subscribe("bg:language", handler),

  /**
   * Обновления через релизы GitHub (см. electron/update.js).
   * state()   — что уже известно, без запросов в сеть;
   * check()   — проверить (force обходит суточный кэш);
   * install() — скачать установщик этого тега и запустить его; тег любой,
   *             поэтому откат на старую версию — тот же вызов.
   */
  update: {
    state: () => ipcRenderer.invoke("bg:update-state"),
    check: (options) => ipcRenderer.invoke("bg:update-check", options || {}),
    install: (tag) => ipcRenderer.invoke("bg:update-install", tag),
    onProgress: (handler) => subscribe("bg:update-progress", handler),
  },
  /** Открыть форму нового issue с подставленной версией и системой. */
  sendFeedback: (payload) => ipcRenderer.invoke("bg:feedback", payload || {}),
});

/** Подписка, отдающая наружу только полезную нагрузку (без объекта события). */
function subscribe(channel, handler) {
  if (typeof handler !== "function") return () => {};
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
