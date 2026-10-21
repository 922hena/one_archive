import { createAppClient, LOGIN_PAGE } from "./supabase.js";

// Reads the stored sign-in state only; nothing here signs in or out.
const link = document.querySelector("#hero-account");

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
  link.href = signedIn ? "app.html" : LOGIN_PAGE;
  link.textContent = signedIn ? "My Mass·Score" : "로그인";
  link.hidden = false;
}

showAccountLink();
