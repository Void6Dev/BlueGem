"use strict";
/**
 * Запуск и остановка встроенного сервера.
 *
 * Сервер — обычный процесс, который слушает только 127.0.0.1 на случайном
 * свободном порту и отдаёт и API, и сам интерфейс. Он стартует вместе с окном
 * и гасится при выходе; пользователь о нём не знает.
 *
 * В собранном приложении это `resources/backend/bluegem-backend.exe`
 * (заморожен PyInstaller'ом), при разработке — python из backend/.venv.
 */
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const log = require("./logger");

const HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 60_000;
const PORT_ATTEMPTS = 4;
const EXIT_PORT_BUSY = 98;

/** Свободный порт: просим ОС выдать любой и сразу отпускаем. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Один запрос к /api/health. Возвращает true, только если сервер ответил 200. */
function ping(port, token) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: HOST, port, path: "/api/health", method: "GET", headers: { "x-bg-token": token }, timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

class BackendError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "BackendError";
    this.details = details || "";
  }
}

class Backend {
  constructor({ dataDir, staticDir, logDir, projectRoot, packaged }) {
    this.dataDir = dataDir;
    this.staticDir = staticDir;
    this.logDir = logDir;
    this.projectRoot = projectRoot;
    this.packaged = packaged;
    this.token = crypto.randomBytes(24).toString("hex");
    this.child = null;
    this.port = null;
    this.stopping = false;
    this.output = []; // хвост stdout/stderr сервера — попадёт в окно ошибки
  }

  get url() {
    return this.port ? `http://${HOST}:${this.port}` : null;
  }

  /** Чем именно запускать сервер: замороженный exe или python из venv. */
  resolveCommand() {
    if (this.packaged) {
      const exe = path.join(process.resourcesPath, "backend", "bluegem-backend.exe");
      if (!fs.existsSync(exe)) {
        throw new BackendError(
          "Серверная часть не найдена в установленном приложении.",
          `Ожидался файл:\n${exe}\n\nПохоже, установка повреждена — переустановите BlueGem.`,
        );
      }
      return { command: exe, args: [], cwd: path.dirname(exe) };
    }

    const backendDir = path.join(this.projectRoot, "backend");
    const python = path.join(backendDir, ".venv", "Scripts", "python.exe");
    if (!fs.existsSync(python)) {
      throw new BackendError(
        "Не найдено окружение backend/.venv.",
        [
          "Для запуска в режиме разработки создайте его:",
          "  python -m venv backend\\.venv",
          "  backend\\.venv\\Scripts\\python.exe -m pip install -r backend\\requirements.txt",
        ].join("\n"),
      );
    }
    return { command: python, args: [path.join(backendDir, "desktop_main.py")], cwd: backendDir };
  }

  spawnOnce(port) {
    const { command, args, cwd } = this.resolveCommand();
    const env = {
      ...process.env,
      BG_HOST: HOST,
      BG_PORT: String(port),
      BG_TOKEN: this.token,
      SQLITE_PATH: path.join(this.dataDir, "bluegem.db"),
      BG_LOG: path.join(this.logDir, "backend.log"),
      // Интерфейс отдаёт сам сервер — один origin, никаких CORS и портов в коде.
      BG_STATIC_DIR: this.staticDir || "",
      CORS_ORIGINS: [
        `http://${HOST}:${port}`,
        `http://localhost:${port}`,
        // При разработке интерфейс живёт на dev-сервере CRA — другой origin.
        process.env.BG_DEV_URL,
      ].filter(Boolean).join(","),
      // Русские сообщения в логе не должны падать на cp1251.
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      PYTHONUNBUFFERED: "1",
      // Сервер следит за нашим stdin и гасится, если оболочку сняли жёстко.
      BG_WATCH_PARENT: "1",
    };

    log.info(`[backend] запуск: ${command} (порт ${port})`);
    // stdin остаётся открытым намеренно: его закрытие — сигнал «родителя больше нет».
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => {}); // канал мог закрыться первым — это не ошибка

    const capture = (chunk) => {
      const text = chunk.toString("utf8").trimEnd();
      if (!text) return;
      for (const line of text.split(/\r?\n/)) {
        this.output.push(line);
        if (this.output.length > 120) this.output.shift();
        log.info(`[backend] ${line}`);
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    return child;
  }

  /** Поднимает сервер и ждёт, пока он ответит на /api/health. */
  async start() {
    for (let attempt = 1; attempt <= PORT_ATTEMPTS; attempt++) {
      const port = await freePort();
      const child = this.spawnOnce(port);

      let exited = null;
      const exitPromise = new Promise((resolve) => {
        child.once("exit", (code, signal) => {
          exited = { code, signal };
          resolve();
        });
        child.once("error", (err) => {
          exited = { code: -1, error: err };
          resolve();
        });
      });

      const deadline = Date.now() + READY_TIMEOUT_MS;
      let ready = false;
      while (Date.now() < deadline && !exited) {
        if (await ping(port, this.token)) {
          ready = true;
          break;
        }
        await sleep(200);
      }

      if (ready) {
        this.child = child;
        this.port = port;
        this.watchForCrash();
        log.info(`[backend] готов на ${this.url}`);
        return this.url;
      }

      await Promise.race([exitPromise, sleep(0)]);
      if (exited && exited.code === EXIT_PORT_BUSY && attempt < PORT_ATTEMPTS) {
        log.warn(`[backend] порт ${port} занят, пробую другой`);
        continue;
      }

      child.kill();
      const details = this.output.join("\n") || (exited?.error ? String(exited.error) : "");
      if (exited) {
        throw new BackendError(
          `Встроенный сервер завершился с кодом ${exited.code}.`,
          details || "Сервер не оставил сообщений об ошибке.",
        );
      }
      throw new BackendError(
        "Встроенный сервер не ответил за отведённое время.",
        details || `Проверялся адрес http://${HOST}:${port}/api/health.`,
      );
    }
    throw new BackendError("Не удалось занять локальный порт для встроенного сервера.", this.output.join("\n"));
  }

  /** Падение сервера уже после старта — окно должно об этом сказать. */
  watchForCrash() {
    this.child.once("exit", (code) => {
      if (this.stopping) return;
      log.error(`[backend] неожиданно завершился, код ${code}`);
      this.onCrash?.(new BackendError(
        `Встроенный сервер остановился (код ${code}).`,
        this.output.join("\n"),
      ));
    });
  }

  stop() {
    if (!this.child || this.stopping) return;
    this.stopping = true;
    log.info("[backend] остановка");
    try {
      this.child.kill();
    } catch (e) {
      log.warn(`[backend] не удалось остановить: ${e.message}`);
    }
    // Если процесс не ушёл сам — снимаем его вместе с дочерними.
    const pid = this.child.pid;
    setTimeout(() => {
      if (this.child && this.child.exitCode === null && pid) {
        try {
          spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
        } catch {
          /* процесса уже нет */
        }
      }
    }, 2000).unref?.();
  }
}

module.exports = { Backend, BackendError };
