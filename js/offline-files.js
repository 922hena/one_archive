// Score files kept on this device (IndexedDB) so they open without downloading again.
// Best effort: every read falls back to "not saved", and nothing here touches the server.

const DB_NAME = "yearscore-offline";
const STORE = "files";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, work) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result.value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function request(req) {
  const box = { value: undefined };
  req.onsuccess = () => {
    box.value = req.result;
  };
  return box;
}

// The saved file, or null when it isn't saved (or storage can't be read).
export async function getOfflineFile(path) {
  try {
    return (await run("readonly", (store) => request(store.get(path)))) ?? null;
  } catch {
    return null;
  }
}

// Throws when the file can't be stored (for example the device is out of space).
export async function saveOfflineFile(path, blob) {
  await run("readwrite", (store) => request(store.put(blob, path)));
}

// How many of these paths are saved.
export async function countOfflineFiles(paths) {
  try {
    const keys = await run("readonly", (store) => request(store.getAllKeys()));
    const saved = new Set(keys ?? []);
    return paths.filter((path) => saved.has(path)).length;
  } catch {
    return 0;
  }
}

export async function removeOfflineFiles(paths) {
  await run("readwrite", (store) => {
    for (const path of paths) store.delete(path);
    return { value: undefined };
  });
}

// Asks the browser not to clear the saved files when space is low. Fine if it says no.
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
