"use strict";
/**
 * Основной процесс BlueGem.
 *
 * Что здесь происходит по шагам:
 *   1. проверяем, что приложение одно (второй запуск отдаёт файл первому);
 *   2. открываем окно с заставкой — пользователь сразу видит реакцию;
 *   3. поднимаем встроенный сервер на свободном порту 127.0.0.1;
 *   4. загружаем в окно его адрес; при неудаче — понятную страницу ошибки;
 *   5. при выходе гасим сервер.
 *
 * Ни фронтенд, ни бэкенд не знают, что запущены внутри Electron: интерфейс
 * получает адрес API через preload, сервер — через переменные окружения.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const log = require("./logger");
const { Backend, BackendError } = require("./backend");
const { WindowState, MIN } = require("./window-state");
const { buildMenu } = require("./menu");
const i18n = require("./i18n");
const updater = require("./update");

const APP_ID = "com.bluegem.app";
const PROJECT_ROOT = path.join(__dirname, "..");
const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const projectFilters = () => [
  // swproj — расширение прежних выгрузок, открывать их приложение обязано.
  { name: i18n.t("dialog.projectFilter"), extensions: ["bgproj", "swproj", "json"] },
  { name: i18n.t("dialog.allFiles"), extensions: ["*"] },
];

/** Каталог собранного интерфейса. В разработке его может не быть — тогда dev-сервер. */
function staticDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, "app-ui");
  const local = path.join(PROJECT_ROOT, "frontend", "build");
  return fs.existsSync(path.join(local, "index.html")) ? local : "";
}

// Портативная сборка складывает данные рядом с exe, а не в %APPDATA%: на то
// она и портативная — флешку можно унести вместе с проектами.
// PORTABLE_EXECUTABLE_DIR выставляет сам портативный лаунчер electron-builder.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath("userData", path.join(process.env.PORTABLE_EXECUTABLE_DIR, "BlueGem-Data"));
}

let win = null;
let backend = null;
let windowState = null;
let pendingProject = null; // файл, с которым запустили приложение
let rendererReady = false; // интерфейс загрузился и готов принимать файлы
let quitting = false;

/* ------------------------------------------------------------------ */
/* Один экземпляр                                                      */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  // Уже запущено: файл из аргументов подхватит первый экземпляр.
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const file = projectFileFromArgv(argv);
    if (file) openProjectFile(file);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(boot).catch(fatal);
}

/* ------------------------------------------------------------------ */
/* Запуск                                                              */
/* ------------------------------------------------------------------ */

async function boot() {
  app.setAppUserModelId(APP_ID);

  const dataDir = app.getPath("userData");
  const logDir = path.join(dataDir, "logs");
  log.init(logDir);
  // Язык нужен до создания меню и до первого диалога.
  log.info(`язык оболочки: ${i18n.init(dataDir, app.getLocale())}`);
  log.info(`версия ${app.getVersion()}, данные: ${dataDir}, упаковано: ${app.isPackaged}`);

  hardenSession();
  registerIpc(dataDir);

  adoptLegacyDatabase(dataDir);

  windowState = new WindowState(path.join(dataDir, "window-state.json"));
  createWindow();

  applyMenu(dataDir);

  pendingProject = await readProjectFile(projectFileFromArgv(process.argv)).catch(() => null);

  await startBackend({ dataDir, logDir });

  // Проверка релизов — раз в запуск и в фоне: она не должна задерживать ни
  // окно, ни сервер, а её неудача (нет сети) не влияет ни на что.
  updater.init(dataDir);
  updater.check().catch((e) => log.warn(`проверка обновлений: ${e.message}`));
}

/**
 * Первый запуск после перехода на десктопную версию: если база из прежней
 * связки «uvicorn + npm start» лежит рядом, забираем её в профиль пользователя.
 * Иначе человек открыл бы приложение и не нашёл своих миров.
 */
function adoptLegacyDatabase(dataDir) {
  const target = path.join(dataDir, "bluegem.db");
  if (fs.existsSync(target)) return; // база уже своя — ничего не трогаем

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const candidates = [
    // Сначала — база нынешнего имени рядом с исходниками.
    path.join(PROJECT_ROOT, "backend", "bluegem.db"),
    portableDir && path.join(portableDir, "backend", "bluegem.db"),
    // Затем — всё, что осталось от версии, которая называлась StoryWeave.
    path.join(app.getPath("appData"), "StoryWeave", "storyweave.db"),
    path.join(PROJECT_ROOT, "backend", "storyweave.db"),
    portableDir && path.join(portableDir, "backend", "storyweave.db"),
    portableDir && path.join(portableDir, "StoryWeave-Data", "storyweave.db"),
  ].filter(Boolean);

  const source = candidates.find((file) => fs.existsSync(file));
  if (!source) return;

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(source, target);
    log.info(`перенесена прежняя база: ${source} → ${target}`);
  } catch (e) {
    // Не смертельно: приложение просто начнёт с пустой базы.
    log.warn(`не удалось перенести прежнюю базу: ${e.message}`);
  }
}

/** Меню пересобирается целиком: у Electron нет способа переименовать пункты. */
function applyMenu(dataDir) {
  Menu.setApplicationMenu(buildMenu({
    openProject: chooseProjectFile,
    send: (cmd) => win?.webContents.send("bg:menu", cmd),
    setLanguage: (lang) => {
      // Из меню — сообщаем интерфейсу; он переключится и вернёт событие обратно.
      if (i18n.setLanguage(lang)) applyMenu(dataDir);
      win?.webContents.send("bg:language", lang);
    },
    dataDir,
    logFile: () => log.file(),
    window: () => win,
  }));
}

async function startBackend({ dataDir, logDir }) {
  backend = new Backend({
    dataDir,
    logDir,
    staticDir: staticDir(),
    projectRoot: PROJECT_ROOT,
    packaged: app.isPackaged,
  });
  backend.onCrash = (err) => showFailure(err);

  try {
    const url = await backend.start();
    // В разработке фронтенд может обслуживать CRA (npm start): scripts/dev.mjs
    // передаёт его адрес, чтобы работала горячая перезагрузка.
    const target = process.env.BG_DEV_URL || url;
    log.info(`окно загружает ${target}`);
    if (!win || win.isDestroyed()) return; // окно закрыли, пока сервер поднимался
    await win.loadURL(target);
    if (windowState.zoom) win.webContents.setZoomLevel(windowState.zoom);
  } catch (err) {
    showFailure(err);
  }
}

function createWindow() {
  win = new BrowserWindow({
    ...windowState.options,
    minWidth: MIN.width,
    minHeight: MIN.height,
    show: false,
    backgroundColor: "#0A0A0A", // тёмная тема по умолчанию — без белой вспышки
    title: "BlueGem",
    icon: path.join(PROJECT_ROOT, "build", "icon.ico"),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  windowState.manage(win);
  // Подпись на заставке приходит параметром: своего словаря у неё нет.
  win.loadFile(path.join(__dirname, "loading.html"), {
    search: new URLSearchParams({ hint: i18n.t("loading.hint") }).toString(),
  });

  win.once("ready-to-show", () => {
    if (windowState.maximized) win.maximize();
    win.show();
  });

  // Внешние ссылки (например, из описания узла) уходят в системный браузер,
  // а не подменяют собой приложение.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, legacyUrl) => {
    // Начиная с Electron 27 адрес приходит в самом объекте события,
    // вторым аргументом — ради совместимости со старой сигнатурой.
    const url = event?.url || legacyUrl || "";
    const allowed = backend?.url && url.startsWith(backend.url);
    const devUrl = process.env.BG_DEV_URL && url.startsWith(process.env.BG_DEV_URL);
    if (!allowed && !devUrl && !url.startsWith("file://")) {
      event.preventDefault();
      openExternal(url);
    }
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    log.error(`окно упало: ${details.reason}`);
    if (!quitting) {
      showFailure(new BackendError(
        i18n.t("backend.windowGone"),
        i18n.t("backend.windowGoneDetail", { reason: details.reason }),
      ));
    }
  });

  // После перезагрузки страницы слушатели интерфейса исчезают — снова ждём,
  // пока он сам запросит отложенный файл.
  win.webContents.on("did-start-navigation", (event, _url, _isInPlace, legacyIsMainFrame) => {
    if (event?.isMainFrame ?? legacyIsMainFrame ?? true) rendererReady = false;
  });

  win.on("closed", () => {
    win = null;
  });
}

/* ------------------------------------------------------------------ */
/* Ошибки                                                              */
/* ------------------------------------------------------------------ */

function showFailure(err) {
  log.error(`сбой запуска: ${err.message}`);
  if (err.details) log.error(err.details);
  if (!win || win.isDestroyed()) return;
  const params = new URLSearchParams({
    message: err.message || i18n.t("error.title"),
    details: err.details || log.recent(25),
    log: log.file() || "",
    lang: i18n.getLanguage(),
  });
  win.loadFile(path.join(__dirname, "error.html"), { search: params.toString() });
  if (!win.isVisible()) win.show();
}

function fatal(err) {
  log.error(`не удалось запуститься: ${err?.stack || err}`);
  dialog.showErrorBox(i18n.t("backend.startFailed"), String(err?.message || err));
  app.exit(1);
}

/* ------------------------------------------------------------------ */
/* Файлы проектов (.bgproj)                                            */
/* ------------------------------------------------------------------ */

/** Ищет в аргументах командной строки путь к файлу проекта. */
function projectFileFromArgv(argv = []) {
  return argv.slice(1).find(
    (arg) => !arg.startsWith("-") && /\.(bgproj|swproj|json)$/i.test(arg) && fs.existsSync(arg),
  ) || null;
}

async function readProjectFile(file) {
  if (!file) return null;
  const { size } = await fsp.stat(file);
  if (size > MAX_PROJECT_BYTES) {
    throw new Error(i18n.t("dialog.tooLarge", { size: Math.round(size / 1048576) }));
  }
  return { path: file, content: await fsp.readFile(file, "utf8") };
}

/**
 * Пока интерфейс не загрузился, файл ждёт в `pendingProject` — интерфейс сам
 * заберёт его при монтировании (sw:take-pending-project). Дальше файлы
 * приходят событием, поэтому двойной обработки не возникает.
 */
async function openProjectFile(file) {
  try {
    const payload = await readProjectFile(file);
    if (!payload) return;
    if (rendererReady && win && !win.isDestroyed()) {
      win.webContents.send("bg:open-project", payload);
    } else {
      pendingProject = payload;
    }
  } catch (err) {
    dialog.showMessageBox(win, {
      type: "error",
      title: i18n.t("dialog.openFailed"),
      message: path.basename(file),
      detail: err.message,
      buttons: [i18n.t("about.close")],
    });
  }
}

async function chooseProjectFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: i18n.t("dialog.openProject"),
    filters: projectFilters(),
    properties: ["openFile"],
  });
  if (!canceled && filePaths[0]) await openProjectFile(filePaths[0]);
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc(dataDir) {
  // Синхронно — preload запрашивает конфигурацию до выполнения кода страницы.
  ipcMain.on("bg:config", (event) => {
    event.returnValue = {
      apiBase: backend?.url || "",
      token: backend?.token || "",
      version: app.getVersion(),
      platform: process.platform,
      dataDir,
    };
  });

  ipcMain.handle("bg:save-file", async (_e, options = {}) => {
    const { defaultPath = "project.bgproj", content = "", filters = projectFilters() } = options;
    if (typeof content !== "string") return { ok: false, error: i18n.t("dialog.nothingToSave") };
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: i18n.t("dialog.saveAs"),
        defaultPath: path.join(app.getPath("documents"), path.basename(defaultPath)),
        filters,
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      await fsp.writeFile(filePath, content, "utf8");
      log.info(`сохранено: ${filePath}`);
      return { ok: true, path: filePath };
    } catch (err) {
      log.error(`не удалось сохранить: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("bg:open-file", async (_e, options = {}) => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: options.title || i18n.t("dialog.openProject"),
        filters: options.filters || projectFilters(),
        properties: ["openFile"],
      });
      if (canceled || !filePaths[0]) return { ok: false, canceled: true };
      const file = await readProjectFile(filePaths[0]);
      return { ok: true, ...file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("bg:take-pending-project", () => {
    rendererReady = true;
    const file = pendingProject;
    pendingProject = null;
    return file;
  });

  ipcMain.handle("bg:ask", async (_e, options = {}) => {
    const buttons = Array.isArray(options.buttons) && options.buttons.length
      ? options.buttons.map(String)
      : [i18n.t("dialog.ok")];
    const { response } = await dialog.showMessageBox(win, {
      type: options.type === "warning" ? "warning" : "question",
      title: options.title || "BlueGem",
      message: String(options.message || ""),
      detail: options.detail ? String(options.detail) : undefined,
      buttons,
      defaultId: 0,
      cancelId: Number.isInteger(options.cancelId) ? options.cancelId : buttons.length - 1,
      noLink: true,
    });
    return response;
  });

  ipcMain.handle("bg:reveal", (_e, target) => {
    if (typeof target === "string" && target) shell.showItemInFolder(target);
  });

  ipcMain.handle("bg:open-external", (_e, url) => openExternal(url));

  ipcMain.handle("bg:open-log", () => {
    const file = log.file();
    if (file) shell.showItemInFolder(file);
  });

  // Интерфейс переключил язык — подстраиваем меню и системные диалоги.
  ipcMain.handle("bg:set-language", (_e, lang) => {
    if (i18n.setLanguage(lang)) {
      log.info(`язык оболочки: ${lang}`);
      applyMenu(dataDir);
    }
  });

  ipcMain.handle("bg:restart", () => {
    log.info("перезапуск по просьбе пользователя");
    app.relaunch();
    app.exit(0);
  });

  /* ---- обновления ---- */

  ipcMain.handle("bg:update-state", () => updater.state());

  // force приходит от кнопки «Проверить сейчас»; без него берётся суточный кэш.
  ipcMain.handle("bg:update-check", (_e, options = {}) => updater.check({ force: !!options.force }));

  ipcMain.handle("bg:update-install", async (_e, tag) => {
    if (typeof tag !== "string" || !tag) return { ok: false, error: "bad-tag" };
    return updater.install(tag, (progress) => {
      if (win && !win.isDestroyed()) win.webContents.send("bg:update-progress", progress);
    });
  });

  ipcMain.handle("bg:feedback", (_e, options = {}) => {
    const url = updater.feedbackUrl({
      title: String(options.title || ""),
      body: String(options.body || ""),
      kind: options.kind === "bug" ? "bug" : "feedback",
    });
    openExternal(url);
    return { ok: true, url };
  });
}

/** Наружу выпускаем только http(s) — и только в системный браузер. */
function openExternal(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "http:" || protocol === "https:") return shell.openExternal(url);
    log.warn(`ссылка отклонена: ${url}`);
  } catch {
    log.warn("ссылка отклонена: неразбираемый адрес");
  }
}

/* ------------------------------------------------------------------ */
/* Безопасность сессии                                                 */
/* ------------------------------------------------------------------ */

function hardenSession() {
  const ses = session.defaultSession;

  // Приложение офлайновое: камера, микрофон, геопозиция и уведомления не нужны.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  if (!app.isPackaged) return; // в разработке CRA нужен eval для source maps
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            "script-src 'self'",
            // React расставляет стили инлайном, картинки узлов лежат как data:.
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
          ].join("; "),
        ],
      },
    });
  });
}

/* ------------------------------------------------------------------ */
/* Завершение                                                          */
/* ------------------------------------------------------------------ */

app.on("before-quit", () => {
  quitting = true;
  backend?.stop();
});

app.on("window-all-closed", () => {
  backend?.stop();
  app.quit();
});

// macOS: приложение живёт без окон, а файлы приходят отдельным событием.
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && backend?.url) createWindow();
});
app.on("open-file", (event, file) => {
  event.preventDefault();
  openProjectFile(file);
});

process.on("uncaughtException", (err) => {
  log.error(`необработанная ошибка: ${err?.stack || err}`);
  if (win && !win.isDestroyed()) {
    showFailure(new BackendError(i18n.t("backend.internal"), String(err?.stack || err)));
  } else {
    fatal(err);
  }
});
