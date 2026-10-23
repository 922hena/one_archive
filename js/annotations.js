// Pure helpers for notes drawn on score pages (no browser APIs, so they can be tested).
// A stroke is { id, tool, color, width, points }. Points are [x, y] in 0..1 of the ORIGINAL page
// (not of the screen), and width is a fraction of the page width. That is why a note stays on the
// same notes when the page is zoomed, shown two-up, or the device is turned.

export const TOOLS = ["pen", "highlighter", "eraser"];
export const COLORS = ["#111111", "#d32f2f", "#1565c0", "#2e7d32", "#f9a825"];
export const WIDTHS = { thin: 0.002, medium: 0.004, thick: 0.008 };
export const HIGHLIGHTER_FACTOR = 5; // a highlighter is this many times wider than the pen of the same size
export const MIN_POINT_GAP = 0.0012;

const MAX_STROKES_PER_PAGE = 5000;
const MAX_POINTS_PER_STROKE = 20000;

let counter = 0;
export function newStrokeId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Notes are kept per file page, like the auto-turn times: "<file id>:<pdf page or 0>".
export function notesKey(page) {
  return `${page.file.id}:${page.pdfPage ?? 0}`;
}

// rects: [{ left, top, width, height }] of the pages on screen. Index of the page under (x, y), or -1.
export function pageAtPoint(rects, x, y) {
  for (let at = 0; at < rects.length; at += 1) {
    const r = rects[at];
    if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return at;
  }
  return -1;
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

// Screen point -> point on the page (0..1).
export function toPagePoint(rect, x, y) {
  return [clamp01((x - rect.left) / rect.width), clamp01((y - rect.top) / rect.height)];
}

// Page point -> screen point.
export function toScreenPoint(rect, point) {
  return [rect.left + point[0] * rect.width, rect.top + point[1] * rect.height];
}

// Adds the point only when it is far enough from the last one (keeps strokes small). aspect = page height / width.
export function addPoint(points, point, aspect = 1, gap = MIN_POINT_GAP) {
  const last = points[points.length - 1];
  if (last) {
    const dx = point[0] - last[0];
    const dy = (point[1] - last[1]) * aspect;
    if (Math.hypot(dx, dy) < gap) return false;
  }
  points.push(point);
  return true;
}

export function strokeWidth(tool, size) {
  const base = WIDTHS[size] ?? WIDTHS.medium;
  return tool === "highlighter" ? base * HIGHLIGHTER_FACTOR : base;
}

function distanceToSegment(p, a, b, aspect) {
  const ax = a[0];
  const ay = a[1] * aspect;
  const bx = b[0];
  const by = b[1] * aspect;
  const px = p[0];
  const py = p[1] * aspect;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Is the point within `radius` (a fraction of the page width) of the stroke line?
export function strokeHit(stroke, point, radius, aspect = 1) {
  const points = stroke.points;
  if (!points.length) return false;
  const reach = radius + stroke.width / 2;
  if (points.length === 1) return Math.hypot(point[0] - points[0][0], (point[1] - points[0][1]) * aspect) <= reach;
  for (let at = 1; at < points.length; at += 1) {
    if (distanceToSegment(point, points[at - 1], points[at], aspect) <= reach) return true;
  }
  return false;
}

// Points along the line from a to b (b included), at most `spacing` apart, so a fast swipe of the
// eraser can't jump over a stroke. aspect = page height / width.
export function pointsBetween(a, b, spacing, aspect = 1) {
  const distance = Math.hypot(b[0] - a[0], (b[1] - a[1]) * aspect);
  const steps = Math.max(1, Math.min(200, Math.ceil(distance / spacing)));
  return Array.from({ length: steps }, (_, n) => [a[0] + ((b[0] - a[0]) * (n + 1)) / steps, a[1] + ((b[1] - a[1]) * (n + 1)) / steps]);
}

// The eraser removes whole strokes it touches. Returns what stays and what was taken, with positions for undo.
export function eraseAt(strokes, point, radius, aspect = 1) {
  const kept = [];
  const removed = [];
  strokes.forEach((stroke, at) => {
    if (strokeHit(stroke, point, radius, aspect)) removed.push({ stroke, at });
    else kept.push(stroke);
  });
  return { kept, removed };
}

// Anything read back from storage is checked before it is drawn.
export function sanitizeStrokes(raw) {
  if (!Array.isArray(raw)) return [];
  const result = [];
  for (const item of raw.slice(0, MAX_STROKES_PER_PAGE)) {
    if (!item || typeof item !== "object" || !Array.isArray(item.points)) continue;
    const tool = item.tool === "highlighter" ? "highlighter" : "pen";
    const width = Number(item.width);
    if (!Number.isFinite(width) || width <= 0 || width > 0.1) continue;
    const points = [];
    for (const point of item.points.slice(0, MAX_POINTS_PER_STROKE)) {
      if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) points.push([clamp01(point[0]), clamp01(point[1])]);
    }
    if (!points.length) continue;
    const color = typeof item.color === "string" && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : COLORS[0];
    result.push({ id: typeof item.id === "string" && item.id ? item.id : newStrokeId(), tool, color, width, points });
  }
  return result;
}

// ---- undo / redo across pages ----
// history = { undo: [], redo: [] } of { key, action }; pages = Map key -> strokes[].
// action: { type: "add", stroke } | { type: "remove", items: [{ stroke, at }] } | { type: "clear", items: [...] }

export function createHistory() {
  return { undo: [], redo: [] };
}

export function record(history, key, action) {
  history.undo.push({ key, action });
  history.redo.length = 0;
}

function apply(strokes, action, reverse) {
  if (action.type === "add") {
    if (reverse) return strokes.filter((stroke) => stroke.id !== action.stroke.id);
    return [...strokes, action.stroke];
  }
  // remove / clear
  if (!reverse) {
    const gone = new Set(action.items.map((item) => item.stroke.id));
    return strokes.filter((stroke) => !gone.has(stroke.id));
  }
  const next = [...strokes];
  for (const item of [...action.items].sort((a, b) => a.at - b.at)) next.splice(Math.min(item.at, next.length), 0, item.stroke);
  return next;
}

// Returns the page key that changed, or null when there is nothing to undo.
export function undo(history, pages) {
  const entry = history.undo.pop();
  if (!entry) return null;
  pages.set(entry.key, apply(pages.get(entry.key) ?? [], entry.action, true));
  history.redo.push(entry);
  return entry.key;
}

export function redo(history, pages) {
  const entry = history.redo.pop();
  if (!entry) return null;
  pages.set(entry.key, apply(pages.get(entry.key) ?? [], entry.action, false));
  history.undo.push(entry);
  return entry.key;
}
