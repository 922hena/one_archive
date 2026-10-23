import { t } from "../i18n.js";
import { h, notify, errorMessage, displayScoreTitle } from "../ui.js";
import { comparePages } from "../pages.js";
import {
  AUTO_DEFAULT,
  AUTO_MAX,
  AUTO_MIN,
  MAX_PER_VIEW,
  ZOOM_MAX,
  ZOOM_STEP,
  clampPan,
  clampPerView,
  clampZoom,
  fitWidthZoom,
  formatSeconds,
  gridFor,
  locatePage,
  nextIndex,
  pageTimeKey,
  parseSeconds,
  prevIndex,
  songStarts,
  spreadSize,
  viewSeconds
} from "../performance.js";
import { countOfflineFiles, getOfflineFile, removeOfflineFiles, requestPersistence, saveOfflineFile } from "../offline-files.js";

// Legacy build: also runs on older iPad Safari.
const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/";
const MAX_CANVAS_PIXELS = 16_000_000;
const KEEP_AROUND = 2;
const KEY_GAP_MS = 220;
const SWIPE_PX = 50;
const TAP_PX = 10;

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown", "PageDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);

const PREFS_KEY = "yearscore-perform";
const TIMES_KEY = "yearscore-perform-times";

let pdfjsPromise = null;

// Device-only settings: pages on screen, default auto-turn seconds, and seconds per page.
// Nothing here is sent to the server.
function readJson(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode etc.: the setting just won't be remembered
  }
}

function loadPrefs() {
  const saved = readJson(PREFS_KEY);
  const fallback = parseSeconds(saved.autoDefault);
  return {
    // older versions saved only "two pages on/off"
    perView: clampPerView(saved.perView ?? (saved.twoUp === true ? 2 : 1)),
    autoDefault: fallback.ok && fallback.value ? fallback.value : AUTO_DEFAULT
  };
}

function savePrefs(prefs) {
  writeJson(PREFS_KEY, prefs);
}

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

  const prefs = loadPrefs();
  let perView = prefs.perView; // pages on one screen, 1 to 4
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let autoOn = false; // always starts off, so pages never turn by surprise
  let autoDefault = prefs.autoDefault;
  const pageTimes = readJson(TIMES_KEY); // seconds per page; a page without one uses autoDefault
  let autoTimer = null;
  let autoOpen = false;
  let offlineBusy = false;
  const touches = new Map(); // pointer id -> { x, y } while fingers are down
  let gesture = null; // { kind: "pan" | "pinch", ... }
  let moved = false;
  const allFiles = songFiles.flat();

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
  const zoomOutButton = h("button", { type: "button", class: "viewer-tool", "aria-label": t("perform.zoomOut"), onclick: () => setZoom(zoom - ZOOM_STEP) }, "−");
  const zoomLabel = h("button", { type: "button", class: "viewer-tool num", "aria-label": t("perform.zoomFit"), onclick: () => setZoom(1) }, "100%");
  const zoomInButton = h("button", { type: "button", class: "viewer-tool", "aria-label": t("perform.zoomIn"), onclick: () => setZoom(zoom + ZOOM_STEP) }, "+");
  const fitWidthButton = h("button", { type: "button", class: "viewer-tool", onclick: fitWidth }, t("perform.fitWidth"));
  const viewButtons = Array.from({ length: MAX_PER_VIEW }, (_, n) =>
    h("button", {
      type: "button",
      class: "viewer-tool num",
      "aria-label": t(n === 0 ? "perform.pagesOne" : "perform.pagesMany", { count: n + 1 }),
      "aria-pressed": String(perView === n + 1),
      onclick: () => setPerView(n + 1)
    }, String(n + 1))
  );
  const viewGroup = h("div", { class: "viewer-view", role: "group", "aria-label": t("perform.pagesOnScreen") },
    h("span", { class: "viewer-label", text: t("perform.pagesOnScreen") }),
    ...viewButtons
  );
  const autoButton = h("button", { type: "button", class: "viewer-tool", "aria-pressed": "false", "aria-expanded": "false", onclick: () => toggleAutoPanel() }, t("perform.autoButton"));
  const autoStart = h("button", { type: "button", class: "viewer-tool is-primary", onclick: toggleAuto }, t("perform.autoStart"));
  const autoDefaultInput = secondsInput("auto-default", t("perform.autoDefault"), formatSeconds(autoDefault), onDefaultChange);
  const autoRows = h("div", { class: "auto-rows" });
  const autoPanel = h("section", { class: "viewer-auto", "aria-label": t("perform.autoTitle"), hidden: true },
    h("div", { class: "lineup-head" },
      h("strong", { text: t("perform.autoTitle") }),
      h("button", { type: "button", class: "viewer-tool", onclick: () => toggleAutoPanel(false) }, t("common.close"))
    ),
    h("div", { class: "auto-body" },
      h("div", { class: "auto-line" }, autoStart),
      h("div", { class: "auto-line" },
        h("label", { for: "auto-default", text: t("perform.autoDefault") }),
        autoDefaultInput,
        h("span", { text: t("perform.secondsUnit") })
      ),
      autoRows,
      h("p", { class: "auto-hint", text: t("perform.autoHint") })
    )
  );
  const stage = h("div", { class: "viewer-stage" }, holder, prevButton, nextButton, notice, lineupPanel, autoPanel);
  const offlineButton = h("button", { type: "button", class: "viewer-tool", "aria-pressed": "false", onclick: toggleOffline }, t("perform.offlineSave"));
  const tools = h("div", { class: "viewer-tools", role: "group", "aria-label": t("perform.viewTools") },
    zoomOutButton, zoomLabel, zoomInButton, fitWidthButton, viewGroup, autoButton, offlineButton
  );
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
    tools,
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
      // A copy saved on this device is used first, so nothing is downloaded again.
      const promise = getOfflineFile(file.storage_path).then((saved) => saved ?? ctx.db.download(file.storage_path));
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
    const span = spreadSize(pageSongs(), index, perView);
    const range = (first) => (span > 1 ? `${first}–${first + span - 1}` : String(first));
    counter.textContent = multi
      ? t("perform.count", { song: song + 1, songs: songs.length, page: range(page + 1), pages: counts[song], total, current: range(index + 1) })
      : t("viewer.count", { page: range(index + 1), total });
    prevButton.disabled = index === 0;
    nextButton.disabled = done && index + span >= pages.length;
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
    if (lineupOpen && autoOpen) {
      // the two panels share the right side: close the Auto turn panel quietly
      autoOpen = false;
      autoPanel.hidden = true;
      autoButton.setAttribute("aria-expanded", "false");
    }
    lineupPanel.hidden = !lineupOpen;
    lineupButton.setAttribute("aria-expanded", String(lineupOpen));
    scheduleAuto(); // paused while the Lineup is open
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
    scheduleAuto();
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
    const { cols, rows } = gridFor(perView);
    const fit = Math.max(0.1, Math.min((box.width / cols - 16) / base.width, (box.height / rows - 16) / base.height));
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
    const around = KEEP_AROUND + perView;
    for (const key of rendered.keys()) {
      if (Math.abs(key - index) > around) rendered.delete(key);
    }
  }

  function pageSongs() {
    return pages.map((page) => page.song);
  }

  async function show(at) {
    index = at;
    const token = ++showToken;
    updateBar();
    scheduleAuto();
    if (lineupOpen) renderLineup();
    const slow = setTimeout(() => {
      if (token === showToken) holder.replaceChildren(h("p", { class: "viewer-message", text: t("common.loading") }));
    }, 150);
    try {
      const span = spreadSize(pageSongs(), index, perView);
      const elements = await Promise.all(Array.from({ length: span }, (_, n) => renderPage(index + n)));
      if (token !== showToken || closed) return;
      if (perView > 1) {
        // The same grid for every screen, so a short last screen keeps the same page size.
        const { cols, rows } = gridFor(perView);
        const spread = h("div", { class: "viewer-spread" }, ...elements);
        spread.style.setProperty("--cols", String(cols));
        spread.style.setProperty("--rows", String(rows));
        holder.replaceChildren(spread);
      } else {
        holder.replaceChildren(elements[0]);
      }
      pan = { x: 0, y: 0 };
      applyZoom();
      if (autoOpen) renderAutoRows();
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
    const after = nextIndex(pageSongs(), index, perView);
    preload(after);
    for (let n = 1; n < perView; n += 1) preload(after + n);
    preload(prevIndex(pageSongs(), index, perView));
    evict();
  }

  // step > 0: next page (or next two pages); step < 0: previous.
  async function turn(step) {
    if (!pages.length) return;
    let target = step > 0 ? nextIndex(pageSongs(), index, perView) : prevIndex(pageSongs(), index, perView);
    if (target < 0) {
      flash(t("viewer.first"));
      return;
    }
    // The next song may still be loading in the background: wait for it instead of stopping.
    if (target >= pages.length && loadedSongs < songs.length) {
      holder.replaceChildren(h("p", { class: "viewer-message", text: t("common.loading") }));
      await ready[loadedSongs].promise;
      if (closed) return;
      target = nextIndex(pageSongs(), index, perView);
    }
    if (target >= pages.length) {
      flash(t("viewer.last"));
      return;
    }
    show(target);
  }

  // ---- zoom ----
  function pageElement() {
    const el = holder.firstElementChild;
    return el && (el.classList.contains("viewer-page") || el.classList.contains("viewer-spread")) ? el : null;
  }

  function sizes() {
    const el = pageElement();
    const box = holder.getBoundingClientRect();
    return { content: { w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0 }, box: { w: box.width, h: box.height } };
  }

  function applyZoom() {
    const el = pageElement();
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    zoomOutButton.disabled = zoom <= 1;
    zoomInButton.disabled = zoom >= ZOOM_MAX;
    if (!el) return;
    const { content, box } = sizes();
    pan = clampPan(pan, zoom, content, box);
    el.style.transform = zoom === 1 ? "" : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    stage.classList.toggle("is-zoomed", zoom > 1);
  }

  function setZoom(next) {
    zoom = clampZoom(Math.round(next * 100) / 100);
    if (zoom === 1) pan = { x: 0, y: 0 };
    applyZoom();
  }

  function fitWidth() {
    const { content, box } = sizes();
    setZoom(fitWidthZoom(content, { w: box.w - 16, h: box.h }));
  }

  // Pages on one screen (1 to 4). Pages are drawn smaller for more pages, so they are drawn again.
  function setPerView(count) {
    const next = clampPerView(count);
    if (next === perView) return;
    perView = next;
    viewButtons.forEach((button, n) => button.setAttribute("aria-pressed", String(n + 1 === perView)));
    savePrefs({ perView, autoDefault });
    rendered.clear();
    show(index);
  }

  // ---- auto page turn: each page has its own seconds (0.1 steps); stops at the end of a Score ----
  function secondsInput(id, label, value, onChange) {
    return h("input", {
      type: "number",
      id,
      class: "auto-input num",
      inputmode: "decimal",
      step: "0.1",
      min: String(AUTO_MIN),
      max: String(AUTO_MAX),
      value,
      "aria-label": label,
      onchange: onChange
    });
  }

  function pageSeconds(page) {
    const own = Number(pageTimes[pageTimeKey(page)]);
    return Number.isFinite(own) && own > 0 ? own : null;
  }

  // The screen stays as long as its longest page.
  function currentViewSeconds() {
    const span = spreadSize(pageSongs(), index, perView);
    const times = Array.from({ length: span }, (_, n) => pageSeconds(pages[index + n]));
    return viewSeconds(times, autoDefault);
  }

  function readSeconds(input, { allowBlank }) {
    const { ok, value } = parseSeconds(input.value);
    const valid = ok && (value !== null || allowBlank);
    input.setAttribute("aria-invalid", String(!valid));
    if (!valid) flash(t("perform.autoInvalid", { min: AUTO_MIN, max: AUTO_MAX }), 3000);
    return valid ? value : undefined;
  }

  function onDefaultChange() {
    const value = readSeconds(autoDefaultInput, { allowBlank: false });
    if (value === undefined) return;
    autoDefault = value;
    autoDefaultInput.value = formatSeconds(value);
    savePrefs({ perView, autoDefault });
    renderAutoRows();
    scheduleAuto();
  }

  function onPageTimeChange(page, input) {
    const value = readSeconds(input, { allowBlank: true });
    if (value === undefined) return;
    if (value === null) delete pageTimes[pageTimeKey(page)];
    else pageTimes[pageTimeKey(page)] = value;
    input.value = value === null ? "" : formatSeconds(value);
    writeJson(TIMES_KEY, pageTimes);
    scheduleAuto();
  }

  // One box per page on the screen; blank means "use the default".
  function renderAutoRows() {
    const span = spreadSize(pageSongs(), index, perView);
    const rows = Array.from({ length: span }, (_, n) => {
      const page = pages[index + n];
      const own = pageSeconds(page);
      const id = `auto-page-${n}`;
      const label = t("perform.autoPage", { page: locatePage(counts, index + n).page + 1 });
      const input = secondsInput(id, label, own === null ? "" : formatSeconds(own), () => onPageTimeChange(page, input));
      input.placeholder = formatSeconds(autoDefault);
      return h("div", { class: "auto-line" }, h("label", { for: id, text: label }), input, h("span", { text: t("perform.secondsUnit") }));
    });
    autoRows.replaceChildren(...rows);
  }

  function toggleAutoPanel(force) {
    autoOpen = force ?? !autoOpen;
    if (autoOpen && lineupOpen) toggleLineup(false);
    autoPanel.hidden = !autoOpen;
    autoButton.setAttribute("aria-expanded", String(autoOpen));
    if (autoOpen) {
      renderAutoRows();
      autoStart.focus();
    } else {
      autoButton.focus();
    }
    scheduleAuto();
  }

  function typingInAutoPanel() {
    const active = document.activeElement;
    return autoPanel.contains(active) && active instanceof HTMLInputElement;
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    // paused while the Lineup is open, the screen is hidden, or a seconds box is being edited
    if (!autoOn || closed || lineupOpen || document.hidden || typingInAutoPanel() || !pages.length) return;
    autoTimer = setTimeout(autoTick, Math.round(currentViewSeconds() * 1000));
  }

  function autoTick() {
    if (closed || !autoOn) return;
    const ids = pageSongs();
    const target = nextIndex(ids, index, perView);
    if (target >= pages.length || ids[target] !== ids[index]) {
      autoOn = false;
      updateAutoButton();
      flash(t("perform.autoEnded"), 3000);
      return;
    }
    show(target);
  }

  function updateAutoButton() {
    autoButton.textContent = autoOn ? t("perform.autoButtonOn") : t("perform.autoButton");
    autoButton.setAttribute("aria-pressed", String(autoOn));
    autoStart.textContent = autoOn ? t("perform.autoStop") : t("perform.autoStart");
    scheduleAuto();
  }

  function toggleAuto() {
    autoOn = !autoOn;
    updateAutoButton();
  }
  // ---- save on this device ----
  async function refreshOffline() {
    const saved = await countOfflineFiles(allFiles.map((file) => file.storage_path));
    if (closed) return;
    const all = saved === allFiles.length;
    offlineButton.textContent = all ? t("perform.offlineSaved") : t("perform.offlineSave");
    offlineButton.setAttribute("aria-pressed", String(all));
    offlineButton.dataset.saved = all ? "true" : "false";
  }

  async function toggleOffline() {
    if (offlineBusy) return;
    offlineBusy = true;
    offlineButton.disabled = true;
    try {
      if (offlineButton.dataset.saved === "true") {
        await removeOfflineFiles(allFiles.map((file) => file.storage_path));
        flash(t("perform.offlineRemoved"));
      } else {
        requestPersistence();
        let done = 0;
        for (const file of allFiles) {
          offlineButton.textContent = t("perform.offlineSaving", { done, total: allFiles.length });
          await saveOfflineFile(file.storage_path, await fileBlob(file));
          done += 1;
        }
        flash(t("perform.offlineDone"), 3200);
      }
    } catch (error) {
      flash(t("perform.offlineFailed"), 4000);
    } finally {
      offlineBusy = false;
      offlineButton.disabled = false;
      await refreshOffline();
    }
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
    // typing seconds in the Auto turn panel must not turn pages
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const onButton = event.target instanceof HTMLButtonElement;
    let step = 0;
    if (NEXT_KEYS.has(event.key)) step = 1;
    else if (PREV_KEYS.has(event.key)) step = -1;
    else if (event.key === " " && !onButton) step = event.shiftKey ? -1 : 1;
    else if (event.key === "Home") step = -index;
    else if (event.key === "End") step = pages.length - 1 - index;
    else if (!onButton && (event.key === "+" || event.key === "=")) return void setZoom(zoom + ZOOM_STEP);
    else if (!onButton && (event.key === "-" || event.key === "_")) return void setZoom(zoom - ZOOM_STEP);
    else if (!onButton && event.key === "0") return void setZoom(1);
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
    if (event.target.closest("button, .viewer-lineup, .viewer-auto")) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved = false;
    if (touches.size === 2) {
      // two fingers: pinch to zoom
      const [a, b] = [...touches.values()];
      gesture = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      pointer = null;
      return;
    }
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event) {
    const point = touches.get(event.pointerId);
    if (!point) return;
    const before = { ...point };
    point.x = event.clientX;
    point.y = event.clientY;
    if (gesture?.kind === "pinch" && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      if (gesture.dist > 0) {
        zoom = clampZoom((gesture.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.dist);
        applyZoom();
      }
      moved = true;
      return;
    }
    // one finger on a zoomed page moves the page instead of turning it
    if (zoom > 1 && pointer?.id === event.pointerId) {
      if (Math.hypot(point.x - pointer.x, point.y - pointer.y) > TAP_PX) moved = true;
      pan = { x: pan.x + point.x - before.x, y: pan.y + point.y - before.y };
      applyZoom();
    }
  }

  function onPointerUp(event) {
    const wasPinch = gesture?.kind === "pinch";
    touches.delete(event.pointerId);
    if (wasPinch) {
      if (!touches.size) gesture = null;
      pointer = null;
      return;
    }
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer = null;
    if (zoom > 1 && moved) return;
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
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", (event) => {
    touches.delete(event.pointerId);
    pointer = null;
    gesture = null;
  });
  // trackpad pinch / Ctrl + wheel
  stage.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom(zoom - event.deltaY * 0.01);
  }, { passive: false });
  window.addEventListener("resize", onResize);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("visibilitychange", onVisibility);
  // Esc closes the Lineup first; the viewer closes on the next Esc.
  dialog.addEventListener("cancel", (event) => {
    if (autoOpen) {
      event.preventDefault();
      toggleAutoPanel(false);
      return;
    }
    if (!lineupOpen) return;
    event.preventDefault();
    toggleLineup(false);
  });
  // The timer waits while a seconds box is being edited and starts again when it is left.
  autoPanel.addEventListener("focusin", scheduleAuto);
  autoPanel.addEventListener("focusout", () => setTimeout(scheduleAuto, 0));
  dialog.addEventListener("close", () => {
    closed = true;
    releaseWake();
    clearTimeout(noticeTimer);
    clearTimeout(resizeTimer);
    clearTimeout(autoTimer);
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
  applyZoom();
  refreshOffline();
  ready[0].promise.then(() => {
    if (closed) return;
    show(0);
    flash(window.matchMedia("(pointer: coarse)").matches ? t("viewer.touchHint") : t("viewer.keyHint"), 3200);
  });
}
