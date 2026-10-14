const BUCKET = "scores";
const SIGNED_URL_SECONDS = 600;

/* 악보 하나의 페이지 정보(서명 URL 포함)만 돌려줍니다. 한 장씩 넘겨 보는 뷰어에서 사용합니다. */
export async function fetchScorePages(supabase, scoreId) {
  const { data, error } = await supabase
    .from("score_pages")
    .select("page_no, storage_path, mime_type, byte_size")
    .eq("score_id", scoreId)
    .order("page_no", { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_SECONDS);
  if (signError) throw signError;

  const byPath = new Map((signed ?? []).filter((entry) => entry.signedUrl).map((entry) => [entry.path, entry.signedUrl]));
  return rows.map((row) => ({
    pageNo: row.page_no,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    url: byPath.get(row.storage_path) ?? ""
  }));
}

/* 악보 하나의 페이지(사진 / PDF)를 화면에 넣을 요소 목록으로 만들어 돌려줍니다. 파일은 다시 올리지 않고 기존 score_id를 그대로 씁니다. */
export async function buildScorePageElements(supabase, scoreId, title) {
  const { data, error } = await supabase
    .from("score_pages")
    .select("page_no, storage_path, mime_type, byte_size")
    .eq("score_id", scoreId)
    .order("page_no", { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_SECONDS);
  if (signError) throw signError;

  const byPath = new Map((signed ?? []).filter((entry) => entry.signedUrl).map((entry) => [entry.path, entry.signedUrl]));
  const wideScreen = window.matchMedia("(min-width: 900px)").matches;

  return rows.map((row) => {
    const url = byPath.get(row.storage_path);
    if (row.mime_type === "application/pdf") {
      const box = document.createElement("div");
      box.className = "viewer-pdf";
      const label = document.createElement("p");
      const megabytes = row.byte_size ? ` · ${(row.byte_size / 1024 / 1024).toFixed(1)}MB` : "";
      label.textContent = `${row.page_no}번 PDF${megabytes}`;
      box.append(label);
      if (url) {
        const link = document.createElement("a");
        link.className = "primary-button";
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "PDF 열기";
        box.append(link);
        if (wideScreen) {
          const frame = document.createElement("iframe");
          frame.className = "viewer-pdf-frame";
          frame.src = url;
          frame.title = `${title} ${row.page_no}번 PDF`;
          box.append(frame);
        }
      }
      return box;
    }
    const image = document.createElement("img");
    image.className = "viewer-page";
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = `${title} ${row.page_no}쪽`;
    if (url) image.src = url;
    return image;
  });
}
