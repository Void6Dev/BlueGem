"use strict";
/** Меню приложения. Всё по-русски, как и остальной интерфейс. */
const { Menu, shell, dialog, app } = require("electron");

/**
 * @param {object} ctx
 * @param {() => void} ctx.openProject   спросить файл проекта и открыть его
 * @param {(cmd: string) => void} ctx.send  отправить команду в интерфейс
 * @param {string} ctx.dataDir           папка с базой и настройками
 * @param {() => string} ctx.logFile     путь к файлу лога
 * @param {() => Electron.BrowserWindow} ctx.window
 */
function buildMenu(ctx) {
  const template = [
    {
      label: "Файл",
      submenu: [
        { label: "Новый проект", accelerator: "CmdOrCtrl+N", click: () => ctx.send("new-project") },
        { label: "Открыть проект…", accelerator: "CmdOrCtrl+O", click: () => ctx.openProject() },
        { type: "separator" },
        {
          label: "Папка с данными",
          click: () => shell.openPath(ctx.dataDir),
        },
        { type: "separator" },
        { label: "Выход", role: "quit" },
      ],
    },
    {
      label: "Правка",
      submenu: [
        // Ctrl+Z в приложении возвращает удалённые узлы, поэтому сочетание
        // оставляем странице: пункт меню работает, но клавиши не перехватывает.
        { label: "Отменить", role: "undo", registerAccelerator: false },
        { label: "Повторить", role: "redo", registerAccelerator: false },
        { type: "separator" },
        { label: "Вырезать", role: "cut" },
        { label: "Копировать", role: "copy" },
        { label: "Вставить", role: "paste" },
        { label: "Выделить всё", role: "selectAll", registerAccelerator: false },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { label: "Обновить", role: "reload" },
        { label: "Инструменты разработчика", role: "toggleDevTools" },
        { type: "separator" },
        { label: "Масштаб по умолчанию", role: "resetZoom" },
        { label: "Крупнее", role: "zoomIn" },
        { label: "Мельче", role: "zoomOut" },
        { type: "separator" },
        { label: "Во весь экран", role: "togglefullscreen" },
      ],
    },
    {
      label: "Справка",
      submenu: [
        {
          label: "Открыть лог",
          click: () => {
            const file = ctx.logFile();
            if (file) shell.showItemInFolder(file);
          },
        },
        { type: "separator" },
        {
          label: "О программе",
          click: () => {
            dialog.showMessageBox(ctx.window(), {
              type: "info",
              title: "О программе",
              message: `BlueGem ${app.getVersion()}`,
              detail: [
                "Визуальный конструктор миров.",
                "",
                "Работает полностью на этом компьютере: интернет не нужен,",
                "данные никуда не отправляются.",
                "",
                `Данные: ${ctx.dataDir}`,
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
              ].join("\n"),
              buttons: ["Закрыть"],
            });
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
