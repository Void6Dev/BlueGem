// Открытие файла проекта: и по кнопке «Импорт», и двойным кликом по .bgproj
// в проводнике. Логика одна на оба случая.
import { api } from "@/lib/api";
import { ask, isDesktop } from "@/lib/desktop";
import { t } from "@/lib/i18n";
import { mergeSnapshots } from "@/lib/sync/merge";

/** Разбирает содержимое файла и убеждается, что это снимок проекта. */
export function parseSnapshot(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t("errors.notJson"));
  }
  const looksRight = data && typeof data === "object" && (data.project || Array.isArray(data.nodes));
  if (!looksRight) throw new Error(t("errors.notProjectFile"));
  return data;
}

// keepIds: проект, перенесённый с другого устройства, сохраняет свои id —
// по ним следующий файл того же проекта узнаётся и сливается, а не
// задваивается. Если id уже заняты, хранилище само выдаст новые.
function importSnapshot(snapshot, { keepIds = true } = {}) {
  return api.importProject({
    project: snapshot.project,
    nodes: snapshot.nodes || [],
    edges: snapshot.edges || [],
    keepIds,
  });
}

/** Слить файл с уже имеющимся проектом (тот же проект с другого устройства). */
async function mergeSnapshot(existing, snapshot) {
  const local = await api.exportProject(existing.id, { inline: true });
  const res = mergeSnapshots(local, snapshot);
  if (res.localChanged) await api.replaceProject(existing.id, res.snapshot);
  return { id: existing.id, name: res.snapshot.project.name || existing.name, action: "merged", stats: res.stats };
}

/**
 * Открывает снимок проекта.
 *
 * Если проект с тем же id уже есть в приложении, спрашиваем: открыть его или
 * завести копию из файла. Молча делать одно из двух нельзя — в первом случае
 * пользователь не увидит содержимое файла, во втором получит дубликаты после
 * каждого двойного клика.
 *
 * @returns {Promise<{id: string, name: string, action: "opened"|"imported"|"merged", stats?: object} | null>}
 *          null — пользователь отказался.
 */
export async function openSnapshot(snapshot) {
  const sourceId = snapshot?.project?.id;
  let existing = null;
  if (sourceId) {
    const projects = await api.listProjects().catch(() => []);
    existing = projects.find((p) => p.id === sourceId) || null;
  }

  if (existing) {
    // Тот же проект уже есть — скорее всего, это его версия с другого
    // устройства. По умолчанию правки из файла сливаются с проектом (так и
    // работает перенос с телефона на компьютер и обратно). Вне десктопной
    // оболочки системного диалога нет — там сразу слияние.
    const choice = isDesktop
      ? await ask({
        message: t("file.alreadyExists", { name: existing.name }),
        detail: t("file.alreadyExistsDetail"),
        buttons: [t("file.merge"), t("file.openExisting"), t("file.importCopy"), t("common.cancel")],
        cancelId: 3,
      })
      : 0;
    if (choice === 3 || (isDesktop && choice < 0)) return null;
    if (choice === 0) return mergeSnapshot(existing, snapshot);
    if (choice === 1) return { id: existing.id, name: existing.name, action: "opened" };
    const copy = await importSnapshot(snapshot, { keepIds: false });
    return { id: copy.id, name: copy.name, action: "imported" };
  }

  const created = await importSnapshot(snapshot);
  return { id: created.id, name: created.name, action: "imported" };
}

/** Тот же путь, но начиная с текста файла. */
export async function openProjectText(text) {
  return openSnapshot(parseSnapshot(text));
}

/** Что сказать после открытия файла. */
export function openResultMessage(result) {
  if (result.action === "merged") {
    const s = result.stats || {};
    return t("file.merged", { name: result.name, added: s.added || 0, updated: s.updated || 0, removed: s.removed || 0 });
  }
  return t(result.action === "imported" ? "dashboard.toasts.imported" : "dashboard.toasts.opened", { name: result.name });
}
