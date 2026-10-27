import { t } from "../i18n.js";
import { formatBytes, formatDateTime, formatLongDate, formatShortDate, formatTime } from "../format.js";
import { validateFile, detectMime, cleanupStaleUploads, MAX_FILE_BYTES } from "../upload.js";
import { uploadPreparedScore, RETRY_DELAYS_MS } from "../upload-prepared.js";
import { attachPreparedFile } from "../upload-attach.js";
import { prepareScore } from "../score-prepare.js";
import { tryDeleteDraft, tryListDrafts, trySaveDraft } from "../upload-drafts.js";
import { h, createDialog, confirmDialog, errorMessage, notify, setBusy, displayScoreTitle, hasScoreFile, infoOnlyTag } from "../ui.js";
import { isImageScore, moveItem } from "../pages.js";
import { openViewer } from "./viewer.js";
import { openPageEditor } from "./page-editor.js";
import { fileProblemMessage, pageRow, photoSourceButtons } from "./page-list.js";
import { openPhotoEditor } from "./photo-editor.js";
import { roleLabel } from "./layouts.js";
import {
  DIFFICULTY_LEVELS,
  KEY_MODES,
  KEY_TONICS,
  formatDuration,
  isWebLink,
  parseDuration,
  parseKeyText,
  periodForYear,
  scorePeriod,
  tonicLabel
} from "../score-meta.js";

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
// options.attachTo: a Score saved without a file; the same Upload File / Scan Score steps attach one to it.
export function openUploadDialog(ctx, { title = t("upload.title"), saveLabel = t("common.save"), onSaved, draft = null, attachTo = null } = {}) {
  const dialogTitle = draft ? t("upload.resumeTitle") : attachTo ? t("upload.attachTitle") : title;
  const { dialog, body, footer, close, setStatus } = createDialog(dialogTitle, { wide: true });
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

  // Third way to add a Score (PRD RIGHT-001): no file, photo or first page needed.
  async function chooseInfoOnly() {
    if (pending.length && !(await confirmDialog(t("upload.infoOnlyDiscard"), { confirmLabel: t("upload.infoOnlyButton") }))) return;
    const values = { title: titleInput.value, composer_name: composerInput.value };
    close();
    openInfoOnlyDialog(ctx, { title: title === t("upload.title") ? undefined : title, saveLabel, onSaved, values });
  }
  const infoChoice =
    draft || attachTo
      ? null
      : h("div", { class: "info-choice" },
          h("span", { class: "hint", text: t("upload.infoOnlyLead") }),
          h("button", { type: "button", class: "ghost-button", onclick: chooseInfoOnly }, t("upload.infoOnlyButton"))
        );
  const sourceArea = h("div", {}, photoSourceButtons({ accept: FILE_ACCEPT, onFiles: addFiles, setStatus }));
  const preparedNote = h("p", { class: "hint", hidden: true });
  // Once the final PDF exists the pages are fixed; only the title and composer can still change.
  function showPrepared() {
    sourceArea.hidden = Boolean(prepared);
    pendingList.hidden = Boolean(prepared);
    if (infoChoice) infoChoice.hidden = Boolean(prepared);
    preparedNote.hidden = !prepared;
    if (prepared) {
      const note = attachTo ? "upload.attachPreparedNote" : "upload.preparedNote";
      preparedNote.textContent = t(note, { name: prepared.pdfName, size: formatBytes(prepared.pdf.size) });
    }
  }

  body.append(
    ...(attachTo
      ? [
          h("p", { class: "dialog-score", translate: "no", text: displayScoreTitle(attachTo) }),
          h("p", { class: "hint", text: t("upload.attachHint") })
        ]
      : [
          h("div", { class: "field-row" },
            h("label", { class: "field" }, h("span", { text: t("upload.scoreTitle") }), titleInput),
            h("label", { class: "field" }, h("span", { text: t("upload.composer") }), composerInput)
          ),
          h("p", { class: "hint", text: t("upload.optionalHint") })
        ]),
    sourceArea,
    h("p", { class: "hint", text: t("upload.rules", { limit: formatBytes(MAX_FILE_BYTES) }) }),
    pendingList,
    ...(infoChoice ? [infoChoice] : []),
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
  // A file being attached is only kept in this dialog, so discarding it needs no question.
  discardButton.addEventListener("click", async () => {
    if (!attachTo) {
      const ok = await confirmDialog(t("upload.discardConfirm"), { confirmLabel: t("upload.discard"), danger: true });
      if (!ok) return;
      await tryDeleteDraft(prepared.scoreId);
    }
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
    if (attachTo) {
      await attach();
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

  // Not kept on this device: if it fails the prepared PDF stays in this dialog for Retry.
  async function attach() {
    showPrepared();
    try {
      await attachPreparedFile(ctx.supabase, ctx.user.id, attachTo.id, prepared, onUploadStage);
    } catch (error) {
      progress.textContent = "";
      setStatus(error?.code === "has_files" ? t("upload.attachHasFile") : errorMessage(error, "upload.attachFailed"));
      saveButton.textContent = t("upload.retry");
      discardButton.hidden = false;
      setBusy(allButtons, false);
      return;
    }
    close();
    notify(t("upload.attached"), "success");
    ctx.refresh();
  }
}

// Score information fields shared by "Save Score Information Only" and Edit: one set of inputs and rules.
function scoreInfoFields(score, periods, composers = []) {
  const listId = `composer-names-${Math.random().toString(36).slice(2)}`;
  const textInput = (value, maxlength, props = {}) => h("input", { type: "text", maxlength, value: value ?? "", ...props });
  const titleInput = textInput(score.title, 200, { placeholder: score.provisional_title ?? null });
  const composerInput = textInput(score.composer_name, 200, composers.length ? { list: listId, autocomplete: "off" } : {});
  const composerList = composers.length ? h("datalist", { id: listId }, composers.map((name) => h("option", { value: name }))) : null;
  const publisherInput = textInput(score.publisher, 200);
  const editionInput = textInput(score.edition, 200, { placeholder: t("library.editionPlaceholder") });
  const scorebookInput = textInput(score.scorebook, 200);
  const pageInput = textInput(score.scorebook_page, 40, { placeholder: t("library.scorebookPagePlaceholder") });
  const locationInput = textInput(score.physical_location, 200, { placeholder: t("library.locationPlaceholder"), translate: "no" });
  const linkInput = h("input", {
    type: "url",
    inputmode: "url",
    maxlength: 2000,
    value: score.external_url ?? "",
    placeholder: "https://",
    autocomplete: "off",
    translate: "no"
  });
  const durationInput = textInput(formatDuration(score.duration_seconds), 6, {
    inputmode: "numeric",
    placeholder: t("library.durationPlaceholder")
  });
  const difficultySelect = h("select", {},
    h("option", { value: "" }, t("library.keyNone")),
    DIFFICULTY_LEVELS.map((level) => h("option", { value: level, selected: level === score.difficulty }, t(`library.difficulty.${level}`)))
  );
  const noteInput = h("textarea", { rows: 3, maxlength: 2000, translate: "no" }, score.note ?? "");

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

  const field = (label, control) => h("label", { class: "field" }, h("span", { text: label }), control);
  const parts = {
    title: (label = t("upload.scoreTitle")) => field(label, titleInput),
    composer: () => [field(t("upload.composer"), composerInput), composerList],
    source: () => [
      h("div", { class: "field-row" }, field(t("library.publisherLabel"), publisherInput), field(t("library.editionLabel"), editionInput)),
      h("div", { class: "field-row" }, field(t("library.scorebookLabel"), scorebookInput), field(t("library.scorebookPageLabel"), pageInput)),
      field(t("library.locationLabel"), locationInput),
      field(t("library.linkLabel"), linkInput)
    ],
    key: () => [
      h("div", { class: "field-row" }, field(t("library.keyTonic"), tonicSelect), field(t("library.keyMode"), modeSelect)),
      h("div", { class: "field-group" }, field(t("library.keyText"), keyTextInput), suggestButton)
    ],
    year: () => [
      h("div", { class: "field-row" },
        h("div", { class: "field-group" },
          field(t("library.yearLabel"), yearInput),
          h("label", { class: "choice" }, approxBox, h("span", { text: t("library.yearApprox") }))
        ),
        field(t("library.periodLabel"), periodSelect)
      ),
      h("p", { class: "hint", text: t("library.periodHint") })
    ],
    performance: () => h("div", { class: "field-row" },
      field(t("library.durationLabel"), durationInput),
      field(t("library.difficultyLabel"), difficultySelect)
    ),
    note: () => field(t("library.noteLabel"), noteInput)
  };

  // { fields } ready for db.createInfoScore / updateScore, or { error, focus } for the first problem.
  function read() {
    const yearText = yearInput.value.trim();
    const year = yearText ? Number(yearText) : null;
    if (yearText && (!Number.isInteger(year) || year < 800 || year > 2100)) return { error: t("library.yearInvalid"), focus: yearInput };
    const link = linkInput.value.trim();
    if (link && !isWebLink(link)) return { error: t("library.linkInvalid"), focus: linkInput };
    const duration = parseDuration(durationInput.value);
    if (!duration.ok) return { error: t("library.durationInvalid"), focus: durationInput };
    return {
      fields: {
        title: titleInput.value,
        composer_name: composerInput.value,
        key_tonic: tonicSelect.value || null,
        key_mode: modeSelect.value || null,
        key_text: keyTextInput.value,
        composition_year: year,
        composition_year_approx: year != null && approxBox.checked,
        period_code: periodSelect.value || null,
        note: noteInput.value,
        publisher: publisherInput.value,
        edition: editionInput.value,
        scorebook: scorebookInput.value,
        scorebook_page: pageInput.value,
        physical_location: locationInput.value,
        external_url: link,
        duration_seconds: duration.value,
        difficulty: Number(difficultySelect.value) || null
      }
    };
  }

  return { titleInput, parts, read };
}

// "Save Score Information Only" (PRD RIGHT-001~003): title is the only required field; nothing is uploaded.
// options as in openUploadDialog; values: title and composer already typed in the Add Score dialog.
export async function openInfoOnlyDialog(ctx, { title = t("upload.infoOnlyTitle"), saveLabel = t("common.save"), onSaved, values = {} } = {}) {
  const [periods, composers] = await Promise.all([
    ctx.db.periods().catch(() => []),
    ctx.db.scoreComposers().catch(() => [])
  ]);
  const { body, footer, close, setStatus } = createDialog(title, { wide: true });
  const form = scoreInfoFields({ title: values.title, composer_name: values.composer_name }, periods, composers);
  form.titleInput.required = true;
  form.titleInput.setAttribute("aria-required", "true");
  const more = h("details", { class: "more-details" },
    h("summary", { text: t("upload.infoOnlyMore") }),
    form.parts.key(),
    form.parts.year(),
    form.parts.performance(),
    h("p", { class: "hint", text: t("upload.infoOnlyLiturgyHint") })
  );
  body.append(
    ...[
      h("p", { class: "hint info-lead", text: t("upload.infoOnlyIntro") }),
      form.parts.title(t("upload.titleRequired")),
      form.parts.composer(),
      form.parts.source(),
      form.parts.note(),
      more
    ].flat().filter(Boolean)
  );
  const saveButton = h("button", { type: "button", class: "solid-button" }, saveLabel);
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);
  saveButton.addEventListener("click", async () => {
    const result = form.read();
    if (!result.error && !result.fields.title.trim()) Object.assign(result, { error: t("upload.titleMissing"), focus: form.titleInput });
    if (result.error) {
      setStatus(result.error);
      if (more.contains(result.focus)) more.open = true;
      result.focus.focus();
      return;
    }
    setBusy([saveButton], true);
    setStatus("");
    let scoreId;
    try {
      scoreId = await ctx.db.createInfoScore(result.fields);
    } catch (error) {
      setStatus(errorMessage(error, "upload.infoOnlyFailed"));
      setBusy([saveButton], false);
      return;
    }
    try {
      if (onSaved) await onSaved(scoreId);
      close();
      notify(t("upload.infoOnlySaved"), "success");
    } catch (error) {
      close();
      notify(errorMessage(error, "upload.savedButLinkFailed"), "error");
    }
    ctx.refresh();
  });
  form.titleInput.focus();
}

async function openEditScore(ctx, score) {
  const [periods, composers] = await Promise.all([
    ctx.db.periods().catch(() => []),
    ctx.db.scoreComposers().catch(() => [])
  ]);
  const { body, footer, close, setStatus } = createDialog(t("library.editTitle"), { wide: true });
  const form = scoreInfoFields(score, periods, composers);
  body.append(
    ...[
      form.parts.title(),
      form.parts.composer(),
      hasScoreFile(score) ? h("p", { class: "hint", text: t("library.provisional", { name: score.provisional_title }) }) : null,
      form.parts.key(),
      form.parts.year(),
      form.parts.source(),
      form.parts.performance(),
      form.parts.note()
    ].flat().filter(Boolean)
  );
  const saveButton = h("button", { type: "button", class: "solid-button" }, t("common.save"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);
  saveButton.addEventListener("click", async () => {
    const result = form.read();
    if (result.error) {
      setStatus(result.error);
      result.focus.focus();
      return;
    }
    setBusy([saveButton], true);
    try {
      await ctx.db.updateScore(score.id, result.fields);
      close();
      notify(t("library.saved"), "success");
      ctx.refresh();
    } catch (error) {
      setStatus(errorMessage(error, "library.saveFailed"));
      setBusy([saveButton], false);
    }
  });
  form.titleInput.focus();
}

// Attach Score File (PRD RIGHT-004): the usual Upload File / Scan Score steps, stored into this same Score.
export function openAttachFile(ctx, score) {
  openUploadDialog(ctx, { attachTo: score });
}

// score: a Score with its files (Score Library, Missa) or only an id (Search), which is then loaded.
export async function openScoreDetails(ctx, scoreOrId) {
  let score = scoreOrId;
  if (typeof scoreOrId === "string") {
    try {
      score = await ctx.db.score(scoreOrId);
    } catch (error) {
      notify(errorMessage(error), "error");
      return;
    }
    if (!score) {
      notify(t("library.notFound"), "error");
      return;
    }
  }
  const withFile = hasScoreFile(score);
  const { body, footer, close } = createDialog(t(withFile ? "library.detailsTitle" : "library.infoDetailsTitle"), { wide: true });
  const files = score.score_files ?? [];
  const usageList = h("ul", { class: "plain-list compact" }, h("li", { class: "meta", text: t("common.loading") }));
  const periods = await ctx.db.periods().catch(() => []);
  const period = scorePeriod(score, periods);
  const key = [keyLabel(score.key_tonic, score.key_mode), score.key_text ? `(${score.key_text})` : ""].filter(Boolean).join(" ");
  const scorebook = [score.scorebook, score.scorebook_page ? t("library.pageNo", { page: score.scorebook_page }) : ""].filter(Boolean).join(" · ");
  const link = score.external_url && isWebLink(score.external_url)
    ? h("a", { href: score.external_url, target: "_blank", rel: "noopener noreferrer", class: "detail-link", text: score.external_url })
    : score.external_url;
  const facts = [
    [t("library.scoreTitle"), displayScoreTitle(score), { translate: "no" }],
    withFile ? [t("library.provisionalLabel"), score.provisional_title, { translate: "no" }] : null,
    score.composer_name ? [t("upload.composer"), score.composer_name, { translate: "no" }] : null,
    score.publisher ? [t("library.publisherLabel"), score.publisher, { translate: "no" }] : null,
    score.edition ? [t("library.editionLabel"), score.edition, { translate: "no" }] : null,
    scorebook ? [t("library.scorebookLabel"), scorebook, { translate: "no" }] : null,
    score.physical_location ? [t("library.locationLabel"), score.physical_location, { translate: "no" }] : null,
    link ? [t("library.linkLabel"), link, { translate: "no" }] : null,
    key ? [t("library.keyLabel"), key, { translate: "no" }] : null,
    score.composition_year ? [t("library.yearLabel"), yearLabel(score), { class: "num" }] : null,
    period.code ? [t("library.periodLabel"), periodName(period.code, periods), {}] : null,
    score.duration_seconds ? [t("library.durationLabel"), formatDuration(score.duration_seconds), { class: "num" }] : null,
    score.difficulty ? [t("library.difficultyLabel"), t(`library.difficulty.${score.difficulty}`), {}] : null,
    [t("library.createdAt"), formatDateTime(score.created_at), { class: "num" }],
    [t("library.lastEditedAt"), formatDateTime(score.last_edited_at), { class: "num" }]
  ].filter(Boolean);
  const history = performanceList(ctx, score);
  if (!withFile) {
    body.append(
      h("div", { class: "info-only-head" },
        infoOnlyTag(),
        h("p", { class: "hint", text: t("library.infoOnlyHint") }),
        h("button", {
          type: "button",
          class: "ghost-button",
          onclick: () => {
            close();
            openAttachFile(ctx, score);
          }
        }, t("library.attachFile"))
      )
    );
  }
  body.append(
    h("dl", { class: "detail-grid" },
      facts.flatMap(([name, value, props]) => [h("dt", { text: name }), h("dd", { ...props }, value)])
    ),
    h("div", { class: "score-note", hidden: !score.note },
      h("h3", { class: "sub-head", text: t("library.noteLabel") }),
      h("p", { class: "note-text", translate: "no", text: score.note ?? "" })
    ),
    history.element,
    h("h3", { class: "sub-head", text: t("library.filesHead") }),
    withFile
      ? h(
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
        )
      : h("p", { class: "meta", text: t("library.noScoreFile") }),
    h("h3", { class: "sub-head", text: t("library.usageHead") }),
    usageList
  );
  footer.append(
    h("button", {
      type: "button",
      class: "ghost-button",
      onclick: () => {
        close();
        openEditScore(ctx, score);
      }
    }, t("common.edit")),
    h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.close"))
  );
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
  const message = hasScoreFile(score) ? "library.deleteConfirm" : "library.deleteInfoConfirm";
  const ok = await confirmDialog(t(message, { title: displayScoreTitle(score) }), {
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
          // Information Only: nothing to open or page through; the file can be attached later.
          if (!hasScoreFile(score)) {
            return h("tr", {},
              h("td", { "data-label": t("library.colTitle") }, h("strong", { translate: "no", text: displayScoreTitle(score) })),
              h("td", { "data-label": t("library.colComposer"), translate: "no", text: score.composer_name ?? "" }),
              h("td", { "data-label": t("library.colFiles") }, infoOnlyTag()),
              h("td", { "data-label": t("library.colLinks"), class: "is-num num", text: linkCount ? String(linkCount) : "–" }),
              h("td", { class: "is-actions" },
                h("button", { type: "button", class: "link-button", onclick: () => openAttachFile(ctx, score) }, t("library.attachFile")),
                h("button", { type: "button", class: "link-button", onclick: () => openEditScore(ctx, score) }, t("common.edit")),
                h("button", { type: "button", class: "link-button", onclick: () => openScoreDetails(ctx, score) }, t("library.infoDetails")),
                deleteButton
              )
            );
          }
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
              h("button", { type: "button", class: "link-button", onclick: () => openScoreDetails(ctx, score) }, t("library.details")),
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
