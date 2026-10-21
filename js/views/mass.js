import { t } from "../i18n.js";
import { formatLongDate, formatTime, liturgyLabel, colorSwatch, sortBySlotNo } from "../format.js";
import { h, createDialog, confirmDialog, errorMessage, notify, setBusy, colorDot, displayScoreTitle } from "../ui.js";
import { roleChecklist, layoutSelection } from "./layouts.js";
import { openUploadDialog } from "./library.js";
import { openViewer } from "./viewer.js";

const SEASONS = ["advent", "christmas", "ordinary", "lent", "easter"];
const COLORS = ["green", "white", "violet", "red", "rose"];
const STATUSES = ["planned", "completed", "cancelled"];

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
  return h("p", { class: "liturgy-line" }, liturgyLabel(name, colorCode), colorDot(colorCode, colorSwatch(colorCode)));
}

// mode "create": needs date + observances (+ layouts, roles). mode "edit": needs mass.
export function openMassForm(ctx, { date, observances = [], roles = [], layouts = [], mass = null }) {
  const editing = Boolean(mass);
  const { body, footer, close, setStatus } = createDialog(t(editing ? "mass.editTitle" : "mass.newTitle"), { wide: true });

  const titleInput = h("input", { type: "text", maxlength: 100, value: mass?.title ?? "", placeholder: t("mass.titlePlaceholder") });
  const timeInput = h("input", { type: "time", value: formatTime(mass?.start_time) });
  const venueInput = h("input", { type: "text", maxlength: 100, value: mass?.venue_name ?? "", placeholder: t("mass.venuePlaceholder") });
  const notesInput = h("textarea", { rows: 2, maxlength: 1000 }, mass?.notes ?? "");

  // Liturgy choice: one of the official rows for the date, or "manual" (blank = unknown).
  const initialChoice = editing
    ? observances.some((observance) => observance.id === mass.observance_id) ? mass.observance_id : "manual"
    : observances[0]?.id ?? "manual";
  const prefillManual = editing && initialChoice === "manual";
  const choiceName = `liturgy-${Math.random().toString(36).slice(2)}`;
  const choices = [
    ...observances.map((observance) => ({ value: observance.id, observance })),
    { value: "manual", observance: null }
  ];
  const manualName = h("input", {
    type: "text",
    maxlength: 200,
    value: prefillManual ? mass.celebration_name ?? "" : "",
    placeholder: t("mass.manualNamePlaceholder")
  });
  const manualColor = selectField(
    t("mass.color"),
    [{ value: "", label: t("liturgy.colorName.unknown") }, ...COLORS.map((code) => ({ value: code, label: t(`liturgy.colorName.${code}`) }))],
    prefillManual ? mass.color_code : ""
  );
  const manualBox = h("div", { class: "field-row manual-liturgy" },
    h("label", { class: "field" }, h("span", { text: t("mass.manualName") }), manualName),
    manualColor.element
  );
  const season = selectField(
    t("mass.season"),
    [{ value: "", label: t("liturgy.season.unknown") }, ...SEASONS.map((code) => ({ value: code, label: t(`liturgy.season.${code}`) }))],
    editing ? mass.season_code : observances[0]?.season_code ?? ""
  );

  const radios = choices.map((choice) => {
    const input = h("input", { type: "radio", name: choiceName, value: choice.value, checked: choice.value === initialChoice });
    input.addEventListener("change", () => {
      manualBox.hidden = choice.value !== "manual";
      if (choice.observance) season.select.value = choice.observance.season_code ?? "";
    });
    return h("label", { class: "choice" },
      input,
      choice.observance
        ? h("span", {}, liturgyLabel(choice.observance.name_ko, choice.observance.color_code), " ",
            colorDot(choice.observance.color_code, colorSwatch(choice.observance.color_code)))
        : h("span", { text: t(observances.length ? "mass.manualChoice" : "mass.manualChoiceUnknown") })
    );
  });
  manualBox.hidden = initialChoice !== "manual";

  const status = editing ? selectField(t("mass.statusLabel"), STATUSES.map((code) => ({ value: code, label: t(`mass.status.${code}`) })), mass.status) : null;

  body.append(
    h("p", { class: "dialog-date num", text: formatLongDate(editing ? mass.local_date : date) }),
    h("div", { class: "field-row" },
      h("label", { class: "field" }, h("span", { text: t("mass.titleLabel") }), titleInput),
      h("label", { class: "field" }, h("span", { text: t("mass.timeLabel") }), timeInput)
    ),
    h("fieldset", { class: "field choices" },
      h("legend", { text: t("mass.liturgyLabel") }),
      observances.length || editing ? null : h("p", { class: "hint", text: t("liturgy.unknownHint") }),
      radios,
      manualBox
    ),
    h("div", { class: "field-row" }, season.element, status ? status.element : h("label", { class: "field" }, h("span", { text: t("mass.venueLabel") }), venueInput)),
    status ? h("label", { class: "field" }, h("span", { text: t("mass.venueLabel") }), venueInput) : null,
    h("label", { class: "field" }, h("span", { text: t("mass.notesLabel") }), notesInput)
  );

  let checklist = null;
  let layoutSelect = null;
  if (!editing) {
    layoutSelect = selectField(
      t("mass.layoutLabel"),
      [{ value: "", label: t("mass.layoutManual") }, ...layouts.map((layout) => ({ value: layout.id, label: layout.name }))],
      ""
    );
    checklist = roleChecklist(roles, { selected: new Map(roles.map((role) => [role.id, ""])) });
    layoutSelect.select.addEventListener("change", () => {
      const layout = layouts.find((item) => item.id === layoutSelect.select.value);
      checklist.setSelection(layout ? layoutSelection(layout) : new Map(roles.map((role) => [role.id, ""])));
    });
    body.append(
      layoutSelect.element,
      layouts.length ? null : h("p", { class: "hint", text: t("mass.noLayoutsHint") }),
      h("p", { class: "field-label", text: t("mass.itemsLabel") }),
      checklist.element
    );
  }

  const saveButton = h("button", { type: "button", class: "solid-button" }, t("common.save"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);

  return new Promise((resolve) => {
    let savedId = null;
    saveButton.addEventListener("click", async () => {
      const choiceValue = body.querySelector(`input[name="${choiceName}"]:checked`)?.value ?? "manual";
      const observance = observances.find((item) => item.id === choiceValue) ?? null;
      const seasonCode = season.select.value || null;
      const fields = {
        title: titleInput.value.trim() || null,
        start_time: timeInput.value || null,
        venue_name: venueInput.value.trim() || null,
        notes: notesInput.value.trim() || null,
        season_code: seasonCode
      };
      if (observance) {
        Object.assign(fields, {
          observance_id: observance.id,
          celebration_name: observance.name_ko,
          color_code: observance.color_code,
          liturgy_source: "official"
        });
      } else {
        const name = manualName.value.trim() || null;
        const color = manualColor.select.value || null;
        Object.assign(fields, {
          observance_id: null,
          celebration_name: name,
          color_code: color,
          liturgy_source: name || color || seasonCode ? "user" : "unknown"
        });
      }
      if (status) fields.status = status.select.value;

      setBusy([saveButton], true);
      setStatus("");
      try {
        if (editing) {
          await ctx.db.updateMass(mass.id, fields);
          savedId = mass.id;
        } else {
          fields.local_date = date;
          fields.layout_id = layoutSelect.select.value || null;
          savedId = await ctx.db.createMass(fields, checklist.read());
        }
        close();
      } catch (error) {
        setStatus(errorMessage(error, "mass.saveFailed"));
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
        t("mass.seasonValue", { season: t(`liturgy.season.${mass.season_code ?? "unknown"}`) }),
        t(`mass.source.${mass.liturgy_source}`),
        mass.venue_name,
        mass.status !== "planned" ? t(`mass.status.${mass.status}`) : null
      ].filter(Boolean).join(" · ")
    ),
    mass.notes ? h("p", { class: "notes", text: mass.notes }) : null,
    h("div", { class: "button-row" },
      h("button", {
        type: "button",
        class: "ghost-button",
        onclick: async () => {
          const savedId = await openMassForm(ctx, { mass, observances: await observancesFor(ctx, mass.local_date) });
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
            await ctx.db.deleteMass(mass.id);
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
          const itemName = slot.display_name || role?.name_ko || "";
          return h("li", { class: "slot" },
            h("div", { class: "slot-head" },
              h("span", { class: "role-no num", text: String((role?.slot_no ?? 0) + 1).padStart(2, "0") }),
              h("div", { class: "slot-name" },
                h("strong", { text: itemName }),
                slot.display_name ? h("small", { text: t("mass.officialName", { name: role?.name_ko ?? "" }) }) : h("small", { text: role?.name_la ?? "" })
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
