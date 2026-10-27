import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../js/db.js";
import { createDemoClient } from "../js/demo-client.js";
import { DEMO_ROLES, DEMO_USER_ID, demoReference, seedDemo, seedDemoScores, staffPaperPdf } from "../js/demo-seed.js";
import { uploadPreparedScore } from "../js/upload-prepared.js";
import { attachPreparedFile } from "../js/upload-attach.js";
import { setlistFromMass } from "../js/performance.js";
import { shiftIso } from "../js/recurrence.js";

const TODAY = "2026-10-28"; // a Wednesday

async function setup(today = TODAY) {
  const state = { tables: {}, objects: [] };
  let changes = 0;
  const client = createDemoClient({
    userId: DEMO_USER_ID,
    state,
    reference: demoReference(),
    onChange: () => (changes += 1),
    today: () => today
  });
  const db = createDb(client);
  await seedDemo({ db, today });
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

test("demo sample Scores: staff-paper Ave verum corpus and information-only Missa de Angelis, played last Sunday", async () => {
  const { state, client, db } = await setup();
  await seedDemoScores({ db, client, today: TODAY });

  const scores = await db.readyScores();
  assert.equal(scores.length, 2);
  const aveVerum = scores.find((score) => score.title === "Ave verum corpus");
  const missa = scores.find((score) => score.title === "Missa de Angelis");
  assert.equal(aveVerum.composer_name, "Wolfgang Amadeus Mozart");
  assert.equal(aveVerum.score_files.length, 1);
  assert.equal(aveVerum.score_files[0].mime_type, "application/pdf");
  assert.equal(missa.composer_name, null);
  assert.deepEqual(missa.score_files, []);
  assert.equal(state.objects.length, 1, "only the staff-paper PDF is stored");

  const pdf = await (await db.download(aveVerum.score_files[0].storage_path)).text();
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(pdf.includes("(Ave verum corpus) Tj"));
  assert.doesNotMatch(pdf, /Image|XObject/, "title and empty staves only");

  const [mass] = await db.massesOn("2026-10-25");
  const { mass_music_slots: slots } = await db.mass(mass.id);
  const linked = (code) => slots.find((slot) => slot.role_id === role(code).id).mass_music_entries.map((entry) => entry.owned_score_id);
  assert.deepEqual(linked("entrance"), [aveVerum.id]);
  assert.deepEqual(linked("kyrie"), [missa.id]);
  assert.equal((await db.scorePerformances(aveVerum.id)).length, 1);
  assert.equal((await db.scorePerformances(missa.id)).length, 1);
  assert.deepEqual((await db.searchScores({ files: "without" })).map((row) => row.score_id), [missa.id]);

  // On a Sunday the samples go to the Sunday before, so they still count as played.
  const sunday = await setup("2026-10-25");
  await seedDemoScores({ db: sunday.db, client: sunday.client, today: "2026-10-25" });
  for (const score of await sunday.db.readyScores()) {
    assert.equal((await sunday.db.scorePerformances(score.id)).length, 1);
  }
});

test("staffPaperPdf writes a well-formed one-page PDF", async () => {
  const pdf = await staffPaperPdf("A (b) \\ c").text();
  assert.ok(pdf.includes("(A \\(b\\) \\\\ c) Tj"), "brackets and backslashes are escaped");
  const xrefAt = Number(pdf.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  assert.ok(pdf.startsWith("xref\n", xrefAt));
  const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((offset, index) => assert.ok(pdf.startsWith(`${index + 1} 0 obj\n`, offset), `object ${index + 1}`));
  const length = Number(pdf.match(/\/Length (\d+) >>\nstream\n/)[1]);
  const start = pdf.indexOf("stream\n") + "stream\n".length;
  assert.equal(pdf.indexOf("endstream", start), start + length);
  assert.equal(pdf.match(/ l\n/g).length, 50, "ten staves of five lines");
  assert.ok(pdf.includes("/Count 1"));
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

test("Save Score Information Only: a Score with no file is listed, searched, linked and counted", async () => {
  const { state, client, db } = await setup();
  const withFile = await addScore(client, { title: "Test With File" });
  await assert.rejects(db.createInfoScore({ title: "   " }), { code: "title_required" });

  const titleOnly = await db.createInfoScore({ title: "Title Only" });
  const infoId = await db.createInfoScore({
    title: " Ave verum corpus ",
    composer_name: "Wolfgang Amadeus Mozart",
    publisher: "Carus",
    edition: "Urtext",
    scorebook: "Choir book 2",
    scorebook_page: "23",
    physical_location: "Choir cabinet, binder 3",
    external_url: "https://imslp.org/wiki/Ave_verum_corpus,_K.618_(Mozart,_Wolfgang_Amadeus)",
    duration_seconds: 180,
    difficulty: 2,
    note: "  ",
    period_code: "classical"
  });
  assert.equal(state.objects.length, 1, "only the uploaded Score has a stored file");

  const scores = await db.readyScores();
  const info = scores.find((score) => score.id === infoId);
  assert.deepEqual(info.score_files, []);
  assert.equal(info.title, "Ave verum corpus");
  assert.equal(info.provisional_title, "Ave verum corpus");
  assert.equal(info.physical_location, "Choir cabinet, binder 3");
  assert.equal(info.scorebook_page, "23");
  assert.equal(info.duration_seconds, 180);
  assert.equal(info.difficulty, 2);
  assert.equal(info.note, null, "a blank note is not stored");
  assert.equal(scores.find((score) => score.id === titleOnly).composer_name, null);

  const all = await db.searchScores({});
  assert.equal(all.length, 3);
  const infoRow = all.find((row) => row.score_id === infoId);
  assert.equal(infoRow.file_count, 0);
  assert.equal(infoRow.first_file_path, null);
  const without = await db.searchScores({ files: "without" });
  assert.deepEqual(without.map((row) => row.score_id).sort(), [infoId, titleOnly].sort());
  const withFiles = await db.searchScores({ files: "with" });
  assert.deepEqual(withFiles.map((row) => row.score_id), [withFile], "a PDF search never lists Information Only");
  assert.deepEqual((await db.searchScores({ q: "binder 3" })).map((row) => row.score_id), [infoId]);
  assert.deepEqual((await db.searchScores({ q: "carus" })).map((row) => row.score_id), [infoId]);
  assert.deepEqual((await db.searchScores({ periods: ["classical"], files: "without" })).map((row) => row.score_id), [infoId]);

  // Linked on past Sundays (played) and a future date (planned only): same rules as Scores with a file.
  for (const date of ["2026-10-18", "2026-10-25"]) await linkOn(db, date, "communion", infoId);
  await linkOn(db, "2026-11-01", "communion", infoId);
  await linkOn(db, "2026-10-25", "offertory", withFile);
  assert.equal((await db.scorePerformances(infoId)).length, 2);
  const communion = await db.searchScores({ role_ids: [role("communion").id], files: "without" });
  assert.deepEqual(communion.map((row) => [row.score_id, row.within_count]), [[infoId, 2]]);
  assert.equal((await db.scoreUsage(infoId)).length, 3);

  const [mass] = await db.massesOn("2026-10-25");
  const detail = await db.mass(mass.id);
  const entries = detail.mass_music_slots.flatMap((slot) => slot.mass_music_entries);
  assert.deepEqual(entries.find((entry) => entry.owned_score_id === infoId).owned_scores.score_files, []);
  const songs = setlistFromMass(detail, DEMO_ROLES);
  assert.deepEqual(songs.map((song) => song.score.id), [withFile], "Performance Mode only shows Scores with pages");

  await assert.rejects(db.deleteScore(info), { code: "23503" }, "a linked Score stays protected");
  const unlinked = scores.find((score) => score.id === titleOnly);
  await db.deleteScore(unlinked);
  assert.equal(await db.score(titleOnly), null);
});

test("Attach Score File keeps the id, first-saved time, links, notes and history", async () => {
  const { state, client, db } = await setup();
  const scoreId = await db.createInfoScore({ title: "Panis angelicus", composer_name: "César Franck", note: "Paper copy only" });
  await linkOn(db, "2026-10-18", "communion", scoreId);
  const before = await db.score(scoreId);
  const history = await db.scorePerformances(scoreId);
  assert.equal(history.length, 1);

  const prepared = {
    fileId: crypto.randomUUID(),
    thumbId: crypto.randomUUID(),
    pdf: new Blob(["%PDF-1.4 attach"], { type: "application/pdf" }),
    pdfName: "Panis angelicus.pdf",
    thumb: { blob: new Blob(["thumb"], { type: "image/webp" }), ext: "webp", mime: "image/webp" }
  };
  await attachPreparedFile(client, DEMO_USER_ID, scoreId, prepared);
  const after = await db.score(scoreId);
  assert.equal(after.id, before.id);
  assert.equal(after.created_at, before.created_at);
  assert.equal(after.title, "Panis angelicus");
  assert.equal(after.composer_name, "César Franck");
  assert.equal(after.note, "Paper copy only");
  assert.equal(after.provisional_title, "Panis angelicus.pdf");
  assert.equal(after.score_files.length, 1);
  assert.equal(after.score_files[0].storage_path, `${DEMO_USER_ID}/${scoreId}/${prepared.fileId}.pdf`);
  assert.ok(after.thumbnail_path?.endsWith(`thumb-${prepared.thumbId}.webp`));
  assert.equal(await (await db.download(after.score_files[0].storage_path)).text(), "%PDF-1.4 attach");
  assert.deepEqual(await db.scorePerformances(scoreId), history);
  assert.equal((await db.scoreUsage(scoreId)).length, 1);
  assert.equal((await db.readyScores()).length, 1, "no second Score was made");
  assert.deepEqual((await db.searchScores({ files: "with" })).map((row) => row.score_id), [scoreId]);

  // The same try again (answer lost) changes nothing; a different file is refused.
  await attachPreparedFile(client, DEMO_USER_ID, scoreId, prepared);
  assert.equal((await db.score(scoreId)).score_files.length, 1);
  await assert.rejects(attachPreparedFile(client, DEMO_USER_ID, scoreId, { ...prepared, fileId: crypto.randomUUID() }), {
    code: "has_files"
  });
  assert.equal(state.objects.length, 2, "one PDF and one thumbnail");
});

test("Edit saves the new Score information and keeps the first-saved time", async () => {
  const { client, db } = await setup();
  const scoreId = await addScore(client, { title: "Test Uploaded" });
  const before = await db.score(scoreId);
  await db.updateScore(scoreId, {
    title: before.title,
    composer_name: before.composer_name,
    physical_location: "  Shelf A  ",
    publisher: "",
    difficulty: 4
  });
  const after = await db.score(scoreId);
  assert.equal(after.physical_location, "Shelf A");
  assert.equal(after.publisher, null);
  assert.equal(after.difficulty, 4);
  assert.equal(after.created_at, before.created_at);
  assert.equal(after.score_files.length, 1, "the uploaded file is untouched");
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
