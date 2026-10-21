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
