import { t } from "../i18n.js";
import { h } from "../ui.js";
import {
  COLORS,
  addPoint,
  createHistory,
  eraseAt,
  newStrokeId,
  pageAtPoint,
  pointsBetween,
  record,
  redo,
  strokeWidth,
  toPagePoint,
  toScreenPoint,
  undo
} from "../annotations.js";
import { loadNotes, saveNotes } from "../notes-store.js";

const PREFS_KEY = "yearscore-perform-notes";
const SAVE_DELAY_MS = 600;
const ERASER_RADIUS = 0.012; // fraction of the page width
const HIGHLIGHT_ALPHA = 0.4;
const CONFIRM_MS = 3000;

const COLOR_NAMES = ["black", "red", "blue", "green", "yellow"];

function readPrefs() {
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    if (value && typeof value === "object") saved = value;
  } catch {
    // unreadable settings: start from the defaults
  }
  return {
    tool: ["pen", "highlighter", "eraser"].includes(saved.tool) ? saved.tool : "pen",
    penColor: COLORS.includes(saved.penColor) ? saved.penColor : COLORS[1],
    highlightColor: COLORS.includes(saved.highlightColor) ? saved.highlightColor : COLORS[4],
    size: ["thin", "medium", "thick"].includes(saved.size) ? saved.size : "medium",
    penOnly: saved.penOnly === true,
    privateView: saved.privateView === true,
    dock: saved.dock === "top" ? "top" : "bottom" // which edge the tool bar sits on
  };
}

// Handwritten notes over the score pages in Performance Mode.
// - Notes are drawn on a canvas that lies over the pages and is redrawn from page coordinates (0..1),
//   so they follow zoom, 1-4 pages on screen and rotation. The score file itself is never changed.
// - They are saved on this device only (IndexedDB), automatically, and come back when the page is opened again.
// visiblePages() -> [{ key, el, label }] for the pages on screen right now.
export function createNotesLayer({ visiblePages, flash, onMode }) {
  const prefs = readPrefs();
  const pages = new Map(); // key -> strokes
  const loading = new Map();
  const history = createHistory();
  const dirty = new Set();
  const claimed = new Set(); // pointers that are drawing, so the viewer doesn't also turn a page for them
  let mode = false;
  let hidden = prefs.privateView; // "Private view": notes stay hidden until asked for
  let draw = null;
  let lastKey = null;
  let saveTimer = null;
  let confirmTimer = null;
  let frame = 0;
  let destroyed = false;
  let saveWarned = false;

  const canvas = h("canvas", { class: "notes-canvas", "aria-hidden": "true" });
  const ctx = canvas.getContext("2d");

  const toolButtons = {
    pen: h("button", { type: "button", class: "viewer-tool", onclick: () => setTool("pen") }, t("perform.notesPen")),
    highlighter: h("button", { type: "button", class: "viewer-tool", onclick: () => setTool("highlighter") }, t("perform.notesHighlighter")),
    eraser: h("button", { type: "button", class: "viewer-tool", onclick: () => setTool("eraser") }, t("perform.notesEraser"))
  };
  const colorButtons = COLORS.map((color, n) => {
    const button = h("button", {
      type: "button",
      class: "notes-swatch",
      "aria-label": t(`perform.notesColor${COLOR_NAMES[n][0].toUpperCase()}${COLOR_NAMES[n].slice(1)}`),
      onclick: () => setColor(color)
    });
    button.style.setProperty("--swatch", color);
    return button;
  });
  const sizeButtons = ["thin", "medium", "thick"].map((size) =>
    h("button", {
      type: "button",
      class: "viewer-tool",
      onclick: () => setSize(size)
    }, t(`perform.notes${size[0].toUpperCase()}${size.slice(1)}`))
  );
  const undoButton = h("button", { type: "button", class: "viewer-tool", onclick: doUndo }, t("perform.notesUndo"));
  const redoButton = h("button", { type: "button", class: "viewer-tool", onclick: doRedo }, t("perform.notesRedo"));
  const clearButton = h("button", { type: "button", class: "viewer-tool", onclick: clearPage }, t("perform.notesClear"));
  const penOnlyButton = h("button", { type: "button", class: "viewer-tool", title: t("perform.notesPenOnlyHint"), onclick: () => setPrefs({ penOnly: !prefs.penOnly }) }, t("perform.notesPenOnly"));
  const privateButton = h("button", { type: "button", class: "viewer-tool", title: t("perform.notesPrivateHint"), onclick: () => setPrefs({ privateView: !prefs.privateView }) }, t("perform.notesPrivate"));
  const doneButton = h("button", { type: "button", class: "viewer-tool is-primary", onclick: () => setMode(false) }, t("perform.notesDone"));

  const moveButton = h("button", { type: "button", class: "viewer-tool", onclick: () => setPrefs({ dock: prefs.dock === "top" ? "bottom" : "top" }) });
  const sep = () => h("span", { class: "notes-sep", "aria-hidden": "true" });
  // One row that wraps, so the bar takes as little of the score as possible.
  const bar = h("div", { class: "viewer-notes", role: "group", "aria-label": t("perform.notesTitle"), hidden: true },
    h("div", { class: "notes-row" },
      ...Object.values(toolButtons), sep(), ...colorButtons, sep(), ...sizeButtons, sep(),
      undoButton, redoButton, clearButton, sep(), penOnlyButton, privateButton, moveButton, doneButton
    )
  );

  // These two sit in the viewer's tool row.
  const modeButton = h("button", { type: "button", class: "viewer-tool", "aria-pressed": "false", onclick: () => setMode(!mode) }, t("perform.notes"));
  const hideButton = h("button", { type: "button", class: "viewer-tool", "aria-pressed": "false", onclick: () => setHidden(!hidden) }, t("perform.notesHide"));

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // not remembered, nothing breaks
    }
  }

  function setPrefs(patch) {
    Object.assign(prefs, patch);
    savePrefs();
    syncButtons();
  }

  function currentColor() {
    return prefs.tool === "highlighter" ? prefs.highlightColor : prefs.penColor;
  }

  function setTool(tool) {
    setPrefs({ tool });
  }

  function setColor(color) {
    setPrefs(prefs.tool === "highlighter" ? { highlightColor: color } : { penColor: color });
  }

  function setSize(size) {
    setPrefs({ size });
  }

  function syncButtons() {
    for (const [tool, button] of Object.entries(toolButtons)) button.setAttribute("aria-pressed", String(prefs.tool === tool));
    const color = currentColor();
    colorButtons.forEach((button, n) => {
      button.setAttribute("aria-pressed", String(COLORS[n] === color && prefs.tool !== "eraser"));
      button.disabled = prefs.tool === "eraser";
    });
    ["thin", "medium", "thick"].forEach((size, n) => {
      sizeButtons[n].setAttribute("aria-pressed", String(prefs.size === size));
      sizeButtons[n].disabled = prefs.tool === "eraser";
    });
    undoButton.disabled = !history.undo.length;
    redoButton.disabled = !history.redo.length;
    clearButton.disabled = !targetEntry();
    penOnlyButton.setAttribute("aria-pressed", String(prefs.penOnly));
    privateButton.setAttribute("aria-pressed", String(prefs.privateView));
    bar.classList.toggle("is-top", prefs.dock === "top");
    moveButton.textContent = t(prefs.dock === "top" ? "perform.notesMoveDown" : "perform.notesMoveUp");
    modeButton.setAttribute("aria-pressed", String(mode));
    hideButton.setAttribute("aria-pressed", String(hidden));
    hideButton.textContent = t(hidden ? "perform.notesShow" : "perform.notesHide");
  }

  function setMode(next) {
    if (destroyed || next === mode) return;
    mode = next;
    bar.hidden = !mode;
    if (mode && hidden) setHidden(false);
    cancelDraw();
    resetConfirm();
    syncButtons();
    onMode?.(mode);
    if (mode) {
      flash(t("perform.notesHint"), 3200);
      refresh();
    }
  }

  function setHidden(next) {
    if (next && mode) {
      // hiding the notes while drawing would be confusing: leave drawing first
      setMode(false);
    }
    hidden = next;
    syncButtons();
    scheduleRedraw();
    if (hidden) flash(t("perform.notesHidden"));
  }

  // ---- loading and saving ----
  function ensureLoaded(key) {
    if (pages.has(key)) return Promise.resolve();
    if (!loading.has(key)) {
      loading.set(key, loadNotes(key).then((strokes) => {
        if (!pages.has(key)) pages.set(key, strokes);
        loading.delete(key);
      }));
    }
    return loading.get(key);
  }

  async function refresh() {
    if (destroyed) return;
    scheduleRedraw();
    const entries = visiblePages();
    await Promise.all(entries.map((entry) => ensureLoaded(entry.key)));
    if (destroyed) return;
    syncButtons();
    scheduleRedraw();
  }

  function markDirty(key) {
    dirty.add(key);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }

  function flush() {
    clearTimeout(saveTimer);
    const keys = [...dirty];
    dirty.clear();
    for (const key of keys) {
      saveNotes(key, pages.get(key) ?? []).catch(() => {
        dirty.add(key);
        if (!saveWarned) {
          saveWarned = true;
          flash(t("perform.notesSaveFailed"), 4500);
        }
      });
    }
  }

  // ---- drawing on the canvas ----
  function scheduleRedraw() {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(redraw);
  }

  function strokePath(stroke, rect) {
    const points = stroke.points.map((point) => toScreenPoint(rect, point));
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    if (points.length === 1) {
      ctx.lineTo(points[0][0] + 0.01, points[0][1]);
      return;
    }
    for (let at = 1; at < points.length - 1; at += 1) {
      // smooth curve through the middle of each pair of points
      ctx.quadraticCurveTo(points[at][0], points[at][1], (points[at][0] + points[at + 1][0]) / 2, (points[at][1] + points[at + 1][1]) / 2);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last[0], last[1]);
  }

  function drawStroke(stroke, rect) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(1, stroke.width * rect.width);
    ctx.globalAlpha = stroke.tool === "highlighter" ? HIGHLIGHT_ALPHA : 1;
    strokePath(stroke, rect);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    frame = 0;
    if (destroyed) return;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(box.width * ratio);
    const height = Math.round(box.height * ratio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    if (hidden) return;
    for (const entry of visiblePages()) {
      const strokes = pages.get(entry.key) ?? [];
      const live = draw?.stroke && draw.key === entry.key ? draw.stroke : null;
      if (!strokes.length && !live) continue;
      const rect = entry.el.getBoundingClientRect();
      const local = { left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height };
      if (local.width <= 0 || local.height <= 0) continue;
      for (const stroke of strokes) drawStroke(stroke, local);
      if (live) drawStroke(live, local);
    }
  }

  // ---- pointer input ----
  function startAllowed(event) {
    if (!mode || destroyed) return false;
    if (event.pointerType === "mouse" && event.button !== 0) return false;
    if (event.pointerType === "touch" && prefs.penOnly) return false; // fingers keep turning pages
    return true;
  }

  function release(id) {
    // the viewer's own handlers run right after ours, so the claim is dropped a moment later
    setTimeout(() => claimed.delete(id), 0);
  }

  function cancelDraw() {
    if (!draw) return;
    if (draw.tool === "eraser") pages.set(draw.key, draw.before);
    draw = null;
    scheduleRedraw();
  }

  function extend(event) {
    const rect = draw.el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const aspect = rect.height / rect.width;
    const point = toPagePoint(rect, event.clientX, event.clientY);
    if (draw.tool === "eraser") {
      // every point on the way, so a quick swipe doesn't skip over a stroke
      const route = draw.last ? pointsBetween(draw.last, point, ERASER_RADIUS, aspect) : [point];
      draw.last = point;
      for (const spot of route) {
        const { kept, removed } = eraseAt(pages.get(draw.key) ?? [], spot, ERASER_RADIUS, aspect);
        if (removed.length) pages.set(draw.key, kept);
      }
    } else {
      addPoint(draw.stroke.points, point, aspect);
    }
  }

  function onPointerDown(event) {
    if (!mode) return;
    if (draw) {
      // a second finger: this is a pinch, not a stroke
      if (draw.id !== event.pointerId) cancelDraw();
      return;
    }
    if (!startAllowed(event)) return;
    const entries = visiblePages();
    const at = pageAtPoint(entries.map((entry) => entry.el.getBoundingClientRect()), event.clientX, event.clientY);
    if (at < 0) return;
    const entry = entries[at];
    if (!pages.has(entry.key)) {
      ensureLoaded(entry.key); // the saved notes of this page are still being read
      return;
    }
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId); // keeps the stroke going when the pen leaves the canvas
    } catch {
      // not an active pointer (e.g. a replayed event): drawing still works
    }
    claimed.add(event.pointerId);
    lastKey = entry.key;
    draw = {
      id: event.pointerId,
      key: entry.key,
      el: entry.el,
      tool: prefs.tool,
      before: [...pages.get(entry.key)],
      stroke: prefs.tool === "eraser"
        ? null
        : { id: newStrokeId(), tool: prefs.tool, color: currentColor(), width: strokeWidth(prefs.tool, prefs.size), points: [] }
    };
    extend(event);
    scheduleRedraw();
  }

  function onPointerMove(event) {
    if (!draw || draw.id !== event.pointerId) return;
    const events = event.getCoalescedEvents?.() ?? [];
    for (const item of events.length ? events : [event]) extend(item);
    scheduleRedraw();
  }

  function onPointerUp(event) {
    if (!draw || draw.id !== event.pointerId) {
      if (claimed.has(event.pointerId)) release(event.pointerId);
      return;
    }
    const finished = draw;
    draw = null;
    release(event.pointerId);
    if (finished.tool === "eraser") {
      const now = pages.get(finished.key) ?? [];
      const keep = new Set(now.map((stroke) => stroke.id));
      const items = finished.before.map((stroke, at) => ({ stroke, at })).filter((item) => !keep.has(item.stroke.id));
      if (items.length) {
        record(history, finished.key, { type: "remove", items });
        markDirty(finished.key);
      }
    } else if (finished.stroke.points.length) {
      pages.set(finished.key, [...(pages.get(finished.key) ?? []), finished.stroke]);
      record(history, finished.key, { type: "add", stroke: finished.stroke });
      markDirty(finished.key);
    }
    syncButtons();
    scheduleRedraw();
  }

  function onPointerCancel(event) {
    if (draw?.id === event.pointerId) cancelDraw();
    if (claimed.has(event.pointerId)) release(event.pointerId);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("contextmenu", (event) => {
    if (mode) event.preventDefault();
  });

  // ---- undo, redo, clear ----
  function afterChange(key) {
    if (key === null) return;
    lastKey = key;
    markDirty(key);
    syncButtons();
    scheduleRedraw();
  }

  function doUndo() {
    cancelDraw();
    afterChange(undo(history, pages));
  }

  function doRedo() {
    cancelDraw();
    afterChange(redo(history, pages));
  }

  // The page that "Clear page" applies to: the one drawn on last, else the first one on screen.
  function targetEntry() {
    const entries = visiblePages();
    return entries.find((entry) => entry.key === lastKey) ?? entries[0] ?? null;
  }

  function resetConfirm() {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    clearButton.textContent = t("perform.notesClear");
  }

  function clearPage() {
    const entry = targetEntry();
    if (!entry) return;
    if (!confirmTimer) {
      // asks once more, so a stray touch can't wipe a page
      clearButton.textContent = t("perform.notesClearConfirm", { page: entry.label });
      confirmTimer = setTimeout(resetConfirm, CONFIRM_MS);
      return;
    }
    resetConfirm();
    const strokes = pages.get(entry.key) ?? [];
    if (!strokes.length) return;
    record(history, entry.key, { type: "clear", items: strokes.map((stroke, at) => ({ stroke, at })) });
    pages.set(entry.key, []);
    afterChange(entry.key);
    flash(t("perform.notesCleared", { page: entry.label }));
  }

  // Ctrl/Cmd + Z = undo, Ctrl/Cmd + Shift + Z or Ctrl + Y = redo. Returns true when the key was used.
  function handleKey(event) {
    if (!mode || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) doRedo();
      else doUndo();
      return true;
    }
    if (key === "y") {
      event.preventDefault();
      doRedo();
      return true;
    }
    return false;
  }

  function onVisibility() {
    if (document.visibilityState === "hidden") flush();
  }

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleRedraw);
  resizeObserver?.observe(canvas);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);
  syncButtons();

  function destroy() {
    if (destroyed) return;
    flush();
    destroyed = true;
    cancelAnimationFrame(frame);
    clearTimeout(confirmTimer);
    resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
  }

  return {
    canvas,
    bar,
    buttons: [modeButton, hideButton],
    get mode() {
      return mode;
    },
    get hidden() {
      return hidden;
    },
    setMode,
    refresh,
    redraw: scheduleRedraw,
    handleKey,
    isClaimed: (id) => claimed.has(id),
    flush,
    destroy
  };
}
