import { createAppClient, requireUser } from "./supabase.js";
import { createDb } from "./db.js";
import { t, setLocale, translateDom } from "./i18n.js";
import { todayIso } from "./format.js";
import { h, errorMessage, notify, confirmDialog } from "./ui.js";
import { renderCalendar } from "./views/calendar.js";
import { renderHome } from "./views/home.js";
import { renderMass } from "./views/mass.js";
import { renderLibrary } from "./views/library.js";
import { renderLayouts } from "./views/layouts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const viewRoot = document.querySelector("#view");
let routeToken = 0;
let lastHash = null;

function parseRoute(hash) {
  const [name, param] = hash.replace(/^#\/?/, "").split("/");
  if (name === "mass" && UUID.test(param ?? "")) return { nav: "home", render: renderMass, params: { id: param } };
  if (name === "library") return { nav: "library", render: renderLibrary, params: {} };
  if (name === "layouts") return { nav: "home", render: renderLayouts, params: {} };
  if (name === "date") return { nav: "home", render: renderCalendar, params: { date: param ?? todayIso() } };
  return { nav: "home", render: renderHome, params: { date: param ?? todayIso() } };
}

async function route(ctx) {
  const token = ++routeToken;
  const hash = window.location.hash;
  const keepScroll = hash === lastHash ? window.scrollY : 0;
  lastHash = hash;
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
  window.scrollTo(0, keepScroll);
}

async function boot() {
  setLocale("ko");
  translateDom();
  const supabase = createAppClient();
  if (!supabase) {
    viewRoot.replaceChildren(h("p", { class: "error-box", text: t("errors.config") }));
    return;
  }
  const user = await requireUser(supabase);
  if (!user) return;
  document.querySelector("#account-email").textContent = user.email ?? "";
  const logoutButton = document.querySelector("#logout-button");
  // requireUser already sends a signed-out member to the login page.
  logoutButton.addEventListener("click", async () => {
    if (!(await confirmDialog(t("nav.logoutConfirm"), { confirmLabel: t("nav.logout") }))) return;
    logoutButton.disabled = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch {
      logoutButton.disabled = false;
      notify(t("errors.logoutFailed"), "error");
    }
  });

  // Search is not built yet; the tab only explains that.
  document.querySelector('[data-action="search"]')?.addEventListener("click", () => notify(t("home.searchSoon")));

  const ctx = {
    supabase,
    user,
    db: createDb(supabase),
    navigate(hash) {
      if (window.location.hash === hash) route(ctx);
      else window.location.hash = hash;
    },
    refresh() {
      route(ctx);
    }
  };
  window.addEventListener("hashchange", () => route(ctx));
  route(ctx);
}

boot();
