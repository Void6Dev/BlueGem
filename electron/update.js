"use strict";
/**
 * Обновление приложения релизами GitHub.
 *
 * Что делает модуль:
 *   1. раз в запуск спрашивает у GitHub список релизов репозитория;
 *   2. сравнивает их версии с версией приложения и говорит интерфейсу,
 *      есть ли что-то новее (кнопка на главной от этого загорается);
 *   3. по команде качает установщик нужного релиза — любого, не только
 *      последнего, поэтому откат назад устроен ровно тем же кодом, —
 *      и запускает его, а сам закрывается.
 *
 * Своего сервера обновлений нет и не нужно: GitHub Releases отдаёт и список,
 * и файлы. Токен не требуется, но безымянный лимит API — 60 запросов в час
 * на адрес, поэтому список кэшируется на диск и живёт сутки.
 */
const { app, net, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const log = require("./logger");

// Репозиторий можно переопределить переменной окружения — удобно проверять
// механику на форке, не пересобирая приложение.
const REPO = (process.env.BG_UPDATE_REPO || "Void6Dev/BlueGem").replace(/^.*github\.com\//, "").replace(/\.git$/, "");
const API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ASSET_BYTES = 512 * 1024 * 1024;

let cacheFile = "";
let state = {
  repo: REPO,
  current: "",
  releases: [],      // [{ tag, version, name, notes, url, publishedAt, prerelease, asset }]
  latest: null,      // релиз новее текущего или null
  checkedAt: 0,
  error: "",
  checking: false,
};

/* ------------------------------------------------------------------ */
/* Версии                                                              */
/* ------------------------------------------------------------------ */

/** "v1.2.3-beta.1" → [1, 2, 3, "beta.1"]. Мусор даёт null. */
function parseVersion(raw) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/.exec(String(raw || "").trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] || ""];
}

/**
 * Сравнение версий: >0 — a новее b.
 * Предрелиз всегда старше одноимённого релиза (1.2.0-beta < 1.2.0).
 */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1;
  if (!y[3]) return -1;
  return x[3] < y[3] ? -1 : 1;
}

/* ------------------------------------------------------------------ */
/* Список релизов                                                      */
/* ------------------------------------------------------------------ */

/**
 * Файл, который надо скачать для этого релиза.
 *
 * Портативной сборке нужен портативный exe: установщик рядом с ней поставит
 * вторую копию в Program Files, чего человек, выбравший портативную версию,
 * точно не просил.
 */
function pickAsset(assets) {
  const exe = (assets || []).filter((a) => /\.exe$/i.test(a.name || ""));
  if (!exe.length) return null;
  const portable = exe.find((a) => /portable/i.test(a.name));
  const setup = exe.find((a) => /setup/i.test(a.name));
  const wanted = isPortable() ? (portable || setup) : (setup || portable);
  const asset = wanted || exe[0];
  return { name: asset.name, url: asset.browser_download_url, size: asset.size || 0 };
}

function isPortable() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

function toRelease(raw) {
  return {
    tag: raw.tag_name || "",
    version: (raw.tag_name || "").replace(/^v/, ""),
    name: raw.name || raw.tag_name || "",
    notes: (raw.body || "").slice(0, 8000),
    url: raw.html_url || "",
    publishedAt: raw.published_at || "",
    prerelease: !!raw.prerelease,
    draft: !!raw.draft,
    asset: pickAsset(raw.assets),
  };
}

async function requestReleases() {
  const res = await net.fetch(API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `BlueGem/${app.getVersion()}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    // 403 без тела — почти всегда исчерпанный лимит безымянных запросов.
    throw new Error(res.status === 403
      ? `GitHub API: ${res.status} (rate limit)`
      : `GitHub API: ${res.status}`);
  }
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error("GitHub API: unexpected payload");
  return list
    .map(toRelease)
    .filter((r) => !r.draft && parseVersion(r.version))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Кэш живёт на диске: без него каждый запуск тратит запрос из лимита. */
async function readCache() {
  try {
    const raw = JSON.parse(await fsp.readFile(cacheFile, "utf8"));
    if (raw?.repo !== REPO) return null;
    return raw;
  } catch {
    return null;
  }
}

async function writeCache(data) {
  try {
    await fsp.writeFile(cacheFile, JSON.stringify(data), "utf8");
  } catch (e) {
    log.warn(`кэш обновлений не записан: ${e.message}`);
  }
}

function recompute() {
  const current = app.getVersion();
  state.current = current;
  // Предрелизы не предлагаем сами — их видно в списке версий, поставить
  // можно вручную, но «загораться зелёным» они не должны.
  const newer = state.releases.find((r) => !r.prerelease && compareVersions(r.version, current) > 0);
  state.latest = newer || null;
  return publicState();
}

function publicState() {
  return { ...state, portable: isPortable() };
}

/**
 * Проверить обновления. Без force берёт свежий кэш (сутки) — «раз в запуск»
 * означает один сетевой запрос, а не один на каждое открытие главной.
 */
let inFlight = null;

async function check(options = {}) {
  // Проверка при запуске идёт в фоне, а интерфейс спрашивает состояние сразу
  // после загрузки: без общего обещания он получил бы пустой список и решил,
  // что обновлений нет.
  if (inFlight) return inFlight;
  inFlight = runCheck(options).finally(() => { inFlight = null; });
  return inFlight;
}

async function runCheck({ force = false } = {}) {
  const fresh = Date.now() - state.checkedAt < CACHE_TTL_MS;
  if (!force && fresh && state.releases.length) return recompute();

  if (!force) {
    const cached = await readCache();
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      state.releases = cached.releases || [];
      state.checkedAt = cached.checkedAt;
      state.error = "";
      return recompute();
    }
  }

  state.checking = true;
  state.error = "";
  try {
    state.releases = await requestReleases();
    state.checkedAt = Date.now();
    await writeCache({ repo: REPO, checkedAt: state.checkedAt, releases: state.releases });
    log.info(`обновления: получено релизов ${state.releases.length}, текущая ${app.getVersion()}`);
  } catch (e) {
    // Нет сети — это не ошибка приложения: кнопка просто останется серой.
    state.error = e.message || String(e);
    log.warn(`обновления недоступны: ${state.error}`);
  } finally {
    state.checking = false;
  }
  return recompute();
}

/* ------------------------------------------------------------------ */
/* Загрузка и установка                                                */
/* ------------------------------------------------------------------ */

let downloading = false;

/**
 * Скачать установщик релиза и запустить его.
 *
 * @param tag       тег релиза; любой из списка, поэтому откат назад — то же
 *                  действие, что и обновление вперёд;
 * @param onProgress ({ received, total, percent }) — для полосы в интерфейсе.
 */
async function install(tag, onProgress) {
  if (downloading) return { ok: false, error: "busy" };
  const release = state.releases.find((r) => r.tag === tag);
  if (!release) return { ok: false, error: "unknown-release" };
  if (!release.asset) return { ok: false, error: "no-asset", url: release.url };

  downloading = true;
  const dir = path.join(app.getPath("temp"), "BlueGem-updates");
  const file = path.join(dir, release.asset.name);
  try {
    await fsp.mkdir(dir, { recursive: true });
    await download(release.asset, file, onProgress);

    log.info(`установка версии ${release.version} из ${file}`);
    if (isPortable()) {
      // Портативную копию заменить на ходу нельзя — она сейчас запущена.
      // Показываем скачанный файл: дальше человек решает сам.
      shell.showItemInFolder(file);
      return { ok: true, portable: true, path: file };
    }
    // Установщик просит прав администратора сам; закрываемся, чтобы он мог
    // переписать файлы приложения.
    const opened = await shell.openPath(file);
    if (opened) throw new Error(opened);
    setTimeout(() => app.quit(), 600);
    return { ok: true, path: file };
  } catch (e) {
    log.warn(`установка не удалась: ${e.message}`);
    await fsp.rm(file, { force: true }).catch(() => {});
    return { ok: false, error: e.message || String(e) };
  } finally {
    downloading = false;
  }
}

async function download(asset, file, onProgress) {
  const res = await net.fetch(asset.url, { headers: { "User-Agent": `BlueGem/${app.getVersion()}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || asset.size || 0;
  if (total > MAX_ASSET_BYTES) throw new Error("asset too large");

  const out = fs.createWriteStream(file);
  const reader = res.body.getReader();
  let received = 0;
  let lastTick = 0;
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_ASSET_BYTES) throw new Error("asset too large");
      if (!out.write(Buffer.from(value))) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => out.once("drain", r));
      }
      // Полоса прогресса обновляется не чаще раза в 120 мс: чаще незаметно,
      // а сообщений в IPC становится тысячи.
      const now = Date.now();
      if (onProgress && (now - lastTick > 120 || received === total)) {
        lastTick = now;
        onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : 0 });
      }
    }
  } finally {
    out.end();
    await new Promise((r) => out.once("close", r));
  }
  if (total && received !== total) throw new Error("incomplete download");
}

/* ------------------------------------------------------------------ */
/* Обратная связь                                                      */
/* ------------------------------------------------------------------ */

/**
 * Открыть форму нового issue с уже подставленными версией и системой.
 * Ответ автора приходит туда же — в отличие от письма, переписка не теряется.
 */
function feedbackUrl({ title = "", body = "", kind = "feedback" } = {}) {
  const labels = kind === "bug" ? "bug" : "feedback";
  const footer = [
    "",
    "---",
    `BlueGem ${app.getVersion()} · ${process.platform} ${process.arch} · Electron ${process.versions.electron}`,
  ].join("\n");
  const params = new URLSearchParams({
    title: title.slice(0, 200),
    body: `${body}\n${footer}`.slice(0, 6000),
    labels,
  });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

module.exports = {
  REPO,
  compareVersions,
  parseVersion,
  feedbackUrl,
  install,
  check,
  state: publicState,
  init(dataDir) {
    cacheFile = path.join(dataDir, "update-cache.json");
    state.current = app.getVersion();
  },
  releasesUrl: () => `https://github.com/${REPO}/releases`,
};
