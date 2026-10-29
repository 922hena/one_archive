import { t } from "./i18n.js";
import { todayIso } from "./format.js";
import { h, errorMessage } from "./ui.js";
import { renderCalendar } from "./views/calendar.js";
import { renderHome } from "./views/home.js";
import { renderMass } from "./views/mass.js";
import { renderLibrary } from "./views/library.js";
import { renderLayouts } from "./views/layouts.js";
import { renderSearch } from "./views/search.js";

// Screens of the signed-in app (app.html).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const viewRoot = document.querySelector("#view");
let routeToken = 0;
let lastHash = null;

// Each screen in the browser history gets an id, so going Back can bring back where it was
// (scroll position and, for Search, how many results were loaded). Kept for this tab only.
const ENTRY_KEY = "yearscoreEntry";
const MEMORY_KEY = "yearscore-screens";
const MEMORY_LIMIT = 60;
const memory = readMemory(); // entry id -> { scrollY, extra }
let currentEntry = null;

function readMemory() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(MEMORY_KEY) ?? "[]");
    return new Map(Array.isArray(saved) ? saved : []);
  } catch {
    return new Map();
  }
}

function saveMemory() {
  try {
    sessionStorage.setItem(MEMORY_KEY, JSON.stringify([...memory].slice(-MEMORY_LIMIT)));
  } catch {
    // private mode etc.: Back still works, only the position is not kept after a reload
  }
}

// The id of the history entry on screen. A brand-new entry (a link was followed) has none yet.
function entryFor() {
  const existing = history.state?.[ENTRY_KEY] ?? null;
  if (existing) return { id: existing, isNew: false };
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  history.replaceState({ ...(history.state ?? {}), [ENTRY_KEY]: id }, "");
  return { id, isNew: true };
}

function remember(id) {
  if (!memory.has(id)) memory.set(id, { scrollY: 0, extra: {} });
  return memory.get(id);
}

function parseRoute(hash) {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [name, param] = path.split("/");
  if (name === "search") return { nav: "search", render: renderSearch, params: { query } };
  if (name === "mass" && UUID.test(param ?? "")) return { nav: "home", render: renderMass, params: { id: param } };
  if (name === "library") return { nav: "library", render: renderLibrary, params: {} };
  if (name === "layouts") return { nav: "home", render: renderLayouts, params: {} };
  if (name === "date") return { nav: "home", render: renderCalendar, params: { date: param ?? todayIso() } };
  return { nav: "home", render: renderHome, params: { date: param ?? todayIso() } };
}

async function route(ctx) {
  const token = ++routeToken;
  const hash = window.location.hash;
  const sameScreen = hash === lastHash; // ctx.refresh() after a save: stay where the page was
  lastHash = hash;
  const entry = entryFor();
  // Back / Forward (or a reload) returns to a known entry: bring back its place. A new screen starts at the top.
  const saved = entry.isNew ? null : memory.get(entry.id) ?? null;
  const keepScroll = sameScreen ? window.scrollY : saved?.scrollY ?? 0;
  ctx.restored = sameScreen || saved ? { ...(saved?.extra ?? {}) } : null;
  ctx.remember = (key, value) => {
    remember(entry.id).extra[key] = value;
  };
  const { nav, render, params } = parseRoute(hash);
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.toggleAttribute("aria-current", link.dataset.nav === nav);
  });
  viewRoot.setAttribute("aria-busy", "true");
  const next = h("div", { class: "view" });
  try {
    await render(next, ctx, params);
  } catch (error) {
    next.replaceChildren(
      h("div", { class: "error-box" },
        h("p", { text: errorMessage(error, "errors.loadFailed") }),
        h("button", { type: "button", class: "ghost-button", onclick: () => route(ctx) }, t("common.retry"))
      )
    );
  }
  if (token !== routeToken) return;
  viewRoot.replaceChildren(next);
  viewRoot.removeAttribute("aria-busy");
  currentEntry = entry.id;
  remember(entry.id).scrollY = keepScroll;
  window.scrollTo(0, keepScroll);
}

function onScroll() {
  if (currentEntry) remember(currentEntry).scrollY = window.scrollY;
}

// ctx: { db, supabase, user }. navigate and refresh are added here.
export function startApp(ctx) {
  ctx.navigate = (hash) => {
    if (window.location.hash === hash) route(ctx);
    else window.location.hash = hash;
  };
  ctx.refresh = () => route(ctx);
  // The app puts screens back itself (after the data has loaded), not the browser.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", saveMemory);
  window.addEventListener("hashchange", () => {
    saveMemory();
    route(ctx);
  });
  route(ctx);
  return ctx;
}
