import { t } from "../i18n.js";
import { h, actionMenu, confirmDialog, createDialog, errorMessage, notify, setBusy } from "../ui.js";

// Music items are shown in Latin; Korean and English names stay in the data for search.
export function roleLabel(role) {
  if (!role) return "";
  return role.name_la || role.name_en || role.name_ko || "";
}

// Checklist of the 18 fixed music items (Latin names). selected: Map(role_id -> display_name|null)
// Rows use the same column grid as the Mass music list: check | number | role | name.
export function roleChecklist(roles, { selected = new Map(), locked = new Set(), labels = {} } = {}) {
  const text = { hint: "roles.hint", selectAll: "roles.selectAll", clearAll: "roles.clearAll", ...labels };
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
    });
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

  function setAll(checked) {
    for (const row of rows) {
      if (row.checkbox.disabled) continue;
      row.checkbox.checked = checked;
      row.checkbox.dispatchEvent(new Event("change"));
    }
  }

  const element = h(
    "div",
    { class: "role-checklist" },
    h("div", { class: "role-tools" },
      h("span", { class: "hint", text: text.hint ? t(text.hint) : "" }),
      h("button", { type: "button", class: "link-button", onclick: () => setAll(true) }, t(text.selectAll)),
      h("button", { type: "button", class: "link-button", onclick: () => setAll(false) }, t(text.clearAll))
    ),
    rows.map((row) => row.element)
  );

  return {
    element,
    read() {
      return rows
        .filter((row) => row.checkbox.checked)
        .map((row) => ({ role_id: row.role.id, display_name: row.nameInput.value.trim() || null }));
    },
    setSelection(map) {
      for (const row of rows) {
        if (row.checkbox.disabled) continue;
        row.checkbox.checked = map.has(row.role.id);
        row.nameInput.value = map.get(row.role.id) ?? "";
        row.checkbox.dispatchEvent(new Event("change"));
      }
    }
  };
}

export function layoutSelection(layout) {
  return new Map((layout?.user_mass_layout_items ?? []).map((item) => [item.role_id, item.display_name ?? ""]));
}

const NEW_LAYOUT = "new";
// Remembered while the screen redraws after a save.
let chosenLayoutId = null;

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
      selected: layout ? layoutSelection(layout) : new Map(roles.map((role) => [role.id, ""]))
    });
    partsBox.replaceChildren(checklist.element);
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
    setStatus("");
    showChecklist();
  });

  const saveButton = h("button", { type: "button", class: "solid-button" }, t("layouts.save"));
  const deleteButton = h("button", { type: "button", class: "ghost-button is-danger", hidden: !layout }, t("layouts.delete"));

  saveButton.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      setStatus(t("layouts.nameRequired"));
      nameInput.focus();
      return;
    }
    setBusy([saveButton, deleteButton], true);
    setStatus("");
    try {
      if (layout) await ctx.db.updateLayout(layout, name, checklist.read());
      else chosenLayoutId = await ctx.db.createLayout(name, checklist.read());
      notify(t("layouts.saved"), "success");
      ctx.refresh();
    } catch (error) {
      setStatus(errorMessage(error, "layouts.saveFailed"));
      setBusy([saveButton, deleteButton], false);
    }
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
      h("div", { class: "layout-actions" }, saveButton, deleteButton)
    ),
    placesSection(ctx, places, layouts)
  );
}
