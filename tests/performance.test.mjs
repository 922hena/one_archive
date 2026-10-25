import test from "node:test";
import assert from "node:assert/strict";
import { linkedCount, locatePage, setlistFromMass, songStarts } from "../js/performance.js";

const roles = [
  { id: "r-gloria", slot_no: 3, name_la: "Gloria", name_en: "Glory to God" },
  { id: "r-kyrie", slot_no: 2, name_la: "Kyrie", name_en: "Lord, have mercy" },
  { id: "r-entrance", slot_no: 0, name_la: null, name_en: "Entrance", name_ko: "입당" }
];
const file = (id) => ({ id, storage_path: `u/s/${id}.pdf`, mime_type: "application/pdf" });
const entry = (id, order, files, created = "2026-10-01T00:00:00Z") => ({
  id,
  sort_order: order,
  created_at: created,
  owned_scores: { id: `score-${id}`, title: `Title ${id}`, score_files: files }
});

const mass = {
  mass_music_slots: [
    { id: "s1", role_id: "r-gloria", display_name: null, mass_music_entries: [entry("g1", 0, [file("f-g1")])] },
    {
      id: "s2",
      role_id: "r-kyrie",
      display_name: "Kyrie (Missa brevis)",
      mass_music_entries: [entry("k2", 1, [file("f-k2")]), entry("k1", 0, [file("f-k1a"), file("f-k1b")])]
    },
    { id: "s3", role_id: "r-entrance", display_name: null, mass_music_entries: [entry("e1", 0, [file("f-e1")])] }
  ]
};

test("without a saved order, songs follow the liturgical Music order, then the link order", () => {
  const songs = setlistFromMass(mass, roles);
  assert.deepEqual(songs.map((song) => song.key), ["e1", "k1", "k2", "g1"]);
  assert.deepEqual(songs.map((song) => song.number), ["01", "02", "02", "03"]);
});

test("songs follow the member's order and are numbered by their place in the Missa", () => {
  const ordered = {
    mass_music_slots: [
      { ...mass.mass_music_slots[0], sort_order: 1 },
      { id: "s4", role_id: "r-entrance-2", sort_order: 2, mass_music_entries: [] },
      { ...mass.mass_music_slots[1], sort_order: 3 },
      { ...mass.mass_music_slots[2], sort_order: 4 }
    ]
  };
  const songs = setlistFromMass(ordered, roles);
  assert.deepEqual(songs.map((song) => song.key), ["g1", "k1", "k2", "e1"]);
  // the empty part keeps its place, so numbers match the Missa screen
  assert.deepEqual(songs.map((song) => song.number), ["01", "03", "03", "04"]);
});

test("labels prefer the user's name, then Latin, then English, then Korean", () => {
  const songs = setlistFromMass(mass, roles);
  assert.equal(songs.find((song) => song.key === "g1").label, "Gloria");
  assert.equal(songs.find((song) => song.key === "k1").label, "Kyrie (Missa brevis)");
  assert.equal(songs.find((song) => song.key === "e1").label, "Entrance");
  const korean = setlistFromMass(
    { mass_music_slots: [{ id: "x", role_id: "r-ko", mass_music_entries: [entry("a", 0, [file("fa")])] }] },
    [{ id: "r-ko", slot_no: 1, name_ko: "입당" }]
  );
  assert.equal(korean[0].label, "입당");
});

test("links without a file are left out", () => {
  const songs = setlistFromMass(
    {
      mass_music_slots: [
        { id: "s", role_id: "r-kyrie", mass_music_entries: [entry("none", 0, []), entry("ok", 1, [file("f")]), { id: "bare", sort_order: 2 }] }
      ]
    },
    roles
  );
  assert.deepEqual(songs.map((song) => song.key), ["ok"]);
});

test("equal link order falls back to the time it was linked", () => {
  const songs = setlistFromMass(
    {
      mass_music_slots: [
        {
          id: "s",
          role_id: "r-kyrie",
          mass_music_entries: [entry("late", 0, [file("a")], "2026-10-02T00:00:00Z"), entry("early", 0, [file("b")], "2026-10-01T00:00:00Z")]
        }
      ]
    },
    roles
  );
  assert.deepEqual(songs.map((song) => song.key), ["early", "late"]);
});

test("a Missa with nothing linked gives an empty list", () => {
  assert.deepEqual(setlistFromMass({ mass_music_slots: [] }, roles), []);
  assert.deepEqual(setlistFromMass(null, roles), []);
});

test("linkedCount counts links, not files", () => {
  assert.equal(linkedCount(mass), 4);
  assert.equal(linkedCount({ mass_music_slots: [{ mass_music_entries: [] }] }), 0);
  assert.equal(linkedCount(null), 0);
});

test("songStarts and locatePage turn a global page into song and page", () => {
  const counts = [3, 1, 5];
  assert.deepEqual(songStarts(counts), [0, 3, 4]);
  assert.deepEqual(locatePage(counts, 0), { song: 0, page: 0 });
  assert.deepEqual(locatePage(counts, 2), { song: 0, page: 2 });
  assert.deepEqual(locatePage(counts, 3), { song: 1, page: 0 });
  assert.deepEqual(locatePage(counts, 4), { song: 2, page: 0 });
  assert.deepEqual(locatePage(counts, 8), { song: 2, page: 4 });
});

test("songs that are still loading are not counted yet", () => {
  assert.deepEqual(songStarts([3, undefined, undefined]), [0]);
  assert.deepEqual(locatePage([3, undefined], 2), { song: 0, page: 2 });
  assert.deepEqual(locatePage([], 0), { song: 0, page: 0 });
});

import {
  AUTO_MAX,
  AUTO_MIN,
  ZOOM_MAX,
  clampPan,
  clampPerView,
  clampZoom,
  fitWidthZoom,
  formatSeconds,
  gridFor,
  NAV_SIZES,
  nextIndex,
  normalizeDisplay,
  orientationOf,
  pageTimeKey,
  parseSeconds,
  prevIndex,
  spreadSize,
  viewSeconds
} from "../js/performance.js";

test("zoom stays between fit page and the maximum", () => {
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(2.5), 2.5);
  assert.equal(clampZoom(99), ZOOM_MAX);
  assert.equal(clampZoom(NaN), 1);
});

test("a zoomed page cannot be dragged past the screen edge", () => {
  const content = { w: 400, h: 600 };
  const box = { w: 800, h: 600 };
  assert.deepEqual(clampPan({ x: 500, y: 500 }, 1, content, box), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: 500, y: -500 }, 2, content, box), { x: 0, y: -300 });
  assert.deepEqual(clampPan({ x: -50, y: 10 }, 3, content, box), { x: -50, y: 10 });
});

test("fit width zooms a narrow page up to the screen width", () => {
  assert.equal(fitWidthZoom({ w: 400, h: 600 }, { w: 800, h: 600 }), 2);
  assert.equal(fitWidthZoom({ w: 900, h: 600 }, { w: 800, h: 600 }), 1);
  assert.equal(fitWidthZoom({ w: 0, h: 0 }, { w: 800, h: 600 }), 1);
});

test("pages on screen are limited to 1-4 and laid out as a grid", () => {
  assert.equal(clampPerView(0), 1);
  assert.equal(clampPerView(3), 3);
  assert.equal(clampPerView(9), 4);
  assert.equal(clampPerView("x"), 1);
  assert.deepEqual(gridFor(1), { cols: 1, rows: 1 });
  assert.deepEqual(gridFor(2), { cols: 2, rows: 1 });
  assert.deepEqual(gridFor(3), { cols: 3, rows: 1 });
  assert.deepEqual(gridFor(4), { cols: 2, rows: 2 });
});

test("stacked pages go top to bottom; four pages stay 2 x 2", () => {
  assert.deepEqual(gridFor(1, true), { cols: 1, rows: 1 });
  assert.deepEqual(gridFor(2, true), { cols: 1, rows: 2 });
  assert.deepEqual(gridFor(3, true), { cols: 1, rows: 3 });
  assert.deepEqual(gridFor(4, true), { cols: 2, rows: 2 });
});

test("seconds can also be typed as minutes:seconds", () => {
  assert.deepEqual(parseSeconds("1:30"), { ok: true, value: 90 });
  assert.deepEqual(parseSeconds("0:07.5"), { ok: true, value: 7.5 });
  assert.deepEqual(parseSeconds("2:05"), { ok: true, value: 125 });
  assert.equal(parseSeconds("1:75").ok, false);
  assert.equal(parseSeconds("1:").ok, false);
  assert.equal(parseSeconds(":30").ok, false);
  assert.equal(parseSeconds("1:2:3").ok, false);
});

test("one screen never mixes two Scores", () => {
  const ids = [0, 0, 0, 1, 1, 1, 1, 1];
  assert.equal(spreadSize(ids, 0, 1), 1);
  assert.equal(spreadSize(ids, 0, 2), 2);
  assert.equal(spreadSize(ids, 0, 4), 3); // Score 0 has only 3 pages
  assert.equal(spreadSize(ids, 2, 2), 1);
  assert.equal(spreadSize(ids, 3, 4), 4);
  assert.equal(spreadSize(ids, 7, 4), 1); // end of the list
});

test("next and previous follow the pages on screen", () => {
  const ids = [0, 0, 0, 1, 1, 1, 1, 1];
  assert.equal(nextIndex(ids, 0, 1), 1);
  assert.equal(nextIndex(ids, 0, 2), 2);
  assert.equal(nextIndex(ids, 0, 4), 3);
  assert.equal(nextIndex(ids, 3, 4), 7);
  assert.equal(nextIndex(ids, 7, 4), 8);
  assert.equal(prevIndex(ids, 0, 4), -1);
  assert.equal(prevIndex(ids, 3, 4), 0); // all 3 pages of Score 0
  assert.equal(prevIndex(ids, 3, 2), 1);
  assert.equal(prevIndex(ids, 7, 4), 3);
  assert.equal(prevIndex(ids, 7, 1), 6);
});

test("seconds are typed with up to one decimal and kept within limits", () => {
  assert.deepEqual(parseSeconds("12.5"), { ok: true, value: 12.5 });
  assert.deepEqual(parseSeconds("12,5"), { ok: true, value: 12.5 });
  assert.deepEqual(parseSeconds("7.26"), { ok: true, value: 7.3 });
  assert.deepEqual(parseSeconds(" 0.1 "), { ok: true, value: 0.1 });
  assert.deepEqual(parseSeconds("0.04"), { ok: true, value: AUTO_MIN });
  assert.deepEqual(parseSeconds("9999"), { ok: true, value: AUTO_MAX });
  assert.deepEqual(parseSeconds(""), { ok: true, value: null });
  assert.equal(parseSeconds("0").ok, false);
  assert.equal(parseSeconds("-3").ok, false);
  assert.equal(parseSeconds("abc").ok, false);
  assert.equal(formatSeconds(12), "12");
  assert.equal(formatSeconds(12.5), "12.5");
  assert.equal(formatSeconds(0.1 + 0.2), "0.3");
});

test("a screen stays as long as its longest page; blank pages use the default", () => {
  assert.equal(viewSeconds([null], 10), 10);
  assert.equal(viewSeconds([5, null], 10), 10);
  assert.equal(viewSeconds([5, 20.5], 10), 20.5);
  assert.equal(viewSeconds([2.5], 10), 2.5);
  assert.equal(viewSeconds([], 8), 8);
});

test("page times are kept per file page", () => {
  assert.equal(pageTimeKey({ file: { id: "f1" }, pdfPage: 3 }), "f1:3");
  assert.equal(pageTimeKey({ file: { id: "f2" } }), "f2:0");
});

test("display settings are cleaned up and completed", () => {
  assert.deepEqual(normalizeDisplay(undefined, false), { arrows: true, size: "medium", opacity: 100, brightness: 100 });
  assert.equal(normalizeDisplay(undefined, true).arrows, false); // touch: swipe and tap already turn pages
  assert.equal(normalizeDisplay({ arrows: true }, true).arrows, true);
  assert.equal(normalizeDisplay({ size: "huge" }).size, "medium");
  assert.ok(Object.hasOwn(NAV_SIZES, normalizeDisplay({ size: "large" }).size));
  assert.equal(normalizeDisplay({ opacity: 5 }).opacity, 20);
  assert.equal(normalizeDisplay({ opacity: 500 }).opacity, 100);
  assert.equal(normalizeDisplay({ brightness: "x" }).brightness, 100);
  assert.equal(normalizeDisplay({ brightness: 10 }).brightness, 40);
  assert.equal(normalizeDisplay("junk").size, "medium");
});

test("orientation follows the screen shape", () => {
  assert.equal(orientationOf(1024, 768), "landscape");
  assert.equal(orientationOf(768, 1024), "portrait");
  assert.equal(orientationOf(800, 800), "landscape");
});
