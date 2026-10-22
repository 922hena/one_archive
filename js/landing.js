import { createAppClient, LOGIN_PAGE } from "./supabase.js";

// Reads the stored sign-in state only; nothing here signs in or out.
const link = document.querySelector("#header-account");

async function showAccountLink() {
  if (!link) return;
  let signedIn = false;
  const supabase = createAppClient();
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      signedIn = Boolean(data?.session?.user);
    } catch {
      signedIn = false;
    }
  }
  const dot = document.createElement("span");
  dot.className = signedIn ? "account-dot is-on" : "account-dot is-off";
  dot.setAttribute("aria-hidden", "true");
  link.href = signedIn ? "app.html" : LOGIN_PAGE;
  link.replaceChildren("Log in", dot);
  // The dot is color only, so the state is also spelled out for screen readers and hover.
  const state = signedIn ? "Signed in · Go to Missa·Score" : "Not signed in · Log in";
  link.setAttribute("aria-label", state);
  link.title = state;
  link.hidden = false;
}

showAccountLink();
