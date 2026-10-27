// Stand-in for the Supabase client on the demo page (demo.html). It answers the same calls that db.js and the
// upload code make, from data kept in this browser tab. Nothing here talks to a server, so the demo cannot read
// or change any account, database row or Storage file of a member.

import { todayIso } from "./format.js";
import { performedEntries, searchHistory, searchScores } from "./demo-search.js";

export const DEMO_TABLES = [
  "user_mass_layouts",
  "user_mass_layout_items",
  "mass_events",
  "mass_music_slots",
  "owned_scores",
  "score_files",
  "mass_music_entries",
  "performance_confirmations",
  "mass_series",
  "mass_series_skips",
  "user_venues",
  "saved_views"
];

// Column defaults of the real tables (supabase/migrations). id, user_id and created_at are added for every table.
const DEFAULTS = {
  user_mass_layouts: { updated_at: true },
  user_mass_layout_items: { display_name: null, sort_order: 0 },
  mass_events: {
    start_time: null, title: null, observance_id: null, celebration_name: null, season_code: null, color_code: null,
    liturgy_source: "unknown", layout_id: null, venue_name: null, venue_id: null, status: "planned", notes: null,
    series_id: null, series_locked: false, updated_at: true
  },
  mass_music_slots: { display_name: null, sort_order: 0 },
  owned_scores: {
    title: null, composer_name: null, status: "uploading", work_id: null, composer_id: null, composition_year: null,
    composition_year_approx: false, period_code: null, key_tonic: null, key_mode: null, key_text: null, note: null,
    thumbnail_path: null, last_edited_at: true, publisher: null, edition: null, scorebook: null, scorebook_page: null,
    physical_location: null, external_url: null, duration_seconds: null, difficulty: null
  },
  score_files: { original_filename: null, page_no: 1, role: "page", removed_at: null },
  mass_music_entries: { sort_order: 0, not_played_at: null, note: null },
  performance_confirmations: { voided_at: null, confirmed_at: true },
  mass_series: {
    title: null, start_time: null, venue_name: null, venue_id: null, layout_id: null, interval_weeks: 1, ends_on: null,
    updated_at: true
  },
  mass_series_skips: {},
  user_venues: { layout_id: null, updated_at: true },
  saved_views: { layout_config: {}, schema_version: 1, updated_at: true }
};

const NO_ID = new Set(["mass_series_skips"]);
const TIME_COLUMNS = ["start_time"];
const SCORE_EDIT_FIELDS = [
  "title", "composer_name", "composer_id", "composition_year", "composition_year_approx", "period_code",
  "key_tonic", "key_mode", "key_text", "note", "publisher", "edition", "scorebook", "scorebook_page",
  "physical_location", "external_url", "duration_seconds", "difficulty"
];

// parent table -> embedded table -> join. one: parent column pointing at the target id; many: target column pointing at the parent id.
const RELATIONS = {
  mass_events: { liturgical_observances: { one: "observance_id" }, mass_music_slots: { many: "mass_event_id" } },
  mass_music_slots: { mass_music_entries: { many: "mass_music_slot_id" }, mass_events: { one: "mass_event_id" } },
  mass_music_entries: {
    owned_scores: { one: "owned_score_id" },
    mass_music_slots: { one: "mass_music_slot_id" },
    performance_confirmations: { many: "mass_music_entry_id" }
  },
  owned_scores: { score_files: { many: "owned_score_id" }, mass_music_entries: { many: "owned_score_id" } },
  user_mass_layouts: { user_mass_layout_items: { many: "layout_id" } }
};

// Unique keys. A key with an empty part is not compared (as in Postgres).
const UNIQUE = {
  user_mass_layout_items: [["layout_id", "role_id"]],
  mass_events: [["series_id", "local_date"]],
  mass_music_slots: [["mass_event_id", "role_id"]],
  mass_music_entries: [["mass_music_slot_id", "owned_score_id"]],
  score_files: [["storage_path"]],
  mass_series_skips: [["series_id", "skip_date"]],
  user_venues: [["name"]],
  saved_views: [["view_type"]]
};

// Rows that must exist before a row pointing at them is added.
const PARENTS = {
  user_mass_layout_items: [["layout_id", "user_mass_layouts"]],
  mass_music_slots: [["mass_event_id", "mass_events"]],
  score_files: [["owned_score_id", "owned_scores"]],
  mass_music_entries: [["mass_music_slot_id", "mass_music_slots"], ["owned_score_id", "owned_scores"]],
  performance_confirmations: [["mass_music_entry_id", "mass_music_entries"]],
  mass_series_skips: [["series_id", "mass_series"]]
};

// What happens to other rows when a row is deleted.
const ON_DELETE = {
  user_mass_layouts: {
    cascade: [["user_mass_layout_items", "layout_id"]],
    setNull: [["mass_events", "layout_id"], ["mass_series", "layout_id"], ["user_venues", "layout_id"]]
  },
  mass_events: { cascade: [["mass_music_slots", "mass_event_id"]] },
  mass_music_slots: { cascade: [["mass_music_entries", "mass_music_slot_id"]] },
  mass_music_entries: { restrict: [["performance_confirmations", "mass_music_entry_id"]] },
  owned_scores: { cascade: [["score_files", "owned_score_id"]], restrict: [["mass_music_entries", "owned_score_id"]] },
  mass_series: { cascade: [["mass_series_skips", "series_id"]], setNull: [["mass_events", "series_id"]] },
  user_venues: { setNull: [["mass_events", "venue_id"], ["mass_series", "venue_id"]] }
};

function dbError(code, message) {
  return { code, message, details: null, hint: null };
}

function storageError(statusCode, message) {
  return { name: "StorageApiError", statusCode: String(statusCode), status: Number(statusCode), message };
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function clone(value) {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
}

function same(a, b) {
  return String(a) === String(b);
}

function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
  const left = String(a);
  const right = String(b);
  if (/^\d/.test(left) && /^\d/.test(right)) return left < right ? -1 : left > right ? 1 : 0;
  return left.localeCompare(right);
}

function normalizeTime(value) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

function uniqueKey(table, columns, row) {
  const parts = columns.map((column) => row[column] ?? null);
  if (parts.some((part) => part === null)) return null;
  if (table === "user_venues") return String(parts[0]).trim().toLowerCase();
  return parts.map(String).join("\u0000");
}

function parseSelect(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  const nodes = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (part === "*") {
      nodes.push({ star: true });
      continue;
    }
    const open = part.indexOf("(");
    if (open === -1) {
      nodes.push({ name: part });
      continue;
    }
    const head = part.slice(0, open).trim();
    const [alias, table] = head.includes(":") ? head.split(":").map((value) => value.trim()) : [head, head];
    nodes.push({ embed: true, alias, table, children: parseSelect(part.slice(open + 1, part.lastIndexOf(")"))) });
  }
  return nodes;
}

function matches(row, filter) {
  const value = row[filter.column] ?? null;
  switch (filter.op) {
    case "eq":
      return value !== null && same(value, filter.value);
    case "neq":
      return value !== null && !same(value, filter.value);
    case "gt":
      return value !== null && compareValues(value, filter.value) > 0;
    case "gte":
      return value !== null && compareValues(value, filter.value) >= 0;
    case "lt":
      return value !== null && compareValues(value, filter.value) < 0;
    case "lte":
      return value !== null && compareValues(value, filter.value) <= 0;
    case "in":
      return value !== null && filter.value.some((item) => same(value, item));
    case "is":
      return filter.value === null ? value === null : value === filter.value;
    case "not_is":
      return filter.value === null ? value !== null : value !== filter.value;
    default:
      return false;
  }
}

// Blob keeper used when nothing better is available (tests, or a browser without IndexedDB).
export function createMemoryBlobStore() {
  const blobs = new Map();
  return {
    async get(path) {
      return blobs.get(path) ?? null;
    },
    async put(path, blob) {
      blobs.set(path, blob);
    },
    async delete(paths) {
      for (const path of paths) blobs.delete(path);
    }
  };
}

// state: { tables: { [name]: rows[] }, objects: [storage paths] }, changed in place.
// reference: read-only tables (liturgical_roles, liturgical_observances, musical_periods).
// blobs: { get(path), put(path, blob), delete(paths) } for the file contents.
export function createDemoClient({ userId, state, reference = {}, blobs = createMemoryBlobStore(), onChange = () => {}, today = () => todayIso() }) {
  for (const name of DEMO_TABLES) state.tables[name] ??= [];
  state.objects ??= [];
  const objectSet = new Set(state.objects);
  const signedUrls = new Map();

  const nowIso = () => new Date().toISOString();

  function rowsOf(table) {
    if (table === "performed_entries") return performedEntries(rowsOf, today());
    if (state.tables[table]) return state.tables[table];
    if (reference[table]) return reference[table];
    return null;
  }

  function project(table, row, nodes) {
    const out = {};
    for (const node of nodes) {
      if (node.star) {
        Object.assign(out, clone(row));
      } else if (node.embed) {
        const relation = RELATIONS[table]?.[node.table];
        const targets = rowsOf(node.table);
        if (!relation || !targets) throw dbError("PGRST200", `Could not find a relationship between '${table}' and '${node.table}'`);
        if (relation.one) {
          const target = targets.find((item) => same(item.id, row[relation.one]));
          out[node.alias] = target ? project(node.table, target, node.children) : null;
        } else {
          out[node.alias] = targets.filter((item) => same(item[relation.many], row.id)).map((item) => project(node.table, item, node.children));
        }
      } else {
        out[node.name] = clone(row[node.name] ?? null);
      }
    }
    return out;
  }

  function withDefaults(table, values) {
    const now = nowIso();
    const row = {};
    if (!NO_ID.has(table)) row.id = uuid();
    row.user_id = userId;
    for (const [column, value] of Object.entries(DEFAULTS[table] ?? {})) row[column] = value === true ? now : clone(value);
    row.created_at = now;
    for (const [column, value] of Object.entries(values)) row[column] = clone(value);
    for (const column of TIME_COLUMNS) if (column in row) row[column] = normalizeTime(row[column]);
    row.user_id = userId;
    return row;
  }

  function checkUnique(table, row, others) {
    if (!NO_ID.has(table) && others.some((other) => same(other.id, row.id))) {
      return dbError("23505", `duplicate key value violates unique constraint "${table}_pkey"`);
    }
    for (const columns of UNIQUE[table] ?? []) {
      const key = uniqueKey(table, columns, row);
      if (key !== null && others.some((other) => uniqueKey(table, columns, other) === key)) {
        return dbError("23505", `duplicate key value violates unique constraint on ${table} (${columns.join(", ")})`);
      }
    }
    return null;
  }

  function checkParents(table, row) {
    for (const [column, parent] of PARENTS[table] ?? []) {
      if (row[column] == null) continue;
      if (!rowsOf(parent).some((item) => same(item.id, row[column]))) {
        return dbError("23503", `insert or update on table "${table}" violates foreign key constraint (${column})`);
      }
    }
    return null;
  }

  // Page added, removed or renumbered: the Score counts as edited (trigger touch_score_on_page_change).
  function touchScore(scoreId) {
    const score = state.tables.owned_scores.find((item) => same(item.id, scoreId));
    if (score && score.status === "ready") score.last_edited_at = nowIso();
  }

  function insertRows(table, values) {
    const rows = values.map((value) => withDefaults(table, value));
    const existing = state.tables[table];
    for (const [index, row] of rows.entries()) {
      const problem = checkUnique(table, row, existing.concat(rows.slice(0, index))) ?? checkParents(table, row);
      if (problem) return { error: problem };
    }
    existing.push(...rows);
    if (table === "score_files") rows.forEach((row) => touchScore(row.owned_score_id));
    return { rows };
  }

  function updateRows(table, targets, patch) {
    const clean = { ...patch };
    delete clean.id;
    delete clean.user_id;
    delete clean.created_at;
    for (const column of TIME_COLUMNS) if (column in clean) clean[column] = normalizeTime(clean[column]);
    const all = state.tables[table];
    for (const row of targets) {
      const next = { ...row, ...clean };
      const problem = checkUnique(table, next, all.filter((other) => other !== row && !targets.includes(other))) ?? checkParents(table, next);
      if (problem) return { error: problem };
    }
    const now = nowIso();
    for (const row of targets) {
      const before = { ...row };
      Object.assign(row, clone(clean));
      if ("updated_at" in row) row.updated_at = now;
      if (table === "owned_scores") {
        const edited = SCORE_EDIT_FIELDS.some((column) => column in clean && !same(before[column], row[column]));
        row.last_edited_at = edited ? now : before.last_edited_at;
      }
      if (table === "score_files" && (("page_no" in clean && !same(before.page_no, row.page_no)) || "removed_at" in clean)) {
        touchScore(row.owned_score_id);
      }
    }
    return { rows: targets };
  }

  // Collects every row a delete reaches, then refuses if a protected link would be broken.
  function deleteRows(table, targets) {
    const doomed = new Map(); // table -> Set(rows)
    const queue = [[table, targets]];
    while (queue.length) {
      const [name, rows] = queue.shift();
      const set = doomed.get(name) ?? new Set();
      doomed.set(name, set);
      const fresh = rows.filter((row) => !set.has(row));
      fresh.forEach((row) => set.add(row));
      for (const [child, column] of ON_DELETE[name]?.cascade ?? []) {
        const children = state.tables[child].filter((item) => fresh.some((row) => same(item[column], row.id)));
        if (children.length) queue.push([child, children]);
      }
    }
    for (const [name, set] of doomed) {
      for (const [child, column] of ON_DELETE[name]?.restrict ?? []) {
        const blocked = state.tables[child].some(
          (item) => !doomed.get(child)?.has(item) && [...set].some((row) => same(item[column], row.id))
        );
        if (blocked) return { error: dbError("23503", `update or delete on table "${name}" violates foreign key constraint on table "${child}"`) };
      }
    }
    for (const [name, set] of doomed) {
      for (const [other, column] of ON_DELETE[name]?.setNull ?? []) {
        for (const item of state.tables[other]) if ([...set].some((row) => same(item[column], row.id))) item[column] = null;
      }
      state.tables[name] = state.tables[name].filter((row) => !set.has(row));
      if (name === "score_files") [...set].forEach((row) => touchScore(row.owned_score_id));
    }
    return { rows: targets };
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.action = "select";
      this.columns = "*";
      this.returning = false;
      this.filters = [];
      this.orders = [];
      this.limitCount = null;
      this.offsetCount = 0;
      this.expect = null;
      this.values = null;
      this.conflict = null;
    }

    select(columns = "*") {
      if (this.action === "select") this.columns = columns;
      else this.returning = columns;
      return this;
    }

    insert(values) {
      this.action = "insert";
      this.values = Array.isArray(values) ? values : [values];
      return this;
    }

    upsert(values, { onConflict = "id" } = {}) {
      this.action = "upsert";
      this.values = Array.isArray(values) ? values : [values];
      this.conflict = onConflict.split(",").map((column) => column.trim());
      return this;
    }

    update(values) {
      this.action = "update";
      this.values = values;
      return this;
    }

    delete() {
      this.action = "delete";
      return this;
    }

    filter(column, op, value) {
      this.filters.push({ column, op, value });
      return this;
    }

    eq(column, value) { return this.filter(column, "eq", value); }
    neq(column, value) { return this.filter(column, "neq", value); }
    gt(column, value) { return this.filter(column, "gt", value); }
    gte(column, value) { return this.filter(column, "gte", value); }
    lt(column, value) { return this.filter(column, "lt", value); }
    lte(column, value) { return this.filter(column, "lte", value); }
    in(column, values) { return this.filter(column, "in", [...values]); }
    is(column, value) { return this.filter(column, "is", value); }

    not(column, op, value) {
      if (op !== "is") throw new Error(`demo client: not(${op}) is not supported`);
      return this.filter(column, "not_is", value);
    }

    order(column, { ascending = true, nullsFirst = !ascending } = {}) {
      this.orders.push({ column, ascending, nullsFirst });
      return this;
    }

    limit(count) {
      this.limitCount = count;
      return this;
    }

    range(from, to) {
      this.offsetCount = from;
      this.limitCount = to - from + 1;
      return this;
    }

    single() {
      this.expect = "single";
      return this;
    }

    maybeSingle() {
      this.expect = "maybe";
      return this;
    }

    then(onFulfilled, onRejected) {
      return this.execute().then(onFulfilled, onRejected);
    }

    async execute() {
      await Promise.resolve();
      try {
        const result = this.run();
        if (result.error) return { data: null, error: result.error };
        if (result.mutated) onChange();
        return this.shape(result.rows ?? null);
      } catch (error) {
        return { data: null, error: error?.code ? error : dbError("demo", String(error?.message ?? error)) };
      }
    }

    selected() {
      const rows = rowsOf(this.table);
      if (!rows) throw dbError("42P01", `relation "public.${this.table}" does not exist`);
      return rows.filter((row) => this.filters.every((filter) => matches(row, filter)));
    }

    run() {
      const table = this.table;
      if (this.action === "select") {
        let rows = [...this.selected()];
        if (this.orders.length) {
          rows.sort((a, b) => {
            for (const order of this.orders) {
              const left = a[order.column] ?? null;
              const right = b[order.column] ?? null;
              if (left === null && right === null) continue;
              if (left === null) return order.nullsFirst ? -1 : 1;
              if (right === null) return order.nullsFirst ? 1 : -1;
              const diff = compareValues(left, right);
              if (diff) return order.ascending ? diff : -diff;
            }
            return 0;
          });
        }
        rows = rows.slice(this.offsetCount, this.limitCount == null ? undefined : this.offsetCount + this.limitCount);
        const nodes = parseSelect(this.columns);
        return { rows: rows.map((row) => project(table, row, nodes)) };
      }
      if (!state.tables[table]) throw dbError("42501", `permission denied for table ${table}`);
      let outcome;
      if (this.action === "insert") {
        outcome = insertRows(table, this.values);
      } else if (this.action === "upsert") {
        const fresh = [];
        const updated = [];
        for (const value of this.values) {
          const probe = withDefaults(table, value);
          const found = state.tables[table].find((row) => this.conflict.every((column) => same(row[column], probe[column])));
          if (found) {
            const result = updateRows(table, [found], value);
            if (result.error) return result;
            updated.push(found);
          } else {
            fresh.push(value);
          }
        }
        outcome = fresh.length ? insertRows(table, fresh) : { rows: [] };
        if (!outcome.error) outcome = { rows: updated.concat(outcome.rows) };
      } else if (this.action === "update") {
        outcome = updateRows(table, this.selected(), this.values ?? {});
      } else {
        outcome = deleteRows(table, this.selected());
      }
      if (outcome.error) return outcome;
      const nodes = this.returning ? parseSelect(this.returning) : null;
      return { mutated: true, rows: nodes ? outcome.rows.map((row) => project(table, row, nodes)) : null };
    }

    shape(rows) {
      if (this.expect === "single" || this.expect === "maybe") {
        const list = rows ?? [];
        if (list.length > 1 || (this.expect === "single" && list.length === 0)) {
          return { data: null, error: dbError("PGRST116", "JSON object requested, multiple (or no) rows returned") };
        }
        return { data: list[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    }
  }

  function bucket() {
    return {
      async upload(path, body, { upsert = false } = {}) {
        if (objectSet.has(path) && !upsert) return { data: null, error: storageError(409, "The resource already exists") };
        if (!body || !body.size) return { data: null, error: storageError(400, "The file is empty") };
        try {
          await blobs.put(path, body);
        } catch {
          return { data: null, error: storageError(507, "This device has no room to keep the file") };
        }
        if (!objectSet.has(path)) {
          objectSet.add(path);
          state.objects.push(path);
        }
        onChange();
        return { data: { path }, error: null };
      },
      async download(path) {
        const blob = objectSet.has(path) ? await blobs.get(path) : null;
        return blob ? { data: blob, error: null } : { data: null, error: storageError(404, "Object not found") };
      },
      async remove(paths) {
        const removed = paths.filter((path) => objectSet.has(path));
        for (const path of removed) {
          objectSet.delete(path);
          const url = signedUrls.get(path);
          if (url) URL.revokeObjectURL(url);
          signedUrls.delete(path);
        }
        state.objects = state.objects.filter((path) => objectSet.has(path));
        await blobs.delete(removed).catch(() => {});
        if (removed.length) onChange();
        return { data: removed.map((name) => ({ name })), error: null };
      },
      async list(folder = "", { limit = 100 } = {}) {
        const prefix = folder ? `${folder.replace(/\/$/, "")}/` : "";
        const seen = new Map();
        for (const path of objectSet) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          const [name, ...more] = rest.split("/");
          if (!seen.has(name)) seen.set(name, { name, id: more.length ? null : `object-${path}` });
        }
        return { data: [...seen.values()].slice(0, limit), error: null };
      },
      async createSignedUrl(path) {
        if (!signedUrls.has(path)) {
          const blob = objectSet.has(path) ? await blobs.get(path) : null;
          if (!blob) return { data: null, error: storageError(404, "Object not found") };
          signedUrls.set(path, URL.createObjectURL(blob));
        }
        return { data: { signedUrl: signedUrls.get(path) }, error: null };
      }
    };
  }

  async function rpc(name, params = {}) {
    await Promise.resolve();
    try {
      if (name === "search_scores") return { data: searchScores(rowsOf, params, today()), error: null };
      if (name === "search_history") return { data: searchHistory(rowsOf, params, today()), error: null };
      return { data: null, error: dbError("PGRST202", `Could not find the function public.${name}`) };
    } catch (error) {
      return { data: null, error: dbError("demo", String(error?.message ?? error)) };
    }
  }

  return {
    isDemo: true,
    from: (table) => new Query(table),
    rpc,
    storage: { from: () => bucket() }
  };
}
