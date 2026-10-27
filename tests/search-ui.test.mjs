import test from "node:test";
import assert from "node:assert/strict";
import { countsAsPlayed, entryPlayed, playedEntries } from "../js/played.js";
import { formatDuration, isWebLink, parseDuration, parseKeyText, periodForYear, scorePeriod, tonicLabel } from "../js/score-meta.js";
import {
  clearFilter,
  countSummary,
  emptySearch,
  hasContext,
  isFilterActive,
  normalizeViewConfig,
  parseCount,
  parseSearchQuery,
  searchFilters,
  searchKey,
  searchQuery
} from "../js/search-state.js";

const PERIODS = [
  { code: "renaissance", start_year: 1450, end_year: 1601, sort_order: 1 },
  { code: "baroque", start_year: 1601, end_year: 1751, sort_order: 2 },
  { code: "classical", start_year: 1751, end_year: 1801, sort_order: 3 },
  { code: "romantic", start_year: 1801, end_year: 1901, sort_order: 4 },
  { code: "modern", start_year: 1901, end_year: null, sort_order: 5 }
];

test("D1: songs count as played only from the day after a Missa that was not cancelled", () => {
  const today = "2026-10-22";
  const entries = [{ id: "a" }, { id: "b", not_played_at: "2026-10-21T10:00:00Z" }];
  const mass = (local_date, status = "planned") => ({ local_date, status, mass_music_slots: [{ mass_music_entries: entries }] });
  assert.equal(countsAsPlayed(mass("2026-10-21"), today), true);
  assert.equal(countsAsPlayed(mass("2026-10-22"), today), false, "today is not played yet");
  assert.equal(countsAsPlayed(mass("2026-10-23"), today), false);
  assert.equal(countsAsPlayed(mass("2026-10-21", "cancelled"), today), false);
  assert.equal(countsAsPlayed(mass("2026-10-21", "completed"), today), true);
  assert.deepEqual(playedEntries(mass("2026-10-21"), today).map((entry) => entry.id), ["a"]);
  assert.deepEqual(playedEntries(mass("2026-10-25"), today), []);
  assert.equal(entryPlayed(mass("2026-10-21"), entries[1], today), false, "marked Not played");
});

test("written keys suggest the standard key in several languages", () => {
  const cases = {
    "D-Dur": ["D", "major"],
    "d-Moll": ["D", "minor"],
    "Es-Dur": ["Eb", "major"],
    "fis-moll": ["F#", "minor"],
    "B-Dur": ["Bb", "major"],
    "H-Moll": ["B", "minor"],
    "ré majeur": ["D", "major"],
    "si bémol mineur": ["Bb", "minor"],
    "fa diesis minore": ["F#", "minor"],
    "라장조": ["D", "major"],
    "내림나장조": ["Bb", "major"],
    "올림바단조": ["F#", "minor"],
    "B-flat major": ["Bb", "major"],
    "C sharp minor": ["C#", "minor"],
    "Eb major": ["Eb", "major"],
    "b minor": ["B", "minor"],
    "F# min": ["F#", "minor"]
  };
  for (const [text, [tonic, mode]] of Object.entries(cases)) {
    assert.deepEqual(parseKeyText(text), { tonic, mode }, text);
  }
  assert.equal(parseKeyText("Dorian"), null);
  assert.equal(parseKeyText(""), null);
  assert.equal(tonicLabel("Bb"), "B♭");
  assert.equal(tonicLabel("F#"), "F♯");
  assert.equal(tonicLabel("Cb"), "C♭");
});

test("period: member choice, then composition year, then provisional composer period", () => {
  assert.equal(periodForYear(1600, PERIODS), "renaissance");
  assert.equal(periodForYear(1601, PERIODS), "baroque");
  assert.equal(periodForYear(1750, PERIODS), "baroque");
  assert.equal(periodForYear(1801, PERIODS), "romantic");
  assert.equal(periodForYear(2020, PERIODS), "modern");
  assert.equal(periodForYear(1200, PERIODS), null);
  assert.deepEqual(scorePeriod({ period_code: "modern", composition_year: 1700 }, PERIODS), { code: "modern", provisional: false });
  assert.deepEqual(scorePeriod({ composition_year: 1700 }, PERIODS, "romantic"), { code: "baroque", provisional: false });
  assert.deepEqual(scorePeriod({}, PERIODS, "romantic"), { code: "romantic", provisional: true });
  assert.deepEqual(scorePeriod({}, PERIODS), { code: null, provisional: false });
});

test("Score information: duration and link follow the database limits", () => {
  assert.deepEqual(parseDuration(""), { ok: true, value: null });
  assert.deepEqual(parseDuration("4:30"), { ok: true, value: 270 });
  assert.deepEqual(parseDuration(" 12 "), { ok: true, value: 720 });
  assert.equal(parseDuration("4:75").ok, false);
  assert.equal(parseDuration("0").ok, false);
  assert.equal(parseDuration("601").ok, false, "at most 600 minutes");
  assert.equal(parseDuration("abc").ok, false);
  assert.equal(formatDuration(270), "4:30");
  assert.equal(formatDuration(null), "");
  assert.equal(isWebLink("https://imslp.org/wiki/Ave_verum_corpus"), true);
  assert.equal(isWebLink("http://example.org"), true);
  assert.equal(isWebLink("javascript:alert(1)"), false);
  assert.equal(isWebLink("www.example.org"), false);
  assert.equal(isWebLink("https://exa mple.org"), false);
});

test("count conditions are read safely", () => {
  assert.deepEqual(parseCount("eq:0"), { op: "eq", value: 0 });
  assert.deepEqual(parseCount("gte:2"), { op: "gte", value: 2 });
  assert.deepEqual(parseCount("between:3:1"), { op: "between", min: 1, max: 3 });
  assert.equal(parseCount("eq:-1"), null);
  assert.equal(parseCount("eq:1.5"), null);
  assert.equal(parseCount("eq:"), null);
  assert.equal(parseCount("drop:1"), null);
  assert.equal(countSummary({ op: "gte", value: 2 }), "≥ 2");
  assert.equal(countSummary({ op: "between", min: 1, max: 3 }), "1–3");
});

test("search address round trip keeps every condition, sort and view", () => {
  const venue = "11111111-1111-4111-8111-111111111111";
  const role = "22222222-2222-4222-8222-222222222222";
  const state = {
    ...emptySearch(),
    q: "Toccata",
    seasons: ["lent"],
    observances: ["Palm Sunday of the Passion of the Lord", "Name, with comma"],
    yearFrom: 2024,
    yearTo: 2025,
    months: [3, 4],
    dateFrom: "2025-03-01",
    dateTo: "2025-04-30",
    composers: ["Widor"],
    periods: ["romantic"],
    provisional: false,
    keys: [{ tonic: "F", mode: "major" }, { tonic: "D", mode: null }],
    venues: [venue],
    parts: [role],
    count: { op: "eq", value: 1 },
    extra: { scope: "venue", venues: [venue], cond: { op: "gte", value: 2 } },
    files: "without",
    sort: "count",
    desc: true,
    view: "notes"
  };
  const back = parseSearchQuery(searchQuery(state));
  assert.deepEqual(back, state);
  assert.equal(searchQuery(emptySearch()), "");
  assert.equal(parseSearchQuery("t=history&ord=asc").target, "history");
  assert.equal(parseSearchQuery("t=history&ord=asc").oldest, true);
});

test("unsafe or unknown address values are dropped", () => {
  const state = parseSearchQuery("s=lent,hacker&v=not-a-uuid&r=1&m=0,13,3&k=H:major&k=D:weird&sort=drop&view=x&n=gte:abc");
  assert.deepEqual(state.seasons, ["lent"]);
  assert.deepEqual(state.venues, []);
  assert.deepEqual(state.parts, []);
  assert.deepEqual(state.months, [3]);
  assert.deepEqual(state.keys, []);
  assert.equal(state.sort, null);
  assert.equal(state.view, null);
  assert.equal(state.count, null);
  assert.equal(parseSearchQuery("f=pdf-only").files, null);
});

test("the score file filter goes to Scores search only and clears on its own", () => {
  const state = { ...emptySearch(), files: "without", composers: ["Bach"] };
  assert.equal(isFilterActive(state, "files"), true);
  assert.equal(searchFilters(state).files, "without");
  assert.equal(searchFilters({ ...state, target: "history" }).files, undefined);
  assert.equal(hasContext(state), false, "file presence is not Missa context");
  const next = clearFilter(state, "files");
  assert.equal(next.files, null);
  assert.deepEqual(next.composers, ["Bach"]);
  assert.equal(searchFilters(emptySearch()).files, undefined);
});

test("filters sent to the database follow the same-record rule and skip counts for History", () => {
  const state = {
    ...emptySearch(),
    q: "  Dvořák ",
    seasons: ["lent"],
    parts: ["22222222-2222-4222-8222-222222222222"],
    count: { op: "eq", value: 0 },
    extra: { scope: "all", venues: [], cond: { op: "gte", value: 1 } }
  };
  assert.equal(hasContext(state), true);
  assert.deepEqual(searchFilters(state), {
    q: "Dvořák",
    q_key: "dvorak",
    seasons: ["lent"],
    role_ids: ["22222222-2222-4222-8222-222222222222"],
    count: { op: "eq", value: 0 },
    extra_count: { scope: "all", op: "gte", value: 1 }
  });
  const history = searchFilters({ ...state, target: "history" });
  assert.equal(history.count, undefined);
  assert.equal(history.extra_count, undefined);
  assert.equal(hasContext({ ...emptySearch(), composers: ["Bach"] }), false, "score filters are not Missa context");
  assert.equal(searchKey("바흐"), "바흐", "Hangul stays composed");
  assert.equal(searchKey("Fauré"), "faure");
});

test("clearing one filter keeps the others", () => {
  const state = { ...emptySearch(), seasons: ["lent"], composers: ["Bach"], sort: "count", view: "preview" };
  assert.equal(isFilterActive(state, "liturgy"), true);
  const next = clearFilter(state, "liturgy");
  assert.deepEqual(next.seasons, []);
  assert.deepEqual(next.composers, ["Bach"]);
  assert.equal(next.sort, "count");
  assert.equal(next.view, "preview");
  assert.equal(isFilterActive(next, "liturgy"), false);
});

test("saved filter settings are cleaned and completed", () => {
  const config = normalizeViewConfig({ filters: ["part", "bogus", "date"], hidden: ["key", "nope"], sort: "key", desc: true, view: "preview" });
  assert.deepEqual(config.filters, ["part", "date", "liturgy", "composer", "period", "count", "key", "venue", "files"]);
  assert.deepEqual(config.hidden, ["key"]);
  assert.equal(config.sort, "key");
  assert.equal(config.desc, true);
  assert.equal(config.view, "preview");
  assert.deepEqual(normalizeViewConfig(null).filters.length, 9);
  assert.equal(normalizeViewConfig({ sort: "x" }).sort, "title");
});
