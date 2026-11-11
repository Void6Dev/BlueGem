/**
 * @jest-environment ./src/test/node-web-env.js
 */
/**
 * Хранилище в приложении (телефон): те же обещания, что и у сервера —
 * картинки отдельно, копии сами, следы удалений, перенос с сохранением id.
 */
import "fake-indexeddb/auto";
import { localApi } from "@/lib/local/api";
import { mergeSnapshots } from "@/lib/sync/merge";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function project(name = "Мир") {
  return localApi.createProject({ name, lang: "ru" });
}

test("картинка хранится отдельно и возвращается в экспорт строкой data:", async () => {
  const p = await project();
  const n = await localApi.createNode(p.id, { title: "С портретом", image: PNG });
  expect(n.image.startsWith("bg-image:")).toBe(true);
  const blob = await localApi.loadImage(n.image.slice("bg-image:".length));
  expect(blob).toBeTruthy();
  const snap = await localApi.exportProject(p.id);
  expect(snap.nodes[0].image).toBe(PNG);
  const raw = await localApi.exportProject(p.id, { inline: false });
  expect(raw.nodes[0].image).toBe(n.image);
});

test("копия снимается перед первой правкой, восстановление возвращает узел", async () => {
  const p = await project();
  const keep = await localApi.createNode(p.id, { title: "Сохранить меня" });
  const manual = await localApi.createBackup(p.id);
  expect(manual.nodeCount).toBe(1);
  await localApi.deleteNode(keep.id);
  expect((await localApi.getGraph(p.id)).nodes).toHaveLength(0);

  const list = await localApi.listBackups(p.id);
  expect(list.map((b) => b.reason)).toContain("auto");
  await localApi.restoreBackup(manual.id);
  const g = await localApi.getGraph(p.id);
  expect(g.nodes.map((x) => x.id)).toEqual([keep.id]);
  const snap = await localApi.exportProject(p.id);
  expect(snap.project.deleted.nodes[keep.id]).toBeUndefined();
  expect((await localApi.listBackups(p.id)).map((b) => b.reason)).toContain("restore");
});

test("удаление оставляет след, импорт с keepIds сохраняет id один раз", async () => {
  const p = await project();
  const a = await localApi.createNode(p.id, { title: "A" });
  const b = await localApi.createNode(p.id, { title: "B" });
  const e = await localApi.createEdge(p.id, { source: a.id, target: b.id });
  const c = await localApi.createNode(p.id, { title: "C" });
  await localApi.deleteNode(c.id);
  const snap = await localApi.exportProject(p.id);
  expect(snap.project.deleted.nodes[c.id]).toBeTruthy();

  await localApi.deleteProject(p.id);
  const again = await localApi.importProject({ ...snap, keepIds: true });
  expect(again.id).toBe(p.id);
  const g = await localApi.getGraph(p.id);
  expect(g.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
  expect(g.edges.map((x) => x.id)).toEqual([e.id]);

  const copy = await localApi.importProject({ ...snap, keepIds: true });
  expect(copy.id).not.toBe(p.id);
});

test("слияние с файлом с другого устройства через replaceProject", async () => {
  const p = await project();
  const a = await localApi.createNode(p.id, { title: "Здесь" });
  const remote = await localApi.exportProject(p.id);
  // «Там» переименовали узел и добавили новый.
  const later = new Date(Date.now() + 60000).toISOString();
  remote.nodes[0] = { ...remote.nodes[0], title: "Там", updatedAt: later };
  remote.nodes.push({ ...remote.nodes[0], id: "remote-node", title: "Новый", updatedAt: later });

  const local = await localApi.exportProject(p.id);
  const res = mergeSnapshots(local, remote);
  expect(res.localChanged).toBe(true);
  await localApi.replaceProject(p.id, res.snapshot);
  const titles = (await localApi.getGraph(p.id)).nodes.map((n) => n.title).sort();
  expect(titles).toEqual(["Новый", "Там"]);
  expect((await localApi.listBackups(p.id)).map((x) => x.reason)).toContain("sync");
  expect(a.id).toBeTruthy();
});
