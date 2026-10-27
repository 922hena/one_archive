// Notes drawn on score pages, kept on this device (IndexedDB). Nothing here touches the server.
// Original score files are never changed: notes are a separate layer, one record per file page.

import { sanitizeStrokes } from "./annotations.js";
import { scopedName } from "./storage-scope.js";

const DB_NAME = "yearscore-notes";
const STORE = "pages";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const request = indexedDB.open(scopedName(DB_NAME), 1);
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
      const box = { value: undefined };
      work(tx.objectStore(STORE), box);
      tx.oncomplete = () => resolve(box.value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// The saved strokes of one file page ([] when there are none or storage can't be read).
export async function loadNotes(key) {
  try {
    const record = await run("readonly", (store, box) => {
      const request = store.get(key);
      request.onsuccess = () => {
        box.value = request.result;
      };
    });
    return sanitizeStrokes(record?.strokes);
  } catch {
    return [];
  }
}

// An empty list removes the record. Throws if the device can't store it, so the caller can say so.
export async function saveNotes(key, strokes) {
  await run("readwrite", (store) => {
    if (strokes.length) store.put({ strokes, updatedAt: Date.now() }, key);
    else store.delete(key);
  });
}
