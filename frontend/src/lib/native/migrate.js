// Переезд проектов телефона из IndexedDB в ядро на Rust.
//
// До этой версии приложение для Android хранило проекты в IndexedDB
// (lib/local). Теперь хранилище — SQLite в ядре, как на компьютере. При
// первом запуске новой версии каждый проект переносится туда целиком, с теми
// же id (так файлы .bgproj и синхронизация продолжают его узнавать) и
// картинками. Старые данные в IndexedDB не стираются: если что-то пошло не
// так, они на месте, и перенос повторится при следующем запуске.
import { localApi } from "@/lib/local/api";

const FLAG = "bluegem:core-migrated";

function done() {
  try { return localStorage.getItem(FLAG) === "1"; } catch { return false; }
}

function markDone() {
  try { localStorage.setItem(FLAG, "1"); } catch { /* приватный режим */ }
}

/**
 * @param coreApi API ядра (тот же набор методов, что у сервера)
 * @returns {Promise<{moved: number, failed: number}>}
 */
export async function migrateIndexedDbToCore(coreApi) {
  if (done()) return { moved: 0, failed: 0 };
  let local;
  try {
    local = await localApi.listProjects();
  } catch {
    // IndexedDB недоступна (чистая установка, приватный режим) — переносить нечего.
    markDone();
    return { moved: 0, failed: 0 };
  }
  if (!local.length) {
    markDone();
    return { moved: 0, failed: 0 };
  }
  const already = new Set((await coreApi.listProjects()).map((p) => p.id));
  let moved = 0;
  let failed = 0;
  for (const p of local) {
    if (already.has(p.id)) continue;
    try {
      const snap = await localApi.exportProject(p.id, { inline: true });
      await coreApi.importProject({ ...snap, keepIds: true });
      moved += 1;
    } catch (e) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error("BlueGem: не удалось перенести проект", p.name, e);
    }
  }
  if (!failed) markDone();
  return { moved, failed };
}
