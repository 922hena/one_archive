import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const BUCKET = "scores";
const MAX_PAGES = 30;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 2400;
const SIGNED_URL_SECONDS = 600;
const UPLOAD_RETRIES = 2;

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

const libraryPanel = $("#library-panel");
const newScoreButton = $("#new-score-button");
const listMessage = $("#list-message");
const scoreList = $("#score-list");

const editorPanel = $("#editor-panel");
const scoreForm = $("#score-form");
const titleInput = $("#score-title");
const composerInput = $("#score-composer");
const composerForm = $("#composer-form");
const composerEdit = $("#composer-edit");
const composerSave = $("#composer-save");
const cameraButton = $("#camera-button");
const libraryButton = $("#library-button");
const cameraInput = $("#camera-input");
const libraryInput = $("#library-input");
const prepareMessage = $("#prepare-message");
const pageStrip = $("#page-strip");
const progress = $("#progress");
const editorMessage = $("#editor-message");
const saveButton = $("#save-button");
const cancelButton = $("#cancel-button");

const viewerPanel = $("#viewer-panel");
const backButton = $("#back-button");
const deleteButton = $("#delete-button");
const viewerTitle = $("#viewer-title");
import { loadScoreHistory, renderScoreHistory } from "./score-history.js";
const viewerHistory = $("#viewer-history");
const viewerMeta = $("#viewer-meta");
const viewerMessage = $("#viewer-message");
const viewerPages = $("#viewer-pages");

const panels = { auth: authPanel, library: libraryPanel, editor: editorPanel, viewer: viewerPanel };

class UserError extends Error {}

let supabase = null;
let activeUserId = null;
let listToken = 0;
let viewToken = 0;
let authBusy = false;
let processing = false;
let saving = false;
let deleting = false;
let draftScoreId = null;
let pages = [];
let openScore = null;

/* ---------- 공통 화면 도우미 ---------- */

function setNotice(element, text, tone) {
  element.textContent = text;
  element.classList.toggle("is-success", tone === "success");
  element.classList.toggle("is-info", tone === "info");
  element.hidden = text.length === 0;
}

function showPanel(name) {
  Object.entries(panels).forEach(([key, panel]) => {
    panel.hidden = key !== name;
  });
}

function uuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
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

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(task, retries = UPLOAD_RETRIES) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await pause(700 * (attempt + 1));
    }
  }
  throw lastError;
}

function isAlreadyExists(error) {
  return String(error?.statusCode ?? error?.status) === "409" || /already exists|duplicate/i.test(String(error?.message ?? ""));
}

/* ---------- 이미지 변환 (모두 JPEG로 저장) ---------- */

function isPdf(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isHeic(file) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function decodeBlob(blob) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      /* 다음 방법을 시도합니다. */
    }
    try {
      return await createImageBitmap(blob);
    } catch {
      /* 다음 방법을 시도합니다. */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    image.src = url;
  });
}

async function heicToJpeg(file) {
  const module = await import("https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm");
  const convert = module.default ?? module;
  const result = await convert({ blob: file, toType: "image/jpeg", quality: 0.9 });
  return Array.isArray(result) ? result[0] : result;
}

async function loadSource(file) {
  try {
    return await decodeBlob(file);
  } catch {
    if (isHeic(file)) {
      try {
        return await decodeBlob(await heicToJpeg(file));
      } catch {
        throw new UserError("HEIC 사진을 변환하지 못했습니다. 카메라로 다시 촬영하거나 JPG로 저장한 사진을 선택해 주세요.");
      }
    }
    throw new UserError("이 형식은 열 수 없습니다. JPG, PNG, HEIC 사진을 선택해 주세요.");
  }
}

function renderCanvas(source, rotate = false) {
  const sourceWidth = source.naturalWidth || source.width;
  const sourceHeight = source.naturalHeight || source.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = rotate ? height : width;
  canvas.height = rotate ? width : height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (rotate) {
    context.translate(height, 0);
    context.rotate(Math.PI / 2);
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function encodeUnderLimit(canvas) {
  let current = canvas;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await canvasToBlob(current, quality);
      if (blob && blob.size <= MAX_UPLOAD_BYTES) {
        return { blob, width: current.width, height: current.height };
      }
    }
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.round(current.width * 0.8));
    smaller.height = Math.max(1, Math.round(current.height * 0.8));
    smaller.getContext("2d").drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  throw new UserError("사진 용량이 너무 커서 줄이지 못했습니다. 다른 사진으로 시도해 주세요.");
}

async function preparePdf(file) {
  if (file.size === 0) throw new UserError("비어 있는 PDF입니다.");
  if (file.size > MAX_PDF_BYTES) {
    throw new UserError("PDF는 20MB까지 올릴 수 있습니다.");
  }
  let header = "";
  try {
    header = await file.slice(0, 5).text();
  } catch {
    throw new UserError("PDF 파일을 읽지 못했습니다. 다시 선택해 주세요.");
  }
  if (header !== "%PDF-") throw new UserError("올바른 PDF 파일이 아닙니다.");
  return { kind: "pdf", blob: file, name: file.name, width: null, height: null };
}

async function prepareFile(file) {
  if (isPdf(file)) return preparePdf(file);
  if (file.size > MAX_SOURCE_BYTES) {
    throw new UserError("파일 하나는 25MB까지 올릴 수 있습니다.");
  }
  if (!file.type.startsWith("image/") && !isHeic(file)) {
    throw new UserError("이 형식은 열 수 없습니다. JPG, PNG, HEIC 사진을 선택해 주세요.");
  }
  const source = await loadSource(file);
  let canvas;
  try {
    canvas = renderCanvas(source);
  } finally {
    if (typeof source.close === "function") source.close();
  }
  const encoded = await encodeUnderLimit(canvas);
  return { kind: "image", name: file.name, ...encoded };
}

/* ---------- 새 악보 편집 ---------- */

function editingLocked() {
  return saving || draftScoreId !== null;
}

function updateControls() {
  const locked = editingLocked();
  const busy = processing || saving;
  cameraButton.disabled = locked || processing;
  libraryButton.disabled = locked || processing;
  titleInput.disabled = locked;
  composerInput.disabled = locked;
  saveButton.disabled = busy;
  cameraButton.textContent = pages.length > 0 ? "한 장 더 촬영" : "카메라로 촬영";
  saveButton.textContent = draftScoreId ? "다시 시도" : "악보 저장";
  cancelButton.disabled = saving;
  cancelButton.textContent = draftScoreId ? "저장 취소하고 지우기" : "취소";
}

function makeButton(label, ariaLabel, onClick, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "strip-button";
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function renderPages() {
  pageStrip.replaceChildren();
  const locked = editingLocked() || processing;
  pages.forEach((page, index) => {
    const item = document.createElement("li");
    item.className = "page-item";
    if (page.uploaded) item.classList.add("is-uploaded");

    let image;
    if (page.kind === "pdf") {
      image = document.createElement("div");
      image.className = "page-thumb page-thumb-pdf";
      image.textContent = "PDF";
      image.title = page.name;
    } else {
      image = document.createElement("img");
      image.src = page.url;
      image.alt = `${index + 1}쪽 미리보기`;
      image.className = "page-thumb";
    }

    const label = document.createElement("p");
    label.className = "page-label";
    label.textContent = `${page.kind === "pdf" ? `${index + 1}번 PDF` : `${index + 1}쪽`}${page.uploaded ? " · 올림" : ""}`;

    const controls = document.createElement("div");
    controls.className = "page-controls";
    controls.append(
      makeButton("회전", `${index + 1}쪽 오른쪽으로 회전`, () => rotatePage(index), locked || page.kind === "pdf"),
      makeButton("앞으로", `${index + 1}쪽을 앞으로`, () => movePage(index, -1), locked || index === 0),
      makeButton("뒤로", `${index + 1}쪽을 뒤로`, () => movePage(index, 1), locked || index === pages.length - 1),
      makeButton("빼기", `${index + 1}쪽 빼기`, () => removePage(index), locked)
    );

    item.append(image, label, controls);
    pageStrip.append(item);
  });
}

function releasePages() {
  pages.forEach((page) => {
    if (page.url) URL.revokeObjectURL(page.url);
  });
  pages = [];
}

function resetEditor() {
  releasePages();
  draftScoreId = null;
  saving = false;
  processing = false;
  titleInput.value = "";
  composerInput.value = "";
  setNotice(prepareMessage, "", "info");
  setNotice(editorMessage, "", "info");
  progress.hidden = true;
  progress.textContent = "";
  renderPages();
  updateControls();
}

function openEditor() {
  resetEditor();
  setNotice(listMessage, "", "info");
  titleInput.placeholder = `비워 두면 '${defaultTitle()}'로 저장`;
  showPanel("editor");
}

async function addFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0 || processing || editingLocked()) return;

  processing = true;
  updateControls();
  renderPages();
  setNotice(editorMessage, "", "info");

  let added = 0;
  let firstError = "";
  let failed = 0;

  for (let index = 0; index < files.length; index += 1) {
    if (pages.length >= MAX_PAGES) {
      failed += files.length - index;
      firstError = firstError || `한 악보는 최대 ${MAX_PAGES}페이지까지 저장할 수 있습니다.`;
      break;
    }
    setNotice(prepareMessage, `파일을 준비하는 중입니다 (${index + 1}/${files.length})`, "info");
    try {
      const result = await prepareFile(files[index]);
      pages.push({
        id: uuid(),
        kind: result.kind,
        name: result.name || "",
        blob: result.blob,
        url: result.kind === "image" ? URL.createObjectURL(result.blob) : null,
        width: result.width,
        height: result.height,
        uploaded: false
      });
      added += 1;
    } catch (error) {
      failed += 1;
      firstError = firstError || (error instanceof UserError ? error.message : "사진을 준비하지 못했습니다. 다른 사진으로 시도해 주세요.");
    }
  }

  processing = false;
  renderPages();
  updateControls();

  if (failed > 0) {
    const summary = added > 0 ? `${added}장을 추가했고 ${failed}장은 추가하지 못했습니다. ` : "";
    setNotice(prepareMessage, `${summary}${firstError}`, "info");
  } else {
    setNotice(prepareMessage, added > 0 ? `${added}개를 추가했습니다. 총 ${pages.length}개입니다.` : "", "success");
  }
  if (added > 0 && !editingLocked()) saveButton.focus();
}

async function rotatePage(index) {
  const page = pages[index];
  if (!page || page.kind === "pdf" || processing || editingLocked()) return;
  processing = true;
  updateControls();
  renderPages();
  try {
    const source = await decodeBlob(page.blob);
    let canvas;
    try {
      canvas = renderCanvas(source, true);
    } finally {
      if (typeof source.close === "function") source.close();
    }
    const result = await encodeUnderLimit(canvas);
    URL.revokeObjectURL(page.url);
    page.blob = result.blob;
    page.url = URL.createObjectURL(result.blob);
    page.width = result.width;
    page.height = result.height;
    setNotice(prepareMessage, "", "info");
  } catch {
    setNotice(prepareMessage, "사진을 회전하지 못했습니다. 다시 시도해 주세요.", "info");
  } finally {
    processing = false;
    renderPages();
    updateControls();
  }
}

function movePage(index, delta) {
  const target = index + delta;
  if (editingLocked() || processing || target < 0 || target >= pages.length) return;
  [pages[index], pages[target]] = [pages[target], pages[index]];
  renderPages();
}

function removePage(index) {
  if (editingLocked() || processing) return;
  const [removed] = pages.splice(index, 1);
  if (removed?.url) URL.revokeObjectURL(removed.url);
  renderPages();
}

/* ---------- 저장 (uploading -> ready) ---------- */

async function uploadPage(page, pageNo) {
  const isPdfPage = page.kind === "pdf";
  const mimeType = isPdfPage ? "application/pdf" : "image/jpeg";
  const path = `${activeUserId}/${draftScoreId}/${page.id}.${isPdfPage ? "pdf" : "jpg"}`;

  await withRetry(async () => {
    const { error } = await supabase.storage.from(BUCKET).upload(path, page.blob, {
      contentType: mimeType,
      cacheControl: "3600",
      upsert: false
    });
    if (error && !isAlreadyExists(error)) throw error;
  });

  await withRetry(async () => {
    const { error } = await supabase.from("score_pages").insert({
      id: page.id,
      score_id: draftScoreId,
      page_no: pageNo,
      storage_path: path,
      mime_type: mimeType,
      width: page.width,
      height: page.height,
      byte_size: page.blob.size
    });
    if (error && error.code !== "23505") throw error;
  });
}

function showProgress(text) {
  progress.textContent = text;
  progress.hidden = text.length === 0;
}

function defaultTitle() {
  const now = new Date();
  const two = (value) => String(value).padStart(2, "0");
  return `악보 ${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
}

/* 저장에 실패하면 서버에 만든 기록과 파일을 모두 지웁니다. 입력한 사진은 화면에 그대로 남깁니다. */
async function abandonDraft() {
  const scoreId = draftScoreId;
  if (!scoreId) {
    setNotice(editorMessage, "악보를 만들지 못했습니다. 연결을 확인하고 '악보 저장'을 다시 눌러 주세요.", "info");
    return;
  }
  showProgress("실패한 저장을 정리하는 중");
  try {
    await withRetry(() => deleteScore(scoreId), 1);
    draftScoreId = null;
    pages.forEach((page) => {
      page.uploaded = false;
    });
    setNotice(
      editorMessage,
      "올리지 못해 저장을 취소했고, 서버에는 아무것도 남기지 않았습니다. 사진은 그대로 있으니 연결을 확인하고 '악보 저장'을 다시 눌러 주세요.",
      "info"
    );
  } catch {
    setNotice(
      editorMessage,
      "올리지 못했고 정리도 끝내지 못했습니다. '저장 취소하고 지우기'를 눌러 정리하거나 '다시 시도'를 눌러 주세요.",
      "info"
    );
  }
}

async function saveScore(event) {
  event.preventDefault();
  if (!supabase || !activeUserId || saving || processing) return;

  const typedTitle = titleInput.value.trim();
  let title = typedTitle;
  if (!draftScoreId) {
    if (!title && pages.length === 0) {
      setNotice(editorMessage, "제목을 입력하거나 사진·PDF를 하나 이상 추가해 주세요.", "info");
      return;
    }
    if (!title) title = defaultTitle();
    if (title.length > 200) {
      setNotice(editorMessage, "제목은 200자 안으로 입력해 주세요.", "info");
      return;
    }
  }

  saving = true;
  setNotice(editorMessage, "", "info");
  updateControls();
  renderPages();

  try {
    if (!draftScoreId) {
      const { data, error } = await supabase
        .from("scores")
        .insert({ title, composer: composerInput.value.trim() || null })
        .select("id")
        .single();
      if (error || !data) {
        setNotice(editorMessage, "악보를 만들지 못했습니다. 연결을 확인하고 다시 시도해 주세요.", "info");
        return;
      }
      draftScoreId = data.id;
    }

    const total = pages.length;
    let uploadFailed = false;
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      if (page.uploaded) continue;
      showProgress(`${index + 1}/${total} 올리는 중`);
      try {
        await uploadPage(page, index + 1);
        page.uploaded = true;
        renderPages();
      } catch {
        uploadFailed = true;
        break;
      }
    }

    let finishFailed = false;
    if (!uploadFailed) {
      showProgress("마무리하는 중");
      try {
        const { error: finishError } = await supabase
          .from("scores")
          .update({ status: "ready", page_count: total })
          .eq("id", draftScoreId);
        finishFailed = Boolean(finishError);
      } catch {
        finishFailed = true;
      }
    }

    if (uploadFailed || finishFailed) {
      await abandonDraft();
      return;
    }

    resetEditor();
    showPanel("library");
    setNotice(listMessage, "악보를 저장했습니다.", "success");
    loadScores();
  } catch {
    await abandonDraft();
  } finally {
    saving = false;
    if (!editorPanel.hidden) showProgress("");
    updateControls();
    renderPages();
  }
}

async function removeScoreFiles(scoreId) {
  const folder = `${activeUserId}/${scoreId}`;
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 100 });
  if (error) throw error;
  const paths = (data ?? []).filter((entry) => entry.name).map((entry) => `${folder}/${entry.name}`);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) throw removeError;
  }
}

async function deleteScore(scoreId) {
  await removeScoreFiles(scoreId);
  const { error } = await supabase.from("scores").delete().eq("id", scoreId);
  if (error) throw error;
}

async function cancelEditor() {
  if (saving) return;
  if (!draftScoreId) {
    resetEditor();
    showPanel("library");
    return;
  }
  if (!window.confirm("저장하던 악보와 올린 사진을 지울까요?")) return;
  saving = true;
  updateControls();
  try {
    await deleteScore(draftScoreId);
    saving = false;
    resetEditor();
    showPanel("library");
    loadScores();
  } catch {
    saving = false;
    updateControls();
    setNotice(editorMessage, "지우지 못했습니다. 연결을 확인하고 다시 시도해 주세요.", "info");
  }
}

/* ---------- 목록 ---------- */

function createScoreCard(score, thumbUrl) {
  const card = document.createElement("article");
  card.className = "score-card";

  const thumb = document.createElement("div");
  thumb.className = "score-thumb";
  if (thumbUrl === "pdf") {
    thumb.textContent = "PDF";
    thumb.classList.add("is-pdf");
  } else if (thumbUrl) {
    const image = document.createElement("img");
    image.src = thumbUrl;
    image.alt = "";
    image.loading = "lazy";
    thumb.append(image);
  } else {
    thumb.textContent = "♩";
  }

  const info = document.createElement("div");
  info.className = "score-info";
  const title = document.createElement("h3");
  title.textContent = score.title;
  const meta = document.createElement("p");
  const uploading = score.status !== "ready";
  meta.textContent = uploading
    ? "업로드 미완료"
    : `${score.composer ? `${score.composer} · ` : ""}${score.page_count > 0 ? `${score.page_count}페이지` : "사진 없음"} · ${formatDate(score.created_at)}`;
  info.append(title, meta);

  card.append(thumb, info);

  if (uploading) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button danger";
    remove.textContent = "삭제";
    remove.setAttribute("aria-label", `${score.title} 삭제`);
    remove.addEventListener("click", () => removeFromList(score, remove));
    card.append(remove);
  } else {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "score-open";
    open.setAttribute("aria-label", `${score.title} 열기`);
    open.addEventListener("click", () => openViewer(score));
    card.append(open);
  }
  return card;
}

async function removeFromList(score, button) {
  if (deleting) return;
  if (!window.confirm(`'${score.title}' 악보를 삭제할까요?`)) return;
  deleting = true;
  button.disabled = true;
  try {
    await deleteScore(score.id);
    setNotice(listMessage, "악보를 삭제했습니다.", "success");
    await loadScores();
  } catch {
    button.disabled = false;
    setNotice(listMessage, "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
  } finally {
    deleting = false;
  }
}

async function loadScores() {
  const token = ++listToken;
  const userId = activeUserId;
  if (!supabase || !userId) return;

  const pending = document.createElement("p");
  pending.className = "empty-copy";
  pending.textContent = "악보를 불러오는 중입니다.";
  scoreList.replaceChildren(pending);

  const { data, error } = await supabase
    .from("scores")
    .select("id, title, composer, status, page_count, created_at")
    .order("created_at", { ascending: false });

  if (token !== listToken || activeUserId !== userId) return;
  if (error) {
    scoreList.replaceChildren();
    setNotice(listMessage, "악보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
    return;
  }

  const scores = data ?? [];
  if (scores.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "저장된 악보가 없습니다. '악보 추가'로 첫 악보를 저장해 보세요.";
    scoreList.replaceChildren(empty);
    return;
  }

  const thumbs = new Map();
  const readyIds = scores.filter((score) => score.status === "ready" && score.page_count > 0).map((score) => score.id);
  if (readyIds.length > 0) {
    const { data: firstPages } = await supabase
      .from("score_pages")
      .select("score_id, storage_path, mime_type")
      .eq("page_no", 1)
      .in("score_id", readyIds);
    if (token !== listToken || activeUserId !== userId) return;
    (firstPages ?? []).forEach((row) => {
      if (row.mime_type === "application/pdf") thumbs.set(row.score_id, "pdf");
    });
    const paths = (firstPages ?? []).filter((row) => row.mime_type !== "application/pdf").map((row) => row.storage_path);
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
      if (token !== listToken || activeUserId !== userId) return;
      const byPath = new Map((signed ?? []).filter((entry) => entry.signedUrl).map((entry) => [entry.path, entry.signedUrl]));
      (firstPages ?? []).filter((row) => row.mime_type !== "application/pdf").forEach((row) => {
        const url = byPath.get(row.storage_path);
        if (url) thumbs.set(row.score_id, url);
      });
    }
  }

  scoreList.replaceChildren(...scores.map((score) => createScoreCard(score, thumbs.get(score.id))));
}

/* ---------- 보기 / 삭제 ---------- */

async function openViewer(score) {
  openScore = score;
  const token = ++viewToken;
  viewerTitle.textContent = score.title;
  viewerMeta.textContent = `${score.page_count}페이지 · ${formatDate(score.created_at)}`;
  setNotice(viewerMessage, "", "info");
  viewerPages.replaceChildren();
  deleteButton.disabled = false;
  viewerHistory.replaceChildren();
  composerEdit.value = score.composer ?? "";
  showPanel("viewer");
  loadScoreHistory(supabase, score.id)
    .then((rows) => {
      if (token === viewToken) renderScoreHistory(viewerHistory, rows);
    })
    .catch(() => {
      if (token !== viewToken) return;
      const note = document.createElement("p");
      note.className = "empty-copy";
      note.textContent = "연주 이력을 불러오지 못했습니다.";
      viewerHistory.replaceChildren(note);
    });

  const loading = document.createElement("p");
  loading.className = "empty-copy";
  loading.textContent = "페이지를 불러오는 중입니다.";
  viewerPages.append(loading);

  const { data, error } = await supabase
    .from("score_pages")
    .select("page_no, storage_path, mime_type, byte_size")
    .eq("score_id", score.id)
    .order("page_no", { ascending: true });
  if (token !== viewToken) return;
  if (error) {
    viewerPages.replaceChildren();
    setNotice(viewerMessage, "페이지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
    return;
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    loading.textContent = "저장된 페이지가 없습니다.";
    return;
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_SECONDS);
  if (token !== viewToken) return;
  if (signError) {
    viewerPages.replaceChildren();
    setNotice(viewerMessage, "사진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
    return;
  }

  const byPath = new Map((signed ?? []).filter((entry) => entry.signedUrl).map((entry) => [entry.path, entry.signedUrl]));
  const wideScreen = window.matchMedia("(min-width: 900px)").matches;
  const items = rows.map((row) => {
    const url = byPath.get(row.storage_path);
    if (row.mime_type === "application/pdf") {
      const box = document.createElement("div");
      box.className = "viewer-pdf";
      const label = document.createElement("p");
      const megabytes = row.byte_size ? ` · ${(row.byte_size / 1024 / 1024).toFixed(1)}MB` : "";
      label.textContent = `${row.page_no}번 PDF${megabytes}`;
      box.append(label);
      if (url) {
        const link = document.createElement("a");
        link.className = "primary-button";
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "PDF 열기";
        box.append(link);
        if (wideScreen) {
          const frame = document.createElement("iframe");
          frame.className = "viewer-pdf-frame";
          frame.src = url;
          frame.title = `${score.title} ${row.page_no}번 PDF`;
          box.append(frame);
        }
      }
      return box;
    }
    const image = document.createElement("img");
    image.className = "viewer-page";
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = `${score.title} ${row.page_no}쪽`;
    if (url) image.src = url;
    return image;
  });
  viewerPages.replaceChildren(...items);
}

async function saveComposer(event) {
  event.preventDefault();
  if (!openScore || !supabase) return;
  const target = openScore;
  const value = composerEdit.value.trim();
  composerSave.disabled = true;
  const { error } = await supabase.from("scores").update({ composer: value || null }).eq("id", target.id);
  composerSave.disabled = false;
  if (error) {
    setNotice(viewerMessage, "작곡가를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
    return;
  }
  target.composer = value || null;
  setNotice(viewerMessage, "작곡가를 저장했습니다.", "success");
}

composerForm.addEventListener("submit", saveComposer);

function closeViewer() {
  viewToken += 1;
  openScore = null;
  viewerHistory.replaceChildren();
  viewerPages.replaceChildren();
  showPanel("library");
}

async function deleteOpenScore() {
  if (!openScore || deleting) return;
  if (!window.confirm("이 악보를 삭제할까요? 올린 사진도 함께 지워집니다.")) return;
  deleting = true;
  deleteButton.disabled = true;
  try {
    await deleteScore(openScore.id);
    closeViewer();
    setNotice(listMessage, "악보를 삭제했습니다.", "success");
    loadScores();
  } catch {
    deleteButton.disabled = false;
    setNotice(viewerMessage, "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "info");
  } finally {
    deleting = false;
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

function setAuthBusy(busy) {
  authBusy = busy;
  loginButton.disabled = busy;
  emailInput.disabled = busy;
  passwordInput.disabled = busy;
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
  if (!supabase || saving) return;
  logoutButton.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(listMessage, "로그아웃하지 못했습니다. 다시 시도해 주세요.", "info");
  } catch {
    setNotice(listMessage, "로그아웃하지 못했습니다. 다시 시도해 주세요.", "info");
  } finally {
    logoutButton.disabled = false;
  }
}

function showSignedOut() {
  stopCamera();
  activeUserId = null;
  listToken += 1;
  viewToken += 1;
  openScore = null;
  deleting = false;
  resetEditor();
  passwordInput.value = "";
  accountLine.textContent = "";
  accountLine.hidden = true;
  logoutButton.hidden = true;
  scoreList.replaceChildren();
  viewerPages.replaceChildren();
  setNotice(listMessage, "", "info");
  showPanel("auth");
}

function showSignedIn(user) {
  accountLine.textContent = user.email ? `${user.email} 님의 악보` : "로그인한 계정의 악보";
  accountLine.hidden = false;
  logoutButton.hidden = false;
}

function boot() {
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
    const changedUser = activeUserId !== user.id;
    showSignedIn(user);
    if (changedUser) {
      activeUserId = user.id;
      resetEditor();
      showPanel("library");
      loadScores();
    }
  });
}

/* ---------- 이벤트 연결 ---------- */

authForm.addEventListener("submit", signIn);
logoutButton.addEventListener("click", signOut);
newScoreButton.addEventListener("click", openEditor);
/* ---------- 연속 촬영 (한 번 열고 최대 10장) ---------- */

const MAX_BURST = 10;
const cameraOverlay = $("#camera-overlay");
const cameraVideo = $("#camera-video");
const cameraCount = $("#camera-count");
const cameraLast = $("#camera-last");
const shutterButton = $("#shutter-button");
const cameraDone = $("#camera-done");

let cameraStream = null;
let burstCount = 0;
let shooting = false;

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  cameraOverlay.hidden = true;
  document.body.style.overflow = "";
}

function burstLimit() {
  return Math.min(MAX_BURST, MAX_PAGES - (pages.length - burstCount));
}

function updateBurstUi() {
  cameraCount.textContent = `${burstCount}/${burstLimit()}`;
  shutterButton.disabled = shooting || burstCount >= burstLimit();
}

async function openCamera() {
  if (editingLocked() || processing) return;
  const canStream = window.isSecureContext && navigator.mediaDevices?.getUserMedia;
  if (!canStream) {
    cameraInput.click();
    return;
  }
  if (pages.length >= MAX_PAGES) {
    setNotice(prepareMessage, `한 악보는 최대 ${MAX_PAGES}개까지 저장할 수 있습니다.`, "info");
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
      audio: false
    });
  } catch {
    setNotice(prepareMessage, "카메라를 열지 못해 기본 카메라 앱으로 촬영합니다. (연속 촬영은 카메라 권한이 필요합니다)", "info");
    cameraInput.click();
    return;
  }
  burstCount = 0;
  shooting = false;
  cameraLast.hidden = true;
  cameraVideo.srcObject = cameraStream;
  cameraOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  try {
    await cameraVideo.play();
  } catch {
    /* autoplay 속성으로 재생됩니다. */
  }
  updateBurstUi();
}

async function shoot() {
  if (shooting || burstCount >= burstLimit() || !cameraStream || !cameraVideo.videoWidth) return;
  shooting = true;
  updateBurstUi();
  try {
    const frame = document.createElement("canvas");
    frame.width = cameraVideo.videoWidth;
    frame.height = cameraVideo.videoHeight;
    frame.getContext("2d").drawImage(cameraVideo, 0, 0);
    const result = await encodeUnderLimit(renderCanvas(frame));
    const url = URL.createObjectURL(result.blob);
    pages.push({
      id: uuid(),
      kind: "image",
      name: "",
      blob: result.blob,
      url,
      width: result.width,
      height: result.height,
      uploaded: false
    });
    burstCount += 1;
    cameraLast.src = url;
    cameraLast.hidden = false;
  } catch {
    /* 한 장 실패해도 계속 촬영할 수 있습니다. */
  } finally {
    shooting = false;
    updateBurstUi();
  }
}

function finishCamera() {
  stopCamera();
  renderPages();
  updateControls();
  if (burstCount > 0) {
    setNotice(prepareMessage, `${burstCount}장을 촬영했습니다. 총 ${pages.length}개입니다.`, "success");
    saveButton.focus();
  }
  burstCount = 0;
}

shutterButton.addEventListener("click", shoot);
cameraDone.addEventListener("click", finishCamera);
document.addEventListener("keydown", (event) => {
  if (!cameraOverlay.hidden && event.key === "Escape") finishCamera();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !cameraOverlay.hidden) finishCamera();
});

cameraButton.addEventListener("click", openCamera);
libraryButton.addEventListener("click", () => libraryInput.click());
cameraInput.addEventListener("change", () => {
  addFiles(cameraInput.files);
  cameraInput.value = "";
});
libraryInput.addEventListener("change", () => {
  addFiles(libraryInput.files);
  libraryInput.value = "";
});
scoreForm.addEventListener("submit", saveScore);
cancelButton.addEventListener("click", cancelEditor);
backButton.addEventListener("click", closeViewer);
deleteButton.addEventListener("click", deleteOpenScore);
window.addEventListener("beforeunload", (event) => {
  if (saving) {
    event.preventDefault();
    event.returnValue = "";
  }
});

boot();
