// Phase 1 scenario + permission test against the real Supabase project.
// Uses only the publishable key and two confirmed test accounts in .env.test:
//   TEST_A_EMAIL=...  TEST_A_PASSWORD=...  TEST_B_EMAIL=...  TEST_B_PASSWORD=...
// Creates rows tagged with a unique marker and deletes only those rows afterwards.
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
const TAG = `PHASE1-TEST-${Date.now()}`;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

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
  const headers = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${session.token}`, ...extra });
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
    userId: session.userId,
    async rest(method, path, body) {
      return parse(
        await fetch(`${BASE}/rest/v1/${path}`, {
          method,
          headers: headers({ "Content-Type": "application/json", Prefer: "return=representation" }),
          body: body === undefined ? undefined : JSON.stringify(body)
        })
      );
    },
    async upload(path, bytes, contentType) {
      return parse(
        await fetch(`${BASE}/storage/v1/object/scores/${path}`, {
          method: "POST",
          headers: headers({ "Content-Type": contentType, "x-upsert": "false" }),
          body: bytes
        })
      );
    },
    async download(path) {
      const response = await fetch(`${BASE}/storage/v1/object/authenticated/scores/${path}`, { headers: headers() });
      await response.arrayBuffer();
      return response.status;
    },
    async sign(path) {
      return parse(
        await fetch(`${BASE}/storage/v1/object/sign/scores/${path}`, {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ expiresIn: 60 })
        })
      );
    },
    async list(prefix) {
      return parse(
        await fetch(`${BASE}/storage/v1/object/list/scores`, {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ prefix, limit: 100 })
        })
      );
    },
    async remove(paths) {
      return parse(
        await fetch(`${BASE}/storage/v1/object/scores`, {
          method: "DELETE",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ prefixes: paths })
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

test("phase 1: masses, scores, links, reuse and isolation", { skip: ready ? false : "fill .env.test with two test accounts" }, async (t) => {
  const a = client(await signIn(env.TEST_A_EMAIL, env.TEST_A_PASSWORD));
  const b = client(await signIn(env.TEST_B_EMAIL, env.TEST_B_PASSWORD));
  assert.notEqual(a.userId, b.userId);

  const created = { aMasses: [], bMasses: [], aScores: [], aPaths: [] };
  const state = {};

  t.after(async () => {
    for (const id of created.bMasses) await b.rest("DELETE", `mass_events?id=eq.${id}`);
    for (const id of created.aMasses) await a.rest("DELETE", `mass_events?id=eq.${id}`);
    for (const id of created.aScores) await a.rest("DELETE", `owned_scores?id=eq.${id}`);
    if (created.aPaths.length) await a.remove(created.aPaths);
    const leftA = await a.rest("GET", `mass_events?select=id&title=like.${encodeURIComponent(TAG)}*`);
    const leftB = await b.rest("GET", `mass_events?select=id&title=like.${encodeURIComponent(TAG)}*`);
    assert.deepEqual([leftA.data, leftB.data], [[], []], "test rows were not fully cleaned up");
  });

  await t.test("reference data: 19 fixed items and the official calendar", async () => {
    const roles = await a.rest("GET", "liturgical_roles?select=id,code,slot_no,name_ko&order=slot_no");
    assert.equal(roles.data.length, 19);
    assert.deepEqual(roles.data.map((role) => role.slot_no), [...Array(19).keys()]);
    assert.deepEqual(roles.data.slice(15).map((role) => role.code), ["post_communion", "meditation", "recessional", "postlude"]);
    assert.equal(roles.data[12].name_ko, "주님께 나라와");
    state.roles = roles.data;
    state.postlude = roles.data[18];

    const day = await a.rest("GET", "liturgical_observances?select=*&calendar_date=eq.2026-10-25");
    assert.equal(day.data.length, 1);
    assert.equal(day.data[0].name_ko, "연중 제30주일");
    assert.equal(day.data[0].color_code, "green");
    state.oct25 = day.data[0];

    const write = await a.rest("POST", "liturgical_observances", { calendar_date: "2030-01-01", name_ko: "x", color_code: "green", rank_code: "weekday" });
    assert.ok(!write.ok, "members must not write the official calendar");
  });

  await t.test("two masses on the same date, observance rows unchanged", async () => {
    const base = {
      local_date: "2026-10-25",
      observance_id: state.oct25.id,
      celebration_name: state.oct25.name_ko,
      color_code: state.oct25.color_code,
      season_code: state.oct25.season_code,
      liturgy_source: "official"
    };
    const first = one(await a.rest("POST", "mass_events", { ...base, title: `${TAG} 교중미사`, start_time: "11:00" }), "mass 1");
    const second = one(await a.rest("POST", "mass_events", { ...base, title: `${TAG} 저녁미사`, start_time: "19:00" }), "mass 2");
    created.aMasses.push(first.id, second.id);
    assert.equal(first.user_id, a.userId, "user_id defaults to the signed-in member");
    state.mass1 = first;
    state.mass2 = second;

    const slots1 = await a.rest("POST", "mass_music_slots", state.roles.map((role) => ({ mass_event_id: first.id, role_id: role.id })));
    assert.equal(slots1.data.length, 19);
    const slots2 = await a.rest("POST", "mass_music_slots", [{ mass_event_id: second.id, role_id: state.postlude.id }]);
    assert.ok(slots2.ok);
    state.postlude1 = slots1.data.find((slot) => slot.role_id === state.postlude.id);
    state.postlude2 = slots2.data[0];

    const sameDay = await a.rest("GET", `mass_events?select=id&local_date=eq.2026-10-25&title=like.${encodeURIComponent(TAG)}*`);
    assert.equal(sameDay.data.length, 2);
    const day = await a.rest("GET", "liturgical_observances?select=id&calendar_date=eq.2026-10-25");
    assert.equal(day.data.length, 1, "creating masses must not add calendar rows");
  });

  await t.test("upload a PDF score (record, file, file record, ready)", async () => {
    const score = one(await a.rest("POST", "owned_scores", { provisional_title: `${TAG}.pdf`, status: "uploading" }), "score");
    created.aScores.push(score.id);
    assert.equal(score.title, null, "title may stay empty");
    const fileId = crypto.randomUUID();
    const path = `${a.userId}/${score.id}/${fileId}.pdf`;
    const uploaded = await a.upload(path, PDF_BYTES, "application/pdf");
    assert.ok(uploaded.ok, `upload: ${uploaded.status} ${JSON.stringify(uploaded.data)}`);
    created.aPaths.push(path);

    const badPath = await a.rest("POST", "score_files", {
      owned_score_id: score.id,
      storage_path: `${a.userId}/elsewhere/${fileId}.pdf`,
      mime_type: "application/pdf",
      byte_size: PDF_BYTES.length
    });
    assert.ok(!badPath.ok, "path format is enforced by the database");

    one(await a.rest("POST", "score_files", {
      id: fileId,
      owned_score_id: score.id,
      storage_path: path,
      mime_type: "application/pdf",
      byte_size: PDF_BYTES.length,
      original_filename: `${TAG}.pdf`,
      page_no: 1
    }), "score file");
    state.score = one(await a.rest("PATCH", `owned_scores?id=eq.${score.id}`, { status: "ready" }), "ready");
    state.path = path;
    assert.equal(await a.download(path), 200);
  });

  await t.test("link to the first mass postlude only; no play count", async () => {
    one(await a.rest("POST", "mass_music_entries", { mass_music_slot_id: state.postlude1.id, owned_score_id: state.score.id }), "link");
    const first = await a.rest("GET", `mass_music_entries?select=id&mass_music_slot_id=eq.${state.postlude1.id}`);
    const second = await a.rest("GET", `mass_music_entries?select=id&mass_music_slot_id=eq.${state.postlude2.id}`);
    assert.equal(first.data.length, 1);
    assert.equal(second.data.length, 0, "the second mass stays unlinked");
    const confirmations = await a.rest("GET", "performance_confirmations?select=id");
    assert.equal(confirmations.data.length, 0, "linking never creates a performance confirmation");
  });

  await t.test("linked score cannot be deleted, file cannot be removed", async () => {
    const refused = await a.rest("DELETE", `owned_scores?id=eq.${state.score.id}`);
    assert.ok(!refused.ok, "deleting a linked score must be refused");
    assert.equal(refused.data?.code, "23503");
    const removed = await a.remove([state.path]);
    assert.deepEqual(removed.ok ? removed.data : [], [], "referenced file must not be deletable");
    assert.equal(await a.download(state.path), 200);
  });

  await t.test("unlink keeps the score; relink on another date", async () => {
    const entry = await a.rest("GET", `mass_music_entries?select=id&mass_music_slot_id=eq.${state.postlude1.id}`);
    const unlinked = await a.rest("DELETE", `mass_music_entries?id=eq.${entry.data[0].id}`);
    assert.ok(unlinked.ok);
    const still = await a.rest("GET", `owned_scores?select=id,status&id=eq.${state.score.id}`);
    assert.deepEqual(still.data, [{ id: state.score.id, status: "ready" }]);
    assert.equal(await a.download(state.path), 200);

    const other = one(await a.rest("POST", "mass_events", { local_date: "2026-11-01", title: `${TAG} 모든 성인`, liturgy_source: "unknown" }), "mass 3");
    created.aMasses.push(other.id);
    const slot = one(await a.rest("POST", "mass_music_slots", { mass_event_id: other.id, role_id: state.postlude.id }), "slot 3");
    one(await a.rest("POST", "mass_music_entries", { mass_music_slot_id: slot.id, owned_score_id: state.score.id }), "relink");
    one(await a.rest("POST", "mass_music_entries", { mass_music_slot_id: state.postlude1.id, owned_score_id: state.score.id }), "link again");
    const uses = await a.rest("GET", `mass_music_entries?select=id&owned_score_id=eq.${state.score.id}`);
    assert.equal(uses.data.length, 2, "one score reused in two masses");
    state.mass3 = other;
  });

  await t.test("created_at is immutable; last_edited_at moves only on edits", async () => {
    const changed = await a.rest("PATCH", `owned_scores?id=eq.${state.score.id}`, { created_at: "2020-01-01T00:00:00Z" });
    assert.ok(!changed.ok, "created_at change must be refused");
    const before = (await a.rest("GET", `owned_scores?select=created_at,last_edited_at&id=eq.${state.score.id}`)).data[0];
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const edited = one(await a.rest("PATCH", `owned_scores?id=eq.${state.score.id}`, { title: `${TAG} 후주`, composer_name: "테스트" }), "edit");
    assert.equal(edited.created_at, before.created_at);
    assert.ok(new Date(edited.last_edited_at) > new Date(before.last_edited_at));
  });

  await t.test("member B cannot see A's masses, scores, links or files", async () => {
    for (const path of [
      `mass_events?select=id&id=eq.${state.mass1.id}`,
      `mass_music_slots?select=id&mass_event_id=eq.${state.mass1.id}`,
      `owned_scores?select=id&id=eq.${state.score.id}`,
      `score_files?select=id&owned_score_id=eq.${state.score.id}`,
      `mass_music_entries?select=id&owned_score_id=eq.${state.score.id}`
    ]) {
      const seen = await b.rest("GET", path);
      assert.deepEqual(seen.data, [], `B saw ${path}`);
    }
    assert.notEqual(await b.download(state.path), 200);
    assert.ok(!(await b.sign(state.path)).ok);
    const listing = await b.list(`${a.userId}/`);
    assert.deepEqual(listing.ok ? listing.data : [], []);
  });

  await t.test("member B cannot link, write or upload into A's data", async () => {
    const mine = one(await b.rest("POST", "mass_events", { local_date: "2026-10-25", title: `${TAG} B 미사` }), "B mass");
    created.bMasses.push(mine.id);
    const slot = one(await b.rest("POST", "mass_music_slots", { mass_event_id: mine.id, role_id: state.postlude.id }), "B slot");
    const steal = await b.rest("POST", "mass_music_entries", { mass_music_slot_id: slot.id, owned_score_id: state.score.id });
    assert.ok(!steal.ok, "B must not link A's score");

    const intoA = await b.rest("POST", "mass_music_slots", { mass_event_id: state.mass2.id, role_id: state.roles[0].id });
    assert.ok(!intoA.ok, "B must not add items to A's mass");
    const asA = await b.rest("POST", "mass_events", { user_id: a.userId, local_date: "2026-10-25", title: `${TAG} forged` });
    assert.ok(!asA.ok, "B must not create rows owned by A");

    const renamed = await b.rest("PATCH", `mass_events?id=eq.${state.mass1.id}`, { title: "hijacked" });
    assert.deepEqual(renamed.data, []);
    const check = await a.rest("GET", `mass_events?select=title&id=eq.${state.mass1.id}`);
    assert.equal(check.data[0].title, `${TAG} 교중미사`);

    const upload = await b.upload(`${a.userId}/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`, PDF_BYTES, "application/pdf");
    assert.ok(!upload.ok, "B must not upload into A's folder");
  });

  await t.test("deleting a mass removes its links but keeps the score", async () => {
    const deleted = await a.rest("DELETE", `mass_events?id=eq.${state.mass3.id}`);
    assert.ok(deleted.ok);
    created.aMasses = created.aMasses.filter((id) => id !== state.mass3.id);
    const uses = await a.rest("GET", `mass_music_entries?select=id&owned_score_id=eq.${state.score.id}`);
    assert.equal(uses.data.length, 1);
    const still = await a.rest("GET", `owned_scores?select=id&id=eq.${state.score.id}`);
    assert.equal(still.data.length, 1);
  });

  await t.test("an unlinked score can be deleted with its file", async () => {
    for (const id of [state.mass1.id, state.mass2.id]) {
      assert.ok((await a.rest("DELETE", `mass_events?id=eq.${id}`)).ok);
    }
    created.aMasses = [];
    const deleted = await a.rest("DELETE", `owned_scores?id=eq.${state.score.id}`);
    assert.ok(deleted.ok, `delete score: ${JSON.stringify(deleted.data)}`);
    created.aScores = [];
    const removed = await a.remove([state.path]);
    assert.ok(removed.ok && removed.data.length === 1, "file removable once no record points to it");
    created.aPaths = [];
    assert.notEqual(await a.download(state.path), 200);
  });
});
