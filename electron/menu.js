"use strict";
/** Меню приложения. Подписи берутся из electron/i18n.js и следуют за языком. */
const { Menu, shell, dialog, app } = require("electron");
const { t, getLanguage, LANGUAGES } = require("./i18n");

const LANGUAGE_LABELS = { en: "English", ru: "Русский" };

/**
 * @param {object} ctx
 * @param {() => void} ctx.openProject   спросить файл проекта и открыть его
 * @param {(cmd: string) => void} ctx.send  отправить команду в интерфейс
 * @param {(lang: string) => void} ctx.setLanguage переключить язык из меню
 * @param {string} ctx.dataDir           папка с базой и настройками
 * @param {() => string} ctx.logFile     путь к файлу лога
 * @param {() => Electron.BrowserWindow} ctx.window
 */
function buildMenu(ctx) {
  const template = [
    {
      label: t("menu.file"),
      submenu: [
        // Ctrl+Shift+N, а не Ctrl+N: акселератор меню перехватывается в главном
        // процессе раньше страницы, и обычный Ctrl+N не давал создать заметку
        // на холсте — там он нужнее, чем новый проект.
        { label: t("menu.newProject"), accelerator: "CmdOrCtrl+Shift+N", click: () => ctx.send("new-project") },
        { label: t("menu.openProject"), accelerator: "CmdOrCtrl+O", click: () => ctx.openProject() },
        { type: "separator" },
        { label: t("menu.dataFolder"), click: () => shell.openPath(ctx.dataDir) },
        { type: "separator" },
        { label: t("menu.quit"), role: "quit" },
      ],
    },
    {
      label: t("menu.edit"),
      submenu: [
        // Ctrl+Z в приложении возвращает удалённые узлы, поэтому сочетание
        // оставляем странице: пункт меню работает, но клавиши не перехватывает.
        { label: t("menu.undo"), role: "undo", registerAccelerator: false },
        { label: t("menu.redo"), role: "redo", registerAccelerator: false },
        { type: "separator" },
        { label: t("menu.cut"), role: "cut" },
        { label: t("menu.copy"), role: "copy" },
        { label: t("menu.paste"), role: "paste" },
        { label: t("menu.selectAll"), role: "selectAll", registerAccelerator: false },
      ],
    },
    {
      label: t("menu.view"),
      submenu: [
        { label: t("menu.reload"), role: "reload" },
        { label: t("menu.devTools"), role: "toggleDevTools" },
        { type: "separator" },
        { label: t("menu.resetZoom"), role: "resetZoom" },
        { label: t("menu.zoomIn"), role: "zoomIn" },
        { label: t("menu.zoomOut"), role: "zoomOut" },
        { type: "separator" },
        { label: t("menu.fullscreen"), role: "togglefullscreen" },
        { type: "separator" },
        {
          label: t("menu.language"),
          submenu: LANGUAGES.map((id) => ({
            label: LANGUAGE_LABELS[id] || id,
            type: "radio",
            checked: getLanguage() === id,
            click: () => ctx.setLanguage(id),
          })),
        },
      ],
    },
    {
      label: t("menu.help"),
      submenu: [
        {
          label: t("menu.openLog"),
          click: () => {
            const file = ctx.logFile();
            if (file) shell.showItemInFolder(file);
          },
        },
        { type: "separator" },
        {
          label: t("menu.about"),
          click: () => {
            dialog.showMessageBox(ctx.window(), {
              type: "info",
              title: t("about.title"),
              message: `BlueGem ${app.getVersion()}`,
              detail: [
                t("about.tagline"),
                "",
                t("about.offline"),
                "",
                t("about.data", { dir: ctx.dataDir }),
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
              ].join("\n"),
              buttons: [t("about.close")],
            });
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
