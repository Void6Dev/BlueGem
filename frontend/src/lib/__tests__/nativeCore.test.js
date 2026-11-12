/**
 * @jest-environment ./src/test/node-web-env.js
 */
// Телефон без телефона: настоящее ядро на Rust (server/) запущено процессом,
// а плагин Capacitor подменён пересылкой тех же запросов (метод, путь, тело)
// в него. Проверяется всё, что на телефоне живёт в JavaScript: адаптер axios,
// вид ошибок, картинки и переезд проектов из IndexedDB.
import "fake-indexeddb/auto";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");

const EXE = process.platform === "win32" ? "bluegem-backend.exe" : "bluegem-backend";
const BIN = path.resolve(__dirname, "../../../../server/target/release", EXE);
const haveCore = fs.existsSync(BIN);

let mockBase = "";
jest.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
    getPlatform: () => "android",
  },
  SystemBars: {},
  SystemBarsStyle: {},
  registerPlugin: () => ({
    // То же, что делает BlueGemCorePlugin.java → server/src/android.rs.
    request: async ({ method, path: p, body }) => {
      const r = await fetch(`${mockBase}${p}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? body : undefined,
      });
      const ctype = r.headers.get("content-type") || "";
      if (ctype.startsWith("image/")) {
        const buf = Buffer.from(await r.arrayBuffer());
        return { status: r.status, contentType: ctype, base64: buf.toString("base64") };
      }
      return { status: r.status, contentType: ctype, body: await r.text() };
    },
  }),
}));

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

let proc;
beforeAll(async () => {
  if (!haveCore) return;
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluegem-core-"));
  proc = spawn(BIN, [], {
    env: { ...process.env, BG_PORT: String(port), SQLITE_PATH: path.join(dir, "core.db"), BG_TOKEN: "", BG_STATIC_DIR: "" },
    stdio: "ignore",
  });
  mockBase = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${mockBase}/api/health`)).ok) return; } catch { /* ещё поднимается */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("ядро не поднялось");
});
afterAll(() => { proc?.kill(); });

const maybe = haveCore ? test : test.skip;

maybe("старые проекты из IndexedDB переезжают в ядро с теми же id, один раз", async () => {
  // Проект «старой версии» — прямо в IndexedDB, как его оставило приложение.
  const { localApi } = require("@/lib/local/api");
  const old = await localApi.createProject({ name: "С телефона", lang: "ru" });
  const n = await localApi.createNode(old.id, { title: "Анна", image: PNG });
  await localApi.createNode(old.id, { title: "Борис" });

  const { api, usesCore, isLocalStorage } = require("@/lib/api");
  expect(usesCore).toBe(true);
  expect(isLocalStorage).toBe(false);

  const projects = await api.listProjects();
  expect(projects.map((p) => p.id)).toContain(old.id);
  expect(await api.migration()).toEqual({ moved: 1, failed: 0 });

  const g = await api.getGraph(old.id);
  expect(g.nodes.map((x) => x.title).sort()).toEqual(["Анна", "Борис"]);
  const anna = g.nodes.find((x) => x.id === n.id);
  expect(anna.image).toMatch(/^bg-image:[0-9a-f]{64}$/);

  // Картинка приходит из ядра двоичной — для показа через Blob.
  const { coreImage } = require("@/lib/native/core");
  const blob = await coreImage(anna.image.slice("bg-image:".length));
  expect(blob.type).toBe("image/png");
  expect(blob.size).toBeGreaterThan(0);
});

maybe("ошибки ядра выглядят так же, как ошибки сервера", async () => {
  const { api, apiErrorMessage } = require("@/lib/api");
  await expect(api.getProject("nope")).rejects.toMatchObject({
    response: { status: 404, data: { detail: { code: "projectNotFound" } } },
  });
  try {
    await api.getProject("nope");
  } catch (e) {
    expect(apiErrorMessage(e)).not.toBe("");
  }
});

maybe("весь путь: проект, узлы, связь, копия, экспорт", async () => {
  const { api } = require("@/lib/api");
  const p = await api.createProject({ name: "Мир", template: "dnd", starter: true });
  expect(p.nodeCount).toBe(9);
  const a = await api.createNode(p.id, { title: "A" });
  const b = await api.createNode(p.id, { title: "B" });
  const e = await api.createEdge(p.id, { source: a.id, target: b.id });
  await api.updateEdge(e.id, { label: "знает" });
  const backup = await api.createBackup(p.id);
  expect(backup.nodeCount).toBe(11);
  const snap = await api.exportProject(p.id);
  expect(snap.nodes).toHaveLength(11);
  expect(snap.edges.find((x) => x.id === e.id).label).toBe("знает");
});
