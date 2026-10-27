import { createAppClient, requireUser } from "./supabase.js";
import { createDb } from "./db.js";
import { t, setLocale, translateDom } from "./i18n.js";
import { h, notify, confirmDialog } from "./ui.js";
import { startApp } from "./router.js";

const viewRoot = document.querySelector("#view");

async function boot() {
  setLocale("en");
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

  startApp({ supabase, user, db: createDb(supabase) });
}

boot();
