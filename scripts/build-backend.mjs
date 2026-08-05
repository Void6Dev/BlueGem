/**
 * Замораживает FastAPI-сервер в самостоятельный exe.
 *
 * На выходе backend/dist/bluegem-backend/bluegem-backend.exe со всеми
 * зависимостями рядом — на машине пользователя python не нужен.
 *
 * Запуск: npm run build:backend
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = join(ROOT, "backend", ".venv", "Scripts", "python.exe");
const SPEC = join(ROOT, "backend", "bluegem-backend.spec");
const OUT = join(ROOT, "backend", "dist", "bluegem-backend", "bluegem-backend.exe");

function run(cmd, args, label) {
  console.log(`\n[backend] ${label}`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

if (!existsSync(PYTHON)) {
  console.error(
    [
      "Не найдено окружение backend/.venv.",
      "Создайте его и поставьте зависимости:",
      "  python -m venv backend\\.venv",
      "  backend\\.venv\\Scripts\\python.exe -m pip install -r backend\\requirements.txt",
    ].join("\n"),
  );
  process.exit(1);
}

// PyInstaller ставится в то же окружение — так он видит те же пакеты.
const hasPyInstaller = spawnSync(PYTHON, ["-m", "PyInstaller", "--version"], { cwd: ROOT }).status === 0;
if (!hasPyInstaller) {
  if (run(PYTHON, ["-m", "pip", "install", "pyinstaller"], "ставлю PyInstaller") !== 0) {
    console.error("Не удалось поставить PyInstaller.");
    process.exit(1);
  }
}

const status = run(
  PYTHON,
  [
    "-m", "PyInstaller", SPEC,
    "--noconfirm",
    "--clean",
    "--distpath", join(ROOT, "backend", "dist"),
    "--workpath", join(ROOT, "backend", ".pyinstaller"),
  ],
  "собираю сервер",
);

if (status !== 0 || !existsSync(OUT)) {
  console.error(`\nСборка сервера не удалась (ожидался ${OUT}).`);
  process.exit(1);
}
console.log(`\n[backend] готово: ${OUT}`);
