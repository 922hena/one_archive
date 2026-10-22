import { t } from "../i18n.js";
import { h, confirmDialog, errorMessage, notify, setBusy } from "../ui.js";

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

export async function renderLayouts(container, ctx) {
  const [roles, layouts] = await Promise.all([ctx.db.roles(), ctx.db.layouts()]);
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
    )
  );
}
