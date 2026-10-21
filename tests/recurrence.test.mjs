import test from "node:test";
import assert from "node:assert/strict";
import { firstOccurrenceOn, liturgyFields, occurrenceDates, sourceKey, weeksAheadRange } from "../js/recurrence.js";

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
