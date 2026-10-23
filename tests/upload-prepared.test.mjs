import test from "node:test";
import assert from "node:assert/strict";
import { isRetryable, uploadPreparedScore } from "../js/upload-prepared.js";

const USER = "11111111-1111-4111-8111-111111111111";
const draft = (overrides = {}) => ({
  scoreId: "22222222-2222-4222-8222-222222222222",
  fileId: "33333333-3333-4333-8333-333333333333",
  thumbId: "44444444-4444-4444-8444-444444444444",
  pdf: { size: 1000, type: "application/pdf" },
  pdfName: "Prelude.pdf",
  thumb: { blob: { size: 10 }, mime: "image/webp", ext: "webp" },
  title: " Prelude ",
  composerName: "",
  ...overrides
});

// In-memory stand-in for the two tables and the bucket. failures: { name: [errors...] } consumed in order.
function fakeClient({ failures = {}, scores = [], objects = [] } = {}) {
  const state = { scores: [...scores], files: [], objects: [...objects], calls: [] };
  const fail = (name) => failures[name]?.shift() ?? null;
  const client = {
    state,
    from(table) {
      return {
        select: () => ({
          eq: (_, id) => ({
            maybeSingle: async () => {
              state.calls.push("lookup");
              const error = fail("lookup");
              return { data: error ? null : state.scores.find((row) => row.id === id) ?? null, error };
            }
          })
        }),
        insert: async (row) => {
          state.calls.push(`insert:${table}`);
          const error = fail(`insert:${table}`);
          if (!error) (table === "owned_scores" ? state.scores : state.files).push({ ...row });
          return { error };
        },
        update: (patch) => ({
          eq: async (_, id) => {
            state.calls.push("update");
            const error = fail("update");
            if (!error) Object.assign(state.scores.find((row) => row.id === id), patch);
            return { error };
          }
        }),
        delete: () => ({
          eq: async (_, id) => {
            state.calls.push(`delete:${table}`);
            state.scores = state.scores.filter((row) => row.id !== id);
            state.files = state.files.filter((row) => row.owned_score_id !== id);
            return { error: null };
          }
        })
      };
    },
    storage: {
      from: () => ({
        upload: async (path, _body, options) => {
          state.calls.push(`upload:${path.split("/").pop().split(".")[0].slice(0, 5)}`);
          state.uploadOptions = [...(state.uploadOptions ?? []), options];
          const error = fail(path.includes("thumb-") ? "upload:thumb" : "upload:pdf");
          if (!error) state.objects.push(path);
          return { error };
        },
        remove: async (paths) => {
          state.objects = state.objects.filter((path) => !paths.includes(path));
          return { error: null };
        },
        list: async (folder) => ({
          data: state.objects.filter((path) => path.startsWith(`${folder}/`)).map((path) => ({ name: path.slice(folder.length + 1) })),
          error: null
        })
      })
    }
  };
  return client;
}

const noWait = { delays: [0, 0, 0], sleep: async () => {} };

test("stores one PDF, one thumbnail and marks the Score ready", async () => {
  const client = fakeClient();
  const id = await uploadPreparedScore(client, USER, draft(), () => {}, noWait);
  assert.equal(id, draft().scoreId);
  const score = client.state.scores[0];
  assert.equal(score.status, "ready");
  assert.equal(score.title, "Prelude");
  assert.equal(score.composer_name, null);
  assert.equal(score.thumbnail_path, `${USER}/${id}/thumb-${draft().thumbId}.webp`);
  assert.equal(client.state.files.length, 1);
  assert.equal(client.state.files[0].mime_type, "application/pdf");
  assert.equal(client.state.files[0].page_no, 1);
  assert.deepEqual(client.state.objects.sort(), [`${USER}/${id}/${draft().fileId}.pdf`, `${USER}/${id}/thumb-${draft().thumbId}.webp`].sort());
  assert.match(score.thumbnail_path, new RegExp(`^${USER}/${id}/thumb-[0-9a-f-]{36}\\.(webp|jpg)$`));
  // Paths are never reused, so both files may stay in the browser cache for a year.
  assert.deepEqual(client.state.uploadOptions.map((options) => options.cacheControl), ["31536000", "31536000"]);
  assert.ok(client.state.uploadOptions.every((options) => options.upsert === false));
});

test("a thumbnail that cannot be stored does not stop the Score", async () => {
  const client = fakeClient({ failures: { "upload:thumb": [{ message: "bad mime", status: 400 }] } });
  await uploadPreparedScore(client, USER, draft(), () => {}, noWait);
  assert.equal(client.state.scores[0].status, "ready");
  assert.equal(client.state.scores[0].thumbnail_path, null);
  assert.equal(client.state.objects.length, 1);
});

test("a Score without a thumbnail is saved without one", async () => {
  const client = fakeClient();
  await uploadPreparedScore(client, USER, draft({ thumb: null }), () => {}, noWait);
  assert.equal(client.state.scores[0].thumbnail_path, null);
  assert.equal(client.state.objects.length, 1);
});

test("a network failure is retried and leaves exactly one Score and one PDF", async () => {
  const client = fakeClient({ failures: { "upload:pdf": [new TypeError("Failed to fetch")], "update": [new TypeError("Failed to fetch")] } });
  const stages = [];
  await uploadPreparedScore(client, USER, draft(), (stage, attemptNo) => stages.push(`${stage}:${attemptNo}`), noWait);
  assert.equal(client.state.scores.length, 1);
  assert.equal(client.state.scores[0].status, "ready");
  assert.equal(client.state.files.length, 1);
  assert.equal(client.state.objects.length, 2);
  assert.ok(stages.includes("retry:1") && stages.includes("retry:2"));
});

test("gives up after the last retry and removes what this try stored", async () => {
  const errors = () => Array.from({ length: 10 }, () => new TypeError("Failed to fetch"));
  const client = fakeClient({ failures: { "update": errors() } });
  await assert.rejects(uploadPreparedScore(client, USER, draft(), () => {}, noWait), /fetch/);
  assert.equal(client.state.scores.length, 0);
  assert.equal(client.state.files.length, 0);
  assert.equal(client.state.objects.length, 0);
});

test("a database error is not retried", async () => {
  const client = fakeClient({ failures: { "insert:score_files": [{ message: "violates check", code: "23514" }] } });
  await assert.rejects(uploadPreparedScore(client, USER, draft(), () => {}, noWait), { code: "23514" });
  assert.equal(client.state.calls.filter((call) => call === "insert:owned_scores").length, 1);
  assert.equal(client.state.scores.length, 0);
  assert.equal(client.state.objects.length, 0);
});

test("an already finished Score counts as done (answer lost on a previous try)", async () => {
  const d = draft();
  const client = fakeClient({ scores: [{ id: d.scoreId, status: "ready" }] });
  const id = await uploadPreparedScore(client, USER, d, () => {}, noWait);
  assert.equal(id, d.scoreId);
  assert.equal(client.state.calls.includes("insert:owned_scores"), false);
});

test("a half-finished record from an earlier try is cleared and uploaded again", async () => {
  const d = draft();
  const client = fakeClient({
    scores: [{ id: d.scoreId, status: "uploading" }],
    objects: [`${USER}/${d.scoreId}/${d.fileId}.pdf`]
  });
  await uploadPreparedScore(client, USER, d, () => {}, noWait);
  assert.equal(client.state.scores.length, 1);
  assert.equal(client.state.scores[0].status, "ready");
  assert.equal(client.state.objects.length, 2);
});

test("empty and oversized PDFs are refused before anything is sent", async () => {
  const client = fakeClient();
  await assert.rejects(uploadPreparedScore(client, USER, draft({ pdf: { size: 0 } }), () => {}, noWait), { code: "file_empty" });
  await assert.rejects(uploadPreparedScore(client, USER, draft({ pdf: { size: 21 * 1024 * 1024 } }), () => {}, noWait), { code: "file_size" });
  assert.equal(client.state.calls.length, 0);
});

test("isRetryable separates network trouble from real errors", () => {
  assert.equal(isRetryable(new TypeError("Failed to fetch")), true);
  assert.equal(isRetryable({ message: "Gateway", status: 502 }), true);
  assert.equal(isRetryable({ message: "Payload too large", status: 413 }), false);
  assert.equal(isRetryable({ message: "violates", code: "23514" }), false);
  assert.equal(isRetryable(null), false);
});
