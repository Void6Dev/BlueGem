import { plainText, rankNodes, snippetAround } from "@/lib/search";
import { backlinksOf } from "@/lib/backlinks";

test("markdown становится текстом", () => {
  expect(plainText("## Заголовок\n**жирный** и [[Анна|сестра]] и [сайт](http://x)")).toBe(
    "Заголовок\nжирный и сестра и сайт",
  );
});

test("сниппет вокруг совпадения", () => {
  const s = snippetAround("Он давно украл королевскую печать и сбежал на север", "печать", 12);
  expect(s.match).toBe("печать");
  expect(s.before.startsWith("…")).toBe(true);
  expect(`${s.before}${s.match}${s.after}`).toContain("королевскую печать");
});

test("совпадение в названии выше совпадения в тексте", () => {
  const nodes = [
    { id: "1", title: "Король", body: "правит севером" },
    { id: "2", title: "Север", body: "" },
    { id: "3", title: "Анна", body: "родилась на севере" },
  ];
  const out = rankNodes(nodes, "север");
  expect(out.map((n) => n.id)).toEqual(["2", "1", "3"]);
  expect(out[0].snippet).toBeUndefined();
  expect(out[1].snippet.match.toLowerCase()).toBe("север");
});

test("обратные ссылки находят упоминания без учёта регистра и подписи", () => {
  const target = { id: "a", title: "Анна" };
  const nodes = [
    target,
    { id: "b", title: "Борис", description: "Брат [[анна|сестры]], живёт в столице." },
    { id: "c", title: "Город", description: "Ничего не знает" },
    { id: "d", title: "Дневник", fields: [{ key: "Автор", value: "[[Анна]]" }] },
  ];
  const out = backlinksOf(target, nodes);
  expect(out.map((m) => m.id)).toEqual(["b", "d"]);
  expect(out[0].snippet).toBe("Брат сестры, живёт в столице.");
});
