// Uploads one finished Score: one final PDF plus (when it could be made) one small thumbnail.
// Kept free of browser-only imports so tests/upload-prepared.test.mjs can run it with a fake client.
// Original photos never reach this code: the PDF is built on the device first.

const BUCKET = "scores";
export const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;
export const RETRY_DELAYS_MS = [1000, 3000, 7000];

function nullable(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function problem(code) {
  return Object.assign(new Error(code), { code });
}

// Failures worth trying again: lost connection, timeouts, server-side hiccups.
export function isRetryable(error) {
  if (!error) return false;
  if (error.code === "file_size" || error.code === "file_empty") return false;
  const status = Number(error.status ?? error.statusCode ?? error.originalError?.status);
  if (status >= 500) return true;
  if (status >= 400) return false;
  if (error.code || error.details || error.hint) return false; // database errors are not network errors
  const text = `${error.name ?? ""} ${error.message ?? ""} ${error.originalError?.message ?? ""}`;
  return error instanceof TypeError || /fetch|network|timeout|timed out|load failed|connection/i.test(text);
}

async function listFolder(supabase, folder) {
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000 });
  if (error) throw error;
  return data ?? [];
}

// Record first: the storage delete policy only allows files no record points to.
async function removeScoreRecord(supabase, scoreId, paths) {
  const { error } = await supabase.from("owned_scores").delete().eq("id", scoreId);
  if (error) throw error;
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}

// One try. Everything stored by this try is removed again if it fails, so a retry starts clean.
async function attempt(supabase, userId, draft, onProgress) {
  const { scoreId, fileId, thumbId } = draft;

  const { data: existing, error: lookupError } = await supabase
    .from("owned_scores")
    .select("id,status")
    .eq("id", scoreId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing?.status === "ready") return scoreId; // an earlier try finished and only the answer was lost
  if (existing) {
    // A half-finished record from an earlier try: clear it, then upload again from the start.
    const files = await listFolder(supabase, `${userId}/${scoreId}`).catch(() => []);
    await removeScoreRecord(supabase, scoreId, files.map((file) => `${userId}/${scoreId}/${file.name}`));
  }

  const { error: scoreError } = await supabase.from("owned_scores").insert({
    id: scoreId,
    title: nullable(draft.title),
    composer_name: nullable(draft.composerName),
    provisional_title: draft.pdfName || "score.pdf",
    status: "uploading"
  });
  if (scoreError) throw scoreError;

  const uploadedPaths = [];
  try {
    onProgress("pdf");
    const pdfPath = `${userId}/${scoreId}/${fileId}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(pdfPath, draft.pdf, { contentType: "application/pdf", upsert: false });
    if (uploadError) throw uploadError;
    uploadedPaths.push(pdfPath);

    const { error: fileError } = await supabase.from("score_files").insert({
      id: fileId,
      owned_score_id: scoreId,
      storage_path: pdfPath,
      mime_type: "application/pdf",
      byte_size: draft.pdf.size,
      original_filename: draft.pdfName || null,
      page_no: 1,
      role: "page"
    });
    if (fileError) throw fileError;

    // The thumbnail is a convenience: if it can't be stored the Score still saves without one.
    let thumbnailPath = null;
    if (draft.thumb?.blob) {
      onProgress("thumbnail");
      const path = `${userId}/${scoreId}/thumb-${thumbId}.${draft.thumb.ext}`;
      const { error: thumbError } = await supabase.storage
        .from(BUCKET)
        .upload(path, draft.thumb.blob, { contentType: draft.thumb.mime, upsert: false });
      if (!thumbError) {
        uploadedPaths.push(path);
        thumbnailPath = path;
      }
    }

    const { error: readyError } = await supabase
      .from("owned_scores")
      .update({ status: "ready", thumbnail_path: thumbnailPath })
      .eq("id", scoreId);
    if (readyError) throw readyError;
    return scoreId;
  } catch (error) {
    try {
      await removeScoreRecord(supabase, scoreId, uploadedPaths);
    } catch {
      // the next try (or cleanupStaleUploads) clears what is left
    }
    throw error;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// draft: see upload-drafts.js. onProgress(stage, attempt) with stage "pdf" | "thumbnail" | "retry".
// Automatic retries only for network-type failures; other errors are thrown at once.
export async function uploadPreparedScore(supabase, userId, draft, onProgress = () => {}, { delays = RETRY_DELAYS_MS, sleep = wait } = {}) {
  if (!draft?.pdf?.size) throw problem("file_empty");
  if (draft.pdf.size > MAX_PDF_UPLOAD_BYTES) throw problem("file_size");
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt(supabase, userId, draft, (stage) => onProgress(stage, tries + 1));
    } catch (error) {
      if (tries >= delays.length || !isRetryable(error)) throw error;
      onProgress("retry", tries + 1);
      await sleep(delays[tries]);
    }
  }
}

// Removes a Score's thumbnail file and clears its path. Used when a Score is deleted or replaced.
export async function removeThumbnailFile(supabase, path) {
  if (path) await supabase.storage.from(BUCKET).remove([path]);
}
