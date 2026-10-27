// Search conditions <-> address (#/search?...) <-> p_filters of search_scores / search_history (PRD 4.13).
import { KEY_MODES, KEY_TONICS } from "./score-meta.js";

export const FILTER_IDS = ["liturgy", "date", "composer", "period", "count", "key", "venue", "part", "files"];
// Score file filter (PRD RIGHT-005): "with" = has a score file, "without" = Information Only. null = both.
export const FILE_CHOICES = ["with", "without"];
export const SEASONS = ["advent", "christmas", "ordinary", "lent", "easter"];
export const SORTS = ["title", "composer", "period", "count", "key", "last_performed", "created"];
export const VIEWS = ["index", "notes", "preview"];
export const COUNT_OPS = ["eq", "gte", "lte", "between"];
// Decision C3: shown first in the Music Parts filter; the other parts are under "+ More".
export const DEFAULT_PART_CODES = ["prelude", "entrance", "offertory", "communion", "post_communion", "meditation", "recessional", "postlude"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COUNT = 9999;

export function emptySearch() {
  return {
    target: "scores",
    q: "",
    seasons: [],
    observances: [],
    yearFrom: null,
    yearTo: null,
    months: [],
    dateFrom: null,
    dateTo: null,
    composers: [],
    periods: [],
    provisional: true,
    keys: [],
    venues: [],
    parts: [],
    count: null,
    extra: null,
    files: null,
    sort: null,
    desc: null,
    view: null,
    oldest: false
  };
}

function wholeNumber(text, min, max) {
  const value = Number(text);
  return text != null && String(text).trim() !== "" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function isoDate(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text ?? "") ? text : null;
}

const listParam = (params, name) =>
  (params.get(name) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const repeatedParam = (params, name) => params.getAll(name).map((item) => item.trim()).filter(Boolean);
const unique = (items) => [...new Set(items)];

// "eq:1", "gte:2", "lte:3" or "between:1:3"
export function parseCount(text) {
  const [op, first, second] = String(text ?? "").split(":");
  if (op === "between") {
    const min = wholeNumber(first, 0, MAX_COUNT);
    const max = wholeNumber(second, 0, MAX_COUNT);
    if (min == null || max == null) return null;
    return { op, min: Math.min(min, max), max: Math.max(min, max) };
  }
  if (!COUNT_OPS.includes(op)) return null;
  const value = wholeNumber(first, 0, MAX_COUNT);
  return value == null ? null : { op, value };
}

export function countText(cond) {
  return cond.op === "between" ? `between:${cond.min}:${cond.max}` : `${cond.op}:${cond.value}`;
}

export function countSummary(cond) {
  if (!cond) return "";
  if (cond.op === "between") return `${cond.min}–${cond.max}`;
  return `${{ eq: "=", gte: "≥", lte: "≤" }[cond.op]} ${cond.value}`;
}

// "D:minor" or "D" (any mode)
function parseKey(text) {
  const [tonic, mode] = String(text ?? "").split(":");
  if (!KEY_TONICS.includes(tonic)) return null;
  if (mode && !KEY_MODES.includes(mode)) return null;
  return { tonic, mode: mode || null };
}

const keyText = (key) => (key.mode ? `${key.tonic}:${key.mode}` : key.tonic);

export function parseSearchQuery(query) {
  const params = new URLSearchParams(query ?? "");
  const state = emptySearch();
  if (params.get("t") === "history") state.target = "history";
  state.q = (params.get("q") ?? "").slice(0, 200);
  state.seasons = unique(listParam(params, "s").filter((code) => SEASONS.includes(code)));
  state.observances = unique(repeatedParam(params, "o")).slice(0, 50);
  state.yearFrom = wholeNumber(params.get("yf"), 1, 9999);
  state.yearTo = wholeNumber(params.get("yt"), 1, 9999);
  state.months = unique(listParam(params, "m").map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12));
  state.dateFrom = isoDate(params.get("df"));
  state.dateTo = isoDate(params.get("dt"));
  state.composers = unique(repeatedParam(params, "c")).slice(0, 50);
  state.periods = unique(listParam(params, "p").filter((code) => /^[a-z_]+$/.test(code)));
  state.provisional = params.get("pp") !== "0";
  state.keys = repeatedParam(params, "k").map(parseKey).filter(Boolean).slice(0, 20);
  state.venues = unique(listParam(params, "v").filter((id) => UUID.test(id)));
  state.parts = unique(listParam(params, "r").filter((id) => UUID.test(id)));
  state.count = parseCount(params.get("n"));
  const scope = params.get("xs");
  const extraCond = parseCount(params.get("xn"));
  if ((scope === "all" || scope === "venue") && extraCond) {
    state.extra = { scope, venues: unique(listParam(params, "xv").filter((id) => UUID.test(id))), cond: extraCond };
  }
  state.files = FILE_CHOICES.includes(params.get("f")) ? params.get("f") : null;
  state.sort = SORTS.includes(params.get("sort")) ? params.get("sort") : null;
  state.desc = params.has("desc") ? params.get("desc") === "1" : null;
  state.view = VIEWS.includes(params.get("view")) ? params.get("view") : null;
  state.oldest = params.get("ord") === "asc";
  return state;
}

export function searchQuery(state) {
  const params = new URLSearchParams();
  if (state.target === "history") params.set("t", "history");
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.seasons.length) params.set("s", state.seasons.join(","));
  for (const name of state.observances) params.append("o", name);
  if (state.yearFrom != null) params.set("yf", String(state.yearFrom));
  if (state.yearTo != null) params.set("yt", String(state.yearTo));
  if (state.months.length) params.set("m", state.months.join(","));
  if (state.dateFrom) params.set("df", state.dateFrom);
  if (state.dateTo) params.set("dt", state.dateTo);
  for (const name of state.composers) params.append("c", name);
  if (state.periods.length) params.set("p", state.periods.join(","));
  if (!state.provisional) params.set("pp", "0");
  for (const key of state.keys) params.append("k", keyText(key));
  if (state.venues.length) params.set("v", state.venues.join(","));
  if (state.parts.length) params.set("r", state.parts.join(","));
  if (state.count) params.set("n", countText(state.count));
  if (state.extra) {
    params.set("xs", state.extra.scope);
    params.set("xn", countText(state.extra.cond));
    if (state.extra.scope === "venue" && state.extra.venues.length) params.set("xv", state.extra.venues.join(","));
  }
  if (state.files) params.set("f", state.files);
  if (state.sort && state.sort !== "title") params.set("sort", state.sort);
  if (state.desc) params.set("desc", "1");
  if (state.view && state.view !== "index") params.set("view", state.view);
  if (state.oldest) params.set("ord", "asc");
  return params.toString();
}

// Lower case without accents, used to match composer aliases ("Dvořák" -> "dvorak"). Hangul stays composed.
export function searchKey(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").toLowerCase().trim();
}

// Filters that must match the same played record (PRD 4.13.4.1).
export function hasContext(state) {
  return Boolean(
    state.seasons.length ||
      state.observances.length ||
      state.yearFrom != null ||
      state.yearTo != null ||
      state.months.length ||
      state.dateFrom ||
      state.dateTo ||
      state.venues.length ||
      state.parts.length
  );
}

export function searchFilters(state) {
  const filters = {};
  const q = state.q.trim();
  if (q) {
    filters.q = q;
    filters.q_key = searchKey(q);
  }
  if (state.seasons.length) filters.seasons = [...state.seasons];
  if (state.observances.length) filters.observance_names = [...state.observances];
  if (state.yearFrom != null) filters.year_from = state.yearFrom;
  if (state.yearTo != null) filters.year_to = state.yearTo;
  if (state.months.length) filters.months = [...state.months];
  if (state.dateFrom) filters.date_from = state.dateFrom;
  if (state.dateTo) filters.date_to = state.dateTo;
  if (state.venues.length) filters.venue_ids = [...state.venues];
  if (state.parts.length) filters.role_ids = [...state.parts];
  if (state.composers.length) filters.composer_names = [...state.composers];
  if (state.periods.length) {
    filters.periods = [...state.periods];
    filters.include_provisional_period = state.provisional;
  }
  if (state.keys.length) filters.keys = state.keys.map((key) => (key.mode ? { tonic: key.tonic, mode: key.mode } : { tonic: key.tonic }));
  if (state.target !== "history") {
    if (state.count) filters.count = { ...state.count };
    if (state.extra) {
      filters.extra_count = { scope: state.extra.scope, ...state.extra.cond };
      if (state.extra.scope === "venue") filters.extra_count.venue_ids = [...state.extra.venues];
    }
    if (state.files) filters.files = state.files;
  }
  return filters;
}

export function isFilterActive(state, id) {
  switch (id) {
    case "liturgy":
      return Boolean(state.seasons.length || state.observances.length);
    case "date":
      return Boolean(state.yearFrom != null || state.yearTo != null || state.months.length || state.dateFrom || state.dateTo);
    case "composer":
      return state.composers.length > 0;
    case "period":
      return state.periods.length > 0;
    case "count":
      return Boolean(state.count || state.extra);
    case "key":
      return state.keys.length > 0;
    case "venue":
      return state.venues.length > 0;
    case "part":
      return state.parts.length > 0;
    case "files":
      return state.files != null;
    default:
      return false;
  }
}

export function clearFilter(state, id) {
  const empty = emptySearch();
  const fields = {
    liturgy: ["seasons", "observances"],
    date: ["yearFrom", "yearTo", "months", "dateFrom", "dateTo"],
    composer: ["composers"],
    period: ["periods", "provisional"],
    count: ["count", "extra"],
    key: ["keys"],
    venue: ["venues"],
    part: ["parts"],
    files: ["files"]
  }[id] ?? [];
  const next = { ...state };
  for (const field of fields) next[field] = empty[field];
  return next;
}

// saved_views.layout_config for view_type "search" (C6, SORT-008).
export function normalizeViewConfig(config) {
  const order = Array.isArray(config?.filters) ? config.filters.filter((id) => FILTER_IDS.includes(id)) : [];
  for (const id of FILTER_IDS) if (!order.includes(id)) order.push(id);
  return {
    filters: unique(order),
    hidden: Array.isArray(config?.hidden) ? unique(config.hidden.filter((id) => FILTER_IDS.includes(id))) : [],
    sort: SORTS.includes(config?.sort) ? config.sort : "title",
    desc: config?.desc === true,
    view: VIEWS.includes(config?.view) ? config.view : "index"
  };
}
