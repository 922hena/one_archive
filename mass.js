import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { buildScorePageElements } from "./score-viewer.js";

/* 큰 역할 6가지 + 미사곡(세부 11가지). 어떤 역할이든 자유롭게 넣고 뺄 수 있습니다. */
const MAIN_ROLES = [
  ["entrance", "입당성가"],
  ["offertory_1", "봉헌성가 1"],
  ["offertory_2", "봉헌성가 2"],
  ["special_song", "특송"],
  ["communion_1", "성체성가 1"],
  ["communion_2", "성체성가 2"],
  ["meditation", "영성체후 묵상곡"],
  ["dismissal", "파견성가"],
  ["postlude", "후주"]
];
const MASS_PART_ROLES = [
  ["kyrie", "자비송"],
  ["gloria", "대영광송"],
  ["psalm", "화답송"],
  ["gospel_acclamation", "복음환호송"],
  ["prayer_response", "보편지향기도응답"],
  ["sanctus", "거룩하시도다"],
  ["mystery_of_faith", "신앙의 신비여"],
  ["amen", "아멘"],
  ["lords_prayer", "주님의 기도"],
  ["doxology", "주님께 나라와"],
  ["agnus_dei", "하느님의 어린양"]
];
/* 미사 순서는 늘 이 순서로 고정됩니다. 어떤 순서로 선택해도 이 순서대로 정렬됩니다. */
const ROLE_ORDER = [
  "entrance",
  "kyrie",
  "gloria",
  "psalm",
  "gospel_acclamation",
  "prayer_response",
  "offertory_1",
  "offertory_2",
  "sanctus",
  "mystery_of_faith",
  "amen",
  "lords_prayer",
  "doxology",
  "agnus_dei",
  "special_song",
  "communion_1",
  "communion_2",
  "meditation",
  "dismissal",
  "postlude"
];
/* 선택한 항목이 없어도 항상 보이면서 바로 악보를 연결할 수 있는 자리 */
const KEY_SLOTS = new Set(["special_song", "meditation", "postlude"]);
const MASS_PART_VALUES = new Set(MASS_PART_ROLES.map(([value]) => value));
const ROLE_LABELS = Object.fromEntries([...MAIN_ROLES, ...MASS_PART_ROLES]);

function roleBadgeText(role) {
  const label = ROLE_LABELS[role] ?? "역할";
  return MASS_PART_VALUES.has(role) ? `미사곡 · ${label}` : label;
}
const MASS_ROLE_LABELS = { accompanist: "미사반주", conductor: "미사지휘" };
const MAX_ORDER = 999;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const $ = (selector) => document.querySelector(selector);

const setupMessage = $("#setup-message");
const accountLine = $("#account-line");
const logoutButton = $("#logout-button");
const authPanel = $("#auth-panel");
const authForm = $("#auth-form");
const authMessage = $("#auth-message");
const emailInput = $("#email");
const passwordInput = $("#password");
const loginButton = $("#login-button");

const massPanel = $("#mass-panel");
const massTitle = $("#mass-title");
const massMeta = $("#mass-meta");
const massMessage = $("#mass-message");
const addLinkButton = $("#add-link-button");
const picker = $("#picker");
const pickerSearch = $("#picker-search");
const pickerList = $("#picker-list");
const pickerForm = $("#picker-form");
const pickerSelected = $("#picker-selected");
const rolePicker = $("#role-picker");
const templateList = $("#template-list");
const templateMessage = $("#template-message");
const templateNewButton = $("#template-new-button");
const templateForm = $("#template-form");
const templateFormTitle = $("#template-form-title");
const templateName = $("#template-name");
const templateRoles = $("#template-roles");
const templateSave = $("#template-save");
const templateCancel = $("#template-cancel");
const pickerTemplates = $("#picker-templates");
const pickerTemplatesBox = $("#picker-templates-box");
const memoInput = $("#memo-input");
const linkConfirm = $("#link-confirm");
const linkCancel = $("#link-cancel");
const linkList = $("#link-list");
const showAllSlots = $("#show-all-slots");

const params = new URLSearchParams(window.location.search);
const massIdParam = params.get("id") ?? "";
const massId = UUID_PATTERN.test(massIdParam) ? massIdParam : null;

let supabase = null;
let activeUserId = null;
let authBusy = false;
let busy = false;
let loadToken = 0;
let links = [];
let myScores = null;
let chosenScore = null;
const openViewers = new Set();

/* ---------- 도우미 ---------- */

function setNotice(element, text, tone) {
  element.textContent = text;
  element.classList.toggle("is-success", tone === "success");
  element.classList.toggle("is-info", tone === "info");
  element.hidden = text.length === 0;
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return match ? `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일` : "";
}

function formatTime(value) {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? "");
  return match ? `${match[1]}:${match[2]}` : "";
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

function showPanel(name) {
  authPanel.hidden = name !== "auth";
  massPanel.hidden = name !== "mass";
}

function embeddedScore(row) {
  const score = Array.isArray(row.scores) ? row.scores[0] : row.scores;
  return { title: score?.title ?? "(제목 없음)", pageCount: score?.page_count ?? 0 };
}

function makeButton(label, className, onClick, disabled = false, ariaLabel = label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

/* ---------- 미사 + 연결 목록 ---------- */

async function loadMass() {
  const token = ++loadToken;
  const userId = activeUserId;
  if (!supabase || !userId) return;

  if (!massId) {
    showPanel("mass");
    addLinkButton.hidden = true;
    massTitle.textContent = "미사를 찾을 수 없습니다";
    setNotice(massMessage, "일정 화면에서 미사를 골라 들어와 주세요.", "info");
    return;
  }

  const { data: mass, error } = await supabase
    .from("mass_schedules")
    .select("id, service_date, service_time, place, role, choir_name")
    .eq("id", massId)
    .maybeSingle();
  if (token !== loadToken || activeUserId !== userId) return;

  showPanel("mass");
  if (error || !mass) {
    addLinkButton.hidden = true;
    massTitle.textContent = "미사를 찾을 수 없습니다";
    massMeta.textContent = "";
    setNotice(massMessage, error ? "미사를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." : "내 일정에 없는 미사입니다.", "info");
    linkList.replaceChildren();
    return;
  }

  addLinkButton.hidden = false;
  massTitle.textContent = [formatDate(mass.service_date), formatTime(mass.service_time)].filter(Boolean).join(" · ");
  massMeta.textContent = [mass.place, MASS_ROLE_LABELS[mass.role], mass.choir_name].filter(Boolean).join(" · ");
  await loadLinks(token);
}

async function loadLinks(token = loadToken) {
  const { data, error } = await supabase
    .from("mass_score_links")
    .select("id, score_id, music_role, play_order, memo, played, created_at, scores(title, page_count)")
    .eq("mass_id", massId)
    .order("play_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (token !== loadToken) return;
  if (error) {
    setNotice(massMessage, "연결된 악보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
    return;
  }
  const rank = (role) => {
    const position = ROLE_ORDER.indexOf(role);
    return position === -1 ? ROLE_ORDER.length : position;
  };
  links = [...(data ?? [])].sort(
    (a, b) =>
      rank(a.music_role) - rank(b.music_role) ||
      a.play_order - b.play_order ||
      String(a.created_at).localeCompare(String(b.created_at))
  );
  renderLinks();
}

function renderLinks() {
  linkList.replaceChildren();
  const showAll = showAllSlots.checked;
  const byRole = new Map();
  links.forEach((link) => {
    if (!byRole.has(link.music_role)) byRole.set(link.music_role, []);
    byRole.get(link.music_role).push(link);
  });

  ROLE_ORDER.forEach((role) => {
    const roleLinks = byRole.get(role) ?? [];
    if (roleLinks.length === 0 && !showAll && !KEY_SLOTS.has(role)) return;

    const slot = document.createElement("li");
    slot.className = "link-slot";
    if (roleLinks.length === 0) slot.classList.add("is-empty");

    const header = document.createElement("div");
    header.className = "slot-header";
    const label = document.createElement("h3");
    label.className = "slot-title";
    label.textContent = roleBadgeText(role);
    const connect = makeButton(
      roleLinks.length === 0 ? "악보 연결" : "악보 추가",
      "strip-button",
      () => openPicker([role]),
      false,
      `${ROLE_LABELS[role]}에 악보 ${roleLinks.length === 0 ? "연결" : "추가"}`
    );
    header.append(label, connect);
    slot.append(header);

    if (roleLinks.length === 0) {
      const hint = document.createElement("p");
      hint.className = "slot-empty";
      hint.textContent = "연결된 악보가 없습니다.";
      slot.append(hint);
    } else {
      const cards = document.createElement("ul");
      cards.className = "slot-cards";
      roleLinks.forEach((link) => cards.append(buildLinkCard(link)));
      slot.append(cards);
    }
    linkList.append(slot);
  });

  if (links.length === 0) {
    const hint = document.createElement("li");
    hint.className = "empty-copy";
    hint.textContent = "특송, 영성체후 묵상곡, 후주에는 바로 악보를 연결할 수 있습니다. 다른 순서는 '악보 연결'이나 '모든 순서 보기'를 이용하세요.";
    linkList.prepend(hint);
  }
}

function buildLinkCard(link) {
  {
    const { title, pageCount } = embeddedScore(link);
    const item = document.createElement("li");
    item.className = "link-item";
    if (link.played) item.classList.add("is-played");

    const head = document.createElement("div");
    head.className = "link-head";
    const name = document.createElement("h4");
    name.className = "link-title";
    name.textContent = title;
    const count = document.createElement("span");
    count.className = "link-count";
    count.textContent = pageCount > 0 ? `${pageCount}개` : "";
    head.append(name, count);

    const played = document.createElement("label");
    played.className = "link-played";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = Boolean(link.played);
    check.addEventListener("change", () => togglePlayed(link, check));
    const playedText = document.createElement("span");
    playedText.textContent = "연주 완료";
    played.append(check, playedText);

    const memoRow = document.createElement("div");
    memoRow.className = "link-memo";
    const memo = document.createElement("input");
    memo.type = "text";
    memo.maxLength = 500;
    memo.value = link.memo ?? "";
    memo.placeholder = "메모";
    memo.setAttribute("aria-label", `${title} 메모`);
    const saveMemo = makeButton("메모 저장", "strip-button", () => saveMemoFor(link, memo, saveMemo), false, `${title} 메모 저장`);
    memoRow.append(memo, saveMemo);

    const viewer = document.createElement("div");
    viewer.className = "link-viewer";
    viewer.hidden = !openViewers.has(link.id);

    const controls = document.createElement("div");
    controls.className = "link-controls";
    const viewButton = makeButton(
      openViewers.has(link.id) ? "접기" : "악보 보기",
      "strip-button",
      () => toggleViewer(link, viewer, viewButton),
      pageCount === 0,
      `${title} ${openViewers.has(link.id) ? "접기" : "보기"}`
    );
    controls.append(
      viewButton,
      makeButton("연결 해제", "strip-button danger", () => unlink(link, title), false, `${title} 연결 해제`)
    );

    item.append(head, played, memoRow, controls, viewer);

    if (openViewers.has(link.id)) fillViewer(link, viewer, title);
    return item;
  }
}

async function fillViewer(link, viewer, title) {
  const loading = document.createElement("p");
  loading.className = "empty-copy";
  loading.textContent = "악보를 불러오는 중입니다.";
  viewer.replaceChildren(loading);
  try {
    const elements = await buildScorePageElements(supabase, link.score_id, title);
    if (!viewer.isConnected) return;
    if (elements.length === 0) loading.textContent = "저장된 페이지가 없습니다.";
    else viewer.replaceChildren(...elements);
  } catch {
    if (viewer.isConnected) loading.textContent = "악보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

function toggleViewer(link, viewer, button) {
  if (openViewers.has(link.id)) {
    openViewers.delete(link.id);
    viewer.hidden = true;
    viewer.replaceChildren();
    button.textContent = "악보 보기";
    return;
  }
  openViewers.add(link.id);
  viewer.hidden = false;
  button.textContent = "접기";
  fillViewer(link, viewer, embeddedScore(link).title);
}

/* ---------- 연결 / 수정 / 해제 ---------- */

function failNotice(text) {
  setNotice(massMessage, text, "info");
}

async function togglePlayed(link, checkbox) {
  if (busy) {
    checkbox.checked = Boolean(link.played);
    return;
  }
  busy = true;
  const next = checkbox.checked;
  const { error } = await supabase.from("mass_score_links").update({ played: next }).eq("id", link.id);
  busy = false;
  if (error) {
    checkbox.checked = !next;
    failNotice("연주 여부를 저장하지 못했습니다. 다시 시도해 주세요.");
    return;
  }
  link.played = next;
  checkbox.closest(".link-item")?.classList.toggle("is-played", next);
  setNotice(massMessage, "", "info");
}

async function saveMemoFor(link, input, button) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  const value = input.value.trim();
  const { error } = await supabase
    .from("mass_score_links")
    .update({ memo: value.length > 0 ? value : null })
    .eq("id", link.id);
  busy = false;
  button.disabled = false;
  if (error) {
    failNotice("메모를 저장하지 못했습니다. 다시 시도해 주세요.");
    return;
  }
  link.memo = value.length > 0 ? value : null;
  setNotice(massMessage, "메모를 저장했습니다.", "success");
}

async function unlink(link, title) {
  if (busy) return;
  if (!window.confirm(`'${title}' 악보를 이 미사에서 연결 해제할까요? 악보 파일은 지워지지 않습니다.`)) return;
  busy = true;
  const { error } = await supabase.from("mass_score_links").delete().eq("id", link.id);
  busy = false;
  if (error) {
    failNotice("연결을 해제하지 못했습니다. 다시 시도해 주세요.");
    return;
  }
  openViewers.delete(link.id);
  setNotice(massMessage, "연결을 해제했습니다.", "success");
  await loadLinks();
}

/* ---------- 악보 고르기 ---------- */

function roleCheckbox(value, label) {
  const wrapper = document.createElement("label");
  wrapper.className = "role-option";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.name = "music-role";
  box.value = value;
  const text = document.createElement("span");
  text.textContent = label;
  wrapper.append(box, text);
  return wrapper;
}

function populateRoles(container) {
  const main = document.createElement("div");
  main.className = "role-group";
  MAIN_ROLES.forEach(([value, label]) => main.append(roleCheckbox(value, label)));

  const partsHead = document.createElement("div");
  partsHead.className = "role-parts-head";
  const partsTitle = document.createElement("strong");
  partsTitle.textContent = "미사곡";
  const partBoxes = () => [...container.querySelectorAll(".role-parts input")];
  const syncToggle = () => {
    toggleAll.textContent = partBoxes().every((box) => box.checked) ? "전체 해제" : "전체 선택";
  };
  const toggleAll = makeButton("전체 선택", "strip-button", () => {
    const boxes = partBoxes();
    const allChecked = boxes.every((box) => box.checked);
    boxes.forEach((box) => {
      box.checked = !allChecked;
    });
    syncToggle();
  });
  partsHead.append(partsTitle, toggleAll);

  const parts = document.createElement("div");
  parts.className = "role-group role-parts";
  MASS_PART_ROLES.forEach(([value, label]) => parts.append(roleCheckbox(value, label)));

  container.addEventListener("change", syncToggle);
  container.append(main, partsHead, parts);
}

function checkedRoles(container = rolePicker) {
  const picked = new Set([...container.querySelectorAll("input:checked")].map((box) => box.value));
  return ROLE_ORDER.filter((value) => picked.has(value));
}

function setRoleChecks(container, roles) {
  const wanted = new Set(roles);
  container.querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.checked = wanted.has(box.value);
  });
  container.dispatchEvent(new Event("change"));
}

function clearRoleChecks(container = rolePicker) {
  setRoleChecks(container, []);
}

/* ---------- 미사틀 (최대 3개 저장) ---------- */

const MAX_TEMPLATES = 3;
let templates = [];
let editingTemplate = null;

function templateTitle(template) {
  return `미사${template.slot_no}. ${template.name}`;
}

function templateSummary(template) {
  const roles = ROLE_ORDER.filter((role) => template.roles.includes(role));
  const allParts = MASS_PART_ROLES.every(([value]) => roles.includes(value));
  const labels = [];
  let partsAdded = false;
  roles.forEach((role) => {
    if (allParts && MASS_PART_VALUES.has(role)) {
      if (!partsAdded) labels.push("미사곡 전체");
      partsAdded = true;
      return;
    }
    labels.push(ROLE_LABELS[role]);
  });
  return labels.join(", ");
}

async function loadTemplates() {
  const userId = activeUserId;
  if (!supabase || !userId) return;
  const { data, error } = await supabase
    .from("mass_templates")
    .select("id, slot_no, name, roles")
    .order("slot_no", { ascending: true });
  if (activeUserId !== userId) return;
  if (error) {
    setNotice(templateMessage, "미사틀을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
    return;
  }
  templates = (data ?? []).map((row) => ({ ...row, roles: Array.isArray(row.roles) ? row.roles : [] }));
  renderTemplates();
}

function renderTemplates() {
  templateList.replaceChildren();
  templates.forEach((template) => {
    const item = document.createElement("li");
    item.className = "template-item";
    const info = document.createElement("div");
    info.className = "template-info";
    const title = document.createElement("strong");
    title.textContent = templateTitle(template);
    const summary = document.createElement("p");
    summary.textContent = templateSummary(template);
    info.append(title, summary);
    const actions = document.createElement("div");
    actions.className = "template-actions";
    actions.append(
      makeButton("수정", "strip-button", () => openTemplateEditor(template), false, `${templateTitle(template)} 수정`),
      makeButton("삭제", "strip-button danger", () => deleteTemplate(template), false, `${templateTitle(template)} 삭제`)
    );
    item.append(info, actions);
    templateList.append(item);
  });
  if (templates.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-copy";
    empty.textContent = "저장된 미사틀이 없습니다. 자주 쓰는 구성을 최대 3개까지 저장해 두세요.";
    templateList.append(empty);
  }
  templateNewButton.hidden = templates.length >= MAX_TEMPLATES || !templateForm.hidden;
  renderPickerTemplates();
}

function renderPickerTemplates() {
  pickerTemplates.replaceChildren();
  pickerTemplatesBox.hidden = templates.length === 0;
  templates.forEach((template) => {
    pickerTemplates.append(
      makeButton(
        templateTitle(template),
        "strip-button",
        () => {
          setRoleChecks(rolePicker, template.roles);
          setNotice(massMessage, "", "info");
        },
        false,
        `${templateTitle(template)} 구성 불러오기`
      )
    );
  });
}

function openTemplateEditor(template) {
  editingTemplate = template ?? null;
  templateName.value = template ? template.name : "";
  setRoleChecks(templateRoles, template ? template.roles : []);
  const slot = template ? template.slot_no : firstFreeSlot();
  templateFormTitle.textContent = template ? `${templateTitle(template)} 수정` : `미사${slot} 만들기`;
  templateForm.hidden = false;
  templateNewButton.hidden = true;
  setNotice(templateMessage, "", "info");
  templateName.focus();
}

function closeTemplateEditor() {
  templateForm.hidden = true;
  editingTemplate = null;
  templateNewButton.hidden = templates.length >= MAX_TEMPLATES;
}

function firstFreeSlot() {
  const used = new Set(templates.map((template) => template.slot_no));
  for (let slot = 1; slot <= MAX_TEMPLATES; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

async function saveTemplate() {
  if (busy) return;
  const name = templateName.value.trim();
  const roles = checkedRoles(templateRoles);
  if (!name) {
    setNotice(templateMessage, "미사틀 이름을 입력해 주세요. 예: 아침미사", "info");
    templateName.focus();
    return;
  }
  if (name.length > 50) {
    setNotice(templateMessage, "이름은 50자 안으로 입력해 주세요.", "info");
    return;
  }
  if (roles.length === 0) {
    setNotice(templateMessage, "음악 역할을 하나 이상 선택해 주세요.", "info");
    return;
  }

  busy = true;
  templateSave.disabled = true;
  let error;
  if (editingTemplate) {
    ({ error } = await supabase.from("mass_templates").update({ name, roles }).eq("id", editingTemplate.id));
  } else {
    const slot = firstFreeSlot();
    if (!slot) {
      busy = false;
      templateSave.disabled = false;
      setNotice(templateMessage, "미사틀은 3개까지 저장할 수 있습니다. 하나를 삭제한 뒤 만들어 주세요.", "info");
      return;
    }
    ({ error } = await supabase.from("mass_templates").insert({ slot_no: slot, name, roles }));
  }
  busy = false;
  templateSave.disabled = false;
  if (error) {
    setNotice(
      templateMessage,
      error.code === "23505" ? "이미 같은 번호의 미사틀이 있습니다. 화면을 새로 고쳐 주세요." : "미사틀을 저장하지 못했습니다. 다시 시도해 주세요.",
      "info"
    );
    return;
  }
  closeTemplateEditor();
  setNotice(templateMessage, "미사틀을 저장했습니다.", "success");
  await loadTemplates();
}

async function deleteTemplate(template) {
  if (busy) return;
  if (!window.confirm(`'${templateTitle(template)}' 미사틀을 삭제할까요? 이미 연결한 악보는 그대로 남습니다.`)) return;
  busy = true;
  const { error } = await supabase.from("mass_templates").delete().eq("id", template.id);
  busy = false;
  if (error) {
    setNotice(templateMessage, "삭제하지 못했습니다. 다시 시도해 주세요.", "info");
    return;
  }
  if (editingTemplate?.id === template.id) closeTemplateEditor();
  setNotice(templateMessage, "미사틀을 삭제했습니다.", "success");
  await loadTemplates();
}

function renderPicker() {
  const needle = pickerSearch.value.trim().toLowerCase();
  const rows = (myScores ?? []).filter((score) => score.title.toLowerCase().includes(needle));
  pickerList.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-copy";
    empty.textContent = myScores && myScores.length === 0 ? "저장된 악보가 없습니다. 먼저 악보 화면에서 저장해 주세요." : "검색 결과가 없습니다.";
    pickerList.append(empty);
    return;
  }
  rows.forEach((score) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-item";
    if (chosenScore?.id === score.id) button.classList.add("is-chosen");
    const label = document.createElement("span");
    label.textContent = score.title;
    const meta = document.createElement("span");
    meta.className = "picker-meta";
    meta.textContent = score.page_count > 0 ? `${score.page_count}개` : "";
    button.append(label, meta);
    button.addEventListener("click", () => chooseScore(score));
    item.append(button);
    pickerList.append(item);
  });
}

function chooseScore(score) {
  chosenScore = score;
  pickerSelected.textContent = `선택한 악보: ${score.title}`;
  pickerForm.hidden = false;
  renderPicker();
  pickerForm.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function openPicker(presetRoles = []) {
  picker.hidden = false;
  addLinkButton.hidden = true;
  pickerForm.hidden = true;
  chosenScore = null;
  memoInput.value = "";
  setRoleChecks(rolePicker, presetRoles);
  pickerSearch.value = "";
  picker.scrollIntoView({ block: "start", behavior: "smooth" });
  const pending = document.createElement("li");
  pending.className = "empty-copy";
  pending.textContent = "악보를 불러오는 중입니다.";
  pickerList.replaceChildren(pending);

  const { data, error } = await supabase
    .from("scores")
    .select("id, title, page_count")
    .eq("status", "ready")
    .order("created_at", { ascending: false });
  if (error) {
    myScores = null;
    const message = document.createElement("li");
    message.className = "empty-copy";
    message.textContent = "악보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    pickerList.replaceChildren(message);
    return;
  }
  myScores = data ?? [];
  renderPicker();
}

function closePicker() {
  picker.hidden = true;
  addLinkButton.hidden = false;
  chosenScore = null;
}

async function confirmLink() {
  if (busy || !chosenScore || !massId) return;
  const picked = checkedRoles();
  if (picked.length === 0) {
    failNotice("음악 역할을 하나 이상 선택해 주세요.");
    return;
  }
  const alreadyLinked = new Set(links.filter((link) => link.score_id === chosenScore.id).map((link) => link.music_role));
  const roles = picked.filter((role) => !alreadyLinked.has(role));
  if (roles.length === 0) {
    failNotice("선택한 역할에 이미 연결된 악보입니다. 다른 역할을 고르거나 다른 악보를 선택해 주세요.");
    return;
  }
  const baseOrder = links.reduce((max, link) => Math.max(max, link.play_order), 0);
  if (baseOrder + roles.length > MAX_ORDER) {
    failNotice("이 미사에는 더 이상 연결할 수 없습니다.");
    return;
  }

  busy = true;
  linkConfirm.disabled = true;
  const memo = memoInput.value.trim();
  const { error } = await supabase.from("mass_score_links").insert(
    roles.map((role, index) => ({
      mass_id: massId,
      score_id: chosenScore.id,
      music_role: role,
      play_order: baseOrder + index + 1,
      memo: memo.length > 0 ? memo : null
    }))
  );
  busy = false;
  linkConfirm.disabled = false;
  if (error) {
    failNotice(
      error.code === "23505"
        ? "이미 같은 역할로 연결된 악보입니다. 화면을 새로 고친 뒤 다시 시도해 주세요."
        : "악보를 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요."
    );
    return;
  }
  const skipped = picked.length - roles.length;
  setNotice(
    massMessage,
    `'${chosenScore.title}' 악보를 ${roles.length}곳에 연결했습니다.${skipped > 0 ? ` 이미 연결된 ${skipped}곳은 건너뛰었습니다.` : ""}`,
    "success"
  );
  closePicker();
  await loadLinks();
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
  if (!supabase) return;
  logoutButton.disabled = true;
  try {
    await supabase.auth.signOut();
  } finally {
    logoutButton.disabled = false;
  }
}

function showSignedOut() {
  activeUserId = null;
  loadToken += 1;
  links = [];
  myScores = null;
  chosenScore = null;
  openViewers.clear();
  templates = [];
  closeTemplateEditor();
  renderTemplates();
  setNotice(templateMessage, "", "info");
  linkList.replaceChildren();
  closePicker();
  passwordInput.value = "";
  accountLine.hidden = true;
  accountLine.textContent = "";
  logoutButton.hidden = true;
  setNotice(massMessage, "", "info");
  showPanel("auth");
}

function boot() {
  populateRoles(rolePicker);
  populateRoles(templateRoles);
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
    accountLine.textContent = user.email ? `${user.email} 님의 미사` : "로그인한 계정의 미사";
    accountLine.hidden = false;
    logoutButton.hidden = false;
    if (activeUserId !== user.id) {
      activeUserId = user.id;
      loadMass();
      loadTemplates();
    }
  });
}

authForm.addEventListener("submit", signIn);
logoutButton.addEventListener("click", signOut);
addLinkButton.addEventListener("click", () => openPicker([]));
showAllSlots.addEventListener("change", renderLinks);
linkCancel.addEventListener("click", closePicker);
linkConfirm.addEventListener("click", confirmLink);
pickerSearch.addEventListener("input", renderPicker);
templateNewButton.addEventListener("click", () => openTemplateEditor(null));
templateCancel.addEventListener("click", closeTemplateEditor);
templateSave.addEventListener("click", saveTemplate);

boot();
