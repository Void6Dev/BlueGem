import { backupsToDrop, contentHash, pruneDeleted } from "@/lib/local/policy";

test("копии: последние 12 подряд, дальше по одной на день, не старше месяца", () => {
  const now = Date.UTC(2026, 10, 11, 12);
  const rows = [];
  for (let i = 0; i < 20; i += 1) rows.push({ id: `t${i}`, createdAt: new Date(now - i * 600000).toISOString() });
  for (let d = 1; d < 40; d += 1) {
    for (const h of [18, 9]) {
      const day = new Date(now - d * 86400000);
      day.setUTCHours(h);
      rows.push({ id: `d${d}-${h}`, createdAt: day.toISOString() });
    }
  }
  const drop = new Set(backupsToDrop(rows, now));
  const kept = rows.filter((r) => !drop.has(r.id));
  for (let i = 0; i < 12; i += 1) expect(drop.has(`t${i}`)).toBe(false);
  const older = kept.filter((r) => !r.id.startsWith("t"));
  const days = older.map((r) => r.createdAt.slice(0, 10));
  expect(new Set(days).size).toBe(days.length);
  expect(older.every((r) => Date.parse(r.createdAt) >= now - 30 * 86400000)).toBe(true);
});

test("отпечаток не зависит от порядка и отметок времени", () => {
  const a = { project: { name: "x", settings: { a: 1, b: 2 } }, nodes: [{ id: "1", updatedAt: "1" }, { id: "2" }], edges: [] };
  const b = { project: { name: "x", settings: { b: 2, a: 1 } }, nodes: [{ id: "2" }, { id: "1", updatedAt: "2" }], edges: [] };
  expect(contentHash(a)).toBe(contentHash(b));
  expect(contentHash({ ...a, project: { name: "y" } })).not.toBe(contentHash(a));
});

test("старые следы удалений забываются", () => {
  const now = Date.UTC(2026, 10, 11);
  const out = pruneDeleted({ nodes: { old: "2025-01-01T00:00:00Z", fresh: "2026-11-01T00:00:00Z" } }, now);
  expect(Object.keys(out.nodes)).toEqual(["fresh"]);
  expect(out.edges).toEqual({});
});
