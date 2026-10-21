import test from "node:test";
import assert from "node:assert/strict";
import {
  deletionGroups,
  firstOccurrenceOn,
  liturgyFields,
  needsLiturgyRefresh,
  occurrenceDates,
  occurrenceWindow,
  offWeekday,
  sourceKey,
  weeksAheadRange
} from "../js/recurrence.js";
import { isMissingRelation } from "../js/errors.js";

test("weekly Sundays from 2026-10-25 include the next Sunday", () => {
  const series = { weekday: 0, interval_weeks: 1, starts_on: "2026-10-25" };
  assert.deepEqual(occurrenceDates(series, "2026-10-25", "2026-11-08"), [
    "2026-10-25",
    "2026-11-01",
    "2026-11-08"
  ]);
});

test("every other week skips the in-between Sunday", () => {
  const series = { weekday: 0, interval_weeks: 2, starts_on: "2026-10-25" };
  assert.deepEqual(occurrenceDates(series, "2026-10-25", "2026-11-15"), [
    "2026-10-25",
    "2026-11-08"
  ]);
});

test("weekday can differ from starts_on and nothing is created before starts_on", () => {
  assert.equal(firstOccurrenceOn("2026-10-21", 0), "2026-10-25");
  const series = { weekday: 0, interval_weeks: 1, starts_on: "2026-10-21" };
  assert.deepEqual(occurrenceDates(series, "2026-10-01", "2026-10-24"), []);
  assert.deepEqual(occurrenceDates(series, "2026-10-01", "2026-11-01"), ["2026-10-25", "2026-11-01"]);
});

test("ends_on stops future dates", () => {
  const series = { weekday: 4, interval_weeks: 1, starts_on: "2026-10-22", ends_on: "2026-10-29" };
  assert.deepEqual(occurrenceDates(series, "2026-10-22", "2026-11-12"), ["2026-10-22", "2026-10-29"]);
});

test("liturgy fields stay unknown when the calendar has no row", () => {
  assert.deepEqual(liturgyFields(null), {
    observance_id: null,
    celebration_name: null,
    color_code: null,
    season_code: null,
    liturgy_source: "unknown"
  });
  assert.equal(sourceKey(null), "unknown");
  assert.equal(sourceKey("official"), "official");
});

test("weeksAheadRange covers the next Sunday used in the acceptance test", () => {
  const range = weeksAheadRange("2026-10-25", 16);
  assert.equal(range.from, "2026-10-25");
  assert.ok(range.to >= "2026-11-01");
});

test("Masses are created at most one year ahead", () => {
  const today = "2026-10-21";
  assert.deepEqual(occurrenceWindow("2026-10-01", "2026-11-07", today), { from: "2026-10-01", to: "2026-11-07" });
  assert.deepEqual(occurrenceWindow("2027-09-26", "2027-11-06", today), { from: "2027-09-26", to: "2027-10-21" });
  assert.equal(occurrenceWindow("2030-11-01", "2030-12-31", today), null);
  assert.equal(occurrenceWindow("bad", "2026-12-31", today), null);
});

test("unknown liturgy is filled in only for upcoming dates nobody edited", () => {
  const today = "2026-10-21";
  const row = { local_date: "2027-01-03", liturgy_source: "unknown", series_locked: false };
  assert.equal(needsLiturgyRefresh(row, today), true);
  assert.equal(needsLiturgyRefresh({ ...row, series_locked: true }, today), false);
  assert.equal(needsLiturgyRefresh({ ...row, liturgy_source: "user" }, today), false);
  assert.equal(needsLiturgyRefresh({ ...row, liturgy_source: "official" }, today), false);
  assert.equal(needsLiturgyRefresh({ ...row, local_date: "2026-10-18" }, today), false);
  assert.equal(needsLiturgyRefresh({ ...row, local_date: today }, today), true);
});

test("after moving Sunday to Saturday only the old Sundays are offered for removal", () => {
  const rows = [
    { id: "sun1", local_date: "2026-11-01" },
    { id: "sat1", local_date: "2026-11-07" },
    { id: "sun2", local_date: "2026-11-08" },
    { id: "sat2", local_date: "2026-11-14" }
  ];
  assert.deepEqual(offWeekday(rows, 6).map((row) => row.id), ["sun1", "sun2"]);
  assert.equal(firstOccurrenceOn("2026-11-01", 6), "2026-11-07");
});

test("a new weekday starts from the edit date, so past weeks are not filled in", () => {
  const moved = { weekday: 6, interval_weeks: 1, starts_on: "2026-11-01" };
  assert.deepEqual(occurrenceDates(moved, "2026-10-01", "2026-11-15"), ["2026-11-07", "2026-11-14"]);
});

test("deletion groups: plain pre-selected, linked or edited chosen one by one, recorded never deleted", () => {
  const groups = deletionGroups([
    { id: "a", linked: false, series_locked: false, recorded: false },
    { id: "b", linked: true, series_locked: false, recorded: false },
    { id: "c", linked: false, series_locked: true, recorded: false },
    { id: "d", linked: true, series_locked: false, recorded: true }
  ]);
  assert.deepEqual(groups.plain.map((row) => row.id), ["a"]);
  assert.deepEqual(groups.careful.map((row) => row.id), ["b", "c"]);
  assert.deepEqual(groups.recorded.map((row) => row.id), ["d"]);
});

test("isMissingRelation matches missing-table codes only, not a message that mentions mass_series", () => {
  assert.equal(isMissingRelation({ code: "PGRST205" }), true);
  assert.equal(isMissingRelation({ code: "42P01" }), true);
  assert.equal(isMissingRelation({ code: "23505", message: "duplicate key on mass_series" }), false);
  assert.equal(isMissingRelation({ message: "Could not find the table 'public.mass_series' in the schema cache" }), false);
});
