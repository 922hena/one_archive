import { t } from "../i18n.js";
import { formatBytes, formatDateTime, formatLongDate, formatTime, formatZonedDate } from "../format.js";
import { uploadScore, validateFile, detectMime, cleanupStaleUploads, MAX_FILE_BYTES } from "../upload.js";
import { h, createDialog, confirmDialog, errorMessage, notify, setBusy, displayScoreTitle } from "../ui.js";

const FILE_ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

function fileSummary(files = []) {
  if (!files.length) return t("library.noFiles");
  const pdf = files.every((file) => file.mime_type === "application/pdf");
  return pdf
    ? t("library.pdfSummary", { count: files.length })
    : t("library.imageSummary", { count: files.length });
}

// Opens a short-lived signed URL. The tab is opened before awaiting so popup blockers allow it.
async function openFile(ctx, file) {
  const tab = window.open("about:blank", "_blank");
  try {
    const url = await ctx.db.signedUrl(file.storage_path);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (error) {
    tab?.close();
    notify(errorMessage(error, "library.openFailed"), "error");
  }
}

export function openScore(ctx, score) {
  const files = score.score_files ?? [];
  if (files.length === 1) {
    openFile(ctx, files[0]);
    return;
  }
  const { body, footer, close } = createDialog(displayScoreTitle(score));
  body.append(
    h("p", { class: "hint", text: t("library.pagesHint") }),
    h(
      "ul",
      { class: "plain-list compact" },
      files.map((file) =>
        h("li", { class: "list-row" },
          h("span", { class: "num", text: t("library.pageNo", { page: file.page_no }) }),
          h("span", { class: "list-main meta", text: file.original_filename ?? "" }),
          h("button", { type: "button", class: "ghost-button", onclick: () => openFile(ctx, file) }, t("common.open"))
        )
      )
    )
  );
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.close")));
}

function problemMessage(problem, name) {
  if (problem === "type") return t("upload.badType", { name });
  if (problem === "size") return t("upload.tooLarge", { name, limit: formatBytes(MAX_FILE_BYTES) });
  return t("upload.emptyFile", { name });
}

// options.onSaved(scoreId) runs after a successful upload (e.g. link to a music item).
export function openUploadDialog(ctx, { title = t("upload.title"), saveLabel = t("common.save"), onSaved } = {}) {
  const { body, footer, close, setStatus } = createDialog(title, { wide: true });
  const pending = [];
  const titleInput = h("input", { type: "text", maxlength: 200, placeholder: t("upload.titlePlaceholder") });
  const composerInput = h("input", { type: "text", maxlength: 200, placeholder: t("upload.composerPlaceholder") });
  const fileInput = h("input", { type: "file", accept: FILE_ACCEPT, multiple: true, hidden: true });
  const cameraInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true });
  const pendingList = h("ol", { class: "pending-list" });
  const progress = h("p", { class: "hint", role: "status" });

  function renderPending() {
    pendingList.replaceChildren(
      ...pending.map((file, index) =>
        h("li", { class: "list-row" },
          h("span", { class: "num", text: t("library.pageNo", { page: index + 1 }) }),
          h("span", { class: "list-main" }, file.name || t("upload.cameraPhoto"), h("small", { class: "meta", text: ` ${formatBytes(file.size)}` })),
          h(
            "button",
            {
              type: "button",
              class: "link-button",
              onclick: () => {
                pending.splice(index, 1);
                renderPending();
              }
            },
            t("common.remove")
          )
        )
      )
    );
    if (!pending.length) pendingList.append(h("li", { class: "empty", text: t("upload.noneSelected") }));
  }

  function addFiles(fileList) {
    const problems = [];
    for (const file of fileList) {
      const problem = validateFile(file);
      if (problem) problems.push(problemMessage(problem, file.name || t("upload.cameraPhoto")));
      else pending.push(file);
    }
    setStatus(problems.join(" "));
    renderPending();
  }

  fileInput.addEventListener("change", () => {
    addFiles([...fileInput.files]);
    fileInput.value = "";
  });
  cameraInput.addEventListener("change", () => {
    addFiles([...cameraInput.files]);
    cameraInput.value = "";
  });

  body.append(
    h("div", { class: "field-row" },
      h("label", { class: "field" }, h("span", { text: t("upload.scoreTitle") }), titleInput),
      h("label", { class: "field" }, h("span", { text: t("upload.composer") }), composerInput)
    ),
    h("p", { class: "hint", text: t("upload.optionalHint") }),
    h("div", { class: "button-row" },
      h("button", { type: "button", class: "ghost-button", onclick: () => fileInput.click() }, t("upload.chooseFile")),
      h("button", { type: "button", class: "ghost-button", onclick: () => cameraInput.click() }, t("upload.takePhoto")),
      fileInput,
      cameraInput
    ),
    h("p", { class: "hint", text: t("upload.rules", { limit: formatBytes(MAX_FILE_BYTES) }) }),
    pendingList,
    progress
  );
  renderPending();

  const saveButton = h("button", { type: "button", class: "solid-button" }, saveLabel);
  const cancelButton = h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel"));
  footer.append(cancelButton, saveButton);

  saveButton.addEventListener("click", async () => {
    if (!pending.length) {
      setStatus(t("upload.noneSelected"));
      return;
    }
    const mixed = pending.some((file) => detectMime(file) === "application/pdf") && pending.length > 1;
    if (mixed) {
      setStatus(t("upload.pdfAlone"));
      return;
    }
    setBusy([saveButton, cancelButton], true);
    setStatus("");
    let scoreId = null;
    try {
      scoreId = await uploadScore(
        ctx.supabase,
        ctx.user.id,
        pending,
        { title: titleInput.value, composerName: composerInput.value },
        (current, total) => {
          progress.textContent = t("upload.progress", { current, total });
        }
      );
    } catch (error) {
      progress.textContent = "";
      setStatus(errorMessage(error, "upload.failed"));
      setBusy([saveButton, cancelButton], false);
      return;
    }
    try {
      if (onSaved) await onSaved(scoreId);
      close();
      notify(t("upload.saved"), "success");
    } catch (error) {
      close();
      notify(errorMessage(error, "upload.savedButLinkFailed"), "error");
    }
    ctx.refresh();
  });
}

function openEditScore(ctx, score) {
  const { body, footer, close, setStatus } = createDialog(t("library.editTitle"));
  const titleInput = h("input", { type: "text", maxlength: 200, value: score.title ?? "", placeholder: score.provisional_title });
  const composerInput = h("input", { type: "text", maxlength: 200, value: score.composer_name ?? "" });
  body.append(
    h("label", { class: "field" }, h("span", { text: t("upload.scoreTitle") }), titleInput),
    h("label", { class: "field" }, h("span", { text: t("upload.composer") }), composerInput),
    h("p", { class: "hint", text: t("library.provisional", { name: score.provisional_title }) })
  );
  const saveButton = h("button", { type: "button", class: "solid-button" }, t("common.save"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);
  saveButton.addEventListener("click", async () => {
    setBusy([saveButton], true);
    try {
      await ctx.db.updateScore(score.id, { title: titleInput.value, composer_name: composerInput.value });
      close();
      notify(t("library.saved"), "success");
      ctx.refresh();
    } catch (error) {
      setStatus(errorMessage(error, "library.saveFailed"));
      setBusy([saveButton], false);
    }
  });
  titleInput.focus();
}

async function openDetails(ctx, score) {
  const { body, footer, close } = createDialog(t("library.detailsTitle"), { wide: true });
  const files = score.score_files ?? [];
  const usageList = h("ul", { class: "plain-list compact" }, h("li", { class: "meta", text: t("common.loading") }));
  body.append(
    h("dl", { class: "detail-grid" },
      h("dt", { text: t("library.scoreTitle") }), h("dd", { text: displayScoreTitle(score) }),
      h("dt", { text: t("library.provisionalLabel") }), h("dd", { text: score.provisional_title }),
      h("dt", { text: t("library.createdAt") }), h("dd", { class: "num", text: formatDateTime(score.created_at) }),
      h("dt", { text: t("library.lastEditedAt") }), h("dd", { class: "num", text: formatDateTime(score.last_edited_at) })
    ),
    h("h3", { class: "sub-head", text: t("library.filesHead") }),
    h(
      "table",
      { class: "data-table" },
      h("thead", {}, h("tr", {},
        h("th", { text: t("library.colPage") }),
        h("th", { text: t("library.colOriginal") }),
        h("th", { text: t("library.colType") }),
        h("th", { class: "is-num", text: t("library.colSize") })
      )),
      h("tbody", {}, files.map((file) =>
        h("tr", {},
          h("td", { class: "num", text: String(file.page_no) }),
          h("td", { text: file.original_filename ?? "" }),
          h("td", { text: file.mime_type === "application/pdf" ? "PDF" : file.mime_type === "image/png" ? "PNG" : "JPG" }),
          h("td", { class: "is-num num", text: formatBytes(file.byte_size) })
        )
      ))
    ),
    h("h3", { class: "sub-head", text: t("library.usageHead") }),
    usageList
  );
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.close")));

  try {
    const [usage, roles] = await Promise.all([ctx.db.scoreUsage(score.id), ctx.db.roles()]);
    const roleById = new Map(roles.map((role) => [role.id, role]));
    usage.sort((a, b) =>
      String(a.mass_music_slots?.mass_events?.local_date).localeCompare(String(b.mass_music_slots?.mass_events?.local_date))
    );
    usageList.replaceChildren(
      ...(usage.length
        ? usage.map((entry) => {
            const slot = entry.mass_music_slots;
            const mass = slot?.mass_events;
            const itemName = slot?.display_name || roleById.get(slot?.role_id)?.name_ko || "";
            return h("li", { class: "list-row" },
              h("a", { href: `#/mass/${mass?.id}`, class: "list-main", onclick: () => close() },
                h("span", { class: "num", text: formatLongDate(mass?.local_date) }),
                " ",
                [formatTime(mass?.start_time), mass?.title || t("mass.untitled"), itemName].filter(Boolean).join(" · ")
              )
            );
          })
        : [h("li", { class: "empty", text: t("library.notUsed") })])
    );
  } catch (error) {
    usageList.replaceChildren(h("li", { class: "empty", text: errorMessage(error) }));
  }
}

async function deleteScore(ctx, score) {
  const ok = await confirmDialog(t("library.deleteConfirm", { title: displayScoreTitle(score) }), {
    confirmLabel: t("common.delete"),
    danger: true
  });
  if (!ok) return;
  try {
    await ctx.db.deleteScore(score);
    notify(t("library.deleted"), "success");
  } catch (error) {
    notify(errorMessage(error, "library.deleteFailed", { 23503: "library.deleteLinked" }), "error");
  }
  ctx.refresh();
}

export async function renderLibrary(container, ctx) {
  await cleanupStaleUploads(ctx.supabase, ctx.user.id).catch(() => {});
  const scores = await ctx.db.readyScores();

  const table = scores.length
    ? h(
        "table",
        { class: "data-table score-table" },
        h("thead", {}, h("tr", {},
          h("th", { text: t("library.colTitle") }),
          h("th", { text: t("library.colComposer") }),
          h("th", { text: t("library.colFiles") }),
          h("th", { class: "is-num", text: t("library.colLinks") }),
          h("th", { text: t("library.colCreated") }),
          h("th", { class: "is-actions", text: "" })
        )),
        h("tbody", {}, scores.map((score) => {
          const linkCount = score.mass_music_entries?.length ?? 0;
          const deleteButton = h(
            "button",
            {
              type: "button",
              class: "link-button is-danger",
              disabled: linkCount > 0,
              title: linkCount > 0 ? t("library.deleteLinked") : null,
              onclick: () => deleteScore(ctx, score)
            },
            t("common.delete")
          );
          return h("tr", {},
            h("td", { "data-label": t("library.colTitle") }, h("strong", { text: displayScoreTitle(score) })),
            h("td", { "data-label": t("library.colComposer"), text: score.composer_name ?? "" }),
            h("td", { "data-label": t("library.colFiles"), text: fileSummary(score.score_files) }),
            h("td", { "data-label": t("library.colLinks"), class: "is-num num", text: linkCount ? String(linkCount) : "–" }),
            h("td", { "data-label": t("library.colCreated"), class: "num", text: formatZonedDate(score.created_at) }),
            h("td", { class: "is-actions" },
              h("button", { type: "button", class: "link-button", onclick: () => openScore(ctx, score) }, t("common.open")),
              h("button", { type: "button", class: "link-button", onclick: () => openEditScore(ctx, score) }, t("common.edit")),
              h("button", { type: "button", class: "link-button", onclick: () => openDetails(ctx, score) }, t("library.details")),
              deleteButton
            )
          );
        }))
      )
    : h("p", { class: "empty", text: t("library.empty") });

  container.append(
    h("section", { class: "page-head" },
      h("div", {},
        h("h1", { text: t("library.title") }),
        h("p", { class: "lead", text: t("library.lead", { count: scores.length }) })
      ),
      h("button", { type: "button", class: "solid-button", onclick: () => openUploadDialog(ctx) }, t("library.upload"))
    ),
    table
  );
}
