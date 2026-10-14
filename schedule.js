import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const ROLE_LABELS = {
  accompanist: "미사반주",
  conductor: "미사지휘"
};

const setupMessage = document.querySelector("#setup-message");
const authPanel = document.querySelector("#auth-panel");
const schedulePanel = document.querySelector("#schedule-panel");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = document.querySelector("#login-button");
const signupButton = document.querySelector("#signup-button");
const logoutButton = document.querySelector("#logout-button");
const accountLine = document.querySelector("#account-line");
const scheduleForm = document.querySelector("#schedule-form");
const saveButton = document.querySelector("#save-button");
const saveMessage = document.querySelector("#save-message");
const scheduleList = document.querySelector("#schedule-list");
const dateInput = document.querySelector("#service-date");
const hourInput = document.querySelector("#service-hour");
const minuteInput = document.querySelector("#service-minute");
const placeInput = document.querySelector("#place");
const roleInput = document.querySelector("#role");
const choirInput = document.querySelector("#choir-name");

const arrivedFromEmailLink = /(?:type=(?:signup|email|magiclink)|[?&#]code=)/.test(
  `${window.location.hash}${window.location.search}`
);

let supabase = null;
let activeUserId = null;
let loadToken = 0;
let authBusy = false;
let saveBusy = false;
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
  activeUserId = null;
  loadToken += 1;
  passwordInput.value = "";
  accountLine.textContent = "";
  accountLine.hidden = true;
  logoutButton.hidden = true;
  authPanel.hidden = false;
  schedulePanel.hidden = true;
  saveBusy = false;
  saveButton.disabled = false;
  saveButton.textContent = "일정 저장";
  setNotice(saveMessage, "", "info");
  scheduleList.replaceChildren();
}

function showSignedIn(user) {
  authPanel.hidden = true;
  schedulePanel.hidden = false;
  accountLine.hidden = false;
  logoutButton.hidden = false;
  accountLine.textContent = user.email ? `${user.email} 님의 일정` : "로그인한 계정의 일정";
  if (arrivedFromEmailLink && !emailLinkNoted) {
    emailLinkNoted = true;
    setNotice(saveMessage, "이메일 확인이 완료되어 로그인되었습니다.", "success");
  }
}

function appendTimeOptions(select, max) {
  for (let value = 0; value <= max; value += 1) {
    const option = document.createElement("option");
    const label = String(value).padStart(2, "0");
    option.value = label;
    option.textContent = label;
    select.append(option);
  }
}

appendTimeOptions(hourInput, 23);
appendTimeOptions(minuteInput, 59);

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return "";
  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

function formatTime(value) {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? "");
  if (!match) return "";
  return `${match[1]}:${match[2]}`;
}

function renderSchedules(rows) {
  scheduleList.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "저장된 일정이 없습니다.";
    scheduleList.append(empty);
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "schedule-item";

    const when = document.createElement("p");
    when.className = "schedule-when";
    when.textContent = [formatDate(row.service_date), formatTime(row.service_time)].filter(Boolean).join(" · ");

    const place = document.createElement("p");
    place.className = "schedule-place";
    place.textContent = typeof row.place === "string" ? row.place : "";

    const role = document.createElement("p");
    role.className = "schedule-role";
    role.textContent = ROLE_LABELS[row.role] ?? "";

    item.append(when, place, role);

    if (typeof row.choir_name === "string" && row.choir_name.trim()) {
      const choir = document.createElement("p");
      choir.className = "schedule-choir";
      choir.textContent = row.choir_name;
      item.append(choir);
    }

    if (typeof row.id === "string") {
      const scoresLink = document.createElement("a");
      scoresLink.className = "text-button";
      scoresLink.href = `mass.html?id=${encodeURIComponent(row.id)}`;
      scoresLink.textContent = "악보";
      item.append(scoresLink);
    }

    scheduleList.append(item);
  });
}

function sortSchedules(rows) {
  return [...rows].sort((a, b) => {
    const byDate = String(a.service_date).localeCompare(String(b.service_date));
    if (byDate !== 0) return byDate;
    return String(a.service_time).localeCompare(String(b.service_time));
  });
}

async function loadSchedules() {
  const token = ++loadToken;
  const userId = activeUserId;
  if (!supabase || !userId) return;

  const pending = document.createElement("p");
  pending.className = "empty-copy";
  pending.textContent = "일정을 불러오는 중입니다.";
  scheduleList.replaceChildren(pending);

  const { data, error } = await supabase
    .from("mass_schedules")
    .select("id, service_date, service_time, place, role, choir_name")
    .order("service_date", { ascending: true })
    .order("service_time", { ascending: true });

  if (token !== loadToken || activeUserId !== userId) return;

  if (error) {
    scheduleList.replaceChildren();
    setNotice(saveMessage, "일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
    return;
  }

  renderSchedules(sortSchedules(data ?? []));
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
    if (error) setNotice(saveMessage, "로그아웃하지 못했습니다. 다시 시도해 주세요.", "info");
  } catch {
    setNotice(saveMessage, "로그아웃하지 못했습니다. 다시 시도해 주세요.", "info");
  } finally {
    logoutButton.disabled = false;
  }
}

function schedulePayload() {
  const place = placeInput.value.trim();
  const choir = choirInput.value.trim();
  const role = roleInput.value;
  const serviceTime = `${hourInput.value}:${minuteInput.value}`;
  if (!dateInput.value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(serviceTime) || !place) {
    return { error: "날짜, 시, 분, 장소를 모두 입력해 주세요." };
  }
  if (!Object.hasOwn(ROLE_LABELS, role)) {
    return { error: "역할은 미사반주 또는 미사지휘 중에서 선택해 주세요." };
  }
  if (place.length > 200 || choir.length > 200) {
    return { error: "장소와 성가대 이름은 200자 안으로 입력해 주세요." };
  }
  return {
    value: {
      service_date: dateInput.value,
      service_time: serviceTime,
      place,
      role,
      choir_name: choir || null
    }
  };
}

async function saveSchedule(event) {
  event.preventDefault();
  if (!supabase || !activeUserId || saveBusy) return;
  if (!scheduleForm.reportValidity()) return;

  const payload = schedulePayload();
  if (payload.error) {
    setNotice(saveMessage, payload.error, "info");
    return;
  }

  saveBusy = true;
  saveButton.disabled = true;
  saveButton.textContent = "저장 중";
  setNotice(saveMessage, "", "info");

  try {
    const { error } = await supabase.from("mass_schedules").insert(payload.value);
    if (error) {
      setNotice(saveMessage, "일정을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.", "info");
      return;
    }
    hourInput.value = "";
    minuteInput.value = "";
    placeInput.value = "";
    choirInput.value = "";
    setNotice(saveMessage, "일정을 저장했습니다.", "success");
    await loadSchedules();
  } catch {
    setNotice(saveMessage, "일정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
  } finally {
    saveBusy = false;
    saveButton.disabled = false;
    saveButton.textContent = "일정 저장";
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
    const changedUser = activeUserId !== user.id;
    showSignedIn(user);
    if (changedUser || event === "INITIAL_SESSION" || event === "SIGNED_IN") {
      activeUserId = user.id;
      loadSchedules();
    }
  });
}

authForm.addEventListener("submit", signIn);
signupButton.addEventListener("click", signUp);
logoutButton.addEventListener("click", signOut);
scheduleForm.addEventListener("submit", saveSchedule);
boot();
