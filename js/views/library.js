import { t } from "../i18n.js";
import { formatBytes, formatDateTime, formatLongDate, formatShortDate, formatTime } from "../format.js";
import { validateFile, detectMime, cleanupStaleUploads, MAX_FILE_BYTES } from "../upload.js";
import { uploadPreparedScore, RETRY_DELAYS_MS } from "../upload-prepared.js";
import { prepareScore } from "../score-prepare.js";
import { tryDeleteDraft, tryListDrafts, trySaveDraft } from "../upload-drafts.js";
import { h, createDialog, confirmDialog, errorMessage, notify, setBusy, displayScoreTitle } from "../ui.js";
import { isImageScore, moveItem } from "../pages.js";
import { openViewer } from "./viewer.js";
import { openPageEditor } from "./page-editor.js";
import { fileProblemMessage, pageRow, photoSourceButtons } from "./page-list.js";
import { openPhotoEditor } from "./photo-editor.js";
import { roleLabel } from "./layouts.js";
import { KEY_MODES, KEY_TONICS, parseKeyText, periodForYear, scorePeriod, tonicLabel } from "../score-meta.js";

const FILE_ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

export function keyLabel(tonic, mode) {
  if (mode === "atonal" || (!tonic && mode)) return t(`keys.modeOption.${mode}`);
  if (!tonic) return "";
  return mode ? `${tonicLabel(tonic)} ${t(`keys.mode.${mode}`)}` : tonicLabel(tonic);
}

export function periodName(code, periods) {
  if (!code) return "";
  return periods.find((period) => period.code === code)?.name_en ?? code;
}

function yearLabel(score) {
  if (!score?.composition_year) return "";
  return score.composition_year_approx ? t("library.approxYear", { year: score.composition_year }) : String(score.composition_year);
}

// Played songs of one Score, oldest first: date · Music Part · place (PRD SCORE-013, 014).
function performanceList(ctx, score) {
  const head = h("h3", { class: "sub-head", text: t("library.performancesHead", { count: "…" }) });
  const list = h("ol", { class: "history-list" }, h("li", { class: "meta", text: t("common.loading") }));
  const element = h("section", { class: "performance-section" },
    head,
    h("p", { class: "hint", text: t("library.performancesHint") }),
    list
  );
  async function load() {
    try {
      const [rows, roles] = await Promise.all([ctx.db.scorePerformances(score.id), ctx.db.roles()]);
      const roleById = new Map(roles.map((role) => [role.id, role]));
      head.textContent = t("library.performancesHead", { count: rows.length });
      list.replaceChildren(
        ...(rows.length
          ? rows.map((row) =>
              h("li", { class: "history-row" },
                h("span", { class: "history-date num", lang: "ko", text: formatShortDate(row.local_date) }),
                h("span", { class: "history-part", translate: "no", text: row.part_display_name || roleLabel(roleById.get(row.role_id)) || "—" }),
                h("span", { class: "history-place", translate: "no", text: row.venue_label || "—" }),
                row.note ? h("span", { class: "history-note", translate: "no", text: row.note }) : null
              )
            )
          : [h("li", { class: "empty", text: t("library.notPerformed") })])
      );
    } catch (error) {
      head.textContent = t("library.performancesHead", { count: "–" });
      list.replaceChildren(h("li", { class: "empty", text: errorMessage(error, "library.historyFailed") }));
    }
  }
  return { element, load };
}

export function openScoreHistory(ctx, score) {
  const { body, footer, close } = createDialog(t("library.historyTitle"), { wide: true });
  const history = performanceList(ctx, score);
  body.append(h("p", { class: "dialog-score", translate: "no", text: displayScoreTitle(score) }), history.element);
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.close")));
  history.load();
}

function fileSummary(files = []) {
  if (!files.length) return t("library.noFiles");
  const pdf = files.every((file) => file.mime_type === "application/pdf");
  return pdf
    ? t("library.pdfSummary", { count: files.length })
    : t("library.imageSummary", { count: files.length });
}

// options.onSaved(scoreId) runs after a successful upload (e.g. link to a music item).
// options.draft: a finished-but-not-uploaded Score kept on this device (Resume).
export function openUploadDialog(ctx, { title = t("upload.title"), saveLabel = t("common.save"), onSaved, draft = null } = {}) {
  const { dialog, body, footer, close, setStatus } = createDialog(draft ? t("upload.resumeTitle") : title, { wide: true });
  let pending = [];
  // The finished PDF + thumbnail. Once it exists, Retry re-sends it without redoing the pages.
  let prepared = draft;
  const titleInput = h("input", { type: "text", maxlength: 200, placeholder: t("upload.titlePlaceholder"), value: draft?.title ?? "" });
  const composerInput = h("input", { type: "text", maxlength: 200, placeholder: t("upload.composerPlaceholder"), value: draft?.composerName ?? "" });
  const pendingList = h("ol", { class: "page-list" });
  const progress = h("p", { class: "hint", role: "status" });

  function isPdf(file) {
    return detectMime(file) === "application/pdf";
  }

  async function edit(item) {
    const edited = await openPhotoEditor(item.file);
    if (!edited || edited === item.file || !dialog.isConnected) return;
    URL.revokeObjectURL(item.url);
    item.file = edited;
    item.url = URL.createObjectURL(edited);
    item.edited = true;
    renderPending();
  }

  function renderPending() {
    pendingList.replaceChildren(
      ...pending.map((item, index) =>
        pageRow({
          index,
          total: pending.length,
          thumbUrl: item.url,
          isPdf: isPdf(item.file),
          name: item.file.name || t("upload.cameraPhoto"),
          meta: formatBytes(item.file.size),
          badge: item.edited ? t("editor.edited") : null,
          onMove: (from, to) => {
            pending = moveItem(pending, from, to);
            renderPending();
          },
          onEdit: isPdf(item.file) ? null : () => edit(item),
          onRemove: () => {
            if (item.url) URL.revokeObjectURL(item.url);
            pending.splice(index, 1);
            renderPending();
          }
        })
      )
    );
    if (!pending.length) pendingList.append(h("li", { class: "empty", text: t("upload.noneSelected") }));
  }

  function addFiles(fileList) {
    const problems = [];
    for (const file of fileList) {
      const problem = validateFile(file);
      if (problem) problems.push(fileProblemMessage(problem, file.name || t("upload.cameraPhoto")));
      else pending.push({ file, url: isPdf(file) ? null : URL.createObjectURL(file), edited: false });
    }
    setStatus(problems.join(" "));
    renderPending();
  }

  dialog.addEventListener("close", () => {
    for (const item of pending) if (item.url) URL.revokeObjectURL(item.url);
  });

  const sourceArea = h("div", {}, photoSourceButtons({ accept: FILE_ACCEPT, onFiles: addFiles, setStatus }));
  const preparedNote = h("p", { class: "hint", hidden: true });
  // Once the final PDF exists the pages are fixed; only the title and composer can still change.
  function showPrepared() {
    sourceArea.hidden = Boolean(prepared);
    pendingList.hidden = Boolean(prepared);
    preparedNote.hidden = !prepared;
    if (prepared) {
      preparedNote.textContent = t("upload.preparedNote", { name: prepared.pdfName, size: formatBytes(prepared.pdf.size) });
    }
  }

  body.append(
    h("div", { class: "field-row" },
      h("label", { class: "field" }, h("span", { text: t("upload.scoreTitle") }), titleInput),
      h("label", { class: "field" }, h("span", { text: t("upload.composer") }), composerInput)
    ),
    h("p", { class: "hint", text: t("upload.optionalHint") }),
    sourceArea,
    h("p", { class: "hint", text: t("upload.rules", { limit: formatBytes(MAX_FILE_BYTES) }) }),
    pendingList,
    preparedNote,
    progress
  );
  renderPending();
  showPrepared();

  const saveButton = h("button", { type: "button", class: "solid-button" }, draft ? t("upload.retry") : saveLabel);
  const cancelButton = h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel"));
  const discardButton = h("button", { type: "button", class: "ghost-button is-danger", hidden: !draft }, t("upload.discard"));
  footer.append(discardButton, cancelButton, saveButton);
  const allButtons = [saveButton, cancelButton, discardButton];

  // The finished Score stays on this device until it is stored or discarded.
  discardButton.addEventListener("click", async () => {
    const ok = await confirmDialog(t("upload.discardConfirm"), { confirmLabel: t("upload.discard"), danger: true });
    if (!ok) return;
    await tryDeleteDraft(prepared.scoreId);
    if (draft) {
      close();
      ctx.refresh();
      return;
    }
    prepared = null;
    showPrepared();
    progress.textContent = "";
    setStatus("");
    saveButton.textContent = saveLabel;
  });

  function onUploadStage(stage, attempt) {
    if (stage === "retry") progress.textContent = t("upload.retrying", { attempt, total: RETRY_DELAYS_MS.length });
    else progress.textContent = t("upload.uploading");
  }

  async function prepare() {
    const files = pending.map((item) => item.file);
    const pdfFile = files.find(isPdf) ?? null;
    progress.textContent = t("upload.preparing");
    const made = await prepareScore({ pdfFile, photoFiles: pdfFile ? [] : files }, (current, total) => {
      progress.textContent = t("upload.preparingPages", { current, total });
    });
    prepared = {
      scoreId: crypto.randomUUID(),
      fileId: crypto.randomUUID(),
      thumbId: crypto.randomUUID(),
      userId: ctx.user.id,
      pdf: made.pdf,
      pdfName: made.pdfName,
      thumb: made.thumb,
      title: "",
      composerName: "",
      createdAt: Date.now()
    };
  }

  saveButton.addEventListener("click", async () => {
    if (!prepared) {
      if (!pending.length) {
        setStatus(t("upload.noneSelected"));
        return;
      }
      const files = pending.map((item) => item.file);
      if (files.some(isPdf) && files.length > 1) {
        setStatus(t("upload.pdfAlone"));
        return;
      }
    }
    setBusy(allButtons, true);
    setStatus("");
    try {
      if (!prepared) await prepare();
    } catch (error) {
      progress.textContent = "";
      setStatus(error?.code === "pdf_too_large" ? t("upload.pdfTooLarge", { limit: formatBytes(MAX_FILE_BYTES) }) : t("upload.prepareFailed"));
      setBusy(allButtons, false);
      discardButton.hidden = !draft;
      return;
    }
    prepared.title = titleInput.value;
    prepared.composerName = composerInput.value;
    // Save the finished Score on this device first so a failure or closed tab can continue later.
    await trySaveDraft(prepared);
    showPrepared();
    let scoreId = null;
    try {
      scoreId = await uploadPreparedScore(ctx.supabase, ctx.user.id, prepared, onUploadStage);
    } catch (error) {
      progress.textContent = "";
      setStatus(errorMessage(error, "upload.failedKept"));
      saveButton.textContent = t("upload.retry");
      discardButton.hidden = false;
      setBusy(allButtons, false);
      return;
    }
    await tryDeleteDraft(prepared.scoreId);
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

async function openEditScore(ctx, score) {
  const periods = await ctx.db.periods().catch(() => []);
  const { body, footer, close, setStatus } = createDialog(t("library.editTitle"), { wide: true });
  const titleInput = h("input", { type: "text", maxlength: 200, value: score.title ?? "", placeholder: score.provisional_title });
  const composerInput = h("input", { type: "text", maxlength: 200, value: score.composer_name ?? "" });

  const tonicSelect = h("select", {},
    h("option", { value: "" }, t("library.keyNone")),
    KEY_TONICS.map((tonic) => h("option", { value: tonic, selected: tonic === score.key_tonic }, tonicLabel(tonic)))
  );
  const modeSelect = h("select", {},
    h("option", { value: "" }, t("library.keyNone")),
    KEY_MODES.map((mode) => h("option", { value: mode, selected: mode === score.key_mode }, t(`keys.modeOption.${mode}`)))
  );
  const keyTextInput = h("input", {
    type: "text",
    maxlength: 60,
    value: score.key_text ?? "",
    placeholder: t("library.keyTextPlaceholder"),
    translate: "no"
  });
  // The written key stays as typed; a recognised one only suggests the standard key.
  let suggestion = null;
  const suggestButton = h("button", { type: "button", class: "link-button", hidden: true });
  const updateSuggestion = () => {
    suggestion = parseKeyText(keyTextInput.value);
    const same = suggestion && suggestion.tonic === tonicSelect.value && suggestion.mode === modeSelect.value;
    suggestButton.hidden = !suggestion || Boolean(same);
    if (suggestion) suggestButton.textContent = t("library.keySuggest", { key: keyLabel(suggestion.tonic, suggestion.mode) });
  };
  keyTextInput.addEventListener("input", updateSuggestion);
  tonicSelect.addEventListener("change", updateSuggestion);
  modeSelect.addEventListener("change", updateSuggestion);
  suggestButton.addEventListener("click", () => {
    if (!suggestion) return;
    tonicSelect.value = suggestion.tonic;
    modeSelect.value = suggestion.mode;
    updateSuggestion();
    tonicSelect.focus();
  });
  updateSuggestion();

  const yearInput = h("input", {
    type: "number",
    inputmode: "numeric",
    min: 800,
    max: 2100,
    step: 1,
    value: score.composition_year ?? "",
    placeholder: t("library.yearPlaceholder")
  });
  const approxBox = h("input", { type: "checkbox", checked: Boolean(score.composition_year_approx) });
  const periodSelect = h("select", {},
    h("option", { value: "" }, t("library.periodAuto")),
    periods.map((period) => h("option", { value: period.code, selected: period.code === score.period_code }, period.name_en))
  );
  const periodFromYear = () => {
    const yearText = yearInput.value.trim();
    return (yearText && periodForYear(yearText, periods)) || "";
  };
  // The Period follows the year until the member picks a different one.
  let yearPeriod = periodFromYear();
  if (!score.period_code) periodSelect.value = yearPeriod;
  yearInput.addEventListener("input", () => {
    const next = periodFromYear();
    if (periodSelect.value === "" || periodSelect.value === yearPeriod) periodSelect.value = next;
    yearPeriod = next;
  });
  const noteInput = h("textarea", { rows: 3, maxlength: 2000, translate: "no" }, score.note ?? "");

  body.append(
    h("label", { class: "field" }, h("span", { text: t("upload.scoreTitle") }), titleInput),
    h("label", { class: "field" }, h("span", { text: t("upload.composer") }), composerInput),
    h("p", { class: "hint", text: t("library.provisional", { name: score.provisional_title }) }),
    h("div", { class: "field-row" },
      h("label", { class: "field" }, h("span", { text: t("library.keyTonic") }), tonicSelect),
      h("label", { class: "field" }, h("span", { text: t("library.keyMode") }), modeSelect)
    ),
    h("div", { class: "field-group" },
      h("label", { class: "field" }, h("span", { text: t("library.keyText") }), keyTextInput),
      suggestButton
    ),
    h("div", { class: "field-row" },
      h("div", { class: "field-group" },
        h("label", { class: "field" }, h("span", { text: t("library.yearLabel") }), yearInput),
        h("label", { class: "choice" }, approxBox, h("span", { text: t("library.yearApprox") }))
      ),
      h("label", { class: "field" }, h("span", { text: t("library.periodLabel") }), periodSelect)
    ),
    h("p", { class: "hint", text: t("library.periodHint") }),
    h("label", { class: "field" }, h("span", { text: t("library.noteLabel") }), noteInput)
  );
  const saveButton = h("button", { type: "button", class: "solid-button" }, t("common.save"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);
  saveButton.addEventListener("click", async () => {
    const yearText = yearInput.value.trim();
    const year = yearText ? Number(yearText) : null;
    if (yearText && (!Number.isInteger(year) || year < 800 || year > 2100)) {
      setStatus(t("library.yearInvalid"));
      yearInput.focus();
      return;
    }
    setBusy([saveButton], true);
    try {
      await ctx.db.updateScore(score.id, {
        title: titleInput.value,
        composer_name: composerInput.value,
        key_tonic: tonicSelect.value || null,
        key_mode: modeSelect.value || null,
        key_text: keyTextInput.value,
        composition_year: year,
        composition_year_approx: year != null && approxBox.checked,
        period_code: periodSelect.value || null,
        note: noteInput.value
      });
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
  const periods = await ctx.db.periods().catch(() => []);
  const period = scorePeriod(score, periods);
  const key = [keyLabel(score.key_tonic, score.key_mode), score.key_text ? `(${score.key_text})` : ""].filter(Boolean).join(" ");
  const facts = [
    [t("library.scoreTitle"), displayScoreTitle(score), { translate: "no" }],
    [t("library.provisionalLabel"), score.provisional_title, { translate: "no" }],
    score.composer_name ? [t("upload.composer"), score.composer_name, { translate: "no" }] : null,
    key ? [t("library.keyLabel"), key, { translate: "no" }] : null,
    score.composition_year ? [t("library.yearLabel"), yearLabel(score), { class: "num" }] : null,
    period.code ? [t("library.periodLabel"), periodName(period.code, periods), {}] : null,
    [t("library.createdAt"), formatDateTime(score.created_at), { class: "num" }],
    [t("library.lastEditedAt"), formatDateTime(score.last_edited_at), { class: "num" }]
  ].filter(Boolean);
  const history = performanceList(ctx, score);
  body.append(
    h("dl", { class: "detail-grid" },
      facts.flatMap(([name, value, props]) => [h("dt", { text: name }), h("dd", { ...props, text: value })])
    ),
    h("div", { class: "score-note", hidden: !score.note },
      h("h3", { class: "sub-head", text: t("library.noteLabel") }),
      h("p", { class: "note-text", translate: "no", text: score.note ?? "" })
    ),
    history.element,
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
          h("td", { translate: "no", text: file.original_filename ?? "" }),
          h("td", { text: file.mime_type === "application/pdf" ? "PDF" : file.mime_type === "image/png" ? "PNG" : "JPG" }),
          h("td", { class: "is-num num", text: formatBytes(file.byte_size) })
        )
      ))
    ),
    h("h3", { class: "sub-head", text: t("library.usageHead") }),
    usageList
  );
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.close")));
  history.load();

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
            const itemName = slot?.display_name || roleLabel(roleById.get(slot?.role_id)) || t("mass.unnamedItem");
            if (!mass?.id) return h("li", { class: "list-row" }, h("span", { class: "list-main", translate: "no", text: itemName }));
            return h("li", { class: "list-row" },
              h("a", { href: `#/mass/${mass.id}`, class: "list-main", onclick: () => close() },
                h("span", { class: "num", lang: "ko", text: formatLongDate(mass.local_date) }),
                " ",
                h("span", { translate: "no", text: [formatTime(mass.start_time), mass.title || t("mass.untitled"), itemName].filter(Boolean).join(" · ") })
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
  const readyIds = new Set(scores.map((score) => score.id));
  // Finished Scores that never got uploaded. One quiet line each, only here (not on Home).
  const allDrafts = await tryListDrafts(ctx.user.id);
  for (const draft of allDrafts) if (readyIds.has(draft.scoreId)) tryDeleteDraft(draft.scoreId); // already stored
  const drafts = allDrafts.filter((draft) => !readyIds.has(draft.scoreId));
  const draftNotices = drafts.map((draft) =>
    h("p", { class: "hint draft-notice", role: "status" },
      h("span", { translate: "no", text: t("upload.unfinished", { name: draft.title?.trim() || draft.pdfName }) }),
      " ",
      h("button", { type: "button", class: "link-button", onclick: () => openUploadDialog(ctx, { draft }) }, t("upload.resume"))
    )
  );

  const table = scores.length
    ? h(
        "table",
        { class: "data-table score-table" },
        h("thead", {}, h("tr", {},
          h("th", { text: t("library.colTitle") }),
          h("th", { text: t("library.colComposer") }),
          h("th", { text: t("library.colFiles") }),
          h("th", { class: "is-num", text: t("library.colLinks") }),
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
            h("td", { "data-label": t("library.colTitle") }, h("strong", { translate: "no", text: displayScoreTitle(score) })),
            h("td", { "data-label": t("library.colComposer"), translate: "no", text: score.composer_name ?? "" }),
            h("td", { "data-label": t("library.colFiles"), text: fileSummary(score.score_files) }),
            h("td", { "data-label": t("library.colLinks"), class: "is-num num", text: linkCount ? String(linkCount) : "–" }),
            h("td", { class: "is-actions" },
              h("button", { type: "button", class: "link-button", onclick: () => openViewer(ctx, score) }, t("common.open")),
              h("button", { type: "button", class: "link-button", onclick: () => openEditScore(ctx, score) }, t("common.edit")),
              h("button", {
                type: "button",
                class: "link-button",
                onclick: () => (isImageScore(score.score_files) ? openPageEditor(ctx, score) : notify(t("pages.pdfLater")))
              }, t("pages.edit")),
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
      h("div", { class: "page-head-actions" },
        h("a", { href: "#/search?t=scores", class: "ghost-button" }, t("library.searchScores")),
        h("button", { type: "button", class: "solid-button", onclick: () => openUploadDialog(ctx) }, t("library.upload"))
      )
    ),
    ...draftNotices,
    table
  );
}
