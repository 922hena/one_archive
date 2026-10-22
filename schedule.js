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
const forgotButton = document.querySelector("#forgot-button");
const resetPanel = document.querySelector("#reset-panel");
const resetForm = document.querySelector("#reset-form");
const resetButton = document.querySelector("#reset-button");
const resetMessage = document.querySelector("#reset-message");
const newPasswordInput = document.querySelector("#new-password");
const newPasswordCheck = document.querySelector("#new-password-check");

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

// Read before the Supabase client clears the address.
const arrivalUrl = `${window.location.hash}${window.location.search}`;
const arrivedFromEmailLink = /(?:type=(?:signup|email|magiclink)|[?&#]code=)/.test(arrivalUrl);
const arrivedFromBrokenLink = /[?&#]error(?:_code)?=/.test(arrivalUrl);

let supabase = null;
let authBusy = false;
let emailLinkNoted = false;
let recovering = /type=recovery/.test(arrivalUrl);

// Mail links come back here and keep the screen the member was going to.
function emailReturnUrl() {
  const url = new URL("/schedule.html", window.location.origin);
  if (nextPath) url.searchParams.set("next", nextPath);
  return url.href;
}

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
  forgotButton.disabled = busy;
  emailInput.disabled = busy;
  passwordInput.disabled = busy;
}

function lockAuthForm() {
  loginButton.disabled = true;
  signupButton.disabled = true;
  forgotButton.disabled = true;
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
  resetPanel.hidden = true;
  setNotice(sessionMessage, "", "info");
}

function showRecovery() {
  authPanel.hidden = true;
  sessionPanel.hidden = true;
  accountLine.hidden = true;
  logoutButton.hidden = true;
  resetPanel.hidden = false;
  newPasswordInput.focus();
}

function showSignedIn(user) {
  authPanel.hidden = true;
  resetPanel.hidden = true;
  sessionPanel.hidden = false;
  accountLine.hidden = false;
  logoutButton.hidden = false;
  accountLine.textContent = user.email ? `Signed in as ${user.email}.` : "Signed in.";
  if (arrivedFromEmailLink && !emailLinkNoted) {
    emailLinkNoted = true;
    setNotice(sessionMessage, "Your email is confirmed and you are signed in.", "success");
  }
}

function authErrorText(error, action) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "Couldn't reach the server. Check the address and try again.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Please confirm your email first. Click the link in the email we sent, then log in again.";
  }
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "The email or password is incorrect.";
  }
  if (code.includes("rate_limit") || message.includes("rate limit") || message.includes("security purposes")) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (message.includes("password") && message.includes("6")) {
    return "The password must be at least 6 characters.";
  }
  if (code === "weak_password") {
    return "This password is easy to guess or has been leaked before. Please choose another one.";
  }
  if (action === "signup" && (code === "user_already_exists" || message.includes("already"))) {
    return "This email is already registered. Please log in.";
  }
  if (action === "update") {
    if (code === "same_password") return "Choose a password different from your current one.";
    if (message.includes("session")) return "The reset link has expired. Please request a new password reset email.";
    return "Couldn't save the new password. Please try again.";
  }
  if (action === "reset") return "Couldn't send the reset email. Check the email address and try again.";
  return action === "signup"
    ? "Couldn't complete signup. Check what you entered and try again."
    : "Couldn't log in. Check your email and password.";
}

async function signUp() {
  if (!supabase || authBusy || !authForm.reportValidity()) return;
  setAuthBusy(true);
  setNotice(authMessage, "", "info");
  try {
    const { data, error } = await supabase.auth.signUp({
      email: emailInput.value.trim(),
      password: passwordInput.value,
      options: { emailRedirectTo: emailReturnUrl() }
    });
    if (error) {
      setNotice(authMessage, authErrorText(error, "signup"), "info");
      return;
    }
    if (!data.session) {
      passwordInput.value = "";
      setNotice(authMessage, "We sent a confirmation email. Click the link in it, then log in.", "success");
    }
  } catch {
    setNotice(authMessage, "Couldn't reach the server. Check the address and try again.", "info");
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
      setNotice(authMessage, authErrorText(error, "login"), "info");
      return;
    }
    passwordInput.value = "";
  } catch {
    setNotice(authMessage, "Couldn't reach the server. Check the address and try again.", "info");
  } finally {
    setAuthBusy(false);
  }
}

async function sendPasswordReset() {
  if (!supabase || authBusy) return;
  const email = emailInput.value.trim();
  if (!email || !emailInput.checkValidity()) {
    setNotice(authMessage, "First enter the email of the account whose password you want to reset.", "info");
    emailInput.focus();
    return;
  }
  setAuthBusy(true);
  setNotice(authMessage, "", "info");
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: emailReturnUrl() });
    if (error) {
      setNotice(authMessage, authErrorText(error, "reset"), "info");
      return;
    }
    setNotice(
      authMessage,
      "If this email is registered, a password reset email is on its way. Click the link in it to set a new password.",
      "success"
    );
  } catch {
    setNotice(authMessage, "Couldn't reach the server. Check the address and try again.", "info");
  } finally {
    setAuthBusy(false);
  }
}

async function saveNewPassword(event) {
  event.preventDefault();
  if (!supabase || resetButton.disabled || !resetForm.reportValidity()) return;
  if (newPasswordInput.value !== newPasswordCheck.value) {
    setNotice(resetMessage, "The two passwords don't match.", "info");
    newPasswordCheck.focus();
    return;
  }
  resetButton.disabled = true;
  setNotice(resetMessage, "", "info");
  try {
    const { data, error } = await supabase.auth.updateUser({ password: newPasswordInput.value });
    if (error) {
      setNotice(resetMessage, authErrorText(error, "update"), "info");
      return;
    }
    recovering = false;
    newPasswordInput.value = "";
    newPasswordCheck.value = "";
    if (nextPath && returnToApp()) return;
    showSignedIn(data.user);
    setNotice(sessionMessage, "New password saved. Use it the next time you log in.", "success");
  } catch {
    setNotice(resetMessage, "Couldn't reach the server. Please try again.", "info");
  } finally {
    resetButton.disabled = false;
  }
}

async function signOut() {
  if (!supabase || authBusy) return;
  logoutButton.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(sessionMessage, "Couldn't log out. Please try again.", "info");
  } catch {
    setNotice(sessionMessage, "Couldn't log out. Please try again.", "info");
  } finally {
    logoutButton.disabled = false;
  }
}

function boot() {
  const { url, key, incomplete, secret } = readConfig();
  if (secret) {
    setNotice(setupMessage, "Use only the public Publishable key. Secret keys are not used.", "info");
    lockAuthForm();
    return;
  }
  if (!url.startsWith("https://") || url.includes("YOUR_PROJECT_REF")) {
    setNotice(setupMessage, "Add the Project URL and Publishable key to config.js, then reload.", "info");
    lockAuthForm();
    return;
  }
  if (incomplete) {
    setNotice(setupMessage, "Put the public key in the Publishable key field of config.js, then reload.", "info");
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
    if (event === "PASSWORD_RECOVERY") recovering = true;
    if (!user) {
      recovering = false;
      showSignedOut();
      if (arrivedFromBrokenLink && !emailLinkNoted) {
        emailLinkNoted = true;
        setNotice(authMessage, "The email link has expired or was already used. Please request a new email.", "info");
      }
      return;
    }
    // A reset link signs the member in; the new password comes first.
    if (recovering) {
      showRecovery();
      return;
    }
    if (nextPath && returnToApp()) return;
    showSignedIn(user);
  });
}

authForm.addEventListener("submit", signIn);
signupButton.addEventListener("click", signUp);
forgotButton.addEventListener("click", sendPasswordReset);
resetForm.addEventListener("submit", saveNewPassword);
logoutButton.addEventListener("click", signOut);
boot();
