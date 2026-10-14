import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { ROLE_LABELS, dateText, massName } from "./score-history.js";

const $ = (selector) => document.querySelector(selector);

const ROLE_GROUPS = [
  ["entrance", "offertory_1", "offertory_2", "special_song", "communion_1", "communion_2", "meditation", "dismissal", "postlude"],
  ["kyrie", "gloria", "psalm", "gospel_acclamation", "prayer_response", "sanctus", "mystery_of_faith", "amen", "lords_prayer", "doxology", "agnus_dei"]
];
const SEASONS = [
  ["advent", "대림 시기"], ["christmas", "성탄 시기"], ["ordinary", "연중 시기"],
  ["lent", "사순 시기"], ["triduum", "성삼일"], ["easter", "부활 시기"]
];
const FEASTS = [
  ["nativity", "주님 성탄 대축일"], ["mary_mother_of_god", "천주의 성모 마리아 대축일"], ["epiphany", "주님 공현 대축일"],
  ["baptism", "주님 세례 축일"], ["ash_wednesday", "재의 수요일"], ["palm_sunday", "주님 수난 성지 주일"],
  ["holy_thursday", "성주간 목요일"], ["good_friday", "주님 수난 성금요일"], ["holy_saturday", "성토요일"],
  ["easter", "주님 부활 대축일"], ["ascension", "주님 승천 대축일"], ["pentecost", "성령 강림 대축일"],
  ["trinity", "지극히 거룩하신 삼위일체 대축일"], ["corpus_christi", "지극히 거룩하신 그리스도의 성체 성혈 대축일"],
  ["christ_king", "온 누리의 임금이신 그리스도 왕 대축일"]
];

const setupMessage = $("#setup-message");
const accountLine = $("#account-line");
const logoutButton = $("#logout-button");
const authPanel = $("#auth-panel");
const authForm = $("#auth-form");
const emailInput = $("#email");
const passwordInput = $("#password");
const loginButton = $("#login-button");
const authMessage = $("#auth-message");
const searchPanel = $("#search-panel");
const searchForm = $("#search-form");
const searchButton = $("#search-button");
const searchMessage = $("#search-message");
const resultPanel = $("#result-panel");
const resultSummary = $("#result-summary");
const resultList = $("#result-list");
const rolesBox = $("#f-roles");
const seasonsBox = $("#f-seasons");
const feastSelect = $("#f-feast");

let supabase = null;
let activeUserId = null;
let authBusy = false;
let searchToken = 0;

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
    return JSON.parse(atob(payload)).role === "service_role";
  } catch {
    return false;
  }
}

function readConfig() {
  const config = window.ONE_ARCHIVE ?? {};
  const url = typeof config.supabaseUrl === "string" ? config.supabaseUrl.trim() : "";
  const key = typeof config.supabasePublishableKey === "string" ? config.supabasePublishableKey.trim() : "";
  return {
    url,
    key,
    missing: !url || !key || url.includes("YOUR_PROJECT_REF") || key.includes("YOUR_PUBLISHABLE_KEY"),
    secret: looksLikeSecretKey(key)
  };
}

function localIso(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* ---------- 조건 입력 ---------- */

function checkbox(container, name, value, label) {
  const wrapper = document.createElement("label");
  wrapper.className = "archive-check";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.name = name;
  box.value = value;
  const text = document.createElement("span");
  text.textContent = label;
  wrapper.append(box, text);
  container.append(wrapper);
}

function buildFilters() {
  ROLE_GROUPS.flat().forEach((role) => checkbox(rolesBox, "role", role, ROLE_LABELS[role]));
  SEASONS.forEach(([value, label]) => checkbox(seasonsBox, "season", value, label));
  const none = new Option("선택 안 함", "");
  feastSelect.append(none, ...FEASTS.map(([value, label]) => new Option(label, value)));
}

function checkedValues(container) {
  return [...container.querySelectorAll("input:checked")].map((box) => box.value);
}

function numberOrNull(id) {
  const raw = $(id).value.trim();
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : Number.NaN;
}

function textOrNull(id) {
  const value = $(id).value.trim();
  return value === "" ? null : value;
}

function readParams() {
  const min = numberOrNull("#f-min");
  const max = numberOrNull("#f-max");
  if (Number.isNaN(min) || Number.isNaN(max)) return { error: "연주 횟수는 0 이상의 정수로 입력해 주세요." };
  const from = $("#f-from").value || null;
  const to = $("#f-to").value || null;
  if (from && to && from > to) return { error: "날짜 시작이 끝보다 늦습니다." };
  if (min !== null && max !== null && min > max) return { error: "최소 횟수가 최대 횟수보다 큽니다." };
  const roles = checkedValues(rolesBox);
  const seasons = checkedValues(seasonsBox);
  return {
    params: {
      p_roles: roles.length ? roles : null,
      p_seasons: seasons.length ? seasons : null,
      p_feast: textOrNull("#f-feast-text") ?? (feastSelect.value || null),
      p_composer: textOrNull("#f-composer"),
      p_title: textOrNull("#f-title"),
      p_place: textOrNull("#f-place"),
      p_from: from,
      p_to: to,
      p_min: min,
      p_max: max,
      p_played: searchForm.elements.played.value,
      p_period_mode: searchForm.elements.mode.value,
      p_limit: 100
    }
  };
}

function resetFilters() {
  searchForm.reset();
  setNotice(searchMessage, "", "info");
  resultPanel.hidden = true;
  resultList.replaceChildren();
}

/* ---------- 결과 ---------- */

function statusOf(item, todayIso) {
  if (item.played) return { key: "played", text: "연주 ○" };
  if (item.date >= todayIso) return { key: "planned", text: "예정" };
  return { key: "unknown", text: "미정" };
}

function historyList(history) {
  const today = localIso(new Date());
  const list = document.createElement("ul");
  list.className = "history-list";
  history.forEach((item) => {
    const row = document.createElement("li");
    const link = document.createElement("a");
    link.className = "history-item";
    link.href = `mass.html?id=${encodeURIComponent(item.mass_id)}`;
    const line = document.createElement("span");
    line.className = "history-line";
    const date = dateText(item.date);
    line.textContent = [
      item.name ? `${date}(${item.name})` : date,
      item.place,
      massName(item.time),
      ROLE_LABELS[item.role] ?? "역할"
    ].filter(Boolean).join(", ");
    const status = statusOf(item, today);
    const badge = document.createElement("span");
    badge.className = `history-status is-${status.key}`;
    badge.textContent = status.text;
    link.append(line, badge);
    if (item.memo && item.memo.trim()) {
      const memo = document.createElement("span");
      memo.className = "history-memo";
      memo.textContent = `메모: ${item.memo.trim()}`;
      link.append(memo);
    }
    row.append(link);
    list.append(row);
  });
  return list;
}

function resultCard(row, exclude) {
  const item = document.createElement("li");
  item.className = "archive-result";

  const head = document.createElement("div");
  head.className = "archive-result-head";
  const title = document.createElement("strong");
  title.textContent = row.title;
  head.append(title);
  if (row.composer) {
    const composer = document.createElement("span");
    composer.className = "archive-composer";
    composer.textContent = row.composer;
    head.append(composer);
  }

  const count = document.createElement("p");
  count.className = "archive-count";
  count.textContent = exclude
    ? `조건에 맞는 연주 0회 · 전체 실제 연주 ${row.total_played}회 · 전체 연결 ${row.total_links}회`
    : `조건에 맞는 연주 ${row.match_count}회 · 전체 실제 연주 ${row.total_played}회 · 전체 연결 ${row.total_links}회`;

  item.append(head, count);

  const roles = row.roles ?? [];
  if (roles.length) {
    const tags = document.createElement("p");
    tags.className = "archive-roles";
    tags.textContent = `역할: ${roles.map((role) => ROLE_LABELS[role] ?? role).join(", ")}`;
    item.append(tags);
  }
  if (row.last_played) {
    const last = document.createElement("p");
    last.className = "archive-last";
    last.textContent = `최근 조건 연주: ${dateText(row.last_played)}`;
    item.append(last);
  }

  const history = Array.isArray(row.history) ? row.history : [];
  if (history.length) {
    const details = document.createElement("details");
    details.className = "archive-history";
    const summary = document.createElement("summary");
    summary.textContent = `관련 미사 이력 ${history.length}건`;
    details.append(summary, historyList(history));
    item.append(details);
  }
  return item;
}

async function runSearch(event) {
  event?.preventDefault();
  if (!supabase || !activeUserId) return;
  const { params, error } = readParams();
  if (error) {
    setNotice(searchMessage, error, "info");
    return;
  }
  setNotice(searchMessage, "", "info");
  const token = ++searchToken;
  searchButton.disabled = true;
  searchButton.textContent = "검색 중";
  try {
    const { data, error: rpcError } = await supabase.rpc("search_score_archive", params);
    if (token !== searchToken) return;
    if (rpcError) {
      setNotice(searchMessage, "검색하지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
      return;
    }
    const rows = data ?? [];
    const exclude = params.p_period_mode === "exclude";
    resultPanel.hidden = false;
    resultSummary.textContent = rows.length === 0
      ? "조건에 맞는 악보가 없습니다."
      : `${rows.length}개 악보${rows.length >= 100 ? " (최대 100개까지 표시)" : ""}`;
    resultList.replaceChildren(...rows.map((row) => resultCard(row, exclude)));
    resultPanel.scrollIntoView({ block: "start", behavior: "smooth" });
  } catch {
    setNotice(searchMessage, "서버에 연결하지 못했습니다.", "info");
  } finally {
    if (token === searchToken) {
      searchButton.disabled = false;
      searchButton.textContent = "검색";
    }
  }
}

/* ---------- 로그인 ---------- */

function koreanAuthError(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "서버에 연결하지 못했습니다. 주소를 확인한 뒤 다시 시도해 주세요.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "이메일 확인이 필요합니다. 받은 메일의 링크를 누른 뒤 다시 로그인해 주세요.";
  }
  return "이메일 또는 비밀번호가 올바르지 않습니다.";
}

function setAuthBusy(value) {
  authBusy = value;
  loginButton.disabled = value;
  emailInput.disabled = value;
  passwordInput.disabled = value;
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
      setNotice(authMessage, koreanAuthError(error), "info");
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
  if (supabase) await supabase.auth.signOut();
}

function showSignedOut() {
  activeUserId = null;
  searchToken += 1;
  resultList.replaceChildren();
  resultPanel.hidden = true;
  searchPanel.hidden = true;
  authPanel.hidden = false;
  accountLine.hidden = true;
  logoutButton.hidden = true;
  passwordInput.value = "";
}

function boot() {
  buildFilters();
  const { url, key, missing, secret } = readConfig();
  if (secret) {
    setNotice(setupMessage, "공개용 Publishable key만 넣어 주세요. 비밀키는 사용하지 않습니다.", "info");
    loginButton.disabled = true;
    return;
  }
  if (missing || !url.startsWith("https://")) {
    setNotice(setupMessage, "config.js에 Project URL과 Publishable key를 넣은 뒤 새로고침해 주세요.", "info");
    loginButton.disabled = true;
    return;
  }
  supabase = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    if (!user) {
      showSignedOut();
      return;
    }
    accountLine.textContent = user.email ? `${user.email} 님의 아카이브` : "로그인한 계정의 아카이브";
    accountLine.hidden = false;
    logoutButton.hidden = false;
    authPanel.hidden = true;
    searchPanel.hidden = false;
    activeUserId = user.id;
  });
}

authForm.addEventListener("submit", signIn);
logoutButton.addEventListener("click", signOut);
searchForm.addEventListener("submit", runSearch);
$("#reset-button").addEventListener("click", resetFilters);
document.querySelectorAll("[data-years]").forEach((button) => {
  button.addEventListener("click", () => {
    const years = Number(button.dataset.years);
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(end.getFullYear() - years);
    $("#f-from").value = localIso(start);
    $("#f-to").value = localIso(end);
  });
});

boot();
