"use strict";
/**
 * Запоминает размер, положение и состояние окна между запусками
 * (%APPDATA%\BlueGem\window-state.json).
 *
 * Отдельно проверяем, что сохранённые координаты всё ещё видимы: если окно
 * закрыли на втором мониторе, а запустили без него, приложение не должно
 * открыться за краем экрана.
 */
const fs = require("node:fs");
const path = require("node:path");
const { screen } = require("electron");

const DEFAULTS = { width: 1440, height: 900 };
const MIN = { width: 900, height: 600 };
const SAVE_DELAY_MS = 400;

class WindowState {
  constructor(file) {
    this.file = file;
    this.state = { ...DEFAULTS, maximized: false, zoom: 0, ...this.read() };
    this.timer = null;
  }

  read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const ok = ["width", "height"].every((k) => Number.isFinite(raw[k]) && raw[k] > 0);
      return ok ? raw : {};
    } catch {
      return {}; // первый запуск или битый файл — берём значения по умолчанию
    }
  }

  /** Попадает ли сохранённый прямоугольник хотя бы на один из текущих экранов. */
  isVisible({ x, y, width, height }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return screen.getAllDisplays().some(({ workArea: a }) =>
      x + width > a.x + 40 && x < a.x + a.width - 40 &&
      y + height > a.y && y < a.y + a.height - 40);
  }

  /** Параметры для конструктора BrowserWindow. */
  get options() {
    const { x, y, width, height } = this.state;
    const size = {
      width: Math.max(MIN.width, Math.round(width)),
      height: Math.max(MIN.height, Math.round(height)),
    };
    const bounds = { ...size, x, y };
    return this.isVisible(bounds) ? bounds : size; // без x/y окно встанет по центру
  }

  get maximized() {
    return Boolean(this.state.maximized);
  }

  get zoom() {
    return Number.isFinite(this.state.zoom) ? this.state.zoom : 0;
  }

  capture(win) {
    if (!win || win.isDestroyed()) return;
    // В развёрнутом виде запоминаем прежний «нормальный» прямоугольник,
    // иначе после разворачивания окно навсегда останется во весь экран.
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      Object.assign(this.state, win.getNormalBounds());
    }
    this.state.maximized = win.isMaximized();
    this.state.zoom = win.webContents.getZoomLevel();
  }

  save(win) {
    this.capture(win);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
      /* не смогли сохранить — потеря геометрии не повод мешать работе */
    }
  }

  /** Подписывается на изменения окна; запись на диск — с задержкой. */
  manage(win) {
    const schedule = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.save(win), SAVE_DELAY_MS);
    };
    for (const event of ["resize", "move", "maximize", "unmaximize"]) win.on(event, schedule);
    win.webContents.on("zoom-changed", schedule);
    win.once("close", () => {
      clearTimeout(this.timer);
      this.save(win);
    });
  }
}

module.exports = { WindowState, MIN };
