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

test("songs follow the liturgical Music order, then the link order", () => {
  const songs = setlistFromMass(mass, roles);
  assert.deepEqual(songs.map((song) => song.key), ["e1", "k1", "k2", "g1"]);
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
