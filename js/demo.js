import { createDb } from "./db.js";
import { t, setLocale, translateDom } from "./i18n.js";
import { todayIso } from "./format.js";
import { h, notify, confirmDialog } from "./ui.js";
import { startApp } from "./router.js";
import { scopedName, setStorageScope } from "./storage-scope.js";
import { createDemoClient, createMemoryBlobStore } from "./demo-client.js";
import { DEMO_USER_ID, demoReference, seedDemo, seedDemoScores } from "./demo-seed.js";

// Demo page: the signed-in app without an account. No Supabase client is created; every change stays in this
// browser tab (records in sessionStorage, files in IndexedDB) and is gone once the tab is closed.

const SESSION_KEY = "yearscore-demo";
const SESSION_VERSION = 2;
const REGISTRY_KEY = "yearscore-demo-tabs";
const STALE_MS = 24 * 60 * 60 * 1000;
const FILES_DB = "yearscore-demo-files";
// Device storage a demo tab may create (see storage-scope.js), removed when the tab has been gone a while.
const SCOPED_DBS = [FILES_DB, "yearscore-notes", "yearscore-offline", "yearscore-uploads"];

const viewRoot = document.querySelector("#view");

function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
    return saved?.version === SESSION_VERSION && saved.sid && saved.tables ? saved : null;
  } catch {
    return null;
  }
}

let saveTimer = null;
let warnedFull = false;

function saveSession(session) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      if (!warnedFull) notify(t("demo.notKept"), "error");
      warnedFull = true;
    }
  }, 60);
}

function readRegistry() {
  try {
    const value = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeRegistry(value) {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(value));
  } catch {
    // only cleanup of old demo tabs depends on this
  }
}

function deleteDatabases(sid) {
  for (const name of SCOPED_DBS) {
    try {
      indexedDB.deleteDatabase(`${name}--demo-${sid}`);
    } catch {
      // nothing stored, or storage is off
    }
  }
}

// Marks this tab as open, and removes what demo tabs closed long ago left on the device.
function keepAlive(sid) {
  const touch = () => {
    const registry = readRegistry();
    const now = Date.now();
    for (const [other, seen] of Object.entries(registry)) {
      if (other !== sid && now - Number(seen) > STALE_MS) {
        deleteDatabases(other);
        delete registry[other];
      }
    }
    registry[sid] = now;
    writeRegistry(registry);
  };
  touch();
  setInterval(touch, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") touch();
  });
}

function openFilesDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb_unavailable"));
      return;
    }
    const request = indexedDB.open(scopedName(FILES_DB), 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// File contents of this tab: uploads in IndexedDB (kept over a reload).
function createTabBlobStore() {
  const fallback = createMemoryBlobStore();
  let dbPromise = openFilesDb().catch(() => null);

  async function run(mode, work) {
    const db = await dbPromise;
    if (!db) return undefined;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode);
      const box = { value: undefined };
      work(tx.objectStore("files"), box);
      tx.oncomplete = () => resolve(box.value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    async get(path) {
      const stored = await run("readonly", (store, box) => {
        const request = store.get(path);
        request.onsuccess = () => {
          box.value = request.result ?? null;
        };
      }).catch(() => null);
      return stored ?? fallback.get(path);
    },
    async put(path, blob) {
      if (await dbPromise) await run("readwrite", (store) => store.put(blob, path));
      else await fallback.put(path, blob);
    },
    async delete(paths) {
      await fallback.delete(paths);
      await run("readwrite", (store) => paths.forEach((path) => store.delete(path)));
    },
    async close() {
      const db = await dbPromise;
      db?.close();
      dbPromise = Promise.resolve(null);
    }
  };
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      resolve();
    }
    setTimeout(resolve, 1500);
  });
}

function setupHeader(session, blobs) {
  const reset = document.querySelector("#demo-reset");
  reset?.addEventListener("click", async () => {
    const ok = await confirmDialog(t("demo.resetConfirm"), { confirmLabel: t("demo.reset"), danger: true });
    if (!ok) return;
    reset.disabled = true;
    clearTimeout(saveTimer);
    sessionStorage.removeItem(SESSION_KEY);
    const registry = readRegistry();
    delete registry[session.sid];
    writeRegistry(registry);
    await blobs.close();
    await Promise.all(SCOPED_DBS.map((name) => deleteDatabase(`${name}--demo-${session.sid}`)));
    window.location.hash = "#/home";
    window.location.reload();
  });
}

async function boot() {
  setLocale("en");
  translateDom();
  let session = readSession();
  const fresh = !session;
  if (fresh) session = { version: SESSION_VERSION, sid: crypto.randomUUID(), tables: {}, objects: [] };
  setStorageScope(`demo-${session.sid}`);
  keepAlive(session.sid);
  const blobs = createTabBlobStore();
  const client = createDemoClient({
    userId: DEMO_USER_ID,
    state: session,
    reference: demoReference(),
    blobs,
    onChange: () => saveSession(session)
  });
  const db = createDb(client);
  try {
    if (fresh) {
      const today = todayIso();
      await seedDemo({ db, today });
      await seedDemoScores({ db, client, today });
    }
  } catch {
    viewRoot.replaceChildren(h("p", { class: "error-box", text: t("demo.startFailed") }));
    return;
  }
  setupHeader(session, blobs);
  startApp({ supabase: client, user: { id: DEMO_USER_ID, email: null }, db });
}

boot();
