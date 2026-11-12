/**
 * Сборка Android-приложения.
 *
 *   1. Ядро на Rust (server/) собирается библиотекой libbluegem_core.so под
 *      три архитектуры телефонов и кладётся в android/app/src/main/jniLibs:
 *      проекты на телефоне живут в той же SQLite, что и на компьютере
 *      (server/src/android.rs, плагин BlueGemCorePlugin.java).
 *   2. Интерфейс собирается для телефона (frontend/src/lib/native).
 *   3. Capacitor копирует сборку в frontend/android и подключает плагины.
 *   4. С флагом --apk ещё и Gradle: на выходе
 *      frontend/android/app/build/outputs/apk/debug/app-debug.apk.
 *
 * Нужны Node 20+, JDK 21, Android SDK (ANDROID_HOME) с NDK (ANDROID_NDK_HOME
 * или ndk/ внутри SDK), Rust с целями aarch64-linux-android,
 * armv7-linux-androideabi, x86_64-linux-android и cargo-ndk.
 *
 *   node scripts/build-android.mjs          — подготовить проект для Android Studio
 *   node scripts/build-android.mjs --apk    — и сразу собрать APK
 *   node scripts/build-android.mjs --open   — и открыть его в Android Studio
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
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

// NDK: явно заданный, иначе самый свежий из SDK.
function findNdk() {
  for (const v of [process.env.ANDROID_NDK_HOME, process.env.ANDROID_NDK_ROOT, process.env.ANDROID_NDK_LATEST_HOME]) {
    if (v && existsSync(v)) return v;
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const dir = sdk && join(sdk, "ndk");
  if (dir && existsSync(dir)) {
    const versions = readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (versions.length) return join(dir, versions[versions.length - 1]);
  }
  return "";
}

const ndk = findNdk();
if (!ndk) {
  console.error("Не найден Android NDK: задайте ANDROID_NDK_HOME или поставьте NDK в SDK (sdkmanager \"ndk;28.2.13676358\").");
  process.exit(1);
}
// Ядро: три архитектуры — телефоны (arm64, старые arm) и эмулятор (x86_64).
// API 24 — тот же minSdk, что у приложения.
run("cargo", [
  "ndk", "-t", "arm64-v8a", "-t", "armeabi-v7a", "-t", "x86_64", "-P", "24",
  "-o", join(ANDROID, "app", "src", "main", "jniLibs"),
  "build", "--release", "--lib", "--locked",
], join(ROOT, "server"), { ANDROID_NDK_HOME: ndk });

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
