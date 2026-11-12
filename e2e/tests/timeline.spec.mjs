// Хронология как место работы: добавить событие, сдвинуть дату, «сейчас»,
// противоречия, дорожки, сюжетная линия и машина времени на холсте.
import { test, expect, devices } from "@playwright/test";
import { apiFor, openRu, palette } from "./helpers.mjs";

const api = apiFor("http://127.0.0.1:8197");
const d = (y, m = null, day = null) => ({ kind: "exact", y, m, d: day });
const entry = (id, key, start, end = null) => ({ id, key, label: "", start, end });

async function world() {
  const p = await api("POST", "/projects", { name: "Хроники", lang: "ru" });
  const proj = await api("GET", `/projects/${p.id}`);
  await api("PUT", `/projects/${p.id}`, { settings: { ...proj.settings,
    eras: [{ id: "e1", name: "Эпоха Огня", color: "#f97316", start: { y: 900 } }] } });
  const mk = (title, typeId, dates, x) => api("POST", `/projects/${p.id}/nodes`, { title, typeId, dates, position: { x, y: 0 } });
  const anna = await mk("Анна", "character", [entry("b", "birth", d(1000)), entry("x", "death", d(1070))], 0);
  const war = await mk("Война", "event", [entry("a", "date", d(1020), d(1027))], 320);
  const funeral = await mk("Похороны", "event", [entry("a", "date", d(1080))], 640);
  await api("POST", `/projects/${p.id}/edges`, { source: anna.id, target: war.id });
  await api("POST", `/projects/${p.id}/edges`, { source: anna.id, target: funeral.id });
  return { p, anna, war, funeral };
}

async function openTimeline(page, p) {
  await openRu(page, `/project/${p.id}`);
  await page.waitForSelector(".react-flow__node");
  await palette(page, "Таймлайн");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("timeline-panel")).toBeVisible();
}

const graphNode = async (p, id) => (await api("GET", `/projects/${p.id}/graph`)).nodes.find((n) => n.id === id);

test("возраст, противоречие и сдвиг даты на шаг", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const { p, war, funeral } = await world();
  await openTimeline(page, p);
  await expect(page.getByTestId(`timeline-row-${war.id}`).getByTestId("timeline-age-chip")).toHaveText(/Анна\s*20/);
  await expect(page.getByTestId(`timeline-conflict-${funeral.id}`)).toBeVisible();
  await page.getByTestId("timeline-conflicts").click();
  await expect(page.locator(".tl-row")).toHaveCount(1);
  await page.getByTestId(`timeline-row-${funeral.id}`).click();
  await expect(page.getByTestId("timeline-inspector-conflicts")).toContainText("Анна");
  await page.getByTestId("timeline-conflicts").click();

  await page.getByTestId(`timeline-row-${war.id}`).click();
  await page.getByTestId("timeline-nudge-plus").click();
  await expect.poll(async () => {
    const e = (await graphNode(p, war.id)).dates[0];
    return [e.start.y, e.end.y];
  }).toEqual([1021, 1028]);
  expect(errors).toEqual([]);
});

test("перетаскивание за ручку меняет год", async ({ page }) => {
  const { p, war, funeral } = await world();
  await openTimeline(page, p);
  await page.getByTestId(`timeline-row-${war.id}`).hover();
  const grip = await page.getByTestId(`timeline-grip-${war.id}`).boundingBox();
  const target = await page.getByTestId(`timeline-row-${funeral.id}`).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x, target.y + target.height / 2 + 30, { steps: 10 });
  await expect(page.getByTestId("timeline-drag-ghost").locator(".tl-drag-label")).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await graphNode(p, war.id)).dates[0].start.y).toBeGreaterThan(1070);
  // Длительность войны сохранилась: конец уехал вместе с началом.
  const e = (await graphNode(p, war.id)).dates[0];
  expect(e.end.y - e.start.y).toBe(7);
});

test("событие со шкалы: новый узел и дата существующему", async ({ page }) => {
  const { p, anna, war } = await world();
  await openTimeline(page, p);
  await page.getByTestId(`timeline-row-${war.id}`).hover();
  await page.getByTestId(`timeline-row-add-${war.id}`).click();
  await page.getByTestId("timeline-add-title").fill("Осада");
  await page.getByTestId("timeline-add-submit").click();
  await expect.poll(async () => {
    const n = (await api("GET", `/projects/${p.id}/graph`)).nodes.find((x) => x.title === "Осада");
    return n ? [n.typeId, n.dates[0].start.y] : null;
  }).toEqual(["event", 1020]);

  await page.getByTestId("timeline-add").click();
  await page.getByTestId("timeline-add-mode-existing").click();
  await page.getByTestId("timeline-add-search").fill("Анн");
  await page.getByTestId(`timeline-add-node-${anna.id}`).click();
  await page.getByTestId("timeline-add-key").selectOption("custom");
  await page.locator('[data-testid="timeline-add-panel"] .df-value input.df-num').first().fill("1050");
  await page.getByTestId("timeline-add-submit").click();
  await expect.poll(async () => (await graphNode(p, anna.id)).dates.length).toBe(3);
});

test("«сейчас», дорожки, сюжетная линия и путь на холст", async ({ page }) => {
  const { p, anna, war, funeral } = await world();
  await openTimeline(page, p);
  await page.getByTestId("timeline-now").click();
  await page.getByTestId("timeline-now-year").fill("1050");
  await page.getByTestId("timeline-now-plus-year").click();
  await expect.poll(async () => (await api("GET", `/projects/${p.id}`)).settings.worldNow?.y).toBe(1051);
  await page.getByTestId("timeline-now").click();
  await expect(page.getByTestId("timeline-now-row")).toBeVisible();
  await expect(page.getByTestId(`timeline-row-${funeral.id}`)).toHaveClass(/tl-row-future/);

  await page.getByTestId(`timeline-row-${war.id}`).click();
  await page.getByTestId("timeline-story").click();
  await expect(page.getByTestId("timeline-story-chip")).toBeVisible();
  await expect(page.locator(".tl-row")).toHaveCount(3);
  await page.getByTestId("timeline-story-clear").click();

  await page.getByTestId("timeline-view-lanes").click();
  await expect(page.locator(".tl-lane")).toHaveCount(3);
  await expect(page.getByTestId("timeline-lanes-now")).toBeVisible();
  await page.getByTestId(`timeline-mark-${war.id}`).click();
  await page.getByTestId("timeline-show-canvas").click();
  await expect(page.getByTestId("timeline-panel")).toHaveCount(0);
  await expect(page.locator(`.react-flow__node[data-id="${war.id}"].selected`)).toHaveCount(1);

  // Обратно из меню узла — шкала открывается на нём.
  await page.click(`.react-flow__node[data-id="${anna.id}"]`, { button: "right" });
  await page.getByText("Показать в хронологии").click();
  await expect(page.locator('[data-testid="timeline-inspector"] strong').first()).toHaveText("Анна");
  await page.getByTestId("timeline-view-list").click();
});

test("машина времени гасит тех, кого ещё нет", async ({ page }) => {
  const { p, anna, war } = await world();
  await openRu(page, `/project/${p.id}`);
  await page.waitForSelector(".react-flow__node");
  await page.getByTestId("more-btn").click();
  await page.getByText("Машина времени").click();
  await page.getByTestId("time-machine-range").fill("1010");
  await expect(page.getByTestId("time-machine-year")).toContainText("1010");
  await expect(page.getByTestId("time-machine")).toContainText("в тени: 2");
  await page.getByTestId("time-machine-range").fill("1022");
  await expect(page.getByTestId("time-machine")).toContainText("в тени: 1");
  void anna; void war;
  await page.getByTestId("time-machine-close").click();
  await expect(page.getByTestId("time-machine")).toHaveCount(0);
});

test.describe("телефон", () => {
  const { defaultBrowserType, ...pixel } = devices["Pixel 7"];
  test.use(pixel);

  test("эпохи лентой, инструменты у выбранного ряда, дорожки по касанию", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    const { p, war } = await world();
    await openRu(page, `/project/${p.id}`);
    await page.getByTestId("dock-timeline").tap();
    await expect(page.getByTestId("timeline-era-chip-e1")).toBeVisible();
    await expect(page.getByTestId(`timeline-grip-${war.id}`)).toBeHidden();
    await page.getByTestId(`timeline-row-${war.id}`).tap();
    await expect(page.getByTestId(`timeline-grip-${war.id}`)).toBeVisible();
    await expect(page.getByTestId("timeline-inspector")).toBeVisible();
    await page.locator('[data-testid="timeline-inspector"] .tl-tool').first().tap();

    await page.getByTestId("timeline-view-lanes").tap();
    const box = await page.getByTestId("timeline-lanes").boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.6, box.y + 60);
    await expect(page.getByTestId("timeline-lanes-cursor")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
