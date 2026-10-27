// Attach Score File (PRD RIGHT-004): the PDF made by Upload File or Scan Score goes into a Score that was saved
// with "Save Score Information Only". The Score keeps its id, first-saved time, Missa links, notes and history;
// only what one try added is removed again when it fails. Free of browser-only imports for the tests.
import { CACHE_SECONDS, MAX_PDF_UPLOAD_BYTES, RETRY_DELAYS_MS, SCORE_BUCKET, isRetryable } from "./upload-prepared.js";

function problem(code) {
  return Object.assign(new Error(code), { code });
}

async function attempt(supabase, userId, scoreId, prepared, onProgress) {
  const { data: existing, error: lookupError } = await supabase.from("score_files").select("id").eq("owned_score_id", scoreId);
  if (lookupError) throw lookupError;
  if (existing.some((file) => file.id === prepared.fileId)) return scoreId; // an earlier try finished and only the answer was lost
  if (existing.length) throw problem("has_files");

  const uploadedPaths = [];
  let fileSaved = false;
  try {
    onProgress("pdf");
    const pdfPath = `${userId}/${scoreId}/${prepared.fileId}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(SCORE_BUCKET)
      .upload(pdfPath, prepared.pdf, { contentType: "application/pdf", cacheControl: CACHE_SECONDS, upsert: false });
    if (uploadError) throw uploadError;
    uploadedPaths.push(pdfPath);

    const { error: fileError } = await supabase.from("score_files").insert({
      id: prepared.fileId,
      owned_score_id: scoreId,
      storage_path: pdfPath,
      mime_type: "application/pdf",
      byte_size: prepared.pdf.size,
      original_filename: prepared.pdfName || null,
      page_no: 1,
      role: "page"
    });
    if (fileError) throw fileError;
    fileSaved = true;

    // Same as an uploaded Score: the file name is the fallback title, and the thumbnail is optional.
    const patch = { provisional_title: prepared.pdfName || "score.pdf" };
    if (prepared.thumb?.blob) {
      onProgress("thumbnail");
      const path = `${userId}/${scoreId}/thumb-${prepared.thumbId}.${prepared.thumb.ext}`;
      const { error: thumbError } = await supabase.storage
        .from(SCORE_BUCKET)
        .upload(path, prepared.thumb.blob, { contentType: prepared.thumb.mime, cacheControl: CACHE_SECONDS, upsert: false });
      if (!thumbError) {
        uploadedPaths.push(path);
        patch.thumbnail_path = path;
      }
    }
    const { error: scoreError } = await supabase.from("owned_scores").update(patch).eq("id", scoreId);
    if (scoreError) throw scoreError;
    return scoreId;
  } catch (error) {
    try {
      // Record first: the storage delete policy only allows files no record points to.
      if (fileSaved) await supabase.from("score_files").delete().eq("id", prepared.fileId);
      if (uploadedPaths.length) await supabase.storage.from(SCORE_BUCKET).remove(uploadedPaths);
    } catch {
      // an unreferenced file is cleared by the next try or by cleanupStaleUploads
    }
    throw error;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// prepared: { fileId, thumbId, pdf, pdfName, thumb } from prepareScore. onProgress(stage, attempt) as in uploadPreparedScore.
export async function attachPreparedFile(supabase, userId, scoreId, prepared, onProgress = () => {}, { delays = RETRY_DELAYS_MS, sleep = wait } = {}) {
  if (!prepared?.pdf?.size) throw problem("file_empty");
  if (prepared.pdf.size > MAX_PDF_UPLOAD_BYTES) throw problem("file_size");
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt(supabase, userId, scoreId, prepared, (stage) => onProgress(stage, tries + 1));
    } catch (error) {
      if (tries >= delays.length || !isRetryable(error)) throw error;
      onProgress("retry", tries + 1);
      await sleep(delays[tries]);
    }
  }
}
