// Синхронизация через папку: проекты ⇄ файлы .bgproj в папке облачного диска.
//
// Оболочка (electron/sync.js) только читает и пишет файлы; решения — здесь.
// Каждые несколько секунд и при каждом изменении в папке:
//   1. файлы, изменившиеся на диске, сливаются с проектами (новые — импорт);
//   2. проекты, изменившиеся здесь, сливаются со своими файлами и пишутся;
//   3. файл проекта, удалённого здесь, уходит в корзину.
// Слияние — lib/sync/merge.js: по узлам и связям, побеждает последняя правка.
//
// Пока человек печатает, файл не переписывается на каждую букву: проект
// пишется, когда правки стихли на пару секунд (но не реже раза в минуту).
import { api } from "@/lib/api";
import { folderBridge } from "@/lib/desktop";
import { PROJECT_EXT, slugify } from "@/lib/exporters";
import { quickHash } from "@/lib/local/policy";
import { mergeSnapshots } from "@/lib/sync/merge";

const STATE_KEY = "bluegem:folder-sync";
const TICK_MS = 4000;
const QUIET_MS = 2500;
const MAX_WAIT_MS = 60000;

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
    return {
      folder: raw.folder || "", files: raw.files || {}, projects: raw.projects || {},
      detached: raw.detached || {},
    };
  } catch {
    return { folder: "", files: {}, projects: {}, detached: {} };
  }
}

function parse(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || !data.project?.id || !Array.isArray(data.nodes)) {
    throw new Error("not a project file");
  }
  return data;
}

export const fileNameFor = (project) =>
  `${slugify(project.name)}-${String(project.id).slice(0, 8)}.${PROJECT_EXT}`;

class FolderSync {
  constructor(bridge) {
    this.bridge = bridge;
    this.state = loadState();
    this.status = { phase: "off", folder: "", lastSyncAt: null, error: "", detached: [] };
    this.listeners = new Set();
    this.running = null;
    this.timer = null;
    this.offChanged = null;
  }

  /* ---------- наружу ---------- */

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  emit(type, detail) {
    window.dispatchEvent(new CustomEvent(`bluegem:${type}`, { detail }));
  }

  async start() {
    this.setStatus({ detached: this.detachedList() });
    const st = await this.bridge.state();
    this.applyFolder(st);
    if (!this.offChanged) this.offChanged = this.bridge.onChanged(() => this.syncSoon());
    if (!this.timer) this.timer = setInterval(() => this.syncSoon(), TICK_MS);
    this.syncSoon();
  }

  applyFolder(st) {
    if (st.folder !== this.state.folder) {
      // Другая папка — другие файлы: прежние отметки к ней не относятся.
      this.state = { folder: st.folder, files: {}, projects: {}, detached: {} };
      this.save();
    }
    this.setStatus({
      phase: !st.folder ? "off" : st.available ? "idle" : "error",
      folder: st.folder,
      error: st.folder && !st.available ? "unavailable" : "",
    });
  }

  async choose(title) {
    const st = await this.bridge.choose({ title });
    if (!st.canceled) this.applyFolder(st);
    this.syncSoon();
    return st;
  }

  /** Вернуть отключённый проект в синхронизацию: он снова запишется в папку. */
  attach(projectId) {
    delete this.state.detached[projectId];
    delete this.state.projects[projectId];
    this.save();
    this.setStatus({ detached: this.detachedList() });
    return this.syncSoon();
  }

  detachedList() {
    return Object.entries(this.state.detached).map(([id, name]) => ({ id, name }));
  }

  async disable() {
    this.applyFolder(await this.bridge.disable());
  }

  reveal() {
    return this.bridge.reveal();
  }

  /** Сделать проход сейчас (или сразу после текущего). */
  syncSoon() {
    if (this.running) { this.again = true; return this.running; }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) { this.again = false; this.syncSoon(); }
    });
    return this.running;
  }

  /* ---------- проход ---------- */

  save() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(this.state)); } catch { /* приватный режим */ }
  }

  async run({ force = false } = {}) {
    if (!this.status.folder) return;
    const st = await this.bridge.state();
    if (!st.available) { this.applyFolder(st); return; }
    if (this.status.phase === "error") this.setStatus({ phase: "idle", error: "" });
    try {
      const files = await this.bridge.list();
      const projects = await api.listProjects();
      const local = new Map(projects.map((p) => [p.id, p]));
      let touched = false;

      // 1. Что поменялось в папке.
      for (const f of files) {
        const known = this.state.files[f.name];
        if (known && known.mtimeMs === f.mtimeMs && known.size === f.size) continue;
        const text = await this.bridge.read(f.name);
        const hash = quickHash(text);
        if (known && known.hash === hash) {
          this.state.files[f.name] = { ...known, mtimeMs: f.mtimeMs, size: f.size };
          continue;
        }
        let snap;
        try { snap = parse(text); } catch {
          // Облачный клиент ещё докачивает файл или это не проект — пропускаем
          // до следующего изменения.
          this.state.files[f.name] = { hash, mtimeMs: f.mtimeMs, size: f.size, projectId: "" };
          continue;
        }
        const pid = snap.project.id;
        // Файл отключённого проекта снова появился — значит, на другом
        // устройстве его вернули в синхронизацию; возвращаем и здесь.
        if (this.state.detached[pid]) delete this.state.detached[pid];
        this.setStatus({ phase: "syncing" });
        if (local.has(pid)) {
          await this.mergeInto(pid, f.name, snap);
          touched = true;
        } else {
          const created = await api.importProject({ ...snap, keepIds: true });
          this.state.projects[created.id] = { name: f.name, updatedAt: created.updatedAt, pushedAt: Date.now() };
          this.emit("projects-changed", { projectId: created.id });
          touched = true;
        }
        this.state.files[f.name] = { hash, mtimeMs: f.mtimeMs, size: f.size, projectId: pid };
      }

      // 2. Что поменялось здесь.
      const fresh = touched ? await api.listProjects() : projects;
      const byName = new Map(files.map((f) => [f.name, f]));
      for (const p of fresh) {
        if (this.state.detached[p.id]) continue;
        const rec = this.state.projects[p.id];
        const hasFile = rec && byName.has(rec.name);
        if (rec && !hasFile) {
          // Файл был и пропал: проект удалили на другом устройстве (или файл
          // убрали руками). Здесь он остаётся, но больше не синхронизируется:
          // записать его заново значило бы воскресить удалённое там.
          this.state.detached[p.id] = p.name;
          delete this.state.projects[p.id];
          delete this.state.files[rec.name];
          this.emit("project-detached", { projectId: p.id, name: p.name });
          continue;
        }
        if (rec && hasFile && rec.updatedAt === p.updatedAt) continue;
        const quietFor = Date.now() - Date.parse(p.updatedAt);
        const waited = Date.now() - (rec?.pushedAt || 0);
        if (!force && hasFile && quietFor < QUIET_MS && waited < MAX_WAIT_MS) continue;
        this.setStatus({ phase: "syncing" });
        const name = hasFile ? rec.name : this.nameFor(p, byName);
        if (byName.has(name)) {
          const text = await this.bridge.read(name);
          let snap = null;
          try { snap = parse(text); } catch { /* испорчен — перепишем своей версией */ }
          if (snap && snap.project.id === p.id) {
            await this.mergeInto(p.id, name, snap);
            continue;
          }
        }
        await this.writeLocal(p.id, name);
      }

      // 3. Удалённые здесь проекты: их файлы — в корзину.
      for (const [pid, rec] of Object.entries(this.state.projects)) {
        if (local.has(pid) || fresh.some((p) => p.id === pid)) continue;
        if (byName.has(rec.name)) await this.bridge.trash(rec.name).catch(() => {});
        delete this.state.projects[pid];
        delete this.state.files[rec.name];
      }

      for (const pid of Object.keys(this.state.detached)) {
        if (!fresh.some((p) => p.id === pid)) delete this.state.detached[pid];
      }
      this.save();
      this.setStatus({
        phase: "idle", lastSyncAt: new Date().toISOString(), error: "", detached: this.detachedList(),
      });
    } catch (e) {
      this.save();
      this.setStatus({ phase: "error", error: e?.message || String(e) });
    }
  }

  /** Имя нового файла: из названия проекта и начала id, без совпадений. */
  nameFor(project, byName) {
    const taken = (n) => byName.has(n)
      && this.state.files[n]?.projectId && this.state.files[n].projectId !== project.id;
    let name = fileNameFor(project);
    for (let i = 2; taken(name); i += 1) name = name.replace(/(-\d+)?\.bgproj$/, `-${i}.bgproj`);
    return name;
  }

  async writeLocal(pid, name) {
    const snap = await api.exportProject(pid, { inline: true });
    await this.writeFile(name, snap);
    const p = await api.getProject(pid);
    this.state.projects[pid] = { name, updatedAt: p.updatedAt, pushedAt: Date.now() };
  }

  async writeFile(name, snap) {
    const text = JSON.stringify(snap);
    await this.bridge.write(name, text);
    this.state.files[name] = { hash: quickHash(text), mtimeMs: -1, size: -1, projectId: snap.project.id };
  }

  /** Слить файл с проектом здесь и записать то, что поменялось, в обе стороны. */
  async mergeInto(pid, name, remote) {
    const local = await api.exportProject(pid, { inline: true });
    const res = mergeSnapshots(local, remote);
    if (res.localChanged) {
      await api.replaceProject(pid, res.snapshot);
      this.emit("project-replaced", { projectId: pid, stats: res.stats });
    }
    if (res.remoteChanged) await this.writeFile(name, res.snapshot);
    const p = await api.getProject(pid);
    this.state.projects[pid] = { name, updatedAt: p.updatedAt, pushedAt: Date.now() };
  }
}

let instance = null;

/** Единственный экземпляр на приложение; null вне десктопной оболочки. */
export function folderSync() {
  if (!folderBridge) return null;
  if (!instance) instance = new FolderSync(folderBridge);
  return instance;
}
