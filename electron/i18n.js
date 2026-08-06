"use strict";
/**
 * Язык оболочки: меню, системные диалоги, страница ошибки.
 *
 * Интерфейс хранит выбор в localStorage, но меню строится ещё до того, как
 * окно загрузилось, поэтому язык дублируется в файле настроек рядом с базой.
 * Когда пользователь переключает язык в интерфейсе, тот присылает событие
 * (см. `bg:set-language` в main.js), и меню собирается заново.
 */
const fs = require("node:fs");
const path = require("node:path");

const DICTS = {
  en: {
    menu: {
      file: "File",
      newProject: "New project",
      openProject: "Open project…",
      dataFolder: "Data folder",
      quit: "Quit",
      edit: "Edit",
      undo: "Undo",
      redo: "Redo",
      cut: "Cut",
      copy: "Copy",
      paste: "Paste",
      selectAll: "Select all",
      view: "View",
      reload: "Reload",
      devTools: "Developer tools",
      resetZoom: "Actual size",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      fullscreen: "Full screen",
      help: "Help",
      openLog: "Open log",
      about: "About",
      language: "Language",
    },
    about: {
      title: "About",
      tagline: "A visual worldbuilding canvas.",
      offline: "Runs entirely on this computer: no internet needed,\nnothing is sent anywhere.",
      data: "Data: {dir}",
      close: "Close",
    },
    dialog: {
      openProject: "Open a BlueGem project",
      projectFilter: "BlueGem project",
      allFiles: "All files",
      saveAs: "Save as",
      openFailed: "Could not open the file",
      nothingToSave: "Nothing to save",
      tooLarge: "The file is too large ({size} MB)",
      ok: "OK",
    },
    backend: {
      missing: "The server component is missing from the installed app.",
      missingDetail: "Expected file:\n{path}\n\nThe installation looks damaged — reinstall BlueGem.",
      noVenv: "The backend/.venv environment was not found.",
      noVenvDetail: "To run in development mode, create it:\n"
        + "  python -m venv backend\\.venv\n"
        + "  backend\\.venv\\Scripts\\python.exe -m pip install -r backend\\requirements.txt",
      exited: "The built-in server exited with code {code}.",
      silent: "The server left no error message.",
      timeout: "The built-in server did not respond in time.",
      checked: "Checked {url}",
      noPort: "Could not reserve a local port for the built-in server.",
      crashed: "The built-in server stopped (code {code}).",
      windowGone: "The application window closed unexpectedly.",
      windowGoneDetail: "Reason: {reason}. Your project data is safe in the database — press “Restart”.",
      internal: "Internal application error.",
      startFailed: "BlueGem failed to start",
    },
    error: {
      badge: "Startup error",
      title: "BlueGem could not start",
      lead: "Your projects are unharmed — they live in the local database and are still there. Below is what the program reported.",
      noDetails: "No further details.",
      logLine: "Full log: {path}",
      restart: "Restart",
      showLog: "Show log",
      copy: "Copy the error text",
      copied: "Copied",
    },
    loading: {
      hint: "Starting the local server…",
    },
  },

  ru: {
    menu: {
      file: "Файл",
      newProject: "Новый проект",
      openProject: "Открыть проект…",
      dataFolder: "Папка с данными",
      quit: "Выход",
      edit: "Правка",
      undo: "Отменить",
      redo: "Повторить",
      cut: "Вырезать",
      copy: "Копировать",
      paste: "Вставить",
      selectAll: "Выделить всё",
      view: "Вид",
      reload: "Обновить",
      devTools: "Инструменты разработчика",
      resetZoom: "Масштаб по умолчанию",
      zoomIn: "Крупнее",
      zoomOut: "Мельче",
      fullscreen: "Во весь экран",
      help: "Справка",
      openLog: "Открыть лог",
      about: "О программе",
      language: "Язык",
    },
    about: {
      title: "О программе",
      tagline: "Визуальный конструктор миров.",
      offline: "Работает полностью на этом компьютере: интернет не нужен,\nданные никуда не отправляются.",
      data: "Данные: {dir}",
      close: "Закрыть",
    },
    dialog: {
      openProject: "Открыть проект BlueGem",
      projectFilter: "Проект BlueGem",
      allFiles: "Все файлы",
      saveAs: "Сохранить как",
      openFailed: "Не удалось открыть файл",
      nothingToSave: "Нечего сохранять",
      tooLarge: "Файл слишком большой ({size} МБ)",
      ok: "ОК",
    },
    backend: {
      missing: "Серверная часть не найдена в установленном приложении.",
      missingDetail: "Ожидался файл:\n{path}\n\nПохоже, установка повреждена — переустановите BlueGem.",
      noVenv: "Не найдено окружение backend/.venv.",
      noVenvDetail: "Для запуска в режиме разработки создайте его:\n"
        + "  python -m venv backend\\.venv\n"
        + "  backend\\.venv\\Scripts\\python.exe -m pip install -r backend\\requirements.txt",
      exited: "Встроенный сервер завершился с кодом {code}.",
      silent: "Сервер не оставил сообщений об ошибке.",
      timeout: "Встроенный сервер не ответил за отведённое время.",
      checked: "Проверялся адрес {url}",
      noPort: "Не удалось занять локальный порт для встроенного сервера.",
      crashed: "Встроенный сервер остановился (код {code}).",
      windowGone: "Окно приложения аварийно закрылось.",
      windowGoneDetail: "Причина: {reason}. Данные проектов сохранены в базе — нажмите «Перезапустить».",
      internal: "Внутренняя ошибка приложения.",
      startFailed: "BlueGem не запустился",
    },
    error: {
      badge: "Ошибка запуска",
      title: "Не удалось запустить BlueGem",
      lead: "Данные проектов не пострадали — они лежат в локальной базе и никуда не делись. Ниже то, что сообщила программа.",
      noDetails: "Дополнительных сведений нет.",
      logLine: "Полный лог: {path}",
      restart: "Перезапустить",
      showLog: "Показать лог",
      copy: "Скопировать текст ошибки",
      copied: "Скопировано",
    },
    loading: {
      hint: "Запускаю локальный сервер…",
    },
  },
};

let lang = "en";
let settingsFile = null;

function lookup(dict, key) {
  return key.split(".").reduce((node, part) => (node == null ? node : node[part]), dict);
}

/** Перевод по ключу с подстановкой {переменных}. */
function t(key, vars) {
  const value = lookup(DICTS[lang], key) ?? lookup(DICTS.en, key);
  if (value == null) return key;
  return String(value).replace(/\{(\w+)\}/g, (whole, name) =>
    (vars && name in vars ? String(vars[name]) : whole));
}

/**
 * Читает сохранённый язык. Если его ещё нет — берём язык системы,
 * чтобы первое окно уже было понятным.
 */
function init(dataDir, systemLocale) {
  settingsFile = path.join(dataDir, "preferences.json");
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    if (DICTS[saved.language]) {
      lang = saved.language;
      return lang;
    }
  } catch {
    /* файла ещё нет — это первый запуск */
  }
  lang = String(systemLocale || "en").toLowerCase().startsWith("ru") ? "ru" : "en";
  return lang;
}

function setLanguage(next) {
  if (!DICTS[next] || next === lang) return false;
  lang = next;
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ language: lang }, null, 2), "utf8");
  } catch {
    /* не сохранилось — язык всё равно применится к текущему сеансу */
  }
  return true;
}

const getLanguage = () => lang;

module.exports = { t, init, setLanguage, getLanguage, LANGUAGES: Object.keys(DICTS) };
