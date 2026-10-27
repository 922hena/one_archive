import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../js/db.js";
import { createDemoClient } from "../js/demo-client.js";
import { DEMO_ROLES, DEMO_USER_ID, demoReference, seedDemo } from "../js/demo-seed.js";
import { uploadPreparedScore } from "../js/upload-prepared.js";
import { shiftIso } from "../js/recurrence.js";

const TODAY = "2026-10-28"; // a Wednesday

async function setup() {
  const state = { tables: {}, objects: [] };
  let changes = 0;
  const client = createDemoClient({
    userId: DEMO_USER_ID,
    state,
    reference: demoReference(),
    onChange: () => (changes += 1),
    today: () => TODAY
  });
  const db = createDb(client);
  await seedDemo({ db, today: TODAY });
  return { state, client, db, changes: () => changes };
}

const role = (code) => DEMO_ROLES.find((item) => item.code === code);
const PAST_SUNDAYS = ["2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];

// Scores made by the test itself; the demo starts with none.
async function addScore(client, { title, composer = "", year = null, tonic = null, mode = null }) {
  const scoreId = crypto.randomUUID();
  await uploadPreparedScore(client, DEMO_USER_ID, {
    scoreId,
    fileId: crypto.randomUUID(),
    thumbId: crypto.randomUUID(),
    pdf: new Blob(["%PDF-1.4 test"], { type: "application/pdf" }),
    pdfName: `${title}.pdf`,
    thumb: null,
    title,
    composerName: composer
  });
  const { error } = await client
    .from("owned_scores")
    .update({ composition_year: year, key_tonic: tonic, key_mode: mode })
    .eq("id", scoreId);
  if (error) throw error;
  return scoreId;
}

async function linkOn(db, date, code, scoreId) {
  const [mass] = await db.massesOn(date);
  const detail = await db.mass(mass.id);
  const slot = detail.mass_music_slots.find((item) => item.role_id === role(code).id);
  await db.linkScore(slot.id, scoreId);
  return slot;
}

test("a new demo has Missae and Music Parts but no Scores", async () => {
  const { state, db, changes } = await setup();
  assert.ok(changes() > 0);
  assert.equal(state.tables.user_mass_layouts.length, 2);
  assert.equal((await db.venues()).length, 2);
  assert.deepEqual(await db.readyScores(), []);
  assert.equal(state.tables.owned_scores?.length ?? 0, 0);
  assert.equal(state.objects.length, 0);

  // Sundays 09-27 .. 11-15 plus the weekday Missa on 11-04
  assert.equal(state.tables.mass_events.length, 9);
  const onSunday = await db.massesOn("2026-11-01");
  assert.equal(onSunday.length, 1);
  const mass = await db.mass(onSunday[0].id);
  assert.equal(mass.observance.name_en, "Solemnity of All Saints");
  assert.equal(mass.mass_music_slots.length, 11);
  assert.equal(mass.mass_music_slots.flatMap((slot) => slot.mass_music_entries).length, 0);
  assert.deepEqual(await db.searchScores({}), []);

  const layouts = await db.layouts();
  assert.deepEqual(layouts.map((layout) => layout.name), ["Sunday", "Weekday"]);
});

test("played songs and Search follow the database rules", async () => {
  const { client, db } = await setup();
  const classical = await addScore(client, { title: "Test Classical", composer: "Composer A", year: 1791, tonic: "D", mode: "major" });
  const closing = await addScore(client, { title: "Test Closing" });
  const early = await addScore(client, { title: "Test Early", year: 1584 });
  for (const date of PAST_SUNDAYS) {
    await linkOn(db, date, "communion", classical);
    const slot = await linkOn(db, date, "recessional", closing);
    if (date === "2026-10-11") {
      const { error } = await client
        .from("mass_music_entries")
        .update({ not_played_at: new Date().toISOString() })
        .eq("mass_music_slot_id", slot.id)
        .eq("owned_score_id", closing);
      if (error) throw error;
    }
  }
  await linkOn(db, "2026-10-25", "communion", early);
  await linkOn(db, "2026-11-01", "communion", early);

  const all = await db.searchScores({});
  assert.equal(all.length, 3);
  assert.equal(all[0].total_count, 3);
  assert.ok(all.every((row) => row.file_count >= 1 && row.first_file_path));

  const communion = await db.searchScores({ role_ids: [role("communion").id] });
  assert.deepEqual(communion.map((row) => row.title).sort(), ["Test Classical", "Test Early"]);
  assert.ok(communion.every((row) => row.within_count >= 1));

  const first = all.find((row) => row.title === "Test Classical");
  assert.equal(first.period_code, "classical");
  const history = await db.scorePerformances(classical);
  assert.equal(history.length, 5);
  assert.ok(history.every((row) => row.local_date < TODAY));

  // five past Sundays, one of them marked "Not played"
  assert.equal(all.find((row) => row.title === "Test Closing").all_count, 4);
  // the link on a future date does not count yet
  assert.equal(all.find((row) => row.title === "Test Early").all_count, 1);

  const byKey = await db.searchScores({ keys: [{ tonic: "D", mode: "major" }] });
  assert.deepEqual(byKey.map((row) => row.title), ["Test Classical"]);
  const sorted = await db.searchScores({}, { sort: "period" });
  assert.equal(sorted[0].period_code, "renaissance");

  const rows = await db.searchHistory({ seasons: ["ordinary"] });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].local_date >= row.local_date));
});

test("linked Scores and Music Parts are protected like in the database", async () => {
  const { client, db } = await setup();
  await linkOn(db, "2026-10-25", "communion", await addScore(client, { title: "Test Linked" }));
  const [mass] = await db.massesOn("2026-10-25");
  const detail = await db.mass(mass.id);
  const slots = detail.mass_music_slots;
  await assert.rejects(db.saveSlots(mass.id, [], slots), { code: "slot_has_entries" });

  const linkedScore = slots.flatMap((slot) => slot.mass_music_entries)[0].owned_scores;
  await assert.rejects(db.deleteScore(linkedScore), { code: "23503" });

  await db.deleteMass(mass.id);
  assert.equal(await db.mass(mass.id), null);
  const usage = await db.scoreUsage(linkedScore.id);
  assert.ok(usage.every((entry) => entry.mass_music_slots?.mass_events?.id !== mass.id));
});

test("the same place name twice gives back the first place", async () => {
  const { db } = await setup();
  const again = await db.createVenue("  main church ");
  assert.equal(again.name, "Main Church");
  assert.equal((await db.venues()).length, 2);
});

test("uploading a Score stores the file in the tab and lists it", async () => {
  const { client, db } = await setup();
  const scoreId = crypto.randomUUID();
  const pdf = new Blob(["%PDF-1.4 demo"], { type: "application/pdf" });
  await uploadPreparedScore(client, DEMO_USER_ID, {
    scoreId,
    fileId: crypto.randomUUID(),
    thumbId: crypto.randomUUID(),
    pdf,
    pdfName: "Mine.pdf",
    thumb: null,
    title: "My own Score",
    composerName: ""
  });
  const scores = await db.readyScores();
  const mine = scores.find((score) => score.id === scoreId);
  assert.equal(mine.title, "My own Score");
  assert.equal(mine.score_files.length, 1);
  const blob = await db.download(mine.score_files[0].storage_path);
  assert.equal(await blob.text(), "%PDF-1.4 demo");
  await db.deleteScore(mine);
  await assert.rejects(db.download(mine.score_files[0].storage_path));
});

test("a Recurring Missa writes its dates and skips deleted ones", async () => {
  const { db } = await setup();
  const [layout] = await db.layouts();
  const created = await db.createSeries({
    title: "Evening",
    start_time: "18:00",
    venue_name: null,
    layout_id: layout.id,
    weekday: 6,
    interval_weeks: 1,
    starts_on: TODAY,
    ends_on: shiftIso(TODAY, 20)
  });
  await db.ensureOccurrences(TODAY, shiftIso(TODAY, 30));
  const masses = await db.seriesMasses(created.id);
  assert.equal(masses.length, 3);
  assert.equal(masses[0].start_time, "18:00:00");
  await db.forgetOccurrences(created.id, [masses[0]]);
  await db.ensureOccurrences(TODAY, shiftIso(TODAY, 30));
  assert.equal((await db.seriesMasses(created.id)).length, 2);
});

test("Search view settings are saved once per member", async () => {
  const { state, db } = await setup();
  await db.saveSearchView({ sort: "composer" });
  await db.saveSearchView({ sort: "title" });
  assert.equal(state.tables.saved_views.length, 1);
  assert.deepEqual(await db.searchView(), { sort: "title" });
});
