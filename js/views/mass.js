import { t } from "../i18n.js";
import {
  colorAbbr,
  formatHourLabel,
  formatLongDate,
  formatTime,
  hourValue,
  isHourChoice,
  colorSwatch,
  massLiturgyTitle,
  observanceTitle,
  sortBySlotNo,
  todayIso,
  weekdayIndex,
  weekdayName
} from "../format.js";
import { countsAsPlayed, entryPlayed, playedEntries } from "../played.js";
import { h, actionMenu, createDialog, confirmDialog, errorMessage, notify, setBusy, colorDot, displayScoreTitle } from "../ui.js";
import { roleChecklist, layoutSelection, roleLabel } from "./layouts.js";
import {
  deletionGroups,
  firstOccurrenceOn,
  liturgyFields,
  offWeekday,
  shiftIso,
  sourceKey,
  weeksAheadRange
} from "../recurrence.js";
import { isMissingRelation } from "../db.js";
import { openUploadDialog } from "./library.js";
import { openViewer } from "./viewer.js";

const COLORS = ["green", "white", "violet", "red", "rose"];
const STATUSES = ["planned", "completed", "cancelled"];
const HOURS = Array.from({ length: 18 }, (_, index) => index + 6);

function selectField(label, options, value) {
  const select = h(
    "select",
    {},
    options.map((option) => h("option", { value: option.value, selected: option.value === (value ?? "") }, option.label))
  );
  return { select, element: h("label", { class: "field" }, h("span", { text: label }), select) };
}

export function massTitle(mass) {
  return mass?.title?.trim() || t("mass.untitled");
}

// title: { text, lang } from observanceTitle / massLiturgyTitle. The color abbreviation is always Korean.
export function liturgyText(title, colorCode) {
  return h("span", {},
    h("span", { lang: title.lang, text: title.text }),
    colorCode ? [" ", h("span", { lang: "ko", text: `(${colorAbbr(colorCode)})` })] : null
  );
}

export function liturgyLine(title, colorCode, { unknownKey = "liturgy.unknown" } = {}) {
  if (!title?.text) return h("p", { class: "liturgy-line is-unknown", text: t(unknownKey) });
  return h("p", { class: "liturgy-line" }, liturgyText(title, colorCode), colorDot(colorCode, colorSwatch(colorCode)));
}

function timeControls(startTime) {
  const stored = formatTime(startTime);
  const onHour = isHourChoice(stored);
  const select = h(
    "select",
    {},
    h("option", { value: "", selected: !stored }, t("mass.timeUnset")),
    HOURS.map((hour) => {
      const value = hourValue(hour);
      return h("option", { value, selected: onHour && stored.startsWith(value) }, formatHourLabel(hour));
    }),
    h("option", { value: "custom", selected: Boolean(stored) && !onHour }, t("mass.timeCustom"))
  );
  const custom = h("input", { type: "time", value: stored && !onHour ? stored : "" });
  const customField = h("div", { class: "time-custom" }, custom);
  customField.hidden = select.value !== "custom";
  select.addEventListener("change", () => {
    customField.hidden = select.value !== "custom";
    if (select.value === "custom") custom.focus();
  });
  return {
    element: h("div", {}, select, customField),
    value() {
      if (!select.value) return null;
      if (select.value === "custom") return custom.value || null;
      return `${select.value}:00`;
    }
  };
}

// Create needs date + observances + layouts + roles. Edit needs mass.
// places: My Places (user_venues). venues: older place names typed before My Places existed.
export function openMassForm(
  ctx,
  { date, observances = [], roles = [], layouts = [], venues = [], places = [], series = null, mass = null }
) {
  const editing = Boolean(mass);
  const formDate = editing ? mass.local_date : date;
  const uid = Math.random().toString(36).slice(2);
  const { body, footer, close, setStatus } = createDialog(t(editing ? "mass.editTitle" : "mass.newTitle"), { wide: true });
  body.classList.add("mass-form");

  const titleId = `mass-title-${uid}`;
  const titleInput = h("input", { id: titleId, type: "text", maxlength: 100, value: mass?.title ?? "", placeholder: t("mass.titlePlaceholder") });
  const time = timeControls(mass?.start_time);
  const venueListId = `venues-${uid}`;
  const venueInput = h("input", {
    type: "text",
    maxlength: 100,
    list: venueListId,
    value: mass?.venue_name ?? "",
    placeholder: t("mass.venuePlaceholder")
  });
  const venueHint = h("p", { class: "hint", role: "status" });
  const knownPlaces = [...places];
  const placeFor = (name) => {
    const key = String(name ?? "").trim().toLowerCase();
    return key ? knownPlaces.find((place) => place.name.trim().toLowerCase() === key) ?? null : null;
  };
  const venueNames = [...knownPlaces.map((place) => place.name), ...venues.filter((name) => !placeFor(name))];
  const notesInput = h("textarea", { rows: 2, maxlength: 1000 }, mass?.notes ?? "");

  const choiceName = `liturgy-${uid}`;
  const initialObservance = (editing && observances.find((item) => item.id === mass.observance_id)) || observances[0] || null;
  const liturgyView = observances.length > 1
    ? observances.map((observance) =>
        h("label", { class: "choice" },
          h("input", { type: "radio", name: choiceName, value: observance.id, checked: observance === initialObservance }),
          h("span", {}, liturgyText(observanceTitle(observance), observance.color_code), " ",
            colorDot(observance.color_code, colorSwatch(observance.color_code)))
        )
      )
    : liturgyLine(initialObservance && observanceTitle(initialObservance), initialObservance?.color_code);

  const specialOpen = editing && sourceKey(mass.liturgy_source) === "user";
  const specialName = h("input", {
    type: "text",
    maxlength: 200,
    value: specialOpen ? mass.celebration_name ?? "" : "",
    placeholder: t("mass.specialNamePlaceholder")
  });
  const specialColor = h(
    "select",
    {},
    h("option", { value: "" }, t("mass.colorOption.unknown")),
    COLORS.map((code) => h("option", { value: code, selected: specialOpen && mass.color_code === code }, t(`mass.colorOption.${code}`)))
  );
  const specialButton = h("button", {
    type: "button",
    class: "link-button",
    title: t("mass.specialAdd"),
    "aria-label": t("mass.specialAdd")
  }, t("mass.specialButton"));
  const specialBox = h("div", { class: "special-mass" },
    h("div", { class: "field-head" },
      h("span", { class: "field-label", text: t("mass.specialMass") }),
      h("button", { type: "button", class: "link-button", onclick: () => setSpecial(false) }, t("mass.specialRemove"))
    ),
    h("div", { class: "special-fields" },
      h("label", { class: "field" }, h("span", { text: t("mass.manualName") }), specialName),
      h("label", { class: "field" }, h("span", { text: t("mass.color") }), specialColor)
    )
  );
  function setSpecial(open) {
    specialBox.hidden = !open;
    specialButton.hidden = open;
    if (open) {
      specialName.focus();
    } else {
      specialName.value = "";
      specialColor.value = "";
      specialButton.focus();
    }
  }
  specialButton.addEventListener("click", () => setSpecial(true));
  specialBox.hidden = !specialOpen;
  specialButton.hidden = specialOpen;

  const knownLayouts = [...layouts];
  const currentLayoutId = mass?.layout_id ?? series?.layout_id ?? "";
  const newOption = editing ? null : h("option", { value: "new" }, t("mass.layoutNew"));
  const layoutSelect = h(
    "select",
    {},
    h("option", { value: "" }, t("mass.layoutNone")),
    knownLayouts.map((layout) => h("option", { value: layout.id, selected: layout.id === currentLayoutId }, layout.name)),
    newOption
  );
  const layoutName = h("input", { type: "text", maxlength: 100, placeholder: t("mass.layoutNamePlaceholder") });
  const layoutNameField = h("label", { class: "field" }, h("span", { text: t("mass.layoutName") }), layoutName);
  layoutNameField.hidden = true;
  const everyItem = () => new Map(roles.map((role) => [role.id, ""]));
  const checklist = editing
    ? null
    : roleChecklist(roles, { selected: everyItem(), labels: { hint: null, selectAll: "mass.selectAll", clearAll: "mass.clearAll" } });
  layoutSelect.addEventListener("change", () => {
    layoutNameField.hidden = layoutSelect.value !== "new";
    if (!checklist) return;
    if (layoutSelect.value === "new") {
      layoutName.focus();
      return;
    }
    const layout = knownLayouts.find((item) => item.id === layoutSelect.value);
    checklist.setSelection(layout ? layoutSelection(layout) : everyItem());
  });

  // A layout made here is kept in the list, so a retry after an error does not create it twice.
  function rememberLayout(id, name, items) {
    knownLayouts.push({ id, name, user_mass_layout_items: items.map((item) => ({ role_id: item.role_id, display_name: item.display_name })) });
    layoutSelect.insertBefore(h("option", { value: id }, name), newOption);
    layoutSelect.value = id;
    layoutNameField.hidden = true;
  }

  const recurrence = h(
    "select",
    {},
    h("option", { value: "once", selected: !series }, t("mass.recurrenceOnce")),
    h("option", { value: "1", selected: series?.interval_weeks === 1 }, t("mass.recurrenceWeekly")),
    h("option", { value: "2", selected: series?.interval_weeks === 2 }, t("mass.recurrenceBiweekly"))
  );
  const weekday = h(
    "select",
    {},
    [0, 1, 2, 3, 4, 5, 6].map((index) =>
      h("option", { value: String(index), selected: index === (series?.weekday ?? weekdayIndex(formDate)) }, t(`mass.weekday.${index}`))
    )
  );
  const scopeName = `scope-${uid}`;
  const scopeThis = h("input", { type: "radio", name: scopeName, value: "this", checked: true });
  const scopeFuture = h("input", { type: "radio", name: scopeName, value: "future" });
  const scopeAll = h("input", { type: "radio", name: scopeName, value: "all" });
  const scopeBox = h("div", { class: "choices" },
    h("span", { class: "field-label", text: t("mass.recurrenceScope") }),
    h("label", { class: "choice" }, scopeThis, h("span", { text: t("mass.recurrenceThisOnly") })),
    h("label", { class: "choice" }, scopeFuture, h("span", { text: t("mass.recurrenceFuture") })),
    h("label", { class: "choice" }, scopeAll, h("span", { text: t("mass.recurrenceAll") })),
    h("p", { class: "hint", text: t("mass.recurrenceWeekdayHint") })
  );
  const recurrenceFields = h("div", {},
    recurrence,
    h("label", { class: "field recurrence-day" }, h("span", { text: t("mass.recurrenceWeekday") }), weekday)
  );
  if (editing && series) {
    recurrence.disabled = true;
    const syncScope = () => {
      layoutSelect.disabled = scopeThis.checked;
      weekday.disabled = !scopeFuture.checked;
    };
    for (const input of [scopeThis, scopeFuture, scopeAll]) input.addEventListener("change", syncScope);
    syncScope();
  }

  const status = editing
    ? selectField(t("mass.statusField"), STATUSES.map((code) => ({ value: code, label: t(`mass.statusOption.${code}`) })), mass.status)
    : null;
  // Layout and recurrence belong to a series; a one-off Mass edits its items in the Mass page.
  const showSeriesFields = !editing || Boolean(series);

  // A place opens with its Music Parts; the member can still change them for this Missa.
  venueInput.addEventListener("change", () => {
    venueHint.textContent = "";
    const place = placeFor(venueInput.value);
    const layout = knownLayouts.find((item) => item.id === place?.layout_id);
    if (!layout || !showSeriesFields || layoutSelect.disabled || layoutSelect.value === layout.id) return;
    layoutSelect.value = layout.id;
    layoutSelect.dispatchEvent(new Event("change"));
    venueHint.textContent = t("mass.placeLayoutApplied", { name: layout.name });
  });

  // Native append would print a skipped (null) field as the text "null".
  body.append(...[
    h("fieldset", { class: "field choices form-liturgy" },
      h("legend", { text: t("mass.liturgyLabel") }),
      h("p", { class: "dialog-date num", lang: "ko", text: formatLongDate(formDate) }),
      liturgyView
    ),
    h("div", { class: "field" },
      h("div", { class: "field-head" }, h("label", { for: titleId, text: t("mass.titleLabel") }), specialButton),
      titleInput
    ),
    specialBox,
    h("label", { class: "field" }, h("span", { text: t("mass.timeLabel") }), time.element),
    h("label", { class: "field" },
      h("span", { text: t("mass.venueLabel") }),
      venueInput,
      h("datalist", { id: venueListId }, venueNames.map((name) => h("option", { value: name }))),
      venueHint
    ),
    showSeriesFields ? h("label", { class: "field" }, h("span", { text: t("mass.layoutLabel") }), layoutSelect) : null,
    showSeriesFields ? layoutNameField : null,
    checklist ? h("div", { class: "layout-items" }, checklist.element) : null,
    showSeriesFields
      ? h("fieldset", { class: "field" },
          h("legend", { text: t("mass.recurrenceLabel") }),
          recurrenceFields,
          editing ? scopeBox : h("p", { class: "hint", text: t("mass.recurrenceHint") })
        )
      : null,
    h("label", { class: "field" }, h("span", { text: t("mass.notesLabel") }), notesInput),
    status ? status.element : null
  ].filter(Boolean));

  const saveButton = h("button", { type: "button", class: "solid-button" }, t("mass.saveButton"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("mass.cancelButton")), saveButton);

  function chosenObservance() {
    if (observances.length < 2) return observances[0] ?? null;
    const value = body.querySelector(`input[name="${choiceName}"]:checked`)?.value;
    return observances.find((item) => item.id === value) ?? observances[0];
  }

  function liturgyPayload() {
    const observance = chosenObservance();
    const name = specialBox.hidden ? null : specialName.value.trim() || null;
    const color = specialBox.hidden ? null : specialColor.value || null;
    if (!name && !color) return liturgyFields(observance);
    return {
      observance_id: null,
      celebration_name: name,
      color_code: color,
      season_code: observance?.season_code ?? null,
      liturgy_source: "user"
    };
  }

  function baseFields() {
    return {
      title: titleInput.value.trim() || null,
      start_time: time.value(),
      notes: notesInput.value.trim() || null,
      ...liturgyPayload()
    };
  }

  // A new name becomes a place in My Places, linked to the Music Parts chosen now.
  async function venueFields(layoutId) {
    const name = venueInput.value.trim();
    if (!name) return { venue_id: null, venue_name: null };
    let place = placeFor(name);
    if (!place) {
      place = await ctx.db.createVenue(name, layoutId || null);
      knownPlaces.push(place);
    }
    return { venue_id: place.id, venue_name: place.name };
  }

  return new Promise((resolve) => {
    let savedId = null;
    let afterClose = null;
    saveButton.addEventListener("click", async () => {
      const stop = (message, target) => {
        setStatus(message);
        setBusy([saveButton], false);
        target?.focus();
      };
      const fields = baseFields();
      if (status) fields.status = status.select.value;
      setBusy([saveButton], true);
      setStatus("");
      let seriesId = null;
      try {
        if (editing) {
          const scope = !series || scopeThis.checked ? "this" : scopeAll.checked ? "all" : "future";
          if (scope === "this") {
            if (series) fields.series_locked = true;
            Object.assign(fields, await venueFields(mass.layout_id));
            await ctx.db.updateMass(mass.id, fields);
            savedId = mass.id;
          } else {
            if (scope === "all" && !(await confirmDialog(t("mass.recurrenceAllConfirm"), { confirmLabel: t("mass.saveButton") }))) {
              setBusy([saveButton], false);
              return;
            }
            const newWeekday = Number(weekday.value);
            const weekdayChanged = scope === "future" && newWeekday !== Number(series.weekday);
            const patch = {
              title: fields.title,
              start_time: fields.start_time,
              ...(await venueFields(layoutSelect.value || null)),
              layout_id: layoutSelect.value || null
            };
            // A new weekday starts from this date, so past weeks are not filled in on the new day.
            await ctx.db.updateSeries(series.id, weekdayChanged ? { ...patch, weekday: newWeekday, starts_on: mass.local_date } : patch);
            await ctx.db.updateMass(mass.id, { ...fields, ...patch, series_locked: false });
            const layout = knownLayouts.find((item) => item.id === layoutSelect.value);
            const items = layout
              ? [...layoutSelection(layout)].map(([role_id, display_name]) => ({ role_id, display_name: display_name || null }))
              : [];
            await ctx.db.syncSeriesMasses(series.id, scope === "all" ? null : mass.local_date, patch, items);
            if (weekdayChanged) {
              afterClose = await settleOldWeekday(ctx, series, mass, newWeekday);
            } else {
              savedId = mass.id;
            }
          }
        } else {
          let layoutId = layoutSelect.value || null;
          const items = checklist.read();
          if (layoutSelect.value === "new") {
            const name = layoutName.value.trim();
            if (!name) {
              stop(t("mass.layoutNameRequired"), layoutName);
              return;
            }
            layoutId = await ctx.db.createLayout(name, items);
            rememberLayout(layoutId, name, items);
          }
          if (recurrence.value !== "once" && !layoutId) {
            stop(t("mass.layoutForRecurrence"), layoutSelect);
            return;
          }
          fields.local_date = formDate;
          fields.layout_id = layoutId;
          Object.assign(fields, await venueFields(layoutId));
          if (recurrence.value !== "once") {
            const created = await ctx.db.createSeries({
              title: fields.title,
              start_time: fields.start_time,
              venue_name: fields.venue_name,
              venue_id: fields.venue_id,
              layout_id: layoutId,
              weekday: Number(weekday.value),
              interval_weeks: Number(recurrence.value),
              starts_on: formDate
            });
            seriesId = created.id;
            fields.series_id = seriesId;
            fields.series_locked = false;
          }
          savedId = await ctx.db.createMass(fields, items);
          if (seriesId) {
            const range = weeksAheadRange(formDate, 16);
            await ctx.db.ensureOccurrences(range.from, range.to);
          }
        }
        close();
        afterClose?.();
      } catch (error) {
        if (seriesId && !savedId) await ctx.db.deleteSeries(seriesId).catch(() => {});
        setStatus(isMissingRelation(error) ? t("mass.seriesNeeded") : errorMessage(error, "mass.saveFailed"));
        setBusy([saveButton], false);
      }
    });
    saveButton.closest("dialog").addEventListener("close", () => resolve(savedId));
  });
}

function openItemsEditor(ctx, mass, roles) {
  const slots = mass.mass_music_slots ?? [];
  const selected = new Map(slots.map((slot) => [slot.role_id, slot.display_name ?? ""]));
  const locked = new Set(slots.filter((slot) => slot.mass_music_entries.length).map((slot) => slot.role_id));
  const { body, footer, close, setStatus } = createDialog(t("mass.itemsEditTitle"), { wide: true });
  const checklist = roleChecklist(roles, { selected, locked });
  body.append(h("p", { class: "hint", text: t("mass.itemsEditHint") }), checklist.element);
  const saveButton = h("button", { type: "button", class: "solid-button" }, t("common.save"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);
  saveButton.addEventListener("click", async () => {
    setBusy([saveButton], true);
    try {
      await ctx.db.saveSlots(mass.id, checklist.read(), slots);
      close();
      notify(t("mass.itemsSaved"), "success");
      ctx.refresh();
    } catch (error) {
      setStatus(errorMessage(error, "mass.itemsSaveFailed", { slot_has_entries: "roles.locked" }));
      setBusy([saveButton], false);
    }
  });
}

async function openLinkPicker(ctx, slot, itemName) {
  const { body, footer, close } = createDialog(t("mass.pickTitle", { item: itemName }), { wide: true });
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.close")));
  body.append(h("p", { class: "meta", text: t("common.loading") }));
  let scores;
  try {
    scores = await ctx.db.readyScores();
  } catch (error) {
    body.replaceChildren(h("p", { class: "empty", text: errorMessage(error) }));
    return;
  }
  const linkedIds = new Set(slot.mass_music_entries.map((entry) => entry.owned_score_id));
  const available = scores.filter((score) => !linkedIds.has(score.id));
  if (!available.length) {
    body.replaceChildren(h("p", { class: "empty", text: t(scores.length ? "mass.pickAllLinked" : "mass.pickEmpty") }));
    return;
  }
  body.replaceChildren(
    h("ul", { class: "plain-list" },
      available.map((score) => {
        const button = h("button", { type: "button", class: "solid-button is-small" }, t("mass.link"));
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await ctx.db.linkScore(slot.id, score.id);
            close();
            notify(t("mass.linked", { title: displayScoreTitle(score), item: itemName }), "success");
            ctx.refresh();
          } catch (error) {
            notify(errorMessage(error, "mass.linkFailed"), "error");
            button.disabled = false;
          }
        });
        return h("li", { class: "list-row" },
          h("div", { class: "list-main" },
            h("strong", { text: displayScoreTitle(score) }),
            h("span", { class: "meta", text: [score.composer_name, t("mass.usedCount", { count: score.mass_music_entries?.length ?? 0 })].filter(Boolean).join(" · ") })
          ),
          button
        );
      })
    )
  );
}

// played: the song counts as played (decision D1), so unlinking also takes it out of the history.
async function unlinkEntry(ctx, entry, itemName, played = false) {
  const score = entry.owned_scores;
  const key = played ? "mass.unlinkPlayedConfirm" : "mass.unlinkConfirm";
  const ok = await confirmDialog(t(key, { title: displayScoreTitle(score), item: itemName }), {
    confirmLabel: t("mass.unlink"),
    danger: played
  });
  if (!ok) return;
  try {
    await ctx.db.unlink(entry.id);
    notify(t("mass.unlinked"), "success");
    ctx.refresh();
  } catch (error) {
    notify(errorMessage(error, "mass.unlinkFailed"), "error");
  }
}

async function toggleNotPlayed(ctx, entry) {
  const marking = !entry.not_played_at;
  try {
    await ctx.db.setNotPlayed(entry.id, marking);
    notify(t(marking ? "mass.markedNotPlayed" : "mass.markedPlayed", { title: displayScoreTitle(entry.owned_scores) }), "success");
    ctx.refresh();
  } catch (error) {
    notify(errorMessage(error, "mass.playedFailed"), "error");
  }
}

function openEntryNote(ctx, entry, itemName) {
  const { body, footer, close, setStatus } = createDialog(t("mass.entryNoteTitle"));
  const inputId = `entry-note-${entry.id}`;
  const input = h("textarea", { id: inputId, rows: 4, maxlength: 2000 }, entry.note ?? "");
  body.append(
    h("p", { class: "meta", translate: "no", text: `${itemName} · ${displayScoreTitle(entry.owned_scores)}` }),
    h("div", { class: "field" }, h("label", { for: inputId, text: t("mass.entryNoteLabel") }), input),
    h("p", { class: "hint", text: t("mass.entryNoteHint") })
  );
  const saveButton = h("button", { type: "button", class: "solid-button" }, t("common.save"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);
  saveButton.addEventListener("click", async () => {
    setBusy([saveButton], true);
    try {
      await ctx.db.setEntryNote(entry.id, input.value);
      close();
      notify(t("mass.entryNoteSaved"), "success");
      ctx.refresh();
    } catch (error) {
      setStatus(errorMessage(error, "mass.entryNoteFailed"));
      setBusy([saveButton], false);
    }
  });
  input.focus();
}

// Resolves with the ids to delete ([] only when noneLabel allows it), or null when closed.
function pickMasses(rows, { title, lead, cancelLabel, noneLabel = null }) {
  return new Promise((resolve) => {
    const { body, footer, close, dialog } = createDialog(title, { wide: true });
    const groups = deletionGroups(rows);
    const choices = [];
    const row = (item, { checked = false, disabled = false } = {}) => {
      const box = h("input", { type: "checkbox", checked, disabled });
      if (!disabled) choices.push({ box, id: item.id });
      const notes = [
        formatTime(item.start_time),
        massTitle(item),
        item.played ? t("mass.pickPlayedTag", { count: item.played }) : item.linked ? t("mass.pickLinkedTag") : null,
        item.series_locked ? t("mass.pickEditedTag") : null
      ].filter(Boolean);
      return h("li", {},
        h("label", { class: disabled ? "pick-row is-disabled" : "pick-row" },
          box,
          h("span", { class: "pick-main" },
            h("span", { class: "num", lang: "ko", text: formatLongDate(item.local_date) }),
            h("span", { class: "meta", text: notes.join(" · ") })
          )
        )
      );
    };
    const group = (headKey, items, options) =>
      items.length
        ? h("section", { class: "pick-group" },
            h("h3", { class: "sub-head", text: t(headKey, { count: items.length }) }),
            h("ul", { class: "plain-list" }, items.map((item) => row(item, options)))
          )
        : null;
    body.append(...[
      h("p", { class: "sheet-message", text: lead }),
      group("mass.pickPlainHead", groups.plain, { checked: true }),
      group("mass.pickCarefulHead", groups.careful),
      group("mass.pickPlayedHead", groups.played),
      group("mass.pickRecordedHead", groups.recorded, { disabled: true })
    ].filter(Boolean));

    let answer = null;
    const chosen = () => choices.filter((choice) => choice.box.checked).map((choice) => choice.id);
    const deleteButton = h("button", { type: "button", class: "solid-button is-danger" });
    const update = () => {
      const count = chosen().length;
      deleteButton.textContent = count || !noneLabel ? t("mass.pickDeleteButton", { count }) : noneLabel;
      deleteButton.disabled = count === 0 && !noneLabel;
    };
    body.addEventListener("change", update);
    update();
    deleteButton.addEventListener("click", async () => {
      const ids = chosen();
      const played = groups.played.filter((item) => ids.includes(item.id));
      if (played.length) {
        const songs = played.reduce((sum, item) => sum + item.played, 0);
        const ok = await confirmDialog(t("mass.pickPlayedConfirm", { count: played.length, songs }), {
          confirmLabel: t("common.delete"),
          danger: true
        });
        if (!ok) return;
      }
      answer = ids;
      close();
    });
    footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, cancelLabel), deleteButton);
    dialog.addEventListener("close", () => resolve(answer));
  });
}

function chooseDeleteScope(mass) {
  return new Promise((resolve) => {
    const { body, footer, close, dialog } = createDialog(t("mass.deleteScopeTitle"));
    const name = `delete-scope-${Math.random().toString(36).slice(2)}`;
    body.append(
      h("p", { class: "sheet-message", text: t("mass.deleteScopeLead", { title: massTitle(mass) }) }),
      h("div", { class: "choices delete-scope" },
        ["this", "future", "all"].map((value) =>
          h("label", { class: "choice" },
            h("input", { type: "radio", name, value, checked: value === "this" }),
            h("span", { text: t(`mass.deleteScope.${value}`) })
          )
        )
      )
    );
    let answer = null;
    footer.append(
      h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")),
      h("button", {
        type: "button",
        class: "solid-button is-danger",
        onclick: () => {
          answer = body.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
          close();
        }
      }, t("mass.deleteNext"))
    );
    dialog.addEventListener("close", () => resolve(answer));
  });
}

// After a weekday change the new-day Masses are made first; then the member decides about the old-day ones.
async function settleOldWeekday(ctx, series, mass, newWeekday) {
  const range = weeksAheadRange(mass.local_date, 16);
  await ctx.db.ensureOccurrences(range.from, range.to);
  const leftovers = offWeekday(await ctx.db.seriesMasses(series.id, { from: mass.local_date }), newWeekday);
  let ids = [];
  if (leftovers.length) {
    ids =
      (await pickMasses(leftovers, {
        title: t("mass.oldWeekdayTitle"),
        lead: t("mass.oldWeekdayLead", { weekday: weekdayName(newWeekday), count: leftovers.length }),
        cancelLabel: t("mass.pickKeepAll")
      })) ?? [];
    await ctx.db.forgetOccurrences(series.id, leftovers.filter((row) => ids.includes(row.id)));
  }
  const message = ids.length ? t("mass.weekdayMoved", { count: ids.length }) : t("mass.weekdayMovedKept");
  const firstNew = firstOccurrenceOn(mass.local_date, newWeekday) ?? mass.local_date;
  return () => {
    notify(message, "success");
    if (ids.includes(mass.id)) ctx.navigate(`#/date/${firstNew}`);
    else ctx.refresh();
  };
}

async function removeMass(ctx, mass) {
  let series = null;
  try {
    series = await ctx.db.series(mass.series_id);
  } catch (error) {
    notify(errorMessage(error, "mass.deleteFailed"), "error");
    return;
  }
  // PRD 8.37: deleting a past Missa also deletes its performance history, so say so first.
  const played = playedEntries(mass, todayIso()).length;
  const playedMessage = t("mass.deletePlayedConfirm", { title: massTitle(mass), count: played });
  if (!series) {
    const message = played ? playedMessage : t("mass.deleteConfirm", { title: massTitle(mass) });
    const ok = await confirmDialog(message, { confirmLabel: t("common.delete"), danger: true });
    if (!ok) return;
  }
  const scope = series ? await chooseDeleteScope(mass) : "this";
  if (!scope) return;
  if (series && scope === "this" && played) {
    if (!(await confirmDialog(playedMessage, { confirmLabel: t("common.delete"), danger: true }))) return;
  }
  try {
    if (scope === "this") {
      await ctx.db.forgetOccurrence(mass);
      notify(t("mass.deleted"), "success");
      ctx.navigate(`#/date/${mass.local_date}`);
      return;
    }
    if (scope === "all" && !(await confirmDialog(t("mass.deleteAllConfirm"), { confirmLabel: t("mass.deleteNext"), danger: true }))) return;
    const future = scope === "future";
    const rows = await ctx.db.seriesMasses(series.id, { from: future ? mass.local_date : null });
    const ids = await pickMasses(rows, {
      title: t("mass.pickDeleteTitle"),
      lead: future ? t("mass.pickFutureLead", { date: formatLongDate(mass.local_date) }) : t("mass.pickAllLead"),
      cancelLabel: t("common.cancel"),
      noneLabel: t(future ? "mass.pickEndOnly" : "mass.pickRemoveOnly")
    });
    if (!ids) return;
    if (future) await ctx.db.updateSeries(series.id, { ends_on: shiftIso(mass.local_date, -1) });
    await ctx.db.forgetOccurrences(series.id, rows.filter((row) => ids.includes(row.id)));
    if (!future) await ctx.db.deleteSeries(series.id);
    const kept = rows.length - ids.length;
    const done = ids.length
      ? t(future ? "mass.seriesEnded" : "mass.seriesRemoved", { count: ids.length })
      : t(future ? "mass.seriesEndedOnly" : "mass.seriesRemovedOnly");
    const keptNote = ids.length && kept ? ` ${t(future ? "mass.keptNote" : "mass.keptAsOnce", { kept })}` : "";
    notify(done + keptNote, "success");
    if (ids.includes(mass.id)) ctx.navigate(`#/date/${mass.local_date}`);
    else ctx.refresh();
  } catch (error) {
    notify(errorMessage(error, "mass.deleteFailed"), "error");
    ctx.refresh();
  }
}

export async function renderMass(container, ctx, { id }) {
  const [mass, roles, layouts] = await Promise.all([ctx.db.mass(id), ctx.db.roles(), ctx.db.layouts()]);
  if (!mass) {
    container.append(
      h("p", { class: "empty", text: t("mass.notFound") }),
      h("a", { href: "#/date", class: "link-button" }, t("mass.backToCalendar"))
    );
    return;
  }
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const slots = sortBySlotNo(mass.mass_music_slots ?? [], (slot) => roleById.get(slot.role_id)?.slot_no ?? 99);

  const layout = layouts.find((item) => item.id === mass.layout_id) ?? null;

  async function editMass() {
    const [observances, venues, places, series] = await Promise.all([
      observancesFor(ctx, mass.local_date),
      ctx.db.usedVenues(),
      ctx.db.venues(),
      ctx.db.series(mass.series_id)
    ]);
    const savedId = await openMassForm(ctx, { mass, observances, roles, layouts, venues, places, series });
    if (savedId) {
      notify(t("mass.saved"), "success");
      ctx.refresh();
    }
  }

  const header = h("section", { class: "mass-head" },
    h("a", { href: `#/date/${mass.local_date}`, class: "back-link" }, t("mass.backToDate")),
    h("h1", { class: "page-title", text: t("mass.pageTitle") }),
    h("p", { class: "date-title num", lang: "ko", text: formatLongDate(mass.local_date) }),
    liturgyLine(massLiturgyTitle(mass), mass.color_code)
  );

  const facts = [
    [t("mass.venueLabel"), mass.venue_name ? h("span", { translate: "no", text: mass.venue_name }) : "—"],
    [t("mass.layoutLabel"), layout ? h("a", { href: "#/layouts", translate: "no", text: layout.name }) : t("mass.noLayout")],
    mass.status && mass.status !== "planned" ? [t("mass.statusField"), t(`mass.status.${mass.status}`)] : null,
    sourceKey(mass.liturgy_source) === "unknown" ? null : [t("mass.liturgyLabel"), t(`mass.source.${sourceKey(mass.liturgy_source)}`)]
  ].filter(Boolean);

  const card = h("section", { class: "mass-card", "aria-label": massTitle(mass) },
    h("div", { class: "mass-card-head" },
      h("h2", { class: "mass-name", translate: "no" }, massTitle(mass), mass.start_time ? h("span", { class: "time num", text: formatTime(mass.start_time) }) : null),
      actionMenu(t("mass.moreActions"), [
        { label: t("mass.edit"), onSelect: editMass },
        { label: t("mass.editItems"), onSelect: () => openItemsEditor(ctx, mass, roles) },
        { label: t("mass.delete"), danger: true, onSelect: () => removeMass(ctx, mass) }
      ])
    ),
    h("dl", { class: "mass-facts" }, facts.flatMap(([name, value]) => [h("dt", { text: name }), h("dd", {}, value)])),
    mass.notes ? h("p", { class: "notes", translate: "no", text: mass.notes }) : null,
    h("div", { class: "mass-actions" },
      h("button", { type: "button", class: "solid-button", onclick: () => notify(t("mass.performSoon")) }, t("mass.performMode")),
      h("button", { type: "button", class: "ghost-button", onclick: () => openUploadDialog(ctx) }, t("mass.addScore"))
    )
  );

  // Decision D1: from the day after the Missa, linked songs count as played unless marked "Not played".
  const today = todayIso();
  const past = countsAsPlayed(mass, today);

  // One row per linked score. Extra scores of the same item reuse the grid with empty number/role cells.
  const musicRows = slots.flatMap((slot) => {
    const role = roleById.get(slot.role_id);
    const number = String((role?.slot_no ?? 0) + 1).padStart(2, "0");
    const itemName = slot.display_name || roleLabel(role) || t("mass.unnamedItem");
    const entries = slot.mass_music_entries ?? [];
    const slotActions = [
      {
        label: t("mass.newScore"),
        onSelect: () =>
          openUploadDialog(ctx, {
            title: t("mass.newScoreFor", { item: itemName }),
            saveLabel: t("mass.saveAndLink"),
            onSaved: (scoreId) => ctx.db.linkScore(slot.id, scoreId)
          })
      },
      { label: t("mass.linkFromRepertoire"), onSelect: () => openLinkPicker(ctx, slot, itemName) }
    ];
    const blank = () => h("span", { class: "music-empty-cell", "aria-hidden": "true" });
    const rowFor = (entry, index) => {
      const score = entry?.owned_scores;
      const actions = entry
        ? [
            { label: t("mass.openScore"), onSelect: () => openViewer(ctx, score) },
            past
              ? { label: t(entry.not_played_at ? "mass.markPlayed" : "mass.markNotPlayed"), onSelect: () => toggleNotPlayed(ctx, entry) }
              : null,
            { label: t(entry.note ? "mass.editEntryNote" : "mass.addEntryNote"), onSelect: () => openEntryNote(ctx, entry, itemName) },
            { label: t("mass.unlink"), onSelect: () => unlinkEntry(ctx, entry, itemName, entryPlayed(mass, entry, today)) },
            ...slotActions
          ].filter(Boolean)
        : slotActions;
      return h("li", { class: "music-row" },
        index === 0 ? h("span", { class: "music-no num", text: number }) : blank(),
        index === 0
          ? h("span", { class: "music-role", translate: "no" }, itemName, slot.display_name && role?.name_la ? h("small", { text: role.name_la }) : null)
          : blank(),
        entry
          ? h("div", { class: "music-work", translate: "no" },
              h("button", { type: "button", class: "music-title", onclick: () => openViewer(ctx, score) }, displayScoreTitle(score)),
              score?.composer_name || (past && entry.not_played_at)
                ? h("span", { class: "music-composer" },
                    score?.composer_name ? h("span", { text: score.composer_name }) : null,
                    past && entry.not_played_at
                      ? h("span", { class: "music-flag", translate: "yes", text: t("mass.notPlayedTag") })
                      : null
                  )
                : null,
              entry.note ? h("span", { class: "music-note", text: entry.note }) : null
            )
          : h("div", { class: "music-work is-empty" }, h("span", { class: "music-title", text: t("mass.noScore") })),
        actionMenu(t("mass.moreFor", { item: itemName }), actions)
      );
    };
    return entries.length ? entries.map(rowFor) : [rowFor(null, 0)];
  });

  const hasEntries = slots.some((slot) => (slot.mass_music_entries ?? []).length);
  const music = h("section", { class: "mass-music" },
    h("h2", { text: t("mass.musicaMissae") }),
    past && hasEntries ? h("p", { class: "hint", text: t("mass.playedHint") }) : null,
    slots.length ? h("ol", { class: "music-list" }, musicRows) : h("p", { class: "empty", text: t("mass.noItems") })
  );

  container.append(header, card, music);
}

async function observancesFor(ctx, date) {
  try {
    return await ctx.db.observancesBetween(date, date);
  } catch {
    return [];
  }
}
