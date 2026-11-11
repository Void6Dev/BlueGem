/**
 * Собирает встроенный сервер (server/, Rust) в один исполняемый файл.
 *
 * На выходе server/dist/bluegem-backend(.exe) — отсюда его берёт
 * electron-builder (extraResources). Ни Python, ни других зависимостей на
 * машине пользователя не нужно.
 *
 * Собирается под систему, на которой запущен: Windows-сервер — на Windows,
 * Linux — на Linux.
 *
 * Запуск: npm run build:backend
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXE = process.platform === "win32" ? "bluegem-backend.exe" : "bluegem-backend";
const MANIFEST = join(ROOT, "server", "Cargo.toml");
const BUILT = join(ROOT, "server", "target", "release", EXE);
const DIST = join(ROOT, "server", "dist");
const OUT = join(DIST, EXE);

const hasCargo = spawnSync("cargo", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
if (!hasCargo) {
  console.error([
    "Не найден cargo — для сборки сервера нужен Rust.",
    "Поставьте его с https://rustup.rs и повторите сборку.",
  ].join("\n"));
  process.exit(1);
}

console.log("\n[backend] собираю сервер (cargo build --release)");
const res = spawnSync("cargo", ["build", "--release", "--locked", "--manifest-path", MANIFEST], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (res.status !== 0 || !existsSync(BUILT)) {
  console.error(`\nСборка сервера не удалась (ожидался ${BUILT}).`);
  process.exit(1);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
copyFileSync(BUILT, OUT);
console.log(`\n[backend] готово: ${OUT}`);
