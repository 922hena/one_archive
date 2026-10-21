// Page-list helpers shared by the upload dialog and the saved-score page editor.

export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// Wanted page order: saved files ({ id, page_no }) or null for pages not saved yet.
// Returns only the saved rows whose page_no must change (1-based, no gaps).
export function renumberPages(order) {
  const changes = [];
  order.forEach((file, index) => {
    if (file && file.page_no !== index + 1) changes.push({ id: file.id, page_no: index + 1 });
  });
  return changes;
}

export function comparePages(a, b) {
  return a.page_no - b.page_no || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

export function isImageScore(files = []) {
  return files.length > 0 && files.every((file) => file.mime_type !== "application/pdf");
}
