import { SCORE_BUCKET } from "./supabase.js";
import { CACHE_SECONDS } from "./upload-prepared.js";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const STALE_UPLOAD_MS = 15 * 60 * 1000;

const EXTENSION_BY_MIME = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png"
};

const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png"
};

export function detectMime(file) {
  if (EXTENSION_BY_MIME[file.type]) return file.type;
  const extension = String(file.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

// Returns "type" | "size" | "empty" | null
export function validateFile(file) {
  if (!detectMime(file)) return "type";
  if (!file.size) return "empty";
  if (file.size > MAX_FILE_BYTES) return "size";
  return null;
}

function nullable(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

async function removeScoreRecord(supabase, scoreId, paths) {
  // Record first: the storage delete policy only allows files no record points to.
  await supabase.from("owned_scores").delete().eq("id", scoreId);
  if (paths.length) await supabase.storage.from(SCORE_BUCKET).remove(paths);
}

// Stores one file and its record. The path is pushed before the record insert so a failed
// insert still leaves the uploaded file in uploadedPaths for cleanup.
async function storeFile(supabase, userId, scoreId, file, pageNo, uploadedPaths) {
  const mimeType = detectMime(file);
  const fileId = crypto.randomUUID();
  const path = `${userId}/${scoreId}/${fileId}.${EXTENSION_BY_MIME[mimeType]}`;
  const { error: uploadError } = await supabase.storage
    .from(SCORE_BUCKET)
    .upload(path, file, { contentType: mimeType, cacheControl: CACHE_SECONDS, upsert: false });
  if (uploadError) throw uploadError;
  uploadedPaths.push(path);
  const { error: fileError } = await supabase.from("score_files").insert({
    id: fileId,
    owned_score_id: scoreId,
    storage_path: path,
    mime_type: mimeType,
    byte_size: file.size,
    original_filename: file.name || null,
    page_no: pageNo
  });
  if (fileError) throw fileError;
  return fileId;
}

function checkFiles(files) {
  for (const file of files) {
    const problem = validateFile(file);
    if (problem) throw Object.assign(new Error(problem), { code: `file_${problem}`, fileName: file.name });
  }
}

// Order: score record (uploading) -> each file -> file record -> mark ready.
// Any failure removes what was already stored.
export async function uploadScore(supabase, userId, files, { title, composerName } = {}, onProgress = () => {}) {
  if (!files.length) throw Object.assign(new Error("no_files"), { code: "no_files" });
  checkFiles(files);

  const { data: score, error: scoreError } = await supabase
    .from("owned_scores")
    .insert({
      title: nullable(title),
      composer_name: nullable(composerName),
      provisional_title: files[0].name || "score",
      status: "uploading"
    })
    .select("id")
    .single();
  if (scoreError) throw scoreError;

  const uploadedPaths = [];
  try {
    for (const [index, file] of files.entries()) {
      onProgress(index + 1, files.length);
      await storeFile(supabase, userId, score.id, file, index + 1, uploadedPaths);
    }
    const { error: readyError } = await supabase.from("owned_scores").update({ status: "ready" }).eq("id", score.id);
    if (readyError) throw readyError;
    return score.id;
  } catch (error) {
    try {
      await removeScoreRecord(supabase, score.id, uploadedPaths);
    } catch {
      // cleanupStaleUploads() retries on the next visit
    }
    throw error;
  }
}

// Adds photo pages to a saved score. pages = [{ file, pageNo }]. On failure everything added here is removed.
export async function addScorePages(supabase, userId, scoreId, pages, onProgress = () => {}) {
  checkFiles(pages.map((page) => page.file));
  if (pages.some((page) => detectMime(page.file) === "application/pdf")) {
    throw Object.assign(new Error("type"), { code: "file_type" });
  }
  const uploadedPaths = [];
  const insertedIds = [];
  try {
    for (const [index, page] of pages.entries()) {
      onProgress(index + 1, pages.length);
      insertedIds.push(await storeFile(supabase, userId, scoreId, page.file, page.pageNo, uploadedPaths));
    }
    return insertedIds;
  } catch (error) {
    try {
      if (insertedIds.length) await supabase.from("score_files").delete().in("id", insertedIds);
      if (uploadedPaths.length) await supabase.storage.from(SCORE_BUCKET).remove(uploadedPaths);
    } catch {
      // best effort; the error below is what the member sees
    }
    throw error;
  }
}

async function listFolder(supabase, folder) {
  const { data, error } = await supabase.storage.from(SCORE_BUCKET).list(folder, { limit: 1000 });
  if (error) throw error;
  return data ?? [];
}

// Removes records left in "uploading" (window closed mid-upload) and files whose record is gone.
export async function cleanupStaleUploads(supabase, userId) {
  const cutoff = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
  const { data: stale } = await supabase
    .from("owned_scores")
    .select("id")
    .eq("status", "uploading")
    .lt("created_at", cutoff);
  for (const score of stale ?? []) {
    const files = await listFolder(supabase, `${userId}/${score.id}`).catch(() => []);
    await removeScoreRecord(supabase, score.id, files.map((file) => `${userId}/${score.id}/${file.name}`));
  }

  const { data: known } = await supabase.from("owned_scores").select("id");
  if (!known) return;
  const knownIds = new Set(known.map((row) => row.id));
  const folders = await listFolder(supabase, userId).catch(() => []);
  for (const folder of folders) {
    if (folder.id !== null || knownIds.has(folder.name)) continue;
    const files = await listFolder(supabase, `${userId}/${folder.name}`).catch(() => []);
    if (files.length) {
      await supabase.storage.from(SCORE_BUCKET).remove(files.map((file) => `${userId}/${folder.name}/${file.name}`));
    }
  }
}
