// Тонкая обёртка над IndexedDB — хранилищем, которое есть в любом WebView.
//
// Без библиотек: три таблицы и пара индексов, а обёртка вроде idb тянула бы
// за собой больше, чем этот файл. Транзакция — одна на вызов API, как и
// соединение на запрос в server.py: правка узла и отметка «проект изменён»
// пишутся вместе или не пишутся вовсе.

const DB_NAME = "bluegem";
// 2 — картинки отдельно от узлов и резервные копии проектов.
const DB_VERSION = 2;

let opening = null;

function upgrade(db) {
  if (!db.objectStoreNames.contains("projects")) {
    db.createObjectStore("projects", { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains("nodes")) {
    const nodes = db.createObjectStore("nodes", { keyPath: "id" });
    nodes.createIndex("projectId", "projectId");
    // Ключи без значений: панель проектов считает состав по типам, не читая
    // ни описаний, ни картинок — только пары (проект, тип).
    nodes.createIndex("projectType", ["projectId", "typeId"]);
  }
  if (!db.objectStoreNames.contains("edges")) {
    const edges = db.createObjectStore("edges", { keyPath: "id" });
    edges.createIndex("projectId", "projectId");
    edges.createIndex("source", "source");
    edges.createIndex("target", "target");
  }
  if (!db.objectStoreNames.contains("images")) {
    // Байты картинок узлов, по одной записи на содержимое (ключ — sha256).
    db.createObjectStore("images", { keyPath: "hash" });
  }
  if (!db.objectStoreNames.contains("backups")) {
    const backups = db.createObjectStore("backups", { keyPath: "id" });
    backups.createIndex("projectId", "projectId");
  }
}

export function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      // Другая вкладка обновила схему — эту закрываем, чтобы не держать её.
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { /* ждём, пока старая вкладка отпустит базу */ };
  });
  // Просим систему не вычищать данные при нехватке места: это не кэш, а
  // единственная копия миров пользователя.
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* не умеет — и ладно */
  }
  return opening;
}

/** Запрос IndexedDB как обещание. */
export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Выполнить fn в одной транзакции над перечисленными таблицами.
 *
 * Внутри fn можно ждать только запросы этой же транзакции: любое постороннее
 * await (таймер, fetch) даст транзакции закрыться, и следующий запрос упадёт
 * с TransactionInactiveError.
 */
export async function tx(names, mode, fn) {
  const db = await openDb();
  const list = Array.isArray(names) ? names : [names];
  const t = db.transaction(list, mode);
  const stores = {};
  for (const name of list) stores[name] = t.objectStore(name);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Transaction aborted"));
  });
  let result;
  try {
    result = await fn(stores, t);
  } catch (e) {
    try { t.abort(); } catch { /* уже закрыта */ }
    done.catch(() => {});
    throw e;
  }
  await done;
  return result;
}
