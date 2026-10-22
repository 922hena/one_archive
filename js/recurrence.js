import { parseIsoDate, toIsoDate, weekdayIndex } from "./format.js";

export function shiftIso(iso, days) {
  return addUtcDays(iso, days);
}

function addUtcDays(iso, days) {
  const parts = parseIsoDate(iso);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function firstOccurrenceOn(startsOn, weekday) {
  const startWeekday = weekdayIndex(startsOn);
  if (startWeekday < 0 || weekday < 0 || weekday > 6) return null;
  return addUtcDays(startsOn, (Number(weekday) - startWeekday + 7) % 7);
}

// Dates of a Recurring Mass inside [from, to], inclusive.
// interval_weeks 1 = every week, 2 = every other week from the first matching weekday on or after starts_on.
export function occurrenceDates(series, from, to) {
  const weekday = Number(series?.weekday);
  const interval = Number(series?.interval_weeks) || 1;
  const startsOn = series?.starts_on;
  const endsOn = series?.ends_on || null;
  if (!parseIsoDate(startsOn) || !parseIsoDate(from) || !parseIsoDate(to)) return [];
  if (weekday < 0 || weekday > 6 || (interval !== 1 && interval !== 2)) return [];

  let cursor = firstOccurrenceOn(startsOn, weekday);
  if (!cursor) return [];

  const dates = [];
  while (cursor && cursor <= to) {
    if (cursor >= from && cursor >= startsOn && (!endsOn || cursor <= endsOn)) dates.push(cursor);
    cursor = addUtcDays(cursor, 7 * interval);
  }
  return dates;
}

export function weeksAheadRange(startsOn, weeks = 16) {
  const end = addUtcDays(startsOn, 7 * weeks);
  return { from: startsOn, to: end ?? startsOn };
}

export const OCCURRENCE_HORIZON_DAYS = 365;

// Recurring Masses are written at most this far ahead; browsing later months creates nothing.
export function occurrenceWindow(from, to, today, days = OCCURRENCE_HORIZON_DAYS) {
  const limit = addUtcDays(today, days);
  if (!limit || !parseIsoDate(from) || !parseIsoDate(to)) return null;
  const end = to < limit ? to : limit;
  return from <= end ? { from, to: end } : null;
}

// Liturgy is filled in later only for upcoming dates the member never edited.
export function needsLiturgyRefresh(row, today) {
  return sourceKey(row?.liturgy_source) === "unknown" && !row?.series_locked && String(row?.local_date ?? "") >= today;
}

export function offWeekday(rows, weekday) {
  return rows.filter((row) => weekdayIndex(row.local_date) !== Number(weekday));
}

// Plain rows start selected; careful rows (linked Score or edited by hand) are picked one by one;
// played rows (past Missae with played songs, decision D1) are picked one by one after a warning;
// recorded rows have a performance record and the database refuses to delete them.
export function deletionGroups(rows) {
  const groups = { plain: [], careful: [], played: [], recorded: [] };
  for (const row of rows) {
    if (row.recorded) groups.recorded.push(row);
    else if (row.played > 0) groups.played.push(row);
    else if (row.linked || row.series_locked) groups.careful.push(row);
    else groups.plain.push(row);
  }
  return groups;
}

export function liturgyFields(observance) {
  if (!observance) {
    return {
      observance_id: null,
      celebration_name: null,
      color_code: null,
      season_code: null,
      liturgy_source: "unknown"
    };
  }
  return {
    observance_id: observance.id,
    celebration_name: observance.name_ko,
    color_code: observance.color_code,
    season_code: observance.season_code ?? null,
    liturgy_source: "official"
  };
}

export function sourceKey(source) {
  if (source === "official" || source === "user" || source === "unknown") return source;
  return "unknown";
}
