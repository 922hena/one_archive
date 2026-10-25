import { t } from "../i18n.js";
import { h, actionMenu, confirmDialog, createDialog, errorMessage, notify, setBusy } from "../ui.js";
import { connectPlan, insertInOrder, moveItem, partNumber, sortedParts, withOrder } from "../music-parts.js";
import { formatLongDate, formatTime, todayIso } from "../format.js";

// Music items are shown in Latin; Korean and English names stay in the data for search.
export function roleLabel(role) {
  if (!role) return "";
  return role.name_la || role.name_en || role.name_ko || "";
}

// Music Parts editor: the official candidates (Latin names, official numbers) and, below them, the chosen
// parts in the member's order, numbered 1..n. selected: Map(role_id -> display_name|null) in that order.
// Candidate rows use the same column grid as the Mass music list: check | number | role | name.
export function roleChecklist(roles, { selected = new Map(), locked = new Set(), labels = {} } = {}) {
  const text = { hint: "roles.hint", selectAll: "roles.selectAll", clearAll: "roles.clearAll", ...labels };
  const roleById = new Map(roles.map((role) => [role.id, role]));
  let order = [];
  const rows = roles.map((role) => {
    const isLocked = locked.has(role.id);
    const primary = roleLabel(role);
    const checkbox = h("input", {
      type: "checkbox",
      checked: selected.has(role.id) || isLocked,
      disabled: isLocked,
      "aria-label": primary
    });
    const nameInput = h("input", {
      type: "text",
      class: "role-rename",
      maxlength: 100,
      placeholder: primary,
      value: selected.get(role.id) ?? "",
      "aria-label": t("roles.renameLabel", { name: primary })
    });
    nameInput.disabled = !checkbox.checked;
    checkbox.addEventListener("change", () => {
      nameInput.disabled = !checkbox.checked;
      order = checkbox.checked ? insertInOrder(order, role.id, roleById) : order.filter((id) => id !== role.id);
      renderOrder();
    });
    nameInput.addEventListener("input", () => renderOrder());
    const element = h(
      "div",
      { class: checkbox.checked ? "role-row" : "role-row is-off" },
      h("label", { class: "role-check" }, checkbox),
      h("span", { class: "role-no num", text: String(role.slot_no + 1).padStart(2, "0") }),
      h("span", { class: "role-name", translate: "no", text: primary }),
      nameInput,
      isLocked ? h("small", { class: "role-lock", text: t("roles.locked") }) : null
    );
    checkbox.addEventListener("change", () => element.classList.toggle("is-off", !checkbox.checked));
    return { role, checkbox, nameInput, element };
  });
  const rowById = new Map(rows.map((row) => [row.role.id, row]));
  const shownName = (id) => rowById.get(id).nameInput.value.trim() || roleLabel(roleById.get(id));

  const orderList = h("ol", { class: "parts-order-list" });
  const orderEmpty = h("p", { class: "empty", text: t("parts.orderEmpty") });
  const orderCount = h("span", { class: "parts-order-count" });
  const announcer = h("p", { class: "visually-hidden", "aria-live": "polite" });

  function move(index, step) {
    const id = order[index];
    order = moveItem(order, index, step);
    renderOrder();
    const at = order.indexOf(id);
    announcer.textContent = t("parts.moved", { name: shownName(id), number: at + 1 });
    const buttons = orderList.children[at]?.querySelectorAll("button") ?? [];
    const wanted = buttons[step < 0 ? 0 : 1];
    (wanted && !wanted.disabled ? wanted : [...buttons].find((button) => !button.disabled))?.focus();
  }

  function renderOrder() {
    orderCount.textContent = t("parts.selectedCount", { count: order.length });
    orderEmpty.hidden = order.length > 0;
    orderList.replaceChildren(
      ...order.map((id, index) => {
        const name = shownName(id);
        const official = roleLabel(roleById.get(id));
        return h("li", { class: "parts-order-row" },
          h("span", { class: "music-no num", text: partNumber(index) }),
          h("span", { class: "parts-order-name", translate: "no" },
            name,
            name !== official ? h("small", { text: official }) : null
          ),
          h("button", {
            type: "button",
            class: "icon-button",
            disabled: index === 0,
            "aria-label": t("parts.moveUp", { name }),
            onclick: () => move(index, -1)
          }, "↑"),
          h("button", {
            type: "button",
            class: "icon-button",
            disabled: index === order.length - 1,
            "aria-label": t("parts.moveDown", { name }),
            onclick: () => move(index, 1)
          }, "↓")
        );
      })
    );
  }

  function applySelection(map) {
    const wanted = [...map.keys()].filter((id) => rowById.has(id));
    for (const row of rows) {
      if (row.checkbox.disabled) continue;
      row.checkbox.checked = map.has(row.role.id);
      row.nameInput.value = map.get(row.role.id) ?? "";
      row.nameInput.disabled = !row.checkbox.checked;
      row.element.classList.toggle("is-off", !row.checkbox.checked);
    }
    order = wanted;
    for (const id of locked) if (rowById.has(id) && !order.includes(id)) order = insertInOrder(order, id, roleById);
    renderOrder();
  }

  function setAll(checked) {
    for (const row of rows) {
      if (row.checkbox.disabled || row.checkbox.checked === checked) continue;
      row.checkbox.checked = checked;
      row.checkbox.dispatchEvent(new Event("change"));
    }
  }

  const element = h(
    "div",
    { class: "parts-editor" },
    h("div", { class: "role-checklist" },
      h("h3", { class: "parts-step", text: t("parts.candidatesHead", { count: roles.length }) }),
      h("div", { class: "role-tools" },
        h("span", { class: "hint", text: text.hint ? t(text.hint) : "" }),
        h("button", { type: "button", class: "link-button", onclick: () => setAll(true) }, t(text.selectAll)),
        h("button", { type: "button", class: "link-button", onclick: () => setAll(false) }, t(text.clearAll))
      ),
      rows.map((row) => row.element)
    ),
    h("section", { class: "parts-order" },
      h("h3", { class: "parts-step" }, t("parts.orderHead"), orderCount),
      h("p", { class: "hint", text: t("parts.orderHint") }),
      orderEmpty,
      orderList,
      announcer
    )
  );

  applySelection(selected);

  return {
    element,
    // Only the chosen parts, in the member's order, numbered 1..n.
    read() {
      return withOrder(order.map((id) => ({ role_id: id, display_name: rowById.get(id).nameInput.value.trim() || null })));
    },
    setSelection: applySelection
  };
}

// Final check before a selection is saved: the parts exactly as they will be numbered.
export function confirmParts(items, roles, { title = t("parts.confirmTitle"), lead = t("parts.confirmLead"), confirmLabel = t("parts.saveConfiguration") } = {}) {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  return new Promise((resolve) => {
    const { body, footer, close, dialog } = createDialog(title);
    let answer = false;
    body.append(
      h("p", { class: "sheet-message", text: lead }),
      items.length
        ? h("ol", { class: "parts-order-list is-preview" },
            items.map((item, index) =>
              h("li", { class: "parts-order-row" },
                h("span", { class: "music-no num", text: partNumber(index) }),
                h("span", { class: "parts-order-name", translate: "no", text: item.display_name || roleLabel(roleById.get(item.role_id)) })
              )
            )
          )
        : h("p", { class: "empty", text: t("parts.orderEmpty") })
    );
    footer.append(
      h("button", { type: "button", class: "ghost-button", onclick: close }, t("parts.backToEdit")),
      h("button", { type: "button", class: "solid-button", onclick: () => { answer = true; close(); } }, confirmLabel)
    );
    dialog.addEventListener("close", () => resolve(answer));
  });
}

// A saved selection as Map(role_id -> display_name) in the member's order.
export function layoutSelection(layout, roles = []) {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  return new Map(sortedParts(layout?.user_mass_layout_items, roleById).map((item) => [item.role_id, item.display_name ?? ""]));
}

const NEW_LAYOUT = "new";
// Remembered while the screen redraws after a save.
let chosenLayoutId = null;
let connectDate = null;

const massName = (mass) => mass?.title?.trim() || t("mass.untitled");

// Connects a saved selection to an existing Missa. With parts already there, the member chooses
// Replace or Add; parts with linked Scores are never removed. The official list is not touched.
function openConnect(ctx, layout, roles) {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const layoutItems = sortedParts(layout.user_mass_layout_items, roleById).map((item) => ({
    role_id: item.role_id,
    display_name: item.display_name ?? null
  }));
  const { body, footer, close, setStatus } = createDialog(t("connect.title", { name: layout.name }));
  const dateId = "connect-date";
  const dateInput = h("input", { id: dateId, type: "date", value: connectDate ?? todayIso() });
  const massBox = h("div", { class: "connect-masses" });
  const modeOptions = ["replace", "add"].map((value) => {
    const input = h("input", { type: "radio", name: "connect-mode", value });
    input.addEventListener("change", () => {
      mode = value;
      update();
    });
    return h("label", { class: "connect-option" },
      input,
      h("span", { class: "list-main" },
        h("strong", { text: t(`connect.mode.${value}`) }),
        h("span", { class: "meta", text: t(`connect.modeHint.${value}`) })
      )
    );
  });
  const modeBox = h("fieldset", { class: "connect-mode", hidden: true },
    h("legend", { text: t("connect.modeLegend") }),
    modeOptions
  );
  const preview = h("div", { class: "connect-preview", hidden: true });
  const connectButton = h("button", { type: "button", class: "solid-button", disabled: true }, t("connect.connect"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), connectButton);
  body.append(
    h("div", { class: "field" }, h("label", { for: dateId, text: t("connect.dateLabel") }), dateInput),
    massBox,
    modeBox,
    preview
  );

  let chosen = null;
  let mode = null;
  let token = 0;

  function existingSlots() {
    return (chosen?.mass_music_slots ?? []).map((slot) => ({
      role_id: slot.role_id,
      display_name: slot.display_name,
      sort_order: slot.sort_order,
      linked: (slot.mass_music_entries ?? []).length > 0
    }));
  }

  function currentPlan() {
    if (!chosen) return null;
    const existing = existingSlots();
    if (!existing.length) return connectPlan(existing, layoutItems, "replace", roleById);
    return mode ? connectPlan(existing, layoutItems, mode, roleById) : null;
  }

  function update() {
    modeBox.hidden = !chosen?.mass_music_slots?.length;
    const plan = currentPlan();
    const nothingNew = plan && mode === "add" && !plan.added.length;
    connectButton.disabled = !plan || nothingNew;
    preview.hidden = !plan;
    if (!plan) {
      preview.replaceChildren();
      return;
    }
    preview.replaceChildren(
      h("h3", { class: "parts-step", text: t("connect.previewHead") }),
      h("ol", { class: "parts-order-list is-preview" },
        plan.items.map((item, index) =>
          h("li", { class: "parts-order-row" },
            h("span", { class: "music-no num", text: partNumber(index) }),
            h("span", { class: "parts-order-name", translate: "no", text: item.display_name || roleLabel(roleById.get(item.role_id)) })
          )
        )
      ),
      nothingNew ? h("p", { class: "hint", text: t("connect.nothingToAdd") }) : null,
      plan.removed.length ? h("p", { class: "hint", text: t("connect.removedNote", { count: plan.removed.length }) }) : null,
      plan.kept.length ? h("p", { class: "hint", text: t("connect.keptNote", { count: plan.kept.length }) }) : null
    );
  }

  async function pick(id) {
    const mine = ++token;
    chosen = null;
    mode = null;
    for (const option of modeOptions) option.querySelector("input").checked = false;
    update();
    try {
      const full = await ctx.db.mass(id);
      if (mine !== token) return;
      chosen = full;
      update();
    } catch (error) {
      if (mine === token) setStatus(errorMessage(error, "connect.loadFailed"));
    }
  }

  async function loadMasses() {
    const mine = ++token;
    chosen = null;
    mode = null;
    setStatus("");
    update();
    const date = dateInput.value;
    if (!date) {
      massBox.replaceChildren();
      return;
    }
    connectDate = date;
    massBox.replaceChildren(h("p", { class: "meta", text: t("common.loading") }));
    try {
      const masses = await ctx.db.massesOn(date);
      if (mine !== token) return;
      if (!masses.length) {
        massBox.replaceChildren(h("p", { class: "empty", text: t("connect.noMasses") }));
        return;
      }
      massBox.replaceChildren(
        h("fieldset", { class: "connect-list" },
          h("legend", { text: t("connect.chooseMass") }),
          masses.map((mass) => {
            const slots = mass.mass_music_slots ?? [];
            const linked = slots.reduce((sum, slot) => sum + (slot.mass_music_entries?.length ?? 0), 0);
            const input = h("input", { type: "radio", name: "connect-mass", value: mass.id });
            input.addEventListener("change", () => pick(mass.id));
            return h("label", { class: "connect-option" },
              input,
              h("span", { class: "time num", text: formatTime(mass.start_time) || t("calendar.noTime") }),
              h("span", { class: "list-main" },
                h("strong", { translate: "no", text: massName(mass) }),
                h("span", { class: "meta", text: t("calendar.itemSummary", { items: slots.length, linked }) })
              )
            );
          })
        )
      );
    } catch (error) {
      if (mine === token) massBox.replaceChildren(h("p", { class: "sheet-status", text: errorMessage(error, "connect.loadFailed") }));
    }
  }

  function done(mass) {
    body.replaceChildren(
      h("p", { class: "sheet-message", text: t("connect.done", { title: massName(mass), date: formatLongDate(mass.local_date) }) })
    );
    footer.replaceChildren(
      h("button", { type: "button", class: "ghost-button", onclick: close }, t("connect.doneButton")),
      h("button", {
        type: "button",
        class: "solid-button",
        onclick: () => {
          close();
          ctx.navigate(`#/mass/${mass.id}`);
        }
      }, t("connect.open"))
    );
  }

  connectButton.addEventListener("click", async () => {
    const plan = currentPlan();
    if (!plan) return;
    const target = chosen;
    setBusy([connectButton], true);
    setStatus("");
    try {
      await ctx.db.saveSlots(target.id, plan.items, target.mass_music_slots ?? []);
      if (mode !== "add") await ctx.db.updateMass(target.id, { layout_id: layout.id });
      done(target);
    } catch (error) {
      setStatus(errorMessage(error, "connect.failed", { slot_has_entries: "roles.locked" }));
      setBusy([connectButton], false);
    }
  });

  dateInput.addEventListener("change", loadMasses);
  loadMasses();
}

const samePlaceName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function layoutOptions(layouts, selectedId) {
  return [
    h("option", { value: "", selected: !selectedId }, t("places.noLayout")),
    layouts.map((item) => h("option", { value: item.id, selected: item.id === selectedId, translate: "no" }, item.name))
  ];
}

function renamePlace(ctx, place, places) {
  const { body, footer, close, setStatus } = createDialog(t("places.renameTitle"));
  const inputId = `place-name-${place.id}`;
  const input = h("input", { id: inputId, type: "text", maxlength: 100, value: place.name });
  body.append(
    h("div", { class: "field" }, h("label", { for: inputId, text: t("places.name") }), input),
    h("p", { class: "hint", text: t("places.renameHint") })
  );
  const saveButton = h("button", { type: "button", class: "solid-button" }, t("common.save"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);
  saveButton.addEventListener("click", async () => {
    const name = input.value.trim();
    if (!name) {
      setStatus(t("places.nameRequired"));
      input.focus();
      return;
    }
    if (places.some((item) => item.id !== place.id && samePlaceName(item.name, name))) {
      setStatus(t("places.duplicate"));
      input.focus();
      return;
    }
    setBusy([saveButton], true);
    try {
      await ctx.db.updateVenue(place, { name });
      close();
      notify(t("places.saved"), "success");
      ctx.refresh();
    } catch (error) {
      setStatus(errorMessage(error, "places.saveFailed", { 23505: "places.duplicate" }));
      setBusy([saveButton], false);
    }
  });
  input.select();
}

async function removePlace(ctx, place) {
  const ok = await confirmDialog(t("places.deleteConfirm", { name: place.name }), { confirmLabel: t("common.delete"), danger: true });
  if (!ok) return;
  try {
    await ctx.db.deleteVenue(place.id);
    notify(t("places.deleted"), "success");
    ctx.refresh();
  } catch (error) {
    notify(errorMessage(error, "places.deleteFailed"), "error");
  }
}

// My Places (decision D3): each place opens a Missa with one saved selection of Music Parts.
function placesSection(ctx, places, layouts) {
  const rows = places.map((place) => {
    const select = h("select", { "aria-label": t("places.layoutFor", { name: place.name }) }, layoutOptions(layouts, place.layout_id));
    select.addEventListener("change", async () => {
      select.disabled = true;
      try {
        await ctx.db.updateVenue(place, { layout_id: select.value || null });
        place.layout_id = select.value || null;
        notify(t("places.saved"), "success");
      } catch (error) {
        select.value = place.layout_id ?? "";
        notify(errorMessage(error, "places.saveFailed"), "error");
      } finally {
        select.disabled = false;
      }
    });
    return h("li", { class: "place-row" },
      h("span", { class: "place-name", translate: "no", text: place.name }),
      select,
      actionMenu(t("places.moreFor", { name: place.name }), [
        { label: t("places.rename"), onSelect: () => renamePlace(ctx, place, places) },
        { label: t("places.delete"), danger: true, onSelect: () => removePlace(ctx, place) }
      ])
    );
  });

  const nameId = "place-new-name";
  const layoutId = "place-new-layout";
  const nameInput = h("input", { id: nameId, type: "text", maxlength: 100, placeholder: t("places.namePlaceholder") });
  const layoutSelect = h("select", { id: layoutId }, layoutOptions(layouts, null));
  const addButton = h("button", { type: "button", class: "ghost-button" }, t("places.add"));
  const status = h("p", { class: "sheet-status", role: "status", hidden: true });
  const setStatus = (message) => {
    status.textContent = message ?? "";
    status.hidden = !message;
  };
  async function addPlace() {
    const name = nameInput.value.trim();
    if (!name) {
      setStatus(t("places.nameRequired"));
      nameInput.focus();
      return;
    }
    if (places.some((item) => samePlaceName(item.name, name))) {
      setStatus(t("places.duplicate"));
      nameInput.focus();
      return;
    }
    setBusy([addButton], true);
    setStatus("");
    try {
      await ctx.db.createVenue(name, layoutSelect.value || null);
      notify(t("places.added"), "success");
      ctx.refresh();
    } catch (error) {
      setStatus(errorMessage(error, "places.saveFailed"));
      setBusy([addButton], false);
    }
  }
  addButton.addEventListener("click", addPlace);
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) addPlace();
  });

  return h("section", { class: "layout-card places-card", "aria-labelledby": "places-heading" },
    h("h2", { id: "places-heading", text: t("places.heading") }),
    h("p", { class: "hint", text: t("places.lead") }),
    rows.length ? h("ul", { class: "place-list" }, rows) : h("p", { class: "empty", text: t("places.empty") }),
    h("div", { class: "place-add" },
      h("div", { class: "field" }, h("label", { for: nameId, text: t("places.name") }), nameInput),
      h("div", { class: "field" }, h("label", { for: layoutId, text: t("places.layout") }), layoutSelect),
      addButton
    ),
    status
  );
}

export async function renderLayouts(container, ctx) {
  const [roles, layouts, places] = await Promise.all([ctx.db.roles(), ctx.db.layouts(), ctx.db.venues()]);
  let layout = layouts.find((item) => item.id === chosenLayoutId) ?? layouts[0] ?? null;
  chosenLayoutId = layout?.id ?? NEW_LAYOUT;

  const select = h(
    "select",
    { "aria-label": t("layouts.choose") },
    layouts.map((item) => h("option", { value: item.id, selected: item.id === layout?.id, translate: "no" }, item.name)),
    h("option", { value: NEW_LAYOUT, selected: !layout }, t("layouts.newOption"))
  );
  const nameInput = h("input", {
    type: "text",
    required: true,
    maxlength: 100,
    value: layout?.name ?? "",
    placeholder: t("layouts.namePlaceholder")
  });
  const status = h("p", { class: "sheet-status", role: "status", hidden: true });
  const partsBox = h("div", { class: "layout-parts-box" });
  let checklist = null;

  function showChecklist() {
    checklist = roleChecklist(roles, {
      selected: layout ? layoutSelection(layout, roles) : new Map(roles.map((role) => [role.id, ""]))
    });
    partsBox.replaceChildren(checklist.element);
  }

  // Unsaved changes in the editor (connecting always uses the saved selection).
  function isDirty() {
    if (!layout) return true;
    const saved = withOrder([...layoutSelection(layout, roles)].map(([role_id, display_name]) => ({ role_id, display_name: display_name || null })));
    return nameInput.value.trim() !== layout.name || JSON.stringify(saved) !== JSON.stringify(checklist.read());
  }

  function setStatus(message) {
    status.textContent = message ?? "";
    status.hidden = !message;
  }

  select.addEventListener("change", () => {
    layout = layouts.find((item) => item.id === select.value) ?? null;
    chosenLayoutId = layout?.id ?? NEW_LAYOUT;
    nameInput.value = layout?.name ?? "";
    deleteButton.hidden = !layout;
    connectButton.hidden = !layout;
    setStatus("");
    showChecklist();
  });

  const saveButton = h("button", { type: "button", class: "solid-button" }, t("parts.saveConfiguration"));
  const connectButton = h("button", { type: "button", class: "ghost-button", hidden: !layout }, t("connect.button"));
  const deleteButton = h("button", { type: "button", class: "ghost-button is-danger", hidden: !layout }, t("layouts.delete"));

  saveButton.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      setStatus(t("layouts.nameRequired"));
      nameInput.focus();
      return;
    }
    const items = checklist.read();
    if (!items.length) {
      setStatus(t("layouts.partsRequired"));
      return;
    }
    setStatus("");
    if (!(await confirmParts(items, roles, { lead: t("layouts.confirmLead", { name }) }))) return;
    setBusy([saveButton, connectButton, deleteButton], true);
    try {
      if (layout) await ctx.db.updateLayout(layout, name, items);
      else chosenLayoutId = await ctx.db.createLayout(name, items);
      notify(t("layouts.saved"), "success");
      ctx.refresh();
    } catch (error) {
      setStatus(errorMessage(error, "layouts.saveFailed"));
      setBusy([saveButton, connectButton, deleteButton], false);
    }
  });

  connectButton.addEventListener("click", () => {
    if (!layout) return;
    if (isDirty()) {
      setStatus(t("connect.saveFirst"));
      saveButton.focus();
      return;
    }
    setStatus("");
    openConnect(ctx, layout, roles);
  });

  deleteButton.addEventListener("click", async () => {
    if (!layout) return;
    const ok = await confirmDialog(t("layouts.deleteConfirm", { name: layout.name }), {
      confirmLabel: t("common.delete"),
      danger: true
    });
    if (!ok) return;
    try {
      await ctx.db.deleteLayout(layout.id);
      chosenLayoutId = null;
      notify(t("layouts.deleted"), "success");
      ctx.refresh();
    } catch (error) {
      notify(errorMessage(error, "layouts.deleteFailed"), "error");
    }
  });

  showChecklist();

  container.append(
    h("section", { class: "page-head" },
      h("div", {},
        h("p", { class: "meta", text: t("layouts.title") }),
        h("h1", { text: t("layouts.heading") })
      )
    ),
    h("section", { class: "layout-card" },
      h("div", { class: "layout-fields" },
        h("label", { class: "field" }, h("span", { text: t("layouts.choose") }), select),
        h("label", { class: "field" }, h("span", { text: t("layouts.name") }), nameInput)
      ),
      h("p", { class: "hint", text: t("layouts.lead") }),
      h("div", { class: "layout-parts" }, h("h2", { text: t("layouts.partes") }), partsBox),
      status,
      h("div", { class: "layout-actions" }, saveButton, connectButton, deleteButton)
    ),
    placesSection(ctx, places, layouts)
  );
}
