// The search functions of the database (supabase/migrations/20261022150300_search_functions.sql and
// 20261023020000_score_pdf_thumbnail.sql), written again for the in-memory client so they can run on data in memory.
// read(table) returns the rows of one table. Keep the rules the same as the SQL.

const KEY_ORDER = ["Cb", "C", "C#", "Db", "D", "D#", "Eb", "E", "E#", "Fb", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B", "B#"];
const MODE_ORDER = ["major", "minor", "modal", "ambiguous", "atonal"];

function list(value) {
  return Array.isArray(value) && value.length ? value.map(String) : null;
}

function present(value) {
  return value !== undefined && value !== null;
}

function trimmed(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function yearOf(iso) {
  return Number(String(iso).slice(0, 4));
}

function monthOf(iso) {
  return Number(String(iso).slice(5, 7));
}

function byId(rows) {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function compareText(a, b) {
  return String(a).localeCompare(String(b));
}

// performed_entries: a linked Score on a past, not cancelled Missa that is not marked "Not played".
export function performedEntries(read, today) {
  const slots = byId(read("mass_music_slots"));
  const masses = byId(read("mass_events"));
  const venues = byId(read("user_venues"));
  const rows = [];
  for (const entry of read("mass_music_entries")) {
    const slot = slots.get(String(entry.mass_music_slot_id));
    const mass = slot && masses.get(String(slot.mass_event_id));
    if (!mass || mass.status === "cancelled" || entry.not_played_at || !(mass.local_date < today)) continue;
    const venue = mass.venue_id ? venues.get(String(mass.venue_id)) : null;
    rows.push({
      entry_id: entry.id,
      user_id: entry.user_id,
      owned_score_id: entry.owned_score_id,
      mass_event_id: mass.id,
      local_date: mass.local_date,
      start_time: mass.start_time ?? null,
      season_code: mass.season_code ?? null,
      observance_id: mass.observance_id ?? null,
      celebration_name: mass.celebration_name ?? null,
      role_id: slot.role_id,
      part_display_name: slot.display_name ?? null,
      venue_id: mass.venue_id ?? null,
      venue_label: venue?.name ?? trimmed(mass.venue_name),
      note: entry.note ?? null
    });
  }
  return rows;
}

export function searchEntries(read, filters = {}, today) {
  const seasons = list(filters.seasons);
  const observanceNames = list(filters.observance_names);
  const years = list(filters.years)?.map(Number) ?? null;
  const yearFrom = present(filters.year_from) ? Number(filters.year_from) : null;
  const yearTo = present(filters.year_to) ? Number(filters.year_to) : null;
  const months = list(filters.months)?.map(Number) ?? null;
  const dateFrom = filters.date_from ?? null;
  const dateTo = filters.date_to ?? null;
  const venueIds = list(filters.venue_ids);
  const roleIds = list(filters.role_ids);
  const observances = byId(read("liturgical_observances"));

  return performedEntries(read, today).filter((row) => {
    if (seasons && !seasons.includes(row.season_code)) return false;
    if (observanceNames) {
      const observance = row.observance_id ? observances.get(String(row.observance_id)) : null;
      const names = [observance?.name_en, observance?.name_ko, row.celebration_name];
      if (!names.some((name) => name != null && observanceNames.includes(name))) return false;
    }
    if (years || yearFrom !== null || yearTo !== null) {
      const year = yearOf(row.local_date);
      const inList = (years ?? []).includes(year);
      const inRange = (yearFrom !== null || yearTo !== null) && year >= (yearFrom ?? 1) && year <= (yearTo ?? 9999);
      if (!inList && !inRange) return false;
    }
    if (months && !months.includes(monthOf(row.local_date))) return false;
    if (dateFrom && row.local_date < dateFrom) return false;
    if (dateTo && row.local_date > dateTo) return false;
    if (venueIds && !venueIds.includes(String(row.venue_id))) return false;
    if (roleIds && !roleIds.includes(String(row.role_id))) return false;
    return true;
  });
}

function periodForYear(year, periods) {
  if (year == null) return null;
  const sorted = [...periods].sort((a, b) => a.sort_order - b.sort_order);
  return (
    sorted.find((period) => (period.start_year == null || year >= period.start_year) && (period.end_year == null || year < period.end_year))
      ?.code ?? null
  );
}

// Scores that match the score filters. The demo has no composer dictionary, so the label is the typed name.
export function searchPool(read, filters = {}) {
  const q = trimmed(filters.q)?.toLowerCase() ?? null;
  const composerNames = list(filters.composer_names)?.map((name) => name.trim().toLowerCase()) ?? null;
  const composerIds = list(filters.composer_ids);
  const periodsWanted = list(filters.periods);
  const includeProvisional = filters.include_provisional_period ?? true;
  const keys = Array.isArray(filters.keys) && filters.keys.length ? filters.keys : null;
  const periods = read("musical_periods");

  return read("owned_scores")
    .filter((score) => score.status === "ready")
    .map((score) => ({
      score_id: score.id,
      title: score.title ?? null,
      provisional_title: score.provisional_title,
      composer_id: score.composer_id ?? null,
      composer_name: score.composer_name ?? null,
      composer_label: trimmed(score.composer_name),
      period_code: score.period_code ?? periodForYear(score.composition_year, periods),
      period_provisional: false,
      key_tonic: score.key_tonic ?? null,
      key_mode: score.key_mode ?? null,
      key_text: score.key_text ?? null,
      note: score.note ?? null,
      created_at: score.created_at,
      text: [score.publisher, score.edition, score.scorebook, score.physical_location]
    }))
    .filter((score) => {
      if (q) {
        const fields = [score.title, score.provisional_title, score.composer_label, ...score.text].map((value) =>
          String(value ?? "").toLowerCase()
        );
        if (!fields.some((value) => value.includes(q))) return false;
      }
      if (composerIds || composerNames) {
        const byIdMatch = (composerIds ?? []).includes(String(score.composer_id));
        const byName =
          (composerNames ?? []).includes(String(score.composer_name ?? "").trim().toLowerCase()) ||
          (score.composer_label !== null && (composerNames ?? []).includes(score.composer_label.toLowerCase()));
        if (!byIdMatch && !byName) return false;
      }
      if (periodsWanted && !(periodsWanted.includes(score.period_code) && (includeProvisional || !score.period_provisional))) return false;
      if (keys && !keys.some((key) => key?.tonic === score.key_tonic && (key?.mode == null || key.mode === score.key_mode))) return false;
      return true;
    })
    .map(({ composer_name, text, ...score }) => score);
}

function countMet(n, cond) {
  switch (cond?.op) {
    case "eq":
      return n === Number(cond.value);
    case "gte":
      return n >= Number(cond.value);
    case "lte":
      return n <= Number(cond.value);
    case "between":
      return n >= Number(cond.min) && n <= Number(cond.max);
    default:
      return false;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function titleKey(row) {
  return (trimmed(row.title) ?? row.provisional_title ?? "").toLowerCase();
}

// Ascending comparison with empty values last, turned around for descending (empty values stay last).
function nullsLast(a, b, descending, compare) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const diff = compare(a, b);
  return descending ? -diff : diff;
}

function position(listed, value) {
  const index = listed.indexOf(value);
  return index === -1 ? null : index;
}

function clampPage(limit, offset, fallback, max) {
  const size = Math.min(Math.max(Number(limit ?? fallback) || fallback, 1), max);
  const start = Math.max(Number(offset ?? 0) || 0, 0);
  return [start, start + size];
}

export function searchScores(read, params = {}, today) {
  const filters = params.p_filters ?? {};
  const sort = params.p_sort ?? "title";
  const descending = Boolean(params.p_descending);
  const countCond = isObject(filters.count) ? filters.count : null;
  const extraCond = isObject(filters.extra_count) ? filters.extra_count : null;
  const extraVenues = list(extraCond?.venue_ids) ?? [];
  const files = ["with", "without"].includes(filters.files) ? filters.files : null;
  const hasContext = Boolean(
    list(filters.seasons) || list(filters.observance_names) || list(filters.years) ||
    present(filters.year_from) || present(filters.year_to) || list(filters.months) ||
    present(filters.date_from) || present(filters.date_to) || list(filters.venue_ids) || list(filters.role_ids)
  );

  const within = new Map();
  for (const entry of searchEntries(read, filters, today)) {
    const item = within.get(String(entry.owned_score_id)) ?? { n: 0, masses: new Set(), last: null };
    item.n += 1;
    item.masses.add(String(entry.mass_event_id));
    if (!item.last || entry.local_date > item.last) item.last = entry.local_date;
    within.set(String(entry.owned_score_id), item);
  }
  const allTime = new Map();
  const extra = new Map();
  for (const entry of performedEntries(read, today)) {
    const key = String(entry.owned_score_id);
    allTime.set(key, (allTime.get(key) ?? 0) + 1);
    if (extraCond && (extraCond.scope === "all" || (extraCond.scope === "venue" && extraVenues.includes(String(entry.venue_id))))) {
      extra.set(key, (extra.get(key) ?? 0) + 1);
    }
  }

  const scores = byId(read("owned_scores"));
  const pages = read("score_files").filter((file) => file.removed_at == null && (file.role ?? "page") === "page");
  const periodOrder = new Map(read("musical_periods").map((period) => [period.code, period.sort_order]));

  const matched = searchPool(read, filters)
    .map((score) => {
      const found = within.get(String(score.score_id));
      const own = pages
        .filter((file) => String(file.owned_score_id) === String(score.score_id))
        .sort((a, b) => a.page_no - b.page_no || compareText(a.created_at, b.created_at) || compareText(a.id, b.id));
      return {
        ...score,
        file_count: own.length,
        first_file_path: own[0]?.storage_path ?? null,
        first_file_mime: own[0]?.mime_type ?? null,
        thumbnail_path: scores.get(String(score.score_id))?.thumbnail_path ?? null,
        within_count: found?.n ?? 0,
        within_masses: found?.masses.size ?? 0,
        all_count: allTime.get(String(score.score_id)) ?? 0,
        extra_count: extraCond ? extra.get(String(score.score_id)) ?? 0 : null,
        last_performed: found?.last ?? null
      };
    })
    .filter((row) => {
      const counted = countCond ? countMet(row.within_count, countCond) : hasContext ? row.within_count >= 1 : true;
      const fileMatch = !files || (files === "with") === row.file_count > 0;
      return counted && (!extraCond || countMet(row.extra_count ?? 0, extraCond)) && fileMatch;
    });

  const primary = {
    title: (a, b) => (descending ? -1 : 1) * compareText(titleKey(a), titleKey(b)),
    composer: (a, b) => nullsLast(a.composer_label?.toLowerCase(), b.composer_label?.toLowerCase(), descending, compareText),
    period: (a, b) => nullsLast(periodOrder.get(a.period_code), periodOrder.get(b.period_code), descending, (x, y) => x - y),
    count: (a, b) => (descending ? -1 : 1) * (a.within_count - b.within_count),
    key: (a, b) =>
      nullsLast(position(KEY_ORDER, a.key_tonic), position(KEY_ORDER, b.key_tonic), descending, (x, y) => x - y) ||
      nullsLast(position(MODE_ORDER, a.key_mode), position(MODE_ORDER, b.key_mode), false, (x, y) => x - y),
    last_performed: (a, b) => nullsLast(a.last_performed, b.last_performed, descending, compareText),
    created: (a, b) => (descending ? -1 : 1) * compareText(a.created_at, b.created_at)
  }[sort];

  matched.sort((a, b) => (primary?.(a, b) || 0) || compareText(titleKey(a), titleKey(b)) || compareText(a.score_id, b.score_id));
  const [start, end] = clampPage(params.p_limit, params.p_offset, 50, 200);
  return matched.slice(start, end).map(({ composer_id, ...row }) => ({ ...row, total_count: matched.length }));
}

export function searchHistory(read, params = {}, today) {
  const filters = params.p_filters ?? {};
  const descending = params.p_descending ?? true;
  const pool = new Map(searchPool(read, filters).map((score) => [String(score.score_id), score]));
  const rows = searchEntries(read, filters, today)
    .filter((entry) => pool.has(String(entry.owned_score_id)))
    .map((entry) => {
      const score = pool.get(String(entry.owned_score_id));
      return {
        entry_id: entry.entry_id,
        mass_event_id: entry.mass_event_id,
        local_date: entry.local_date,
        start_time: entry.start_time,
        score_id: score.score_id,
        title: score.title,
        provisional_title: score.provisional_title,
        composer_label: score.composer_label,
        role_id: entry.role_id,
        part_display_name: entry.part_display_name,
        venue_label: entry.venue_label,
        note: entry.note
      };
    });
  rows.sort(
    (a, b) =>
      (descending ? -1 : 1) * compareText(a.local_date, b.local_date) ||
      nullsLast(a.start_time, b.start_time, descending, compareText) ||
      compareText(a.entry_id, b.entry_id)
  );
  const [start, end] = clampPage(params.p_limit, params.p_offset, 100, 500);
  return rows.slice(start, end).map((row) => ({ ...row, total_count: rows.length }));
}
