import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { safeNextPath } from "./js/return-to.js";

const setupMessage = document.querySelector("#setup-message");
const authPanel = document.querySelector("#auth-panel");
const sessionPanel = document.querySelector("#session-panel");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = document.querySelector("#login-button");
const signupButton = document.querySelector("#signup-button");
const logoutButton = document.querySelector("#logout-button");
const accountLine = document.querySelector("#account-line");
const sessionMessage = document.querySelector("#session-message");
const appLink = document.querySelector("#app-link");

// Set when the app sent the member here; only app.html screens are accepted.
const nextPath = safeNextPath(new URLSearchParams(window.location.search).get("next"));
if (nextPath && appLink) appLink.href = nextPath;

// One automatic return per few seconds, so this page and the app can never bounce back and forth.
function returnToApp() {
  try {
    const last = Number(sessionStorage.getItem("oneArchiveReturnAt") || 0);
    if (Date.now() - last < 5000) return false;
    sessionStorage.setItem("oneArchiveReturnAt", String(Date.now()));
  } catch {
    // storage unavailable: still return once
  }
  window.location.replace(nextPath);
  return true;
}

const arrivedFromEmailLink = /(?:type=(?:signup|email|magiclink)|[?&#]code=)/.test(
  `${window.location.hash}${window.location.search}`
);

let supabase = null;
let authBusy = false;
let emailLinkNoted = false;

function setNotice(element, text, tone) {
  element.textContent = text;
  element.classList.toggle("is-success", tone === "success");
  element.classList.toggle("is-info", tone === "info");
  element.hidden = text.length === 0;
}

function looksLikeSecretKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length < 2) return false;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(payload));
    return parsed.role === "service_role";
  } catch {
    return false;
  }
}

function readConfig() {
  const config = window.ONE_ARCHIVE ?? {};
  const url = typeof config.supabaseUrl === "string" ? config.supabaseUrl.trim() : "";
  const key = typeof config.supabasePublishableKey === "string" ? config.supabasePublishableKey.trim() : "";
  const incomplete = !url || !key || url.includes("YOUR_PROJECT_REF") || key.includes("YOUR_PUBLISHABLE_KEY");
  return { url, key, incomplete, secret: looksLikeSecretKey(key) };
}

function setAuthBusy(busy) {
  authBusy = busy;
  loginButton.disabled = busy;
  signupButton.disabled = busy;
  emailInput.disabled = busy;
  passwordInput.disabled = busy;
}

function lockAuthForm() {
  loginButton.disabled = true;
  signupButton.disabled = true;
  emailInput.disabled = true;
  passwordInput.disabled = true;
}

function showSignedOut() {
  passwordInput.value = "";
  accountLine.textContent = "";
  accountLine.hidden = true;
  logoutButton.hidden = true;
  authPanel.hidden = false;
  sessionPanel.hidden = true;
  setNotice(sessionMessage, "", "info");
}

function showSignedIn(user) {
  authPanel.hidden = true;
  sessionPanel.hidden = false;
  accountLine.hidden = false;
  logoutButton.hidden = false;
  accountLine.textContent = user.email ? `${user.email} 님으로 로그인했습니다.` : "로그인했습니다.";
  if (arrivedFromEmailLink && !emailLinkNoted) {
    emailLinkNoted = true;
    setNotice(sessionMessage, "이메일 확인이 완료되어 로그인되었습니다.", "success");
  }
}

function koreanAuthError(error, action) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "서버에 연결하지 못했습니다. 주소를 확인한 뒤 다시 시도해 주세요.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "이메일 확인이 필요합니다. 받은 메일의 링크를 누른 뒤 다시 로그인해 주세요.";
  }
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (message.includes("password") && message.includes("6")) {
    return "비밀번호는 6자 이상이어야 합니다.";
  }
  if (action === "signup" && (code === "user_already_exists" || message.includes("already"))) {
    return "이미 가입된 이메일입니다. 로그인해 주세요.";
  }
  return action === "signup"
    ? "회원가입을 완료하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요."
    : "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.";
}

async function signUp() {
  if (!supabase || authBusy || !authForm.reportValidity()) return;
  setAuthBusy(true);
  setNotice(authMessage, "", "info");
  try {
    const emailRedirectTo = new URL("/schedule.html", window.location.origin).href;
    const { data, error } = await supabase.auth.signUp({
      email: emailInput.value.trim(),
      password: passwordInput.value,
      options: { emailRedirectTo }
    });
    if (error) {
      setNotice(authMessage, koreanAuthError(error, "signup"), "info");
      return;
    }
    if (!data.session) {
      passwordInput.value = "";
      setNotice(authMessage, "확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요.", "success");
    }
  } catch {
    setNotice(authMessage, "서버에 연결하지 못했습니다. 주소를 확인한 뒤 다시 시도해 주세요.", "info");
  } finally {
    setAuthBusy(false);
  }
}

async function signIn(event) {
  event.preventDefault();
  if (!supabase || authBusy || !authForm.reportValidity()) return;
  setAuthBusy(true);
  setNotice(authMessage, "", "info");
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value
    });
    if (error) {
      setNotice(authMessage, koreanAuthError(error, "login"), "info");
      return;
    }
    passwordInput.value = "";
  } catch {
    setNotice(authMessage, "서버에 연결하지 못했습니다. 주소를 확인한 뒤 다시 시도해 주세요.", "info");
  } finally {
    setAuthBusy(false);
  }
}

async function signOut() {
  if (!supabase || authBusy) return;
  logoutButton.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(sessionMessage, "로그아웃하지 못했습니다. 다시 시도해 주세요.", "info");
  } catch {
    setNotice(sessionMessage, "로그아웃하지 못했습니다. 다시 시도해 주세요.", "info");
  } finally {
    logoutButton.disabled = false;
  }
}

function boot() {
  const { url, key, incomplete, secret } = readConfig();
  if (secret) {
    setNotice(setupMessage, "공개용 Publishable key만 넣어 주세요. 비밀키는 사용하지 않습니다.", "info");
    lockAuthForm();
    return;
  }
  if (!url.startsWith("https://") || url.includes("YOUR_PROJECT_REF")) {
    setNotice(setupMessage, "config.js에 Project URL과 Publishable key를 넣은 뒤 새로고침해 주세요.", "info");
    lockAuthForm();
    return;
  }
  if (incomplete) {
    setNotice(setupMessage, "config.js의 Publishable key 자리에 공개용 키를 넣은 뒤 새로고침해 주세요.", "info");
    lockAuthForm();
    return;
  }

  supabase = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "implicit"
    }
  });

  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    if (!user) {
      showSignedOut();
      return;
    }
    if (nextPath && returnToApp()) return;
    showSignedIn(user);
  });
}

authForm.addEventListener("submit", signIn);
signupButton.addEventListener("click", signUp);
logoutButton.addEventListener("click", signOut);
boot();
