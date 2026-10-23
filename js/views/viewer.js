import { t } from "../i18n.js";
import { h, notify, errorMessage, displayScoreTitle } from "../ui.js";
import { comparePages } from "../pages.js";
import { locatePage, songStarts } from "../performance.js";

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

// A small thumbnail image from an object URL. The URL is released once the image is decoded.
export async function thumbnailImage(url) {
  const img = h("img", { alt: "", draggable: "false", decoding: "async" });
  img.src = url;
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  return img;
}

// localUrl: the viewer's already-downloaded copy, so the file isn't fetched a second time.
// Without it a short-lived signed URL is used. The tab is opened before awaiting so popup blockers allow it.
export async function openOriginal(ctx, file, localUrl = null) {
  const tab = window.open("about:blank", "_blank");
  try {
    const url = (await localUrl?.catch(() => null)) ?? (await ctx.db.signedUrl(file.storage_path));
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

// One score, opened in the same screen Performance Mode uses.
export function openViewer(ctx, score) {
  const files = score?.score_files ?? [];
  if (!files.length) {
    notify(t("library.noFiles"), "error");
    return;
  }
  openPerformance(ctx, { title: displayScoreTitle(score), songs: [{ key: score.id, number: null, label: "", score, files }] });
}

// songs: [{ key, number, label, score, files }] shown one after another (see performance.js).
// The first song appears as soon as it is ready; the others load in the background, in order.
export function openPerformance(ctx, { title, songs }) {
  if (!songs?.length) {
    notify(t("library.noFiles"), "error");
    return;
  }
  const multi = songs.length > 1;
  const songFiles = songs.map((song) => [...song.files].sort(comparePages));
  const counts = [];
  const ready = songs.map(() => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  });
  let loadedSongs = 0;
  let lineupOpen = false;
  let wakeLock = null;
  let wakeWarned = false;

  const pages = [];
  const fileBlobs = new Map();
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
  const lineupList = h("ol", { class: "lineup-list" });
  const lineupPanel = h("section", { class: "viewer-lineup", "aria-label": t("perform.lineup"), hidden: true },
    h("div", { class: "lineup-head" },
      h("strong", { translate: "no", text: title }),
      h("button", { type: "button", class: "viewer-tool", onclick: () => toggleLineup(false) }, t("common.close"))
    ),
    lineupList
  );
  const stage = h("div", { class: "viewer-stage" }, holder, prevButton, nextButton, notice, lineupPanel);
  const fullscreenButton = document.fullscreenEnabled
    ? h("button", { type: "button", class: "viewer-tool", onclick: toggleFullscreen }, t("viewer.fullscreen"))
    : null;
  const titleLabel = h("strong", { class: "viewer-title", translate: "no" });
  const prevSongButton = multi
    ? h("button", { type: "button", class: "viewer-tool", "aria-label": t("perform.prevSong"), onclick: () => turnSong(-1) }, "«")
    : null;
  const nextSongButton = multi
    ? h("button", { type: "button", class: "viewer-tool", "aria-label": t("perform.nextSong"), onclick: () => turnSong(1) }, "»")
    : null;
  const lineupButton = multi
    ? h("button", { type: "button", class: "viewer-tool", "aria-expanded": "false", onclick: () => toggleLineup() }, t("perform.lineup"))
    : null;
  const dialog = h(
    "dialog",
    { class: "viewer", "aria-label": title },
    h("div", { class: "viewer-bar" },
      prevSongButton,
      nextSongButton,
      titleLabel,
      counter,
      lineupButton,
      h("button", { type: "button", class: "viewer-tool", onclick: () => openFile(pages[index]?.file ?? songFiles[currentSong()][0]) }, t("viewer.original")),
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

  // One download per file per viewer; pages, PDF rendering and "Original file" all share it.
  function fileBlob(file) {
    if (!fileBlobs.has(file.id)) {
      const promise = ctx.db.download(file.storage_path);
      promise.catch(() => fileBlobs.delete(file.id));
      fileBlobs.set(file.id, promise);
    }
    return fileBlobs.get(file.id);
  }

  function blobUrl(file) {
    if (!blobUrls.has(file.id)) {
      const promise = fileBlob(file).then((blob) => URL.createObjectURL(blob));
      promise.catch(() => blobUrls.delete(file.id));
      blobUrls.set(file.id, promise);
    }
    return blobUrls.get(file.id);
  }

  function openFile(file) {
    openOriginal(ctx, file, fileBlobs.has(file.id) ? blobUrl(file) : null);
  }

  function pdfDoc(file) {
    if (!pdfDocs.has(file.id)) {
      const promise = Promise.all([loadPdfJs(), fileBlob(file)])
        .then(async ([lib, blob]) => lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise);
      promise.catch(() => pdfDocs.delete(file.id));
      pdfDocs.set(file.id, promise);
    }
    return pdfDocs.get(file.id);
  }

  // Songs are added to `pages` whole and in order, so global page numbers never shift once shown.
  async function loadSong(at) {
    const list = [];
    try {
      for (const file of songFiles[at]) {
        if (file.mime_type === "application/pdf") {
          const doc = await pdfDoc(file);
          for (let number = 1; number <= doc.numPages; number += 1) list.push({ song: at, file, pdfPage: number });
        } else {
          list.push({ song: at, file });
        }
      }
    } catch (error) {
      // One song that can't be read doesn't stop the others: it shows as a single error page.
      list.length = 0;
      list.push({ song: at, file: songFiles[at][0], failed: error });
    }
    pages.push(...list);
    counts[at] = list.length;
    loadedSongs += 1;
    ready[at].resolve();
    if (!closed && pages.length) updateBar();
    if (lineupOpen) renderLineup();
  }

  async function loadAllSongs() {
    for (let at = 0; at < songs.length; at += 1) {
      if (closed) return;
      await loadSong(at);
    }
  }

  function currentSong() {
    return locatePage(counts, index).song;
  }

  function songStart(at) {
    return songStarts(counts)[at];
  }

  function updateBar() {
    const { song, page } = locatePage(counts, index);
    const done = loadedSongs === songs.length;
    const total = done ? String(pages.length) : `${pages.length}+`;
    titleLabel.textContent = (multi && songs[song].label ? `${songs[song].number} ${songs[song].label} · ` : "") + displayScoreTitle(songs[song].score);
    counter.textContent = multi
      ? t("perform.count", { song: song + 1, songs: songs.length, page: page + 1, pages: counts[song], total, current: index + 1 })
      : t("viewer.count", { page: index + 1, total });
    prevButton.disabled = index === 0;
    nextButton.disabled = done && index >= pages.length - 1;
    if (multi) {
      prevSongButton.disabled = song === 0;
      nextSongButton.disabled = song >= songs.length - 1;
    }
  }

  // Music Part shortcuts and page numbers. Loaded songs only; the rest say they are still loading.
  function renderLineup() {
    const starts = songStarts(counts);
    const active = currentSong();
    lineupList.replaceChildren(
      ...songs.map((song, at) => {
        const open = starts[at] !== undefined;
        const chips = open
          ? Array.from({ length: counts[at] }, (_, n) =>
              h("button", {
                type: "button",
                class: starts[at] + n === index ? "lineup-page is-current" : "lineup-page",
                "aria-label": t("perform.goToPage", { page: starts[at] + n + 1 }),
                "aria-current": starts[at] + n === index ? "true" : null,
                onclick: () => goTo(starts[at] + n)
              }, String(starts[at] + n + 1))
            )
          : [h("span", { class: "meta", text: t("common.loading") })];
        return h("li", { class: at === active ? "lineup-item is-active" : "lineup-item" },
          h("button", { type: "button", class: "lineup-song", disabled: !open, onclick: () => goTo(starts[at]) },
            h("span", { class: "lineup-no num", text: song.number ?? String(at + 1).padStart(2, "0") }),
            h("span", { class: "lineup-role", translate: "no", text: song.label }),
            h("span", { class: "lineup-title", translate: "no", text: displayScoreTitle(song.score) })
          ),
          h("div", { class: "lineup-pages" }, chips)
        );
      })
    );
  }

  function toggleLineup(force) {
    if (!multi) return;
    lineupOpen = force ?? !lineupOpen;
    lineupPanel.hidden = !lineupOpen;
    lineupButton.setAttribute("aria-expanded", String(lineupOpen));
    if (lineupOpen) {
      renderLineup();
      lineupPanel.querySelector(".lineup-item.is-active .lineup-song")?.focus();
    } else {
      lineupButton.focus();
    }
  }

  function goTo(at) {
    toggleLineup(false);
    show(at);
  }

  // Wake Lock keeps the screen on while performing. It is released by the browser when the tab
  // is hidden, so it is asked for again when the viewer comes back.
  async function keepAwake() {
    if (closed || wakeLock) return;
    if (!("wakeLock" in navigator)) {
      if (!wakeWarned) {
        wakeWarned = true;
        setTimeout(() => !closed && flash(t("perform.noWakeLock"), 4000), 3400);
      }
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
      if (closed) releaseWake();
    } catch {
      wakeLock = null; // e.g. low battery: the screen may sleep, nothing else breaks
    }
  }

  function releaseWake() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  function onVisibility() {
    if (document.visibilityState === "visible") keepAwake();
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

  function failedPage(page) {
    return h("div", { class: "viewer-message" },
      h("p", { text: errorMessage(page.failed, page.file.mime_type === "application/pdf" ? "viewer.pdfFailed" : "viewer.loadFailed") }),
      h("button", { type: "button", class: "viewer-tool", onclick: () => openFile(page.file) }, t("viewer.original"))
    );
  }

  function renderPage(at) {
    if (!rendered.has(at)) {
      const page = pages[at];
      const promise = page.failed
        ? Promise.resolve(failedPage(page))
        : page.pdfPage ? renderPdf(page) : renderImage(page);
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
    updateBar();
    if (lineupOpen) renderLineup();
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

  async function turn(step) {
    if (!pages.length) return;
    const target = index + step;
    if (target < 0) {
      flash(t("viewer.first"));
      return;
    }
    // The next song may still be loading in the background: wait for it instead of stopping.
    if (target >= pages.length && loadedSongs < songs.length) {
      holder.replaceChildren(h("p", { class: "viewer-message", text: t("common.loading") }));
      await ready[loadedSongs].promise;
      if (closed) return;
    }
    if (target >= pages.length) {
      flash(t("viewer.last"));
      return;
    }
    show(target);
  }

  // Previous / next song: jumps to the first page of it.
  async function turnSong(step) {
    if (!pages.length) return;
    const target = currentSong() + step;
    if (target < 0 || target >= songs.length) {
      flash(t(target < 0 ? "perform.firstSong" : "perform.lastSong"));
      return;
    }
    if (songStart(target) === undefined) {
      holder.replaceChildren(h("p", { class: "viewer-message", text: t("common.loading") }));
      await ready[target].promise;
      if (closed) return;
    }
    show(songStart(target));
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || lineupOpen) return;
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
    if (event.target.closest("button, .viewer-lineup")) return;
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
  document.addEventListener("visibilitychange", onVisibility);
  // Esc closes the Lineup first; the viewer closes on the next Esc.
  dialog.addEventListener("cancel", (event) => {
    if (!lineupOpen) return;
    event.preventDefault();
    toggleLineup(false);
  });
  dialog.addEventListener("close", () => {
    closed = true;
    releaseWake();
    clearTimeout(noticeTimer);
    clearTimeout(resizeTimer);
    document.removeEventListener("visibilitychange", onVisibility);
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

  keepAwake();
  loadAllSongs();
  ready[0].promise.then(() => {
    if (closed) return;
    show(0);
    flash(window.matchMedia("(pointer: coarse)").matches ? t("viewer.touchHint") : t("viewer.keyHint"), 3200);
  });
}
