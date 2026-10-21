import { t } from "../i18n.js";
import { formatBytes } from "../format.js";
import { h, createDialog, confirmDialog, errorMessage, notify, setBusy, displayScoreTitle } from "../ui.js";
import { addScorePages, detectMime, validateFile } from "../upload.js";
import { isImageScore, moveItem, renumberPages } from "../pages.js";
import { fileProblemMessage, pageRow, photoSourceButtons } from "./page-list.js";
import { openPhotoEditor } from "./photo-editor.js";

const PHOTO_ACCEPT = "image/jpeg,image/png,.jpg,.jpeg,.png";

// Add, remove and reorder pages of a saved photo score.
// Order of saving: new pages -> page numbers -> removals, so nothing is deleted unless the rest worked.
export async function openPageEditor(ctx, score) {
  const { dialog, body, footer, close, setStatus } = createDialog(t("pages.title", { title: displayScoreTitle(score) }), { wide: true });
  const list = h("ol", { class: "page-list" }, h("li", { class: "empty", text: t("common.loading") }));
  const progress = h("p", { class: "hint", role: "status" });
  const saveButton = h("button", { type: "button", class: "solid-button", disabled: true }, t("common.save"));
  const cancelButton = h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel"));
  const thumbs = new Map();
  let saved = [];
  let items = [];
  let closed = false;

  function addFiles(files) {
    const problems = [];
    for (const file of files) {
      const name = file.name || t("upload.cameraPhoto");
      if (detectMime(file) === "application/pdf") {
        problems.push(t("pages.imagesOnly"));
        continue;
      }
      const problem = validateFile(file);
      if (problem) problems.push(fileProblemMessage(problem, name));
      else items.push({ file, url: URL.createObjectURL(file) });
    }
    setStatus(problems.join(" "));
    render();
  }

  function move(from, to) {
    items = moveItem(items, from, to);
    render();
  }

  function remove(index) {
    const [item] = items.splice(index, 1);
    if (item?.url) URL.revokeObjectURL(item.url);
    render();
  }

  async function edit(item) {
    const edited = await openPhotoEditor(item.file);
    if (!edited || edited === item.file || closed) return;
    URL.revokeObjectURL(item.url);
    item.file = edited;
    item.url = URL.createObjectURL(edited);
    render();
  }

  function render() {
    list.replaceChildren(
      ...items.map((item, index) =>
        item.saved
          ? pageRow({
              index,
              total: items.length,
              thumbUrl: thumbs.get(item.saved.id),
              name: item.saved.original_filename || t("library.pageNo", { page: item.saved.page_no }),
              meta: formatBytes(item.saved.byte_size),
              onMove: move,
              onRemove: () => remove(index)
            })
          : pageRow({
              index,
              total: items.length,
              thumbUrl: item.url,
              name: item.file.name || t("upload.cameraPhoto"),
              meta: formatBytes(item.file.size),
              badge: t("pages.newBadge"),
              onMove: move,
              onEdit: () => edit(item),
              onRemove: () => remove(index)
            })
      )
    );
    if (!items.length) list.append(h("li", { class: "empty", text: t("pages.keepOne") }));
  }

  async function loadThumbs() {
    for (const file of saved) {
      if (closed) return;
      try {
        const blob = await ctx.db.download(file.storage_path);
        if (closed) return;
        thumbs.set(file.id, URL.createObjectURL(blob));
        render();
      } catch {
        // the row stays without a thumbnail
      }
    }
  }

  body.append(
    h("p", { class: "hint", text: t("pages.hint") }),
    h("p", { class: "hint", text: t("pages.deleteHint") }),
    photoSourceButtons({ accept: PHOTO_ACCEPT, onFiles: addFiles, setStatus }),
    list,
    progress
  );
  footer.append(cancelButton, saveButton);

  dialog.addEventListener("close", () => {
    closed = true;
    for (const url of thumbs.values()) URL.revokeObjectURL(url);
    for (const item of items) if (item.url) URL.revokeObjectURL(item.url);
  });

  saveButton.addEventListener("click", async () => {
    if (!items.length) {
      setStatus(t("pages.keepOne"));
      return;
    }
    const kept = new Set(items.filter((item) => item.saved).map((item) => item.saved.id));
    const removed = saved.filter((file) => !kept.has(file.id));
    const added = items.flatMap((item, index) => (item.saved ? [] : [{ file: item.file, pageNo: index + 1 }]));
    const changes = renumberPages(items.map((item) => item.saved ?? null));
    if (!removed.length && !added.length && !changes.length) {
      close();
      notify(t("pages.unchanged"));
      return;
    }
    if (removed.length) {
      const ok = await confirmDialog(t("pages.deleteConfirm", { count: removed.length }), {
        confirmLabel: t("common.delete"),
        danger: true
      });
      if (!ok) return;
    }
    setBusy([saveButton, cancelButton], true);
    setStatus("");
    try {
      if (added.length) {
        await addScorePages(ctx.supabase, ctx.user.id, score.id, added, (current, total) => {
          progress.textContent = t("upload.progress", { current, total });
        });
      }
      progress.textContent = t("pages.saving");
      await ctx.db.setPageNumbers(changes);
      await ctx.db.removeScoreFiles(removed);
      close();
      notify(t("pages.saved"), "success");
    } catch (error) {
      close();
      notify(errorMessage(error, "pages.saveFailed"), "error");
    }
    ctx.refresh();
  });

  try {
    saved = await ctx.db.scoreFiles(score.id);
  } catch (error) {
    list.replaceChildren(h("li", { class: "empty", text: errorMessage(error, "errors.loadFailed") }));
    return;
  }
  if (closed) return;
  if (!isImageScore(saved)) {
    close();
    notify(t("pages.pdfLater"));
    return;
  }
  items = saved.map((file) => ({ saved: file }));
  render();
  saveButton.disabled = false;
  loadThumbs();
}
