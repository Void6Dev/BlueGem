// Открытие файла проекта: и по кнопке «Импорт», и двойным кликом по .bgproj
// в проводнике. Логика одна на оба случая.
import { api } from "@/lib/api";
import { ask, isDesktop } from "@/lib/desktop";
import { t } from "@/lib/i18n";

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

function importSnapshot(snapshot) {
  return api.importProject({
    project: snapshot.project,
    nodes: snapshot.nodes || [],
    edges: snapshot.edges || [],
  });
}

/**
 * Открывает снимок проекта.
 *
 * Если проект с тем же id уже есть в приложении, спрашиваем: открыть его или
 * завести копию из файла. Молча делать одно из двух нельзя — в первом случае
 * пользователь не увидит содержимое файла, во втором получит дубликаты после
 * каждого двойного клика.
 *
 * @returns {Promise<{id: string, name: string, action: "opened"|"imported"} | null>}
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
    // Вне десктопной оболочки системного диалога нет — импортируем копию,
    // как эта кнопка работала и раньше.
    const choice = isDesktop
      ? await ask({
        message: t("file.alreadyExists", { name: existing.name }),
        detail: t("file.alreadyExistsDetail"),
        buttons: [t("file.openExisting"), t("file.importCopy"), t("common.cancel")],
        cancelId: 2,
      })
      : 1;
    if (choice === 2 || choice < 0) return null;
    if (choice === 0) return { id: existing.id, name: existing.name, action: "opened" };
  }

  const created = await importSnapshot(snapshot);
  return { id: created.id, name: created.name, action: "imported" };
}

/** Тот же путь, но начиная с текста файла. */
export async function openProjectText(text) {
  return openSnapshot(parseSnapshot(text));
}
