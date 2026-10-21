import { t } from "../i18n.js";
import {
  formatHourLabel,
  formatLongDate,
  formatTime,
  hourValue,
  isHourChoice,
  liturgyLabel,
  colorSwatch,
  sortBySlotNo,
  weekdayIndex
} from "../format.js";
import { h, createDialog, confirmDialog, errorMessage, notify, setBusy, colorDot, displayScoreTitle } from "../ui.js";
import { roleChecklist, layoutSelection, roleLabel } from "./layouts.js";
import { liturgyFields, sourceKey, weeksAheadRange } from "../recurrence.js";
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

export function liturgyLine(name, colorCode, { unknownKey = "liturgy.unknown" } = {}) {
  if (!name) return h("p", { class: "liturgy-line is-unknown", text: t(unknownKey) });
  return h("p", { class: "liturgy-line" }, liturgyLabel(name, colorCode), " ", colorDot(colorCode, colorSwatch(colorCode)));
}

function missingSeries(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("schema cache") || message.includes("mass_series");
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
export function openMassForm(ctx, { date, observances = [], roles = [], layouts = [], venues = [], series = null, mass = null }) {
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
  const notesInput = h("textarea", { rows: 2, maxlength: 1000 }, mass?.notes ?? "");

  const choiceName = `liturgy-${uid}`;
  const initialObservance = (editing && observances.find((item) => item.id === mass.observance_id)) || observances[0] || null;
  const liturgyView = observances.length > 1
    ? observances.map((observance) =>
        h("label", { class: "choice" },
          h("input", { type: "radio", name: choiceName, value: observance.id, checked: observance === initialObservance }),
          h("span", {}, liturgyLabel(observance.name_ko, observance.color_code), " ",
            colorDot(observance.color_code, colorSwatch(observance.color_code)))
        )
      )
    : liturgyLine(initialObservance?.name_ko, initialObservance?.color_code);

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
  const stopInput = h("input", { type: "checkbox" });
  const scopeBox = h("div", { class: "choices" },
    h("span", { class: "field-label", text: t("mass.recurrenceScope") }),
    h("label", { class: "choice" }, scopeThis, h("span", { text: t("mass.recurrenceThisOnly") })),
    h("label", { class: "choice" }, scopeFuture, h("span", { text: t("mass.recurrenceFuture") })),
    h("label", { class: "choice" }, stopInput, h("span", { text: t("mass.recurrenceStop") }))
  );
  const recurrenceFields = h("div", {},
    recurrence,
    h("label", { class: "field recurrence-day" }, h("span", { text: t("mass.recurrenceWeekday") }), weekday)
  );
  if (editing && series) {
    recurrence.disabled = true;
    const syncScope = () => {
      const future = scopeFuture.checked;
      layoutSelect.disabled = !future;
      weekday.disabled = !future;
    };
    scopeThis.addEventListener("change", syncScope);
    scopeFuture.addEventListener("change", syncScope);
    syncScope();
  }

  const status = editing
    ? selectField(t("mass.statusField"), STATUSES.map((code) => ({ value: code, label: t(`mass.statusOption.${code}`) })), mass.status)
    : null;
  // Layout and recurrence belong to a series; a one-off Mass edits its items in the Mass page.
  const showSeriesFields = !editing || Boolean(series);

  body.append(
    h("fieldset", { class: "field choices form-liturgy" },
      h("legend", { text: t("mass.liturgyLabel") }),
      h("p", { class: "dialog-date num", text: formatLongDate(formDate) }),
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
      h("datalist", { id: venueListId }, venues.map((name) => h("option", { value: name })))
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
  );

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
      venue_name: venueInput.value.trim() || null,
      notes: notesInput.value.trim() || null,
      ...liturgyPayload()
    };
  }

  return new Promise((resolve) => {
    let savedId = null;
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
          const future = Boolean(series) && scopeFuture.checked;
          if (!future) {
            if (series) fields.series_locked = true;
            await ctx.db.updateMass(mass.id, fields);
          } else {
            const patch = {
              title: fields.title,
              start_time: fields.start_time,
              venue_name: fields.venue_name,
              layout_id: layoutSelect.value || null
            };
            await ctx.db.updateSeries(series.id, {
              ...patch,
              weekday: Number(weekday.value),
              interval_weeks: Number(series.interval_weeks)
            });
            await ctx.db.updateMass(mass.id, { ...fields, ...patch, series_locked: false });
            const layout = knownLayouts.find((item) => item.id === layoutSelect.value);
            const items = layout
              ? [...layoutSelection(layout)].map(([role_id, display_name]) => ({ role_id, display_name: display_name || null }))
              : [];
            await ctx.db.syncFutureMasses(series.id, mass.local_date, patch, items);
            if (stopInput.checked) await ctx.db.endSeries(series.id, mass.local_date);
          }
          savedId = mass.id;
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
          if (recurrence.value !== "once") {
            const created = await ctx.db.createSeries({
              title: fields.title,
              start_time: fields.start_time,
              venue_name: fields.venue_name,
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
      } catch (error) {
        if (seriesId && !savedId) await ctx.db.deleteSeries(seriesId).catch(() => {});
        setStatus(missingSeries(error) ? t("mass.seriesNeeded") : errorMessage(error, "mass.saveFailed"));
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

function entryRow(ctx, entry, itemName) {
  const score = entry.owned_scores;
  return h("li", { class: "entry-row" },
    h("div", { class: "list-main" },
      h("strong", { text: displayScoreTitle(score) }),
      score?.composer_name ? h("span", { class: "meta", text: score.composer_name }) : null
    ),
    h("div", { class: "row-actions" },
      h("button", { type: "button", class: "link-button", onclick: () => openViewer(ctx, score) }, t("common.open")),
      h(
        "button",
        {
          type: "button",
          class: "link-button",
          onclick: async () => {
            const ok = await confirmDialog(t("mass.unlinkConfirm", { title: displayScoreTitle(score), item: itemName }), {
              confirmLabel: t("mass.unlink")
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
        },
        t("mass.unlink")
      )
    )
  );
}

export async function renderMass(container, ctx, { id }) {
  const [mass, roles] = await Promise.all([ctx.db.mass(id), ctx.db.roles()]);
  if (!mass) {
    container.append(
      h("p", { class: "empty", text: t("mass.notFound") }),
      h("a", { href: "#/date", class: "link-button" }, t("mass.backToCalendar"))
    );
    return;
  }
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const slots = sortBySlotNo(mass.mass_music_slots ?? [], (slot) => roleById.get(slot.role_id)?.slot_no ?? 99);

  const header = h("section", { class: "mass-head" },
    h("a", { href: `#/date/${mass.local_date}`, class: "back-link" }, t("mass.backToDate", { date: formatLongDate(mass.local_date) })),
    h("p", { class: "date-title num", text: formatLongDate(mass.local_date) }),
    h("h1", {}, massTitle(mass), mass.start_time ? h("span", { class: "time num", text: formatTime(mass.start_time) }) : null),
    liturgyLine(mass.celebration_name, mass.color_code),
    h("p", { class: "meta" },
      [
        sourceKey(mass.liturgy_source) === "unknown" ? null : t(`mass.source.${sourceKey(mass.liturgy_source)}`),
        mass.venue_name,
        mass.status && mass.status !== "planned" ? t(`mass.status.${mass.status}`) : null
      ].filter(Boolean).join(" · ")
    ),
    mass.notes ? h("p", { class: "notes", text: mass.notes }) : null,
    h("div", { class: "button-row" },
      h("button", {
        type: "button",
        class: "ghost-button",
        onclick: async () => {
          const [observances, layouts, venues, series] = await Promise.all([
            observancesFor(ctx, mass.local_date),
            ctx.db.layouts(),
            ctx.db.usedVenues(),
            ctx.db.series(mass.series_id)
          ]);
          const savedId = await openMassForm(ctx, { mass, observances, roles, layouts, venues, series });
          if (savedId) {
            notify(t("mass.saved"), "success");
            ctx.refresh();
          }
        }
      }, t("mass.edit")),
      h("button", { type: "button", class: "ghost-button", onclick: () => openItemsEditor(ctx, mass, roles) }, t("mass.editItems")),
      h("button", {
        type: "button",
        class: "ghost-button is-danger",
        onclick: async () => {
          const ok = await confirmDialog(t("mass.deleteConfirm", { title: massTitle(mass) }), { confirmLabel: t("common.delete"), danger: true });
          if (!ok) return;
          try {
            await ctx.db.forgetOccurrence(mass);
            notify(t("mass.deleted"), "success");
            ctx.navigate(`#/date/${mass.local_date}`);
          } catch (error) {
            notify(errorMessage(error, "mass.deleteFailed"), "error");
          }
        }
      }, t("mass.delete"))
    )
  );

  const items = slots.length
    ? h("ol", { class: "slot-list" },
        slots.map((slot) => {
          const role = roleById.get(slot.role_id);
          const itemName = slot.display_name || roleLabel(role);
          return h("li", { class: "slot" },
            h("div", { class: "slot-head" },
              h("span", { class: "role-no num", text: String((role?.slot_no ?? 0) + 1).padStart(2, "0") }),
              h("div", { class: "slot-name" },
                h("strong", { text: itemName }),
                slot.display_name ? h("small", { text: t("mass.officialName", { name: roleLabel(role) }) }) : h("small", { text: role?.name_la ?? "" })
              ),
              h("div", { class: "row-actions" },
                h("button", {
                  type: "button",
                  class: "link-button",
                  onclick: () =>
                    openUploadDialog(ctx, {
                      title: t("mass.newScoreFor", { item: itemName }),
                      saveLabel: t("mass.saveAndLink"),
                      onSaved: (scoreId) => ctx.db.linkScore(slot.id, scoreId)
                    })
                }, t("mass.newScore")),
                h("button", { type: "button", class: "link-button", onclick: () => openLinkPicker(ctx, slot, itemName) }, t("mass.fromLibrary"))
              )
            ),
            slot.mass_music_entries.length
              ? h("ul", { class: "entry-list" }, slot.mass_music_entries.map((entry) => entryRow(ctx, entry, itemName)))
              : null
          );
        })
      )
    : h("p", { class: "empty", text: t("mass.noItems") });

  container.append(header, h("h2", { class: "section-head", text: t("mass.itemsHead") }), items);
}

async function observancesFor(ctx, date) {
  try {
    return await ctx.db.observancesBetween(date, date);
  } catch {
    return [];
  }
}
