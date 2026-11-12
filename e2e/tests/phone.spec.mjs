// Телефон: переходы по ссылкам, колесо холстов, выбор сторон связи.
import { test, expect, devices } from "@playwright/test";
import { apiFor, openRu } from "./helpers.mjs";

const api = apiFor("http://127.0.0.1:8197");
const { defaultBrowserType, ...pixel } = devices["Pixel 7"];
test.use(pixel);

async function campaign() {
  const p = await api("POST", "/projects", { name: "Кампания", lang: "ru", template: "dnd", starter: true });
  const g = await api("GET", `/projects/${p.id}/graph`);
  const by = (t) => g.nodes.find((n) => n.title === t);
  return { p, g, by };
}

test("ссылка в тексте открывает узел, «назад» называет, куда вернёт", async ({ page }) => {
  const { p, by } = await campaign();
  const town = by("Брекенфорд");
  await api("PUT", `/nodes/${town.id}`, { description: "Порт у [[Громовая долина|долины]]." });
  await openRu(page, `/project/${p.id}`);
  await page.getByTestId(`world-row-${town.id}`).tap();
  await page.getByTestId("mobile-desc").locator("button", { hasText: "долины" }).tap();
  await expect(page.getByTestId("node-title-input")).toHaveValue("Громовая долина");
  await expect(page.getByTestId("node-back-label")).toHaveText("Брекенфорд");
  await page.getByTestId("close-editor-btn").tap();
  await expect(page.getByTestId("node-title-input")).toHaveValue("Брекенфорд");
});

test("колесо холстов: касание соседнего названия переключает холст", async ({ page }) => {
  const { p } = await campaign();
  await openRu(page, `/project/${p.id}`);
  await page.getByTestId("dock-canvas").tap();
  const wheel = page.getByTestId("canvas-wheel");
  await expect(wheel.locator("[aria-selected=true]")).toHaveText("Кампания");
  await wheel.getByTestId("canvas-wheel-world").tap();
  await expect(wheel.locator("[aria-selected=true]")).toHaveText("Мир");
  // Касание текущего — список холстов.
  await wheel.getByTestId("canvas-wheel-world").tap();
  await expect(page.getByTestId("canvas-sheet")).toBeVisible();
});

test("связь из страницы узла: выбранные стороны и «Авто» по положению", async ({ page }) => {
  const { p, by } = await campaign();
  const crown = by("Расколотая корона"); // x 80
  const vale = by("Громовая долина"); // x 80
  const barrow = by("Пепельный курган"); // x 760 — правее короны
  await openRu(page, `/project/${p.id}`);
  await page.getByTestId(`world-row-${crown.id}`).tap();
  await page.getByTestId("add-link-btn").tap();
  await page.getByTestId("side-from-l").tap();
  await page.getByTestId("side-to-r").tap();
  await page.getByTestId(`link-option-${vale.id}`).tap();
  await page.getByTestId("add-link-btn").tap();
  await page.getByTestId(`link-option-${barrow.id}`).tap();
  await expect.poll(async () => {
    const g = await api("GET", `/projects/${p.id}/graph`);
    const side = (t) => g.edges.filter((e) => e.source === crown.id && e.target === t).map((e) => `${e.sourceHandle}${e.targetHandle}`)[0];
    return [side(vale.id), side(barrow.id)];
  }).toEqual(["lr", "rl"]);
});
