/**
 * Сборка Android-приложения.
 *
 *   1. Интерфейс собирается в режиме «без сервера»: проекты живут в IndexedDB
 *      прямо на телефоне (frontend/src/lib/local).
 *   2. Capacitor копирует сборку в frontend/android и подключает плагины.
 *   3. С флагом --apk ещё и Gradle: на выходе
 *      frontend/android/app/build/outputs/apk/debug/app-debug.apk.
 *
 * Нужны Node 20+, JDK 21 и Android SDK (ANDROID_HOME или Android Studio).
 *
 *   node scripts/build-android.mjs          — подготовить проект для Android Studio
 *   node scripts/build-android.mjs --apk    — и сразу собрать APK
 *   node scripts/build-android.mjs --open   — и открыть его в Android Studio
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = join(ROOT, "frontend");
const ANDROID = join(FRONTEND, "android");
const win = process.platform === "win32";
const args = new Set(process.argv.slice(2));

function run(cmd, argv, cwd, env = {}) {
  console.log(`\n> ${cmd} ${argv.join(" ")}   (${cwd})`);
  const res = spawnSync(cmd, argv, {
    cwd,
    stdio: "inherit",
    shell: win,
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

run("npx", ["craco", "build"], FRONTEND, {
  GENERATE_SOURCEMAP: "false",
  REACT_APP_STORAGE: "local",
  // Сборка для телефона не должна падать из-за предупреждений линтера на CI.
  CI: "false",
});
run("npx", ["cap", "sync", "android"], FRONTEND);

if (args.has("--apk")) {
  run(win ? "gradlew.bat" : "./gradlew", ["assembleDebug", "--no-daemon"], ANDROID);
  console.log("\nAPK: frontend/android/app/build/outputs/apk/debug/app-debug.apk");
}
if (args.has("--open")) run("npx", ["cap", "open", "android"], FRONTEND);
