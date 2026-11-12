import {
  buildChronology, canMove, existenceOf, findConflicts, fromDayIndex, moveDateTo,
  normalizeCalendar, nowIndexOf, nudgeDate, shiftDate, stateAt, storylineOf,
  toDayIndex, yearsOnlyCalendar,
} from "@/lib/chrono";

// Простой календарь: 12 месяцев по 30 дней, без високосных лет.
const cal = normalizeCalendar({
  ...yearsOnlyCalendar(),
  months: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, days: 30 })),
  leap: { enabled: false },
});
const day = (y, m = 0, d = 1) => toDayIndex(cal, { y, m, d });
const date = (y, m = null, d = null, extra = {}) => ({ kind: "exact", y, m, d, rel: null, eraId: null, raw: "", ...extra });
const node = (id, dates) => ({ id, title: id, dates: dates.map((x, i) => ({ id: `e${i}`, key: x.key || "date", start: x.start, end: x.end })) });

test("перетаскивание сохраняет точность даты", () => {
  expect(moveDateTo(cal, date(1024), day(1024), day(1031, 5, 12))).toMatchObject({ y: 1031, m: null, d: null });
  expect(moveDateTo(cal, date(1024, 2), day(1024, 2), day(1024, 7, 20))).toMatchObject({ y: 1024, m: 7, d: null });
  expect(moveDateTo(cal, date(1024, 2, 3), day(1024, 2, 3), day(1025, 0, 9))).toMatchObject({ y: 1025, m: 0, d: 9 });
});

test("относительная дата меняет срок, а не превращается в абсолютную", () => {
  const rel = { nodeId: "a", entryId: null, edge: "start", amount: 5, unit: "day", dir: "after" };
  const v = date(null, null, null, { rel });
  const moved = moveDateTo(cal, v, day(100, 0, 6), day(100, 0, 3));
  expect(moved.rel).toMatchObject({ amount: 2, dir: "after", nodeId: "a" });
  const back = shiftDate(cal, v, -9);
  expect(back.rel).toMatchObject({ amount: 4, dir: "before" });
});

test("«между» сдвигается обоими концами; «неизвестно» не двигается", () => {
  const v = { ...date(10), kind: "between", y2: 12, m2: null, d2: null, rel2: null };
  const out = shiftDate(cal, v, 360 * 3);
  expect([out.y, out.y2]).toEqual([13, 15]);
  expect(canMove({ kind: "unknown", eraId: "x" })).toBe(false);
  expect(moveDateTo(cal, { kind: "unknown" }, 0, 10)).toBe(null);
});

test("сдвиг на шаг своей точности и счёт эпохи", () => {
  expect(nudgeDate(cal, date(5), 1)).toMatchObject({ y: 6 });
  expect(nudgeDate(cal, date(5, 11), 1)).toMatchObject({ y: 6, m: 0 });
  expect(nudgeDate(cal, date(5, 0, 1), -1)).toMatchObject({ y: 4, m: 11, d: 30 });
  // Год эпохи, считающей годы от 4000-го: «412» — это 4411-й.
  const era = { id: "e3", countsYears: true, startYear: 4000 };
  const moved = moveDateTo(cal, date(412, null, null, { eraId: "e3" }), day(4411), day(4415, 3), era);
  expect(moved).toMatchObject({ y: 416, eraId: "e3" });
  expect(fromDayIndex(cal, day(4415, 3)).y).toBe(4415);
});

test("противоречия: участник до рождения, смерть до рождения, конец до начала", () => {
  const nodes = [
    node("hero", [{ key: "birth", start: date(100) }, { key: "death", start: date(150) }]),
    node("battle", [{ start: date(90) }]),
    node("feast", [{ start: date(120) }]),
    node("funeral", [{ start: date(170) }]),
    node("ghost", [{ key: "birth", start: date(50) }, { key: "death", start: date(40) }]),
    node("war", [{ key: "started", start: date(30), end: date(20) }]),
  ];
  const chrono = buildChronology(nodes, cal, []);
  const edges = [
    { source: "hero", target: "battle" }, { source: "feast", target: "hero" },
    { source: "hero", target: "funeral" },
  ];
  const c = findConflicts(chrono, edges);
  expect(c.get("battle/e0")).toEqual([{ code: "beforeBirth", otherId: "hero" }]);
  expect(c.has("feast/e0")).toBe(false);
  expect(c.get("funeral/e0")).toEqual([{ code: "afterDeath", otherId: "hero" }]);
  expect(c.get("ghost/e1")).toEqual([{ code: "deathBeforeBirth" }]);
  expect(c.get("war/e0")).toEqual([{ code: "endBeforeStart" }]);
});

test("приблизительные даты не считаются противоречием, пока пересекаются", () => {
  const nodes = [
    node("hero", [{ key: "birth", start: date(100) }]),
    node("raid", [{ start: { ...date(99), kind: "approx", spread: { amount: 2, unit: "year" } } }]),
  ];
  const chrono = buildChronology(nodes, cal, []);
  expect(findConflicts(chrono, [{ source: "hero", target: "raid" }]).size).toBe(0);
});

test("машина времени: когда узел есть в мире", () => {
  const chrono = buildChronology([
    node("hero", [{ key: "birth", start: date(100) }, { key: "death", start: date(150) }]),
    node("city", [{ key: "created", start: date(10) }]),
    node("war", [{ start: date(120), end: date(125) }]),
  ], cal, []);
  const year = (y) => [day(y), day(y + 1) - 1];
  const hero = existenceOf(chrono.byNode.get("hero"));
  expect(stateAt(hero, year(90))).toBe("future");
  expect(stateAt(hero, year(120))).toBe("present");
  expect(stateAt(hero, year(160))).toBe("past");
  expect(stateAt(existenceOf(chrono.byNode.get("city")), year(5000))).toBe("present");
  expect(stateAt(existenceOf(chrono.byNode.get("war")), year(124))).toBe("present");
  expect(stateAt(existenceOf(chrono.byNode.get("war")), year(126))).toBe("past");
  expect(stateAt(existenceOf(undefined), year(1))).toBe("timeless");
});

test("сюжетная линия и «сейчас»", () => {
  const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "x", target: "y" }];
  expect([...storylineOf(edges, "a", 1)].sort()).toEqual(["a", "b"]);
  expect([...storylineOf(edges, "a", 2)].sort()).toEqual(["a", "b", "c"]);
  const chrono = buildChronology([], cal, [{ id: "e3", name: "E", start: { y: 4000 }, countsYears: true }]);
  expect(nowIndexOf(chrono, { y: 412, m: 2, d: 5, eraId: "e3" })).toBe(day(4411, 2, 5));
  expect(nowIndexOf(chrono, null)).toBe(null);
});

test("конец промежутка едет на столько же, на сколько встало начало", () => {
  const { movedBy } = require("@/lib/chrono");
  const start = date(1020);
  const moved = moveDateTo(cal, start, day(1020), day(1071, 9, 20));
  const delta = movedBy(cal, start, moved);
  const end = shiftDate(cal, date(1027), delta);
  expect([moved.y, end.y]).toEqual([1071, 1078]);
});
