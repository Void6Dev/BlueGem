// Синхронизация через папку между двумя «компьютерами»: два сервера с
// разными базами и общая папка на диске. Мост Electron (window.bluegem.sync)
// подменён тонкой обёрткой над той же папкой — проверяется всё остальное:
// менеджер синхронизации, слияние, хранилище и сервер.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { apiFor, PNG } from "./helpers.mjs";

const A = "http://127.0.0.1:8197";
const B = "http://127.0.0.1:8198";
const a = apiFor(A);
const b = apiFor(B);

async function device(browser, base, folder) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.errors = errors;
  const files = () => fs.readdirSync(folder).filter((n) => n.endsWith(".bgproj"));
  await page.exposeFunction("__fsList", () => files().map((name) => {
    const st = fs.statSync(path.join(folder, name));
    return { name, mtimeMs: st.mtimeMs, size: st.size };
  }));
  await page.exposeFunction("__fsRead", (n) => fs.readFileSync(path.join(folder, n), "utf8"));
  await page.exposeFunction("__fsWrite", (n, t) => { fs.writeFileSync(path.join(folder, n), t); return { ok: true }; });
  await page.exposeFunction("__fsTrash", (n) => { fs.rmSync(path.join(folder, n), { force: true }); return { ok: true }; });
  await page.addInitScript((dir) => {
    const noop = () => () => {};
    window.bluegem = {
      isDesktop: true, version: "e2e", platform: "linux", apiBase: "", token: "", dataDir: "",
      takePendingProject: async () => null, onOpenProject: noop, onMenuCommand: noop, onLanguage: noop,
      setLanguage: async () => {}, ask: async () => 0,
      sync: {
        state: async () => ({ folder: dir, available: true }),
        choose: async () => ({ folder: dir, available: true }),
        disable: async () => ({ folder: "", available: false }),
        list: () => window.__fsList(),
        read: (n) => window.__fsRead(n),
        write: (n, t) => window.__fsWrite(n, t),
        trash: (n) => window.__fsTrash(n),
        reveal: async () => "",
        onChanged: noop,
      },
    };
    localStorage.setItem("bluegem:lang", "ru");
  }, folder);
  await page.goto(`${base}/`);
  return page;
}

const titles = async (api, pid) => (await api("GET", `/projects/${pid}/graph`)).nodes.map((n) => n.title).sort().join(",");

test("два устройства сходятся: правки, удаления, картинки, удаление проекта", async ({ browser }) => {
  test.setTimeout(150_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "bluegem-sync-"));
  const opts = { timeout: 30_000 };

  const pA = await device(browser, A, folder);
  const proj = await a("POST", "/projects", { name: "Общий мир", lang: "ru" });
  const n1 = await a("POST", `/projects/${proj.id}/nodes`, { title: "Анна" });
  const n2 = await a("POST", `/projects/${proj.id}/nodes`, { title: "Борис" });
  await a("POST", `/projects/${proj.id}/edges`, { source: n1.id, target: n2.id });
  await expect.poll(() => fs.readdirSync(folder).some((n) => n.endsWith(".bgproj")), opts).toBe(true);


  const pB = await device(browser, B, folder);
  await expect.poll(async () => (await b("GET", "/projects")).map((p) => p.id), opts).toContain(proj.id);
  expect(await titles(b, proj.id)).toBe("Анна,Борис");

  // Правки на обоих устройствах одновременно.
  await b("PUT", `/nodes/${n1.id}`, { title: "Анна (B)" });
  await a("PUT", `/nodes/${n2.id}`, { title: "Борис (A)" });
  await a("POST", `/projects/${proj.id}/nodes`, { title: "Вера" });
  await expect.poll(() => titles(a, proj.id), opts).toBe("Анна (B),Борис (A),Вера");
  await expect.poll(() => titles(b, proj.id), opts).toBe("Анна (B),Борис (A),Вера");

  // Удаление на B доходит до A и не возвращается.
  await b("DELETE", `/nodes/${n2.id}`);
  await expect.poll(() => titles(a, proj.id), opts).toBe("Анна (B),Вера");
  expect((await a("GET", `/projects/${proj.id}/graph`)).edges).toHaveLength(0);
  await new Promise((r) => setTimeout(r, 9000));
  expect(await titles(a, proj.id)).toBe("Анна (B),Вера");
  expect(await titles(b, proj.id)).toBe("Анна (B),Вера");

  // Картинка переезжает вместе с проектом.
  await a("PUT", `/nodes/${n1.id}`, { image: PNG });
  await expect.poll(async () => (await b("GET", `/projects/${proj.id}/graph`)).nodes
    .find((n) => n.id === n1.id).image, opts).toMatch(/^bg-image:/);

  // Удалили проект на A: файл убран, на B проект остался, на A не воскрес.
  // В папке могут лежать и другие проекты этих серверов — ищем файл этого.
  const fileOf = () => fs.readdirSync(folder).filter((n) => n.endsWith(".bgproj")).some((n) => {
    try { return JSON.parse(fs.readFileSync(path.join(folder, n), "utf8")).project.id === proj.id; } catch { return false; }
  });
  await a("DELETE", `/projects/${proj.id}`);
  await expect.poll(fileOf, opts).toBe(false);
  await new Promise((r) => setTimeout(r, 9000));
  expect(fileOf()).toBe(false);
  expect((await b("GET", `/projects/${proj.id}`)).id).toBe(proj.id);
  expect((await a("GET", "/projects")).map((p) => p.id)).not.toContain(proj.id);

  expect(pA.errors).toEqual([]);
  expect(pB.errors).toEqual([]);
});
