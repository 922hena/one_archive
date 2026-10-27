// Device-only holding place for a Score that is made but not yet uploaded (final PDF + thumbnail).
// It lets a failed or interrupted upload continue later. Original photos are never kept here or on the server.

import { scopedName } from "./storage-scope.js";

const DB_NAME = "yearscore-uploads";
const STORE = "drafts";

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb_unavailable"));
      return;
    }
    const request = indexedDB.open(scopedName(DB_NAME), 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "scoreId" });
      store.createIndex("userId", "userId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, work) {
  const db = await open();
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

// draft: { scoreId, fileId, thumbId, userId, pdf, pdfName, thumb: { blob, mime, ext } | null,
//          title, composerName, slotId, createdAt }
export function saveDraft(draft) {
  return run("readwrite", (store) => {
    store.put(draft);
    return {};
  });
}

export function deleteDraft(scoreId) {
  return run("readwrite", (store) => {
    store.delete(scoreId);
    return {};
  });
}

export function listDrafts(userId) {
  return run("readonly", (store) => {
    const result = { value: [] };
    store.index("userId").getAll(userId).onsuccess = (event) => {
      result.value = (event.target.result ?? []).sort((a, b) => a.createdAt - b.createdAt);
    };
    return result;
  });
}

// Storage can be missing (private mode). Callers keep going without a saved copy.
export async function trySaveDraft(draft) {
  try {
    await saveDraft(draft);
    return true;
  } catch {
    return false;
  }
}

export async function tryListDrafts(userId) {
  try {
    return await listDrafts(userId);
  } catch {
    return [];
  }
}

export async function tryDeleteDraft(scoreId) {
  try {
    await deleteDraft(scoreId);
  } catch {
    // an old copy left behind is only offered again as Resume
  }
}
