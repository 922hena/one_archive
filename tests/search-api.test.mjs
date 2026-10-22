// Advanced search test against the real Supabase project (PRD 4.13, decisions D1 and D2).
// Uses only the publishable key and two confirmed test accounts in .env.test:
//   TEST_A_EMAIL=...  TEST_A_PASSWORD=...  TEST_B_EMAIL=...  TEST_B_PASSWORD=...
// Creates rows tagged with a unique marker and deletes only those rows afterwards.
// Every search sends q = TAG, so other rows of the test accounts never enter the results.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function readEnv() {
  const env = { ...process.env };
  const file = new URL("../.env.test", import.meta.url);
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  const config = readFileSync(new URL("../config.js", import.meta.url), "utf8");
  env.SUPABASE_URL ??= /supabaseUrl:\s*"([^"]+)"/.exec(config)?.[1];
  env.SUPABASE_PUBLISHABLE_KEY ??= /supabasePublishableKey:\s*"([^"]+)"/.exec(config)?.[1];
  return env;
}

const env = readEnv();
const BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_PUBLISHABLE_KEY;
const ready = Boolean(BASE && KEY && env.TEST_A_EMAIL && env.TEST_A_PASSWORD && env.TEST_B_EMAIL && env.TEST_B_PASSWORD);
const TAG = `SEARCH-TEST-${Date.now()}`;

async function signIn(email, password) {
  const response = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`sign-in failed for ${email}: ${body.error_description ?? body.msg ?? response.status}`);
  return { token: body.access_token, userId: body.user.id };
}

function client(session) {
  const headers = (extra = {}) => ({ apikey: KEY, ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...extra });
  async function parse(response) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, ok: response.ok, data };
  }
  return {
    userId: session?.userId,
    async rest(method, path, body) {
      return parse(
        await fetch(`${BASE}/rest/v1/${path}`, {
          method,
          headers: headers({ "Content-Type": "application/json", Prefer: "return=representation" }),
          body: body === undefined ? undefined : JSON.stringify(body)
        })
      );
    },
    async rpc(name, args) {
      return parse(
        await fetch(`${BASE}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(args)
        })
      );
    }
  };
}

function one(result, label) {
  assert.ok(result.ok, `${label}: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  assert.equal(result.data.length, 1, `${label}: expected one row`);
  return result.data[0];
}

function seoulToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("advanced search: played rule, same record, counts, places and isolation", { skip: ready ? false : "fill .env.test with two test accounts" }, async (t) => {
  const a = client(await signIn(env.TEST_A_EMAIL, env.TEST_A_PASSWORD));
  const b = client(await signIn(env.TEST_B_EMAIL, env.TEST_B_PASSWORD));
  const anon = client(null);
  assert.notEqual(a.userId, b.userId);

  const created = { aMasses: [], bMasses: [], aScores: [], bScores: [], aVenues: [] };
  const state = {};

  t.after(async () => {
    for (const id of created.bMasses) await b.rest("DELETE", `mass_events?id=eq.${id}`);
    for (const id of created.aMasses) await a.rest("DELETE", `mass_events?id=eq.${id}`);
    for (const id of created.bScores) await b.rest("DELETE", `owned_scores?id=eq.${id}`);
    for (const id of created.aScores) await a.rest("DELETE", `owned_scores?id=eq.${id}`);
    for (const id of created.aVenues) await a.rest("DELETE", `user_venues?id=eq.${id}`);
    const tag = encodeURIComponent(TAG);
    const left = [
      await a.rest("GET", `mass_events?select=id&title=like.${tag}*`),
      await b.rest("GET", `mass_events?select=id&title=like.${tag}*`),
      await a.rest("GET", `owned_scores?select=id&provisional_title=like.${tag}*`),
      await b.rest("GET", `owned_scores?select=id&provisional_title=like.${tag}*`),
      await a.rest("GET", `user_venues?select=id&name=like.${tag}*`)
    ];
    assert.deepEqual(left.map((result) => result.data), [[], [], [], [], []], "test rows were not fully cleaned up");
  });

  async function scores(client, filters, extra = {}) {
    const result = await client.rpc("search_scores", { p_filters: { q: TAG, ...filters }, ...extra });
    assert.ok(result.ok, `search_scores: HTTP ${result.status} ${JSON.stringify(result.data)}`);
    return result.data;
  }
  const titles = (rows) => rows.map((row) => row.title).sort();

  await t.test("set up places, scores and past, today and future masses", async () => {
    const roles = await a.rest("GET", "liturgical_roles?select=id,code");
    state.role = Object.fromEntries(roles.data.map((role) => [role.code, role.id]));

    state.venueMy = one(await a.rest("POST", "user_venues", { name: `${TAG} Myeongdong` }), "place 1");
    state.venueHe = one(await a.rest("POST", "user_venues", { name: `${TAG} Heukseok` }), "place 2");
    created.aVenues.push(state.venueMy.id, state.venueHe.id);
    assert.equal(state.venueMy.user_id, a.userId);
    const twin = await a.rest("POST", "user_venues", { name: ` ${TAG} myeongdong ` });
    assert.ok(!twin.ok, "the same place name with other case or spaces is refused");

    state.score = {};
    for (const [key, title] of [["s1", "Toccata"], ["s2", "Prelude B"], ["s3", "Fugue C"], ["s4", "Not played piece"], ["s5", "Never played"], ["s6", "Cancelled piece"], ["s7", "Future piece"]]) {
      const row = one(await a.rest("POST", "owned_scores", { title, provisional_title: `${TAG} ${key}.pdf`, status: "ready" }), title);
      state.score[key] = row.id;
      created.aScores.push(row.id);
    }

    async function mass(date, season, venue, status = "planned") {
      const row = one(await a.rest("POST", "mass_events", { local_date: date, season_code: season, venue_id: venue?.id ?? null, status, title: `${TAG} ${date}` }), `mass ${date}`);
      created.aMasses.push(row.id);
      return row;
    }
    async function link(massRow, role, scoreKey, notPlayed = false) {
      let slot = (await a.rest("GET", `mass_music_slots?select=id&mass_event_id=eq.${massRow.id}&role_id=eq.${state.role[role]}`)).data[0];
      slot ??= one(await a.rest("POST", "mass_music_slots", { mass_event_id: massRow.id, role_id: state.role[role] }), "slot");
      return one(await a.rest("POST", "mass_music_entries", {
        mass_music_slot_id: slot.id,
        owned_score_id: state.score[scoreKey],
        not_played_at: notPlayed ? new Date().toISOString() : null
      }), "entry");
    }

    const today = seoulToday();
    const m1 = await mass("2025-03-30", "lent", state.venueMy);
    await link(m1, "postlude", "s1");
    await link(m1, "prelude", "s2");
    const m2 = await mass("2025-07-06", "ordinary", state.venueHe);
    await link(m2, "postlude", "s2");
    await link(m2, "prelude", "s1");
    const m3 = await mass("2024-03-10", "lent", state.venueMy);
    await link(m3, "postlude", "s3");
    state.notPlayed = await link(m3, "postlude", "s4", true);
    const m4 = await mass("2025-03-16", "lent", state.venueMy);
    await link(m4, "postlude", "s3");
    const m5 = await mass("2025-03-23", "lent", state.venueMy, "cancelled");
    await link(m5, "postlude", "s6");
    const m6 = await mass(addDays(today, 30), "lent", state.venueMy);
    await link(m6, "postlude", "s7");
    const m7 = await mass(today, "lent", state.venueMy);
    await link(m7, "postlude", "s7");
  });

  await t.test("Lent + Postludium + exactly 1 does not mix other seasons or parts", async () => {
    const rows = await scores(a, { seasons: ["lent"], role_ids: [state.role.postlude], count: { op: "eq", value: 1 } });
    assert.deepEqual(titles(rows), ["Toccata"]);
  });

  await t.test("2 or more, and 0 compared with every score", async () => {
    const two = await scores(a, { seasons: ["lent"], role_ids: [state.role.postlude], count: { op: "gte", value: 2 } });
    assert.deepEqual(titles(two), ["Fugue C"]);
    const zero = await scores(a, { seasons: ["lent"], role_ids: [state.role.postlude], count: { op: "eq", value: 0 } });
    assert.deepEqual(titles(zero), ["Cancelled piece", "Future piece", "Never played", "Not played piece", "Prelude B"]);
  });

  await t.test("not played, cancelled, today and future are not counted", async () => {
    const rows = await scores(a, {});
    const count = Object.fromEntries(rows.map((row) => [row.title, row.all_count]));
    assert.deepEqual(count, { Toccata: 2, "Prelude B": 2, "Fugue C": 2, "Not played piece": 0, "Never played": 0, "Cancelled piece": 0, "Future piece": 0 });
    assert.equal(Number(rows[0].total_count), 7);
  });

  await t.test("all time 2 or more AND 0 times at one place", async () => {
    const rows = await scores(a, { count: { op: "gte", value: 2 }, extra_count: { scope: "venue", venue_ids: [state.venueHe.id], op: "eq", value: 0 } });
    assert.deepEqual(titles(rows), ["Fugue C"]);
  });

  await t.test("history lists played songs newest first", async () => {
    const result = await a.rpc("search_history", { p_filters: { q: TAG, seasons: ["lent"], role_ids: [state.role.postlude] } });
    assert.ok(result.ok, JSON.stringify(result.data));
    assert.deepEqual(result.data.map((row) => [row.local_date, row.title, row.venue_label]), [
      ["2025-03-30", "Toccata", `${TAG} Myeongdong`],
      ["2025-03-16", "Fugue C", `${TAG} Myeongdong`],
      ["2024-03-10", "Fugue C", `${TAG} Myeongdong`]
    ]);
  });

  await t.test("clearing Not played counts the song again", async () => {
    one(await a.rest("PATCH", `mass_music_entries?id=eq.${state.notPlayed.id}`, { not_played_at: null }), "clear mark");
    const rows = await scores(a, { seasons: ["lent"], role_ids: [state.role.postlude], count: { op: "eq", value: 1 } });
    assert.deepEqual(titles(rows), ["Not played piece", "Toccata"]);
  });

  await t.test("key, period and removed pages", async () => {
    one(await a.rest("PATCH", `owned_scores?id=eq.${state.score.s1}`, { key_tonic: "D", key_mode: "minor", key_text: "d-Moll" }), "key");
    one(await a.rest("PATCH", `owned_scores?id=eq.${state.score.s3}`, { composition_year: 1900 }), "year");
    assert.deepEqual(titles(await scores(a, { keys: [{ tonic: "D", mode: "minor" }] })), ["Toccata"]);
    assert.deepEqual(titles(await scores(a, { periods: ["romantic"] })), ["Fugue C"]);

    const fileId = crypto.randomUUID();
    one(await a.rest("POST", "score_files", {
      id: fileId,
      owned_score_id: state.score.s5,
      storage_path: `${a.userId}/${state.score.s5}/${fileId}.jpg`,
      mime_type: "image/jpeg",
      byte_size: 10,
      page_no: 1
    }), "file row");
    let row = (await scores(a, {})).find((score) => score.score_id === state.score.s5);
    assert.equal(row.file_count, 1);
    one(await a.rest("PATCH", `score_files?id=eq.${fileId}`, { removed_at: new Date().toISOString() }), "remove page");
    row = (await scores(a, {})).find((score) => score.score_id === state.score.s5);
    assert.equal(row.file_count, 0);
    assert.equal(row.first_file_path, null);
    const moved = await a.rest("PATCH", `score_files?id=eq.${fileId}`, { storage_path: `${a.userId}/${state.score.s5}/x.jpg` });
    assert.ok(!moved.ok, "storage path stays locked");
  });

  await t.test("member B sees nothing of A and cannot change A's rows", async () => {
    assert.deepEqual(await scores(b, {}), []);
    const view = await b.rest("GET", `performed_entries?select=entry_id&owned_score_id=eq.${state.score.s1}`);
    assert.deepEqual(view.data, []);
    const places = await b.rest("GET", `user_venues?select=id&id=eq.${state.venueMy.id}`);
    assert.deepEqual(places.data, []);
    const mark = await b.rest("PATCH", `mass_music_entries?id=eq.${state.notPlayed.id}`, { not_played_at: new Date().toISOString() });
    assert.deepEqual(mark.data, []);
    const forged = await b.rest("POST", "user_venues", { user_id: a.userId, name: `${TAG} forged` });
    assert.ok(!forged.ok, "B must not create a place owned by A");
  });

  await t.test("signed-out visitors cannot search or read played songs", async () => {
    const search = await anon.rpc("search_scores", { p_filters: { q: TAG } });
    assert.ok(!search.ok, "anon must not call search_scores");
    const view = await anon.rest("GET", "performed_entries?select=entry_id&limit=1");
    assert.ok(!view.ok, "anon must not read performed_entries");
  });

  await t.test("deleting a place keeps the Missa", async () => {
    assert.ok((await a.rest("DELETE", `user_venues?id=eq.${state.venueHe.id}`)).ok);
    created.aVenues = created.aVenues.filter((id) => id !== state.venueHe.id);
    const masses = await a.rest("GET", `mass_events?select=id,venue_id&title=eq.${encodeURIComponent(`${TAG} 2025-07-06`)}`);
    assert.deepEqual(masses.data.map((row) => row.venue_id), [null]);
  });
});
