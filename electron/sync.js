"use strict";
/**
 * Папка синхронизации.
 *
 * Своего облака у BlueGem нет, и заводить его ради синхронизации незачем:
 * у человека уже есть Google Drive, Dropbox, OneDrive или Syncthing, и все
 * они умеют одно — держать папку одинаковой на нескольких устройствах. Здесь
 * приложение кладёт в такую папку по файлу .bgproj на проект и следит, не
 * поменял ли кто-то эти файлы. Само слияние версий делает интерфейс
 * (frontend/src/lib/sync), оболочка только читает и пишет файлы.
 *
 * Окну доступны только файлы *.bgproj прямо в выбранной папке — без
 * подпапок и без путей: имя проверяется здесь, а не в интерфейсе.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { dialog, shell } = require("electron");
const log = require("./logger");

const EXT = ".bgproj";
const WATCH_DEBOUNCE_MS = 800;

class FolderSync {
  constructor(dataDir, getWindow) {
    this.file = path.join(dataDir, "sync.json");
    this.getWindow = getWindow;
    this.folder = this.read().folder || "";
    this.watcher = null;
    this.timer = null;
    this.watch();
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) || {};
    } catch {
      return {};
    }
  }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify({ folder: this.folder }, null, 2));
    } catch (e) {
      log.error("sync: cannot save settings", e);
    }
  }

  state() {
    const ok = !!this.folder && fs.existsSync(this.folder);
    return { folder: this.folder, available: ok };
  }

  /** Имя файла из окна → полный путь, или ошибка, если имя не наше. */
  resolve(name) {
    const n = String(name || "");
    if (!this.folder) throw new Error("Sync folder is not set");
    if (path.basename(n) !== n || !n.toLowerCase().endsWith(EXT) || n.startsWith(".")) {
      throw new Error("Bad file name");
    }
    return path.join(this.folder, n);
  }

  watch() {
    this.unwatch();
    if (!this.folder || !fs.existsSync(this.folder)) return;
    try {
      this.watcher = fs.watch(this.folder, { persistent: false }, (_type, name) => {
        if (name && !String(name).toLowerCase().endsWith(EXT)) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const win = this.getWindow();
          if (win && !win.isDestroyed()) win.webContents.send("bg:sync-changed");
        }, WATCH_DEBOUNCE_MS);
      });
      this.watcher.on("error", (e) => log.warn("sync: watcher error", e));
    } catch (e) {
      // Сетевые и облачные диски иногда не дают следить за папкой — тогда
      // остаётся проверка по таймеру со стороны интерфейса.
      log.warn("sync: cannot watch folder", e);
    }
  }

  unwatch() {
    clearTimeout(this.timer);
    try { this.watcher?.close(); } catch { /* уже закрыт */ }
    this.watcher = null;
  }

  register(ipcMain) {
    ipcMain.handle("bg:sync-state", () => this.state());

    ipcMain.handle("bg:sync-choose", async (_e, options = {}) => {
      const win = this.getWindow();
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: String(options.title || ""),
        defaultPath: this.folder || undefined,
        properties: ["openDirectory", "createDirectory", "promptToCreate"],
      });
      if (canceled || !filePaths[0]) return { ...this.state(), canceled: true };
      this.folder = filePaths[0];
      await fsp.mkdir(this.folder, { recursive: true }).catch(() => {});
      this.save();
      this.watch();
      return this.state();
    });

    ipcMain.handle("bg:sync-disable", () => {
      this.folder = "";
      this.save();
      this.unwatch();
      return this.state();
    });

    ipcMain.handle("bg:sync-list", async () => {
      if (!this.state().available) return [];
      const names = await fsp.readdir(this.folder).catch(() => []);
      const out = [];
      for (const name of names) {
        if (!name.toLowerCase().endsWith(EXT) || name.startsWith(".")) continue;
        try {
          const st = await fsp.stat(path.join(this.folder, name));
          if (st.isFile()) out.push({ name, mtimeMs: st.mtimeMs, size: st.size });
        } catch { /* файл успели убрать */ }
      }
      return out;
    });

    ipcMain.handle("bg:sync-read", async (_e, name) => fsp.readFile(this.resolve(name), "utf8"));

    // Запись через временный файл: облачный клиент не должен увидеть и
    // разослать по устройствам наполовину записанный проект.
    ipcMain.handle("bg:sync-write", async (_e, name, text) => {
      const target = this.resolve(name);
      const tmp = path.join(this.folder, `.${name}.${process.pid}.tmp`);
      await fsp.writeFile(tmp, String(text ?? ""), "utf8");
      await fsp.rename(tmp, target);
      return { ok: true };
    });

    // В корзину, а не насовсем: удалить проект на одном устройстве и потерять
    // его на всех — слишком дорогая ошибка.
    ipcMain.handle("bg:sync-trash", async (_e, name) => {
      const target = this.resolve(name);
      if (!fs.existsSync(target)) return { ok: true };
      await shell.trashItem(target);
      return { ok: true };
    });

    ipcMain.handle("bg:sync-reveal", () => (this.folder ? shell.openPath(this.folder) : ""));
  }
}

module.exports = { FolderSync };
