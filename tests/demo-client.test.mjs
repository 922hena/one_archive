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
  const samples = await seedDemo({ client, db, today: TODAY });
  client.addStoredPaths(Object.keys(samples));
  return { state, client, db, samples, changes: () => changes };
}

const role = (code) => DEMO_ROLES.find((item) => item.code === code);

test("the sample data reads back through db.js", async () => {
  const { state, db, samples, changes } = await setup();
  assert.ok(changes() > 0);
  assert.equal(state.tables.user_mass_layouts.length, 2);
  assert.equal((await db.venues()).length, 2);
  const scores = await db.readyScores();
  assert.equal(scores.length, 12);
  assert.ok(scores.every((score) => score.score_files.length >= 1));
  assert.equal(Object.keys(samples).length, state.tables.score_files.length);
  assert.equal(state.objects.length, state.tables.score_files.length);

  // Sundays 09-27 .. 11-15 plus the weekday Missa on 11-04
  assert.equal(state.tables.mass_events.length, 9);
  const onSunday = await db.massesOn("2026-11-01");
  assert.equal(onSunday.length, 1);
  const mass = await db.mass(onSunday[0].id);
  assert.equal(mass.observance.name_en, "Solemnity of All Saints");
  assert.equal(mass.mass_music_slots.length, 11);
  const linked = mass.mass_music_slots.flatMap((slot) => slot.mass_music_entries);
  assert.equal(linked.length, 4);
  assert.ok(linked.every((entry) => entry.owned_scores?.score_files?.length));

  const layouts = await db.layouts();
  assert.deepEqual(layouts.map((layout) => layout.name), ["Sunday", "Weekday"]);
});

test("played songs and Search follow the database rules", async () => {
  const { db } = await setup();
  const all = await db.searchScores({});
  assert.equal(all.length, 12);
  assert.equal(all[0].total_count, 12);
  assert.ok(all.every((row) => row.file_count >= 1 && row.first_file_path));

  const communion = await db.searchScores({ role_ids: [role("communion").id] });
  assert.ok(communion.length >= 2);
  assert.ok(communion.every((row) => row.within_count >= 1));

  const mozart = all.find((row) => row.title.startsWith("Ave verum"));
  assert.equal(mozart.period_code, "classical");
  const history = await db.scorePerformances(mozart.score_id);
  assert.ok(history.length >= 1);
  assert.ok(history.every((row) => row.local_date < TODAY));

  // five past Sundays; the recessional two weeks ago is marked "Not played"
  const salve = all.find((row) => row.title === "Salve Regina");
  assert.equal(salve.all_count, 4);

  const byKey = await db.searchScores({ keys: [{ tonic: "D", mode: "major" }] });
  assert.deepEqual(byKey.map((row) => row.title), ["Ave verum corpus, KV 618"]);
  const sorted = await db.searchScores({}, { sort: "period" });
  assert.equal(sorted[0].period_code, "renaissance");

  const rows = await db.searchHistory({ seasons: ["ordinary"] });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].local_date >= row.local_date));
});

test("linked Scores and Music Parts are protected like in the database", async () => {
  const { db } = await setup();
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
