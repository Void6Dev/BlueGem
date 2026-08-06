/**
 * Полная сборка содержимого приложения: иконки → интерфейс → сервер.
 * Упаковкой в установщик занимается electron-builder (npm run dist).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = join(ROOT, "frontend");

function step(label, cmd, args, options = {}) {
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    ...options,
    // npm на Windows — это npm.cmd, без shell его не найти. А вот node звать
    // через shell нельзя: путь к нему содержит пробел (C:\Program Files\...).
    shell: options.shell ?? (cmd === "npm" && process.platform === "win32"),
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    console.error(`\nШаг «${label}» завершился с ошибкой.`);
    process.exit(res.status ?? 1);
  }
}

step("иконки", process.execPath, [join(ROOT, "scripts", "make-icons.mjs")]);

if (!existsSync(join(FRONTEND, "node_modules"))) {
  // Дерево зависимостей ставилось yarn'ом, у npm к нему претензии по peer-версиям
  // (react-day-picker ↔ date-fns) — они не мешают сборке.
  step("зависимости интерфейса", "npm", ["install", "--legacy-peer-deps"], { cwd: FRONTEND });
}

// Зовём craco напрямую: `npm --prefix` спотыкается о пробел в пути к проекту.
step("интерфейс", process.execPath, [join(FRONTEND, "node_modules", "@craco", "craco", "dist", "bin", "craco.js"), "build"], {
  cwd: FRONTEND,
  env: {
    ...process.env,
    // Карты исходников удваивают размер сборки и в готовом приложении не нужны.
    GENERATE_SOURCEMAP: "false",
    // Предупреждения CRA не должны валить сборку.
    CI: "false",
  },
});

if (!existsSync(join(FRONTEND, "build", "index.html"))) {
  console.error("\nИнтерфейс не собрался: frontend/build/index.html отсутствует.");
  process.exit(1);
}

step("сервер", process.execPath, [join(ROOT, "scripts", "build-backend.mjs")]);

console.log("\nГотово. Теперь можно упаковать: npx electron-builder --win nsis portable");
