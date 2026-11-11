// Сквозные проверки: настоящий сервер (backend/server.py) отдаёт собранный
// интерфейс (frontend/build), Playwright ходит по нему как человек.
//
// Серверов два — «два компьютера» с разными базами: на них проверяется
// синхронизация через общую папку. Остальным тестам хватает первого.
//
// Перед запуском: собрать интерфейс (cd frontend && yarn build) и поставить
// зависимости сервера (backend/requirements.txt).
import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const venv = path.join(root, "backend", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.BG_PYTHON || (fs.existsSync(venv) ? venv : "python");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bluegem-e2e-"));

export const PORTS = { a: 8197, b: 8198 };

const server = (name, port) => ({
  command: `"${python}" -m uvicorn server:app --host 127.0.0.1 --port ${port}`,
  cwd: path.join(root, "backend"),
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: {
    SQLITE_PATH: path.join(tmp, `${name}.db`),
    BG_STATIC_DIR: path.join(root, "frontend", "build"),
    BG_TOKEN: "",
  },
});

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORTS.a}`,
    viewport: { width: 1400, height: 860 },
    acceptDownloads: true,
    trace: "off",
    locale: "ru-RU",
  },
  webServer: [server("a", PORTS.a), server("b", PORTS.b)],
});
