import { t } from "../i18n.js";
import { h, notify, errorMessage, displayScoreTitle } from "../ui.js";
import { comparePages } from "../pages.js";

// Legacy build: also runs on older iPad Safari.
const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/";
const MAX_CANVAS_PIXELS = 16_000_000;
const KEEP_AROUND = 2;
const KEY_GAP_MS = 220;
const SWIPE_PX = 50;
const TAP_PX = 10;

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown", "PageDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);

let pdfjsPromise = null;

export function loadPdfJs() {
  pdfjsPromise ??= import(`${PDFJS_BASE}pdf.min.mjs`)
    .then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
      return lib;
    })
    .catch((error) => {
      pdfjsPromise = null;
      throw error;
    });
  return pdfjsPromise;
}

// The stored small thumbnail (a signed URL from db.thumbnailUrls). Never downloads the PDF.
export async function thumbnailImage(url) {
  const img = h("img", { alt: "", draggable: "false", decoding: "async" });
  img.src = url;
  await img.decode();
  return img;
}

// First page only, drawn from the PDF itself. Used to make a thumbnail for Scores that don't have one yet.
export async function renderThumbnail(ctx, file, width = 160) {
  if (file.mime_type !== "application/pdf") {
    const img = h("img", { alt: "", draggable: "false" });
    img.src = await ctx.db.signedUrl(file.storage_path);
    await img.decode().catch(() => {});
    return img;
  }
  const [lib, blob] = await Promise.all([loadPdfJs(), ctx.db.download(file.storage_path)]);
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (width / base.width) * pixelRatio });
    const canvas = h("canvas", { "aria-hidden": "true" });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas;
  } finally {
    doc.destroy();
  }
}

// Opens a short-lived signed URL. The tab is opened before awaiting so popup blockers allow it.
export async function openOriginal(ctx, file) {
  const tab = window.open("about:blank", "_blank");
  try {
    const url = await ctx.db.signedUrl(file.storage_path);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (error) {
    tab?.close();
    notify(errorMessage(error, "library.openFailed"), "error");
  }
}

export function openViewer(ctx, score) {
  const files = [...(score?.score_files ?? [])].sort(comparePages);
  if (!files.length) {
    notify(t("library.noFiles"), "error");
    return;
  }

  const pages = [];
  const blobUrls = new Map();
  const pdfDocs = new Map();
  const rendered = new Map();
  let index = 0;
  let showToken = 0;
  let lastKeyTurn = 0;
  let closed = false;
  let pointer = null;
  let noticeTimer = null;
  let resizeTimer = null;

  const counter = h("span", { class: "viewer-count num", "aria-live": "polite" });
  const holder = h("div", { class: "viewer-holder" }, h("p", { class: "viewer-message", text: t("common.loading") }));
  const notice = h("p", { class: "viewer-notice", role: "status", hidden: true });
  const prevButton = h("button", { type: "button", class: "viewer-nav is-prev", "aria-label": t("viewer.previous"), onclick: () => turn(-1) }, "‹");
  const nextButton = h("button", { type: "button", class: "viewer-nav is-next", "aria-label": t("viewer.next"), onclick: () => turn(1) }, "›");
  const stage = h("div", { class: "viewer-stage" }, holder, prevButton, nextButton, notice);
  const fullscreenButton = document.fullscreenEnabled
    ? h("button", { type: "button", class: "viewer-tool", onclick: toggleFullscreen }, t("viewer.fullscreen"))
    : null;
  const dialog = h(
    "dialog",
    { class: "viewer", "aria-label": displayScoreTitle(score) },
    h("div", { class: "viewer-bar" },
      h("strong", { class: "viewer-title", translate: "no", text: displayScoreTitle(score) }),
      counter,
      h("button", { type: "button", class: "viewer-tool", onclick: () => openOriginal(ctx, pages[index]?.file ?? files[0]) }, t("viewer.original")),
      fullscreenButton,
      h("button", { type: "button", class: "viewer-tool is-close", "aria-label": t("common.close"), onclick: () => dialog.close() }, "×")
    ),
    stage
  );

  function flash(message, ms = 1600) {
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, ms);
  }

  function blobUrl(file) {
    if (!blobUrls.has(file.id)) {
      const promise = ctx.db.download(file.storage_path).then((blob) => URL.createObjectURL(blob));
      promise.catch(() => blobUrls.delete(file.id));
      blobUrls.set(file.id, promise);
    }
    return blobUrls.get(file.id);
  }

  function pdfDoc(file) {
    if (!pdfDocs.has(file.id)) {
      const promise = Promise.all([loadPdfJs(), ctx.db.download(file.storage_path)])
        .then(async ([lib, blob]) => lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise);
      promise.catch(() => pdfDocs.delete(file.id));
      pdfDocs.set(file.id, promise);
    }
    return pdfDocs.get(file.id);
  }

  async function buildPages() {
    for (const file of files) {
      if (file.mime_type === "application/pdf") {
        const doc = await pdfDoc(file);
        for (let number = 1; number <= doc.numPages; number += 1) pages.push({ file, pdfPage: number });
      } else {
        pages.push({ file });
      }
    }
  }

  async function renderImage(page) {
    const img = h("img", { class: "viewer-page", alt: t("viewer.pageAlt", { page: pages.indexOf(page) + 1 }), draggable: "false" });
    img.src = await blobUrl(page.file);
    await img.decode().catch(() => {});
    return img;
  }

  async function renderPdf(page) {
    const doc = await pdfDoc(page.file);
    const pdfPage = await doc.getPage(page.pdfPage);
    const base = pdfPage.getViewport({ scale: 1 });
    const box = holder.getBoundingClientRect();
    const fit = Math.max(0.1, Math.min((box.width - 16) / base.width, (box.height - 16) / base.height));
    let pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const area = base.width * fit * pixelRatio * base.height * fit * pixelRatio;
    if (area > MAX_CANVAS_PIXELS) pixelRatio *= Math.sqrt(MAX_CANVAS_PIXELS / area);
    const viewport = pdfPage.getViewport({ scale: fit * pixelRatio });
    const canvas = h("canvas", { class: "viewer-page", role: "img", "aria-label": t("viewer.pageAlt", { page: pages.indexOf(page) + 1 }) });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(base.width * fit)}px`;
    canvas.style.height = `${Math.floor(base.height * fit)}px`;
    await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas;
  }

  function renderPage(at) {
    if (!rendered.has(at)) {
      const page = pages[at];
      const promise = page.pdfPage ? renderPdf(page) : renderImage(page);
      promise.catch(() => rendered.delete(at));
      rendered.set(at, promise);
    }
    return rendered.get(at);
  }

  function preload(at) {
    if (at >= 0 && at < pages.length) renderPage(at).catch(() => {});
  }

  function evict() {
    for (const key of rendered.keys()) {
      if (Math.abs(key - index) > KEEP_AROUND) rendered.delete(key);
    }
  }

  async function show(at) {
    index = at;
    const token = ++showToken;
    counter.textContent = t("viewer.count", { page: index + 1, total: pages.length });
    prevButton.disabled = index === 0;
    nextButton.disabled = index === pages.length - 1;
    const slow = setTimeout(() => {
      if (token === showToken) holder.replaceChildren(h("p", { class: "viewer-message", text: t("common.loading") }));
    }, 150);
    try {
      const element = await renderPage(index);
      if (token !== showToken || closed) return;
      holder.replaceChildren(element);
    } catch (error) {
      if (token !== showToken || closed) return;
      holder.replaceChildren(
        h("div", { class: "viewer-message" },
          h("p", { text: errorMessage(error, "viewer.loadFailed") }),
          h("button", { type: "button", class: "viewer-tool", onclick: () => show(index) }, t("common.retry"))
        )
      );
    } finally {
      clearTimeout(slow);
    }
    preload(index + 1);
    preload(index - 1);
    evict();
  }

  function turn(step) {
    if (!pages.length) return;
    const target = index + step;
    if (target < 0) {
      flash(t("viewer.first"));
      return;
    }
    if (target >= pages.length) {
      flash(t("viewer.last"));
      return;
    }
    show(target);
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const onButton = event.target instanceof HTMLButtonElement;
    let step = 0;
    if (NEXT_KEYS.has(event.key)) step = 1;
    else if (PREV_KEYS.has(event.key)) step = -1;
    else if (event.key === " " && !onButton) step = event.shiftKey ? -1 : 1;
    else if (event.key === "Home") step = -index;
    else if (event.key === "End") step = pages.length - 1 - index;
    if (!step) return;
    event.preventDefault();
    const now = Date.now();
    // pedals and held keys can fire twice; one press = one page
    if (event.repeat || now - lastKeyTurn < KEY_GAP_MS) return;
    lastKeyTurn = now;
    if (event.key === "Home" || event.key === "End") show(index + step);
    else turn(step);
  }

  function onPointerDown(event) {
    if (event.target.closest("button")) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer = null;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      turn(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) > TAP_PX || Math.abs(dy) > TAP_PX) return;
    const box = stage.getBoundingClientRect();
    const position = (event.clientX - box.left) / box.width;
    if (position < 0.35) turn(-1);
    else if (position > 0.65) turn(1);
    else dialog.classList.toggle("is-immersive");
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!pages.some((page) => page.pdfPage)) return;
      rendered.clear();
      show(index);
    }, 200);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await dialog.requestFullscreen();
    } catch {
      flash(t("viewer.fullscreenFailed"));
    }
  }

  function onFullscreenChange() {
    if (fullscreenButton) {
      fullscreenButton.textContent = document.fullscreenElement ? t("viewer.exitFullscreen") : t("viewer.fullscreen");
    }
  }

  const previousOverflow = document.documentElement.style.overflow;
  // On the document: after a tap on the page, focus may leave the dialog, but pedals must keep working.
  document.addEventListener("keydown", onKeyDown);
  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", () => {
    pointer = null;
  });
  window.addEventListener("resize", onResize);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  dialog.addEventListener("close", () => {
    closed = true;
    clearTimeout(noticeTimer);
    clearTimeout(resizeTimer);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.documentElement.style.overflow = previousOverflow;
    for (const promise of blobUrls.values()) promise.then((url) => URL.revokeObjectURL(url)).catch(() => {});
    for (const promise of pdfDocs.values()) promise.then((doc) => doc.destroy()).catch(() => {});
    dialog.remove();
  });

  document.documentElement.style.overflow = "hidden";
  document.body.append(dialog);
  dialog.showModal();

  buildPages()
    .then(() => {
      if (closed) return;
      show(0);
      flash(window.matchMedia("(pointer: coarse)").matches ? t("viewer.touchHint") : t("viewer.keyHint"), 3200);
    })
    .catch((error) => {
      if (closed) return;
      holder.replaceChildren(
        h("div", { class: "viewer-message" },
          h("p", { text: errorMessage(error, files.some((file) => file.mime_type === "application/pdf") ? "viewer.pdfFailed" : "viewer.loadFailed") }),
          h("button", { type: "button", class: "viewer-tool", onclick: () => openOriginal(ctx, files[0]) }, t("viewer.original"))
        )
      );
    });
}
