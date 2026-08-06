/**
 * Режим разработки: CRA с горячей перезагрузкой внутри окна Electron.
 *
 * Сервер поднимает сам Electron (из backend/.venv), интерфейс берётся с
 * dev-сервера CRA. Закрыли окно — гасим и dev-сервер.
 *
 * Запуск: npm run dev
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PORT = Number(process.env.PORT || 3000);
const DEV_URL = `http://localhost:${DEV_PORT}`;

const children = [];

function shutdown(code = 0) {
  for (const child of children) {
    if (child.exitCode === null) {
      try {
        // На Windows dev-сервер порождает дочерние процессы — снимаем дерево.
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      } catch {
        child.kill();
      }
    }
  }
  process.exit(code);
}

function waitForPort(port, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`dev-сервер не поднялся на ${port}`));
        else setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

console.log(`[dev] запускаю интерфейс на ${DEV_URL}`);
const FRONTEND = join(ROOT, "frontend");
// Зовём craco напрямую: `npm --prefix` спотыкается о пробел в пути к проекту.
const cra = spawn(
  process.execPath,
  [join(FRONTEND, "node_modules", "@craco", "craco", "dist", "bin", "craco.js"), "start"],
  {
    cwd: FRONTEND,
    stdio: "inherit",
    env: { ...process.env, BROWSER: "none", PORT: String(DEV_PORT) },
  },
);
children.push(cra);
cra.on("exit", (code) => {
  console.log(`[dev] dev-сервер завершился (${code})`);
  shutdown(code ?? 0);
});

await waitForPort(DEV_PORT).catch((err) => {
  console.error(`[dev] ${err.message}`);
  shutdown(1);
});

console.log("[dev] запускаю окно");
// electron из node_modules — путь к самому бинарнику, без .cmd-обёртки.
const { default: electronBin } = await import("electron");
const app = spawn(electronBin, [ROOT], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, BG_DEV_URL: DEV_URL },
});
children.push(app);
app.on("exit", (code) => shutdown(code ?? 0));

process.on("SIGINT", () => shutdown(0));
