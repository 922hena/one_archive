// Pure helpers for Performance Mode (no browser APIs, so they can be tested).
// A "song" is one linked score in a Missa's Music list: { key, number, label, score, files }.

function roleName(role) {
  if (!role) return "";
  return role.name_la || role.name_en || role.name_ko || "";
}

// Songs in the order of the Missa: Music Part order (liturgical slot_no), then link order.
// Links whose score has no file are left out, because there is nothing to show.
export function setlistFromMass(mass, roles = []) {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const slots = [...(mass?.mass_music_slots ?? [])].sort(
    (a, b) => (roleById.get(a.role_id)?.slot_no ?? 99) - (roleById.get(b.role_id)?.slot_no ?? 99)
  );
  const songs = [];
  for (const slot of slots) {
    const role = roleById.get(slot.role_id);
    const entries = [...(slot.mass_music_entries ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
    );
    for (const entry of entries) {
      const files = entry.owned_scores?.score_files ?? [];
      if (!entry.owned_scores || !files.length) continue;
      songs.push({
        key: entry.id,
        number: String((role?.slot_no ?? 0) + 1).padStart(2, "0"),
        label: slot.display_name || roleName(role) || "",
        score: entry.owned_scores,
        files
      });
    }
  }
  return songs;
}

// Number of linked scores in a Missa (used by the date screen, which only has link ids).
export function linkedCount(mass) {
  return (mass?.mass_music_slots ?? []).reduce((sum, slot) => sum + (slot.mass_music_entries?.length ?? 0), 0);
}

// counts[i] = pages of song i once loaded (undefined while loading). Songs load in order,
// so a song's first page is the sum of the songs before it.
export function songStarts(counts) {
  const starts = [];
  let sum = 0;
  for (const count of counts) {
    if (count === undefined) break;
    starts.push(sum);
    sum += count;
  }
  return starts;
}

// Which song and which page of it a global page index (0-based) belongs to.
export function locatePage(counts, index) {
  const starts = songStarts(counts);
  for (let song = starts.length - 1; song >= 0; song -= 1) {
    if (index >= starts[song]) return { song, page: index - starts[song] };
  }
  return { song: 0, page: 0 };
}

// ---- zoom, several pages on screen and auto page turn ----

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.25;

export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

// Keeps a zoomed page from being dragged away from the screen: the page edge stops at the screen edge.
// content/box are the unzoomed sizes { w, h }.
export function clampPan(pan, zoom, content, box) {
  const limitX = Math.max(0, (content.w * zoom - box.w) / 2);
  const limitY = Math.max(0, (content.h * zoom - box.h) / 2);
  return {
    x: Math.min(limitX, Math.max(-limitX, pan.x)),
    y: Math.min(limitY, Math.max(-limitY, pan.y))
  };
}

// Zoom at which the page is as wide as the screen (never below "fit page").
export function fitWidthZoom(content, box) {
  if (!content.w) return ZOOM_MIN;
  return clampZoom(box.w / content.w);
}

// ---- several pages on one screen (1 to 4) ----

export const MAX_PER_VIEW = 4;

export function clampPerView(count) {
  const n = Math.round(Number(count));
  return Number.isFinite(n) ? Math.min(MAX_PER_VIEW, Math.max(1, n)) : 1;
}

// Grid for that many pages on one screen: 1, 2 or 3 side by side; 4 as 2 x 2.
// vertical = pages stacked top to bottom (Double Vertical); four pages are always 2 x 2.
export function gridFor(perView, vertical = false) {
  const n = clampPerView(perView);
  if (n >= 4) return { cols: 2, rows: 2 };
  return vertical ? { cols: 1, rows: n } : { cols: n, rows: 1 };
}

// songIds[i] = song of global page i. One screen never mixes two songs.
// How many pages the screen starting at `index` shows (at most perView).
export function spreadSize(songIds, index, perView) {
  const limit = clampPerView(perView);
  let size = 1;
  while (size < limit && index + size < songIds.length && songIds[index + size] === songIds[index]) size += 1;
  return size;
}

// First page of the next screen (equals songIds.length when there is none).
export function nextIndex(songIds, index, perView) {
  return index + spreadSize(songIds, index, perView);
}

// First page of the previous screen, or -1 at the very start.
export function prevIndex(songIds, index, perView) {
  if (index <= 0) return -1;
  const limit = clampPerView(perView);
  let run = 1;
  while (run < limit && index - run - 1 >= 0 && songIds[index - run - 1] === songIds[index - 1]) run += 1;
  return index - run;
}

// ---- auto page turn: seconds per page, in steps of 0.1 ----

export const AUTO_MIN = 0.1;
export const AUTO_MAX = 600;
export const AUTO_DEFAULT = 10;

// Text typed in a seconds box -> { ok, value }. Blank is allowed (value null = "use the default").
export function parseSeconds(text) {
  const raw = String(text ?? "").trim().replace(",", ".");
  if (!raw) return { ok: true, value: null };
  let number;
  if (raw.includes(":")) {
    // minutes:seconds, e.g. 1:30 or 1:30.5
    const match = /^(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/.exec(raw);
    number = match && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
  } else {
    number = Number(raw);
  }
  if (!Number.isFinite(number) || number <= 0) return { ok: false, value: null };
  const tenths = Math.round(number * 10) / 10;
  return { ok: true, value: Math.min(AUTO_MAX, Math.max(AUTO_MIN, tenths)) };
}

// 12 -> "12", 12.5 -> "12.5"
export function formatSeconds(seconds) {
  return String(Math.round(seconds * 10) / 10);
}

// A screen stays as long as its longest page. times[i] = that page's own seconds, or null for the default.
export function viewSeconds(times, fallback) {
  let longest = 0;
  for (const time of times) longest = Math.max(longest, time ?? fallback);
  return longest || fallback;
}

// Page times are remembered per file page: { "<file id>:<pdf page or 0>": seconds }.
export function pageTimeKey(page) {
  return `${page.file.id}:${page.pdfPage ?? 0}`;
}

// ---- on-screen buttons and brightness (kept on this device, one set per screen orientation) ----

export const NAV_SIZES = {
  small: { w: 36, h: 56 },
  medium: { w: 44, h: 72 },
  large: { w: 64, h: 104 }
};

function inRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

// Saved settings -> safe settings. `touch` = the device is used by touch (arrows start hidden there,
// because swipe and tap already turn pages).
export function normalizeDisplay(saved, touch = false) {
  const source = saved && typeof saved === "object" ? saved : {};
  return {
    arrows: typeof source.arrows === "boolean" ? source.arrows : !touch,
    size: Object.hasOwn(NAV_SIZES, source.size) ? source.size : "medium",
    opacity: inRange(source.opacity, 20, 100, 100),
    brightness: inRange(source.brightness, 40, 100, 100)
  };
}

export function orientationOf(width, height) {
  return height > width ? "portrait" : "landscape";
}