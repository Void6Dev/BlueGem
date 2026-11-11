import { mergeSnapshots } from "@/lib/sync/merge";

const T = (min) => new Date(Date.UTC(2026, 10, 1, 12, min)).toISOString();

const node = (id, title, min, extra = {}) => ({
  id, projectId: "p", typeId: "note", title, description: "", fields: [], tags: [],
  position: { x: 0, y: 0 }, createdAt: T(0), updatedAt: T(min), ...extra,
});
const edge = (id, source, target, min) => ({ id, projectId: "p", source, target, label: "", updatedAt: T(min) });
const snap = ({ nodes = [], edges = [], deleted, name = "Мир", meta = 0, settings = { theme: "dark" } } = {}) => ({
  project: { id: "p", name, description: "", settings, metaUpdatedAt: T(meta), deleted: deleted || { nodes: {}, edges: {} } },
  nodes,
  edges,
});

// Отметки времени в тесте — ноябрь 2026, следы удалений хранятся полгода:
// чтобы проверки не зависели от того, когда их запускают, «сейчас» фиксируем.
beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 10, 2))); });
afterAll(() => { jest.useRealTimers(); });

test("одинаковые версии ничего не меняют", () => {
  const a = snap({ nodes: [node("a", "A", 1)] });
  const r = mergeSnapshots(a, JSON.parse(JSON.stringify(a)));
  expect(r.localChanged).toBe(false);
  expect(r.remoteChanged).toBe(false);
});

test("узел, добавленный там, приходит сюда", () => {
  const local = snap({ nodes: [node("a", "A", 1)] });
  const remote = snap({ nodes: [node("a", "A", 1), node("b", "B", 2)] });
  const r = mergeSnapshots(local, remote);
  expect(r.snapshot.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  expect(r.localChanged).toBe(true);
  expect(r.remoteChanged).toBe(false);
  expect(r.stats).toEqual({ added: 1, updated: 0, removed: 0 });
});

test("побеждает более поздняя правка, с каждой стороны своя", () => {
  const local = snap({ nodes: [node("a", "A здесь", 5), node("b", "B", 1)] });
  const remote = snap({ nodes: [node("a", "A там", 3), node("b", "B там", 4)] });
  const r = mergeSnapshots(local, remote);
  const titles = Object.fromEntries(r.snapshot.nodes.map((n) => [n.id, n.title]));
  expect(titles).toEqual({ a: "A здесь", b: "B там" });
  expect(r.localChanged).toBe(true);
  expect(r.remoteChanged).toBe(true);
});

test("удалённое там не возвращается отсюда", () => {
  const local = snap({ nodes: [node("a", "A", 1), node("b", "B", 1)], edges: [edge("e", "a", "b", 1)] });
  const remote = snap({
    nodes: [node("b", "B", 1)],
    deleted: { nodes: { a: T(10) }, edges: { e: T(10) } },
  });
  const r = mergeSnapshots(local, remote);
  expect(r.snapshot.nodes.map((n) => n.id)).toEqual(["b"]);
  expect(r.snapshot.edges).toEqual([]);
  expect(r.stats.removed).toBe(2);
  expect(r.snapshot.project.deleted.nodes.a).toBe(T(10));
});

test("правка после удаления оживляет узел", () => {
  const local = snap({ nodes: [node("a", "A поправили", 20)] });
  const remote = snap({ nodes: [], deleted: { nodes: { a: T(10) }, edges: {} } });
  const r = mergeSnapshots(local, remote);
  expect(r.snapshot.nodes.map((n) => n.id)).toEqual(["a"]);
  expect(r.snapshot.project.deleted.nodes.a).toBeUndefined();
  expect(r.remoteChanged).toBe(true);
});

test("связь к удалённому узлу пропадает, даже если её правили", () => {
  const local = snap({ nodes: [node("a", "A", 1), node("b", "B", 1)], edges: [edge("e", "a", "b", 30)] });
  const remote = snap({ nodes: [node("a", "A", 1)], deleted: { nodes: { b: T(10) }, edges: {} } });
  const r = mergeSnapshots(local, remote);
  expect(r.snapshot.edges).toEqual([]);
});

test("название и настройки — от последней правки проекта", () => {
  const local = snap({ name: "Старое", meta: 1, settings: { theme: "dark" } });
  const remote = snap({ name: "Новое", meta: 9, settings: { theme: "light" } });
  const r = mergeSnapshots(local, remote);
  expect(r.snapshot.project.name).toBe("Новое");
  expect(r.snapshot.project.settings.theme).toBe("light");
  expect(r.localChanged).toBe(true);
});

test("слияние сходится: повторное ничего не меняет", () => {
  const local = snap({ nodes: [node("a", "A", 5), node("c", "C", 2)] });
  const remote = snap({ nodes: [node("a", "A2", 3), node("b", "B", 4)], deleted: { nodes: { c: T(9) }, edges: {} } });
  const first = mergeSnapshots(local, remote).snapshot;
  const again = mergeSnapshots(first, remote);
  expect(again.localChanged).toBe(false);
  const back = mergeSnapshots(remote, first);
  expect(back.snapshot.nodes.map((n) => n.id).sort()).toEqual(first.nodes.map((n) => n.id).sort());
});
