// Правила, общие для хранилища в приложении и для сервера (backend/server.py):
// когда снимать резервную копию, какие копии хранить и сколько помнить
// удаления. Числа здесь и там должны совпадать — иначе один и тот же проект
// на телефоне и на компьютере вёл бы себя по-разному.

/** Копия снимается перед правкой, если последней больше этого. */
export const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
/** Последние копии хранятся подряд (это пара часов работы)… */
export const BACKUP_KEEP_RECENT = 12;
/** …а старше — по одной на день, но не дольше месяца. */
export const BACKUP_KEEP_DAYS = 30;
/** Сколько помнить удаление узла или связи для синхронизации. */
export const TOMBSTONE_DAYS = 180;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Какие копии убрать.
 * @param rows копии от новых к старым: [{id, createdAt}]
 * @returns id копий на удаление
 */
export function backupsToDrop(rows, now = Date.now()) {
  const cutoff = now - BACKUP_KEEP_DAYS * DAY;
  const drop = [];
  const days = new Set();
  rows.forEach((r, i) => {
    const day = String(r.createdAt).slice(0, 10);
    if (i < BACKUP_KEEP_RECENT) days.add(day);
    else if (Date.parse(r.createdAt) < cutoff || days.has(day)) drop.push(r.id);
    else days.add(day);
  });
  return drop;
}

/** Следы удалений в одном виде: {nodes: {id: когда}, edges: {id: когда}}. */
export function normalizeDeleted(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    nodes: { ...(src.nodes && typeof src.nodes === "object" ? src.nodes : {}) },
    edges: { ...(src.edges && typeof src.edges === "object" ? src.edges : {}) },
  };
}

/** Забыть удаления старше TOMBSTONE_DAYS. */
export function pruneDeleted(raw, now = Date.now()) {
  const dead = normalizeDeleted(raw);
  const cutoff = now - TOMBSTONE_DAYS * DAY;
  for (const kind of ["nodes", "edges"]) {
    for (const [id, when] of Object.entries(dead[kind])) {
      if (!(Date.parse(when) >= cutoff)) delete dead[kind][id];
    }
  }
  return dead;
}

/** JSON с ключами по алфавиту: одинаковое содержимое — одинаковая строка. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Быстрый хэш строки (FNV-1a, 2×32 бит) — чтобы не плодить одинаковые копии. */
export function quickHash(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** Отпечаток содержимого снимка: без отметок времени, порядок не важен. */
export function contentHash(snap) {
  const strip = (list) => [...(list || [])]
    .map(({ updatedAt, ...rest }) => rest)
    .sort((x, y) => String(x.id).localeCompare(String(y.id)));
  const p = snap.project || {};
  return quickHash(stableJson({
    p: [p.name, p.description, p.settings],
    n: strip(snap.nodes),
    e: strip(snap.edges),
  }));
}
