import { SCORE_BUCKET } from "./supabase.js";
import { compareMasses } from "./format.js";
import { comparePages } from "./pages.js";
import { liturgyFields, occurrenceDates } from "./recurrence.js";

export const SIGNED_URL_SECONDS = 300;

const SCORE_FIELDS = "id,title,composer_name,provisional_title,status,created_at,last_edited_at";
const FILE_FIELDS = "id,storage_path,mime_type,byte_size,original_filename,page_no,created_at";
const OBSERVANCE_FIELDS =
  "id,calendar_date,sort_order,name_ko,name_en,name_la,season_code,color_code,rank_code,source_url,verification_status";

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function normalizeName(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function isMissingRelation(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("schema cache") || message.includes("mass_series");
}

function sortFiles(score) {
  if (Array.isArray(score?.score_files)) score.score_files.sort(comparePages);
  return score;
}

export function createDb(supabase) {
  let rolesCache = null;

  async function roles() {
    if (!rolesCache) {
      rolesCache = await run(
        supabase.from("liturgical_roles").select("id,code,slot_no,name_ko,name_la,name_en").order("slot_no")
      );
    }
    return rolesCache;
  }

  function observancesBetween(from, to) {
    return run(
      supabase
        .from("liturgical_observances")
        .select(OBSERVANCE_FIELDS)
        .eq("calendar_code", "KR")
        .gte("calendar_date", from)
        .lte("calendar_date", to)
        .order("calendar_date")
        .order("sort_order")
    );
  }

  function massDatesBetween(from, to) {
    return run(supabase.from("mass_events").select("id,local_date").gte("local_date", from).lte("local_date", to));
  }

  async function massesOn(date) {
    const rows = await run(
      supabase
        .from("mass_events")
        .select(
          "id,local_date,start_time,title,celebration_name,season_code,color_code,liturgy_source,venue_name,status,created_at," +
            "mass_music_slots(id,mass_music_entries(id))"
        )
        .eq("local_date", date)
    );
    return rows.sort(compareMasses);
  }

  async function mass(id) {
    const row = await run(
      supabase
        .from("mass_events")
        .select(
          "*,mass_music_slots(id,role_id,display_name," +
            `mass_music_entries(id,sort_order,created_at,owned_score_id,owned_scores(${SCORE_FIELDS},score_files(${FILE_FIELDS}))))`
        )
        .eq("id", id)
        .maybeSingle()
    );
    if (!row) return null;
    for (const slot of row.mass_music_slots ?? []) {
      slot.mass_music_entries ??= [];
      slot.mass_music_entries.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
      slot.mass_music_entries.forEach((entry) => sortFiles(entry.owned_scores));
    }
    return row;
  }

  async function createMass(fields, items) {
    const created = await run(supabase.from("mass_events").insert(fields).select("id").single());
    if (items.length) {
      try {
        await run(
          supabase.from("mass_music_slots").insert(
            items.map((item) => ({
              mass_event_id: created.id,
              role_id: item.role_id,
              display_name: normalizeName(item.display_name)
            }))
          )
        );
      } catch (error) {
        await supabase.from("mass_events").delete().eq("id", created.id);
        throw error;
      }
    }
    return created.id;
  }

  function updateMass(id, fields) {
    return run(supabase.from("mass_events").update(fields).eq("id", id));
  }

  function deleteMass(id) {
    return run(supabase.from("mass_events").delete().eq("id", id));
  }

  async function forgetOccurrence(mass) {
    if (mass?.series_id) {
      const { error } = await supabase.from("mass_series_skips").insert({
        series_id: mass.series_id,
        skip_date: mass.local_date
      });
      if (error && error.code !== "23505" && !isMissingRelation(error)) throw error;
    }
    await deleteMass(mass.id);
  }

  function seriesRows() {
    return run(
      supabase
        .from("mass_series")
        .select("id,title,start_time,venue_name,layout_id,weekday,interval_weeks,starts_on,ends_on")
    );
  }

  async function series(id) {
    if (!id) return null;
    try {
      return await run(supabase.from("mass_series").select("*").eq("id", id).maybeSingle());
    } catch (error) {
      if (isMissingRelation(error)) return null;
      throw error;
    }
  }

  function createSeries(fields) {
    return run(supabase.from("mass_series").insert(fields).select("id").single());
  }

  function updateSeries(id, fields) {
    return run(supabase.from("mass_series").update(fields).eq("id", id));
  }

  function deleteSeries(id) {
    return run(supabase.from("mass_series").delete().eq("id", id));
  }

  async function usedVenues() {
    const names = new Set();
    const masses = await run(supabase.from("mass_events").select("venue_name").limit(300));
    for (const row of masses) if (row.venue_name?.trim()) names.add(row.venue_name.trim());
    try {
      const seriesVenues = await run(supabase.from("mass_series").select("venue_name").limit(300));
      for (const row of seriesVenues) if (row.venue_name?.trim()) names.add(row.venue_name.trim());
    } catch (error) {
      if (!isMissingRelation(error)) throw error;
    }
    return [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }

  async function ensureOccurrences(from, to) {
    let series;
    try {
      series = await seriesRows();
    } catch (error) {
      if (isMissingRelation(error)) return;
      throw error;
    }
    const active = series.filter((item) => !item.ends_on || item.ends_on >= from);
    if (!active.length) return;

    const [observances, skips, layoutRows] = await Promise.all([
      observancesBetween(from, to),
      run(supabase.from("mass_series_skips").select("series_id,skip_date").gte("skip_date", from).lte("skip_date", to)),
      layouts()
    ]);
    const observanceByDate = new Map();
    for (const row of observances) if (!observanceByDate.has(row.calendar_date)) observanceByDate.set(row.calendar_date, row);
    const skipSet = new Set(skips.map((row) => `${row.series_id}:${row.skip_date}`));
    const layoutById = new Map(layoutRows.map((layout) => [layout.id, layout]));

    for (const item of active) {
      const dates = occurrenceDates(item, from, to).filter((date) => !skipSet.has(`${item.id}:${date}`));
      if (!dates.length) continue;
      const existing = await run(
        supabase.from("mass_events").select("local_date").eq("series_id", item.id).gte("local_date", from).lte("local_date", to)
      );
      const have = new Set(existing.map((row) => row.local_date));
      const slots = (layoutById.get(item.layout_id)?.user_mass_layout_items ?? []).map((slot) => ({
        role_id: slot.role_id,
        display_name: slot.display_name
      }));
      for (const date of dates) {
        if (have.has(date)) continue;
        try {
          await createMass(
            {
              local_date: date,
              title: item.title,
              start_time: item.start_time,
              venue_name: item.venue_name,
              layout_id: item.layout_id,
              notes: null,
              series_id: item.id,
              series_locked: false,
              ...liturgyFields(observanceByDate.get(date) ?? null)
            },
            slots
          );
        } catch (error) {
          if (error?.code !== "23505") throw error;
        }
      }
    }
  }

  async function syncFutureMasses(seriesId, fromDate, patch, layoutItems) {
    const rows = await run(
      supabase
        .from("mass_events")
        .select("id,mass_music_slots(id,role_id,display_name,mass_music_entries(id))")
        .eq("series_id", seriesId)
        .eq("series_locked", false)
        .gte("local_date", fromDate)
    );
    for (const row of rows) {
      await updateMass(row.id, patch);
      const linked = (row.mass_music_slots ?? []).some((slot) => (slot.mass_music_entries ?? []).length);
      if (!linked && layoutItems) await saveSlots(row.id, layoutItems, row.mass_music_slots ?? []);
    }
  }

  async function endSeries(seriesId, lastDate) {
    await updateSeries(seriesId, { ends_on: lastDate });
    const later = await run(
      supabase
        .from("mass_events")
        .select("id,series_locked,mass_music_slots(id,mass_music_entries(id))")
        .eq("series_id", seriesId)
        .gt("local_date", lastDate)
    );
    for (const row of later) {
      const linked = (row.mass_music_slots ?? []).some((slot) => (slot.mass_music_entries ?? []).length);
      if (row.series_locked || linked) continue;
      await deleteMass(row.id);
    }
  }

  async function saveSlots(massId, wanted, existing) {
    const wantedByRole = new Map(wanted.map((item) => [item.role_id, item]));
    const removals = existing.filter((slot) => !wantedByRole.has(slot.role_id));
    if (removals.length) {
      const linked = await run(
        supabase
          .from("mass_music_entries")
          .select("id")
          .in("mass_music_slot_id", removals.map((slot) => slot.id))
          .limit(1)
      );
      if (linked.length) throw codedError("slot_has_entries");
      await run(supabase.from("mass_music_slots").delete().in("id", removals.map((slot) => slot.id)));
    }
    const additions = wanted.filter((item) => !existing.some((slot) => slot.role_id === item.role_id));
    if (additions.length) {
      await run(
        supabase.from("mass_music_slots").insert(
          additions.map((item) => ({
            mass_event_id: massId,
            role_id: item.role_id,
            display_name: normalizeName(item.display_name)
          }))
        )
      );
    }
    for (const slot of existing) {
      const item = wantedByRole.get(slot.role_id);
      if (!item) continue;
      const nextName = normalizeName(item.display_name);
      if (nextName !== (slot.display_name ?? null)) {
        await run(supabase.from("mass_music_slots").update({ display_name: nextName }).eq("id", slot.id));
      }
    }
  }

  function layouts() {
    return run(
      supabase
        .from("user_mass_layouts")
        .select("id,name,created_at,updated_at,user_mass_layout_items(id,role_id,display_name)")
        .order("name")
    );
  }

  async function createLayout(name, items) {
    const created = await run(supabase.from("user_mass_layouts").insert({ name: name.trim() }).select("id").single());
    if (items.length) {
      try {
        await run(
          supabase.from("user_mass_layout_items").insert(
            items.map((item) => ({
              layout_id: created.id,
              role_id: item.role_id,
              display_name: normalizeName(item.display_name)
            }))
          )
        );
      } catch (error) {
        await supabase.from("user_mass_layouts").delete().eq("id", created.id);
        throw error;
      }
    }
    return created.id;
  }

  async function updateLayout(layout, name, items) {
    if (name.trim() !== layout.name) {
      await run(supabase.from("user_mass_layouts").update({ name: name.trim() }).eq("id", layout.id));
    }
    const existing = layout.user_mass_layout_items ?? [];
    const wantedByRole = new Map(items.map((item) => [item.role_id, item]));
    const removals = existing.filter((item) => !wantedByRole.has(item.role_id));
    if (removals.length) {
      await run(supabase.from("user_mass_layout_items").delete().in("id", removals.map((item) => item.id)));
    }
    const additions = items.filter((item) => !existing.some((current) => current.role_id === item.role_id));
    if (additions.length) {
      await run(
        supabase.from("user_mass_layout_items").insert(
          additions.map((item) => ({
            layout_id: layout.id,
            role_id: item.role_id,
            display_name: normalizeName(item.display_name)
          }))
        )
      );
    }
    for (const current of existing) {
      const item = wantedByRole.get(current.role_id);
      if (!item) continue;
      const nextName = normalizeName(item.display_name);
      if (nextName !== (current.display_name ?? null)) {
        await run(supabase.from("user_mass_layout_items").update({ display_name: nextName }).eq("id", current.id));
      }
    }
  }

  function deleteLayout(id) {
    return run(supabase.from("user_mass_layouts").delete().eq("id", id));
  }

  async function readyScores() {
    const rows = await run(
      supabase
        .from("owned_scores")
        .select(`${SCORE_FIELDS},score_files(${FILE_FIELDS}),mass_music_entries(id)`)
        .eq("status", "ready")
        .order("created_at", { ascending: false })
    );
    return rows.map(sortFiles);
  }

  function scoreUsage(scoreId) {
    return run(
      supabase
        .from("mass_music_entries")
        .select("id,mass_music_slots(id,role_id,display_name,mass_events(id,local_date,start_time,title))")
        .eq("owned_score_id", scoreId)
    );
  }

  function updateScore(id, fields) {
    return run(
      supabase
        .from("owned_scores")
        .update({ title: normalizeName(fields.title), composer_name: normalizeName(fields.composer_name) })
        .eq("id", id)
    );
  }

  async function deleteScore(score) {
    const paths = (score.score_files ?? []).map((file) => file.storage_path);
    await run(supabase.from("owned_scores").delete().eq("id", score.id));
    if (paths.length) {
      // A failure here leaves an unreferenced file; cleanupOrphans() retries later.
      await supabase.storage.from(SCORE_BUCKET).remove(paths);
    }
  }

  async function linkScore(slotId, scoreId) {
    const last = await run(
      supabase
        .from("mass_music_entries")
        .select("sort_order")
        .eq("mass_music_slot_id", slotId)
        .order("sort_order", { ascending: false })
        .limit(1)
    );
    const sortOrder = last.length ? last[0].sort_order + 1 : 0;
    return run(
      supabase.from("mass_music_entries").insert({ mass_music_slot_id: slotId, owned_score_id: scoreId, sort_order: sortOrder })
    );
  }

  function unlink(entryId) {
    return run(supabase.from("mass_music_entries").delete().eq("id", entryId));
  }

  async function signedUrl(path) {
    const { data, error } = await supabase.storage.from(SCORE_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error) throw error;
    return data.signedUrl;
  }

  async function download(path) {
    const { data, error } = await supabase.storage.from(SCORE_BUCKET).download(path);
    if (error) throw error;
    return data;
  }

  async function scoreFiles(scoreId) {
    const rows = await run(supabase.from("score_files").select(FILE_FIELDS).eq("owned_score_id", scoreId));
    return rows.sort(comparePages);
  }

  async function setPageNumbers(changes) {
    for (const change of changes) {
      await run(supabase.from("score_files").update({ page_no: change.page_no }).eq("id", change.id));
    }
  }

  // Record first: the storage delete policy only allows files no record points to.
  async function removeScoreFiles(files) {
    if (!files.length) return;
    await run(supabase.from("score_files").delete().in("id", files.map((file) => file.id)));
    await supabase.storage.from(SCORE_BUCKET).remove(files.map((file) => file.storage_path));
  }

  return {
    roles,
    observancesBetween,
    massDatesBetween,
    massesOn,
    mass,
    createMass,
    updateMass,
    deleteMass,
    forgetOccurrence,
    series,
    createSeries,
    updateSeries,
    deleteSeries,
    usedVenues,
    ensureOccurrences,
    syncFutureMasses,
    endSeries,
    saveSlots,
    layouts,
    createLayout,
    updateLayout,
    deleteLayout,
    readyScores,
    scoreUsage,
    updateScore,
    deleteScore,
    linkScore,
    unlink,
    signedUrl,
    download,
    scoreFiles,
    setPageNumbers,
    removeScoreFiles
  };
}
