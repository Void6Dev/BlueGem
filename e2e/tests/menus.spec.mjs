// Меню и горячие клавиши редактора — то, что вынесено из Editor.jsx в
// pages/editor/useCanvasMenus.js и useEditorHotkeys.js, — и телефонная
// раскладка с шаблонами в шторке «+».
import { test, expect, devices } from "@playwright/test";
import { apiFor, openRu } from "./helpers.mjs";

const api = apiFor("http://127.0.0.1:8197");

async function pair() {
  const p = await api("POST", "/projects", { name: "Меню", lang: "ru" });
  const a = await api("POST", `/projects/${p.id}/nodes`, { title: "Исток", position: { x: 0, y: 0 } });
  const b = await api("POST", `/projects/${p.id}/nodes`, { title: "Цель", position: { x: 460, y: 0 } });
  const e = await api("POST", `/projects/${p.id}/edges`, { source: a.id, target: b.id });
  return { p, a, b, e };
}

test("меню связи: сменить тип и удалить", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const { p, a, b, e } = await pair();
  await openRu(page, `/project/${p.id}`);
  // Линия идёт между карточками: правый клик — в просвет между ними, на её
  // высоте (сама подложка линии прозрачна, и Playwright считает её скрытой).
  const path = page.locator(`.react-flow__edge[data-id="${e.id}"] .react-flow__edge-interaction`);
  await path.waitFor({ state: "attached" });
  const line = await path.boundingBox();
  const left = await page.locator(`.react-flow__node[data-id="${a.id}"]`).boundingBox();
  const right = await page.locator(`.react-flow__node[data-id="${b.id}"]`).boundingBox();
  await page.mouse.click((left.x + left.width + right.x) / 2, line.y + line.height / 2, { button: "right" });
  await expect(page.getByTestId("ctx-rel-type")).toBeVisible();
  await page.getByTestId("ctx-del-edge").click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect.poll(async () => (await api("GET", `/projects/${p.id}/graph`)).edges.length).toBe(0);
  expect(errors).toEqual([]);
});

test("горячие клавиши: Ctrl+N создаёт узел, ? открывает подсказку, Ctrl+Z отменяет", async ({ page }) => {
  const { p } = await pair();
  await openRu(page, `/project/${p.id}`);
  await page.waitForSelector(".react-flow__node");
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Control+n");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Control+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.keyboard.press("Shift+?");
  await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
});

test("меню холста: авто-раскладка двигает узлы", async ({ page }) => {
  const { p, b } = await pair();
  await openRu(page, `/project/${p.id}`);
  await page.waitForSelector(".react-flow__node");
  const before = (await api("GET", `/projects/${p.id}/graph`)).nodes.find((n) => n.id === b.id).position;
  const pane = await page.locator(".react-flow__pane").boundingBox();
  // Правый верхний угол холста свободен: слева внизу — кнопки масштаба.
  await page.mouse.click(pane.x + pane.width - 60, pane.y + 60, { button: "right" });
  await page.hover('[data-testid="ctx-layout"]');
  await page.locator('[data-testid^="ctx-layout-"]').first().click();
  await expect.poll(async () => JSON.stringify((await api("GET", `/projects/${p.id}/graph`)).nodes
    .find((n) => n.id === b.id).position)).not.toBe(JSON.stringify(before));
});

test.describe("телефон", () => {
  // Без defaultBrowserType: он требует отдельного процесса, а движок и так Chromium.
  const { defaultBrowserType, ...pixel } = devices["Pixel 7"];
  test.use(pixel);

  test("шторка «+» показывает шаблоны и создаёт узел из них", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    const { p } = await pair();
    const proj = await api("GET", `/projects/${p.id}`);
    await api("PUT", `/projects/${p.id}`, {
      settings: {
        ...proj.settings,
        nodeTemplates: [{ id: "tpl-npc", label: "NPC", typeId: "character", title: "Новый NPC", description: "", fields: [], tags: ["npc"] }],
      },
    });
    await openRu(page, `/project/${p.id}`);
    await page.getByTestId("dock-create").click();
    await expect(page.getByTestId("create-templates")).toBeVisible();
    await page.getByTestId("create-tile-tpl-npc").click();
    await expect.poll(async () => (await api("GET", `/projects/${p.id}/graph`)).nodes
      .some((n) => n.title === "Новый NPC" && n.tags.includes("npc"))).toBe(true);
    expect(errors).toEqual([]);
  });
});
