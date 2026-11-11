import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { apiFor, openRu, palette, PNG } from "./helpers.mjs";

const api = apiFor("http://127.0.0.1:8197");

async function world() {
  const p = await api("POST", "/projects", { name: "Королевство", lang: "ru" });
  const anna = await api("POST", `/projects/${p.id}/nodes`, { title: "Анна", typeId: "character", position: { x: 0, y: 0 } });
  const boris = await api("POST", `/projects/${p.id}/nodes`, {
    title: "Борис", typeId: "character", position: { x: 340, y: 0 },
    description: "Старший брат [[Анна|Анны]]. Украл королевскую печать и сбежал на север.",
  });
  await api("POST", `/projects/${p.id}/edges`, { source: boris.id, target: anna.id });
  return { p, anna, boris };
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.errors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.errors, "ошибки на странице").toEqual([]);
});

test("палитра находит узел по тексту описания", async ({ page }) => {
  const { p } = await world();
  await openRu(page, `/project/${p.id}`);
  await page.waitForSelector(".react-flow__node");
  await palette(page, "печать");
  const snippet = page.getByTestId("palette-snippet");
  await expect(snippet).toContainText("королевскую печать");
  await expect(snippet.locator("mark")).toHaveText("печать");
});

test("обратные ссылки: Анна упомянута у Бориса", async ({ page }) => {
  const { p, anna, boris } = await world();
  await openRu(page, `/project/${p.id}`);
  await page.dblclick(`.react-flow__node[data-id="${anna.id}"]`);
  const block = page.getByTestId("node-mentions");
  await expect(block).toContainText("Борис");
  await expect(block).toContainText("Старший брат Анны");
  await page.getByTestId(`mention-${boris.id}`).click();
  await expect(page.locator(".sw-panel-title, .sw-npage-title").first()).toHaveValue("Борис");
});

test("шаблон узла: сохранить и создать из меню холста", async ({ page }) => {
  const { p, anna } = await world();
  await api("PUT", `/nodes/${anna.id}`, { fields: [{ key: "Хочет", value: "" }], tags: ["npc"] });
  await openRu(page, `/project/${p.id}`);
  await page.waitForSelector(".react-flow__node");
  await page.click(`.react-flow__node[data-id="${anna.id}"]`, { button: "right" });
  await page.getByTestId("ctx-save-tpl").click();
  await expect.poll(async () => (await api("GET", `/projects/${p.id}`)).settings.nodeTemplates.length).toBe(1);

  const box = await page.locator(".react-flow__pane").boundingBox();
  await page.mouse.click(box.x + box.width - 240, box.y + box.height - 200, { button: "right" });
  await page.hover('[data-testid="ctx-new-here"]');
  await page.locator('[data-testid^="ctx-new-tpl-"]').click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  const g = await api("GET", `/projects/${p.id}/graph`);
  const made = g.nodes.find((n) => n.id !== anna.id && n.title === "Анна");
  expect(made.tags).toEqual(["npc"]);
  expect(made.fields.map((f) => f.key)).toEqual(["Хочет"]);
});

test("резервные копии: вернуться к состоянию до правки", async ({ page }) => {
  const { p, boris } = await world();
  await api("POST", `/projects/${p.id}/backups`);
  await api("DELETE", `/nodes/${boris.id}`);
  await openRu(page, `/project/${p.id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await palette(page, "Настройки");
  await page.keyboard.press("Enter");
  await page.getByTestId("settings-section-backups").click();
  await page.getByTestId("backup-list").waitFor();
  // Самая свежая копия снята перед удалением — в ней Борис ещё есть.
  await page.getByTestId("backup-restore").first().click();
  await page.getByTestId("backup-restore-confirm").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
});

test("картинка узла хранится отдельно и видна на карточке", async ({ page }) => {
  const { p, anna } = await world();
  const saved = await api("PUT", `/nodes/${anna.id}`, { image: PNG });
  expect(saved.image).toMatch(/^bg-image:[0-9a-f]{64}$/);
  await openRu(page, `/project/${p.id}`);
  await page.dblclick(`.react-flow__node[data-id="${anna.id}"]`);
  const img = page.getByTestId("node-image");
  await expect(img).toHaveAttribute("src", /\/api\/images\/[0-9a-f]{64}/);
  await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBe(1);
});

test("экспорт: книга мира и картинка холста", async ({ page }, info) => {
  const { p } = await world();
  await openRu(page, `/project/${p.id}`);
  await page.waitForSelector(".react-flow__edge path");

  const grab = async (label, file) => {
    await palette(page, label);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    const out = info.outputPath(file);
    await dl.saveAs(out);
    return out;
  };
  const html = fs.readFileSync(await grab("книга мира (HTML)", "book.html"), "utf8");
  expect(html).toContain("<title>Королевство</title>");
  expect(html.match(/<article /g)).toHaveLength(2);
  expect(html).toMatch(/<a href="#node-[\w-]+" class="wiki">Анны<\/a>/);

  const png = fs.readFileSync(await grab("картинка холста (PNG)", "canvas.png"));
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const svg = fs.readFileSync(await grab("картинка холста (SVG)", "canvas.svg"), "utf8");
  expect(svg.startsWith("<svg")).toBe(true);
  // Линии связей ссылаются на свой градиент внутри файла, а не на страницу.
  expect(svg).not.toContain("127.0.0.1");
  expect(svg.length).toBeLessThan(2_000_000);
});
