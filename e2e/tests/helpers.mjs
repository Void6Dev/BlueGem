// Общее для тестов: прямые запросы к API (заготовить данные быстрее, чем
// кликами) и открытие страницы на русском.
export const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function apiFor(base) {
  return async (method, url, body) => {
    const r = await fetch(`${base}/api${url}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
    return r.json();
  };
}

export async function openRu(page, url) {
  await page.addInitScript(() => localStorage.setItem("bluegem:lang", "ru"));
  await page.goto(url);
}

export async function palette(page, text) {
  await page.keyboard.press("Control+k");
  await page.fill('[data-testid="command-palette-input"]', text);
}
