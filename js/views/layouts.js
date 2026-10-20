import { t } from "../i18n.js";
import { formatDateTime } from "../format.js";
import { h, createDialog, confirmDialog, errorMessage, notify, setBusy } from "../ui.js";

// Checklist of the 18 fixed music items. selected: Map(role_id -> display_name|null)
export function roleChecklist(roles, { selected = new Map(), locked = new Set() } = {}) {
  const rows = roles.map((role) => {
    const isLocked = locked.has(role.id);
    const checkbox = h("input", { type: "checkbox", checked: selected.has(role.id) || isLocked, disabled: isLocked });
    const nameInput = h("input", {
      type: "text",
      class: "role-rename",
      maxlength: 100,
      placeholder: role.name_ko,
      value: selected.get(role.id) ?? "",
      "aria-label": t("roles.renameLabel", { name: role.name_ko })
    });
    nameInput.disabled = !checkbox.checked;
    checkbox.addEventListener("change", () => {
      nameInput.disabled = !checkbox.checked;
    });
    const element = h(
      "div",
      { class: checkbox.checked ? "role-row" : "role-row is-off" },
      h("label", { class: "role-toggle" },
        checkbox,
        h("span", { class: "role-no", text: String(role.slot_no + 1).padStart(2, "0") }),
        h("span", { class: "role-name" }, role.name_ko, h("small", { text: role.name_la ?? "" }))
      ),
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
      h("span", { class: "hint", text: t("roles.hint") }),
      h("button", { type: "button", class: "link-button", onclick: () => setAll(true) }, t("roles.selectAll")),
      h("button", { type: "button", class: "link-button", onclick: () => setAll(false) }, t("roles.clearAll"))
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

function openLayoutForm(ctx, roles, layout) {
  const { body, footer, close, setStatus } = createDialog(t(layout ? "layouts.editTitle" : "layouts.newTitle"), {
    wide: true
  });
  const nameInput = h("input", {
    type: "text",
    required: true,
    maxlength: 100,
    value: layout?.name ?? "",
    placeholder: t("layouts.namePlaceholder")
  });
  const checklist = roleChecklist(roles, {
    selected: layout ? layoutSelection(layout) : new Map(roles.map((role) => [role.id, ""]))
  });
  body.append(
    h("label", { class: "field" }, h("span", { text: t("layouts.name") }), nameInput),
    h("p", { class: "field-label", text: t("layouts.items") }),
    checklist.element
  );
  const saveButton = h("button", { type: "button", class: "solid-button" }, t("common.save"));
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);
  saveButton.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      setStatus(t("layouts.nameRequired"));
      nameInput.focus();
      return;
    }
    setBusy([saveButton], true);
    setStatus("");
    try {
      if (layout) await ctx.db.updateLayout(layout, name, checklist.read());
      else await ctx.db.createLayout(name, checklist.read());
      close();
      notify(t("layouts.saved"), "success");
      ctx.refresh();
    } catch (error) {
      setStatus(errorMessage(error, "layouts.saveFailed"));
    } finally {
      setBusy([saveButton], false);
    }
  });
  nameInput.focus();
}

export async function renderLayouts(container, ctx) {
  const [roles, layouts] = await Promise.all([ctx.db.roles(), ctx.db.layouts()]);
  const roleById = new Map(roles.map((role) => [role.id, role]));

  const list = layouts.length
    ? h(
        "ul",
        { class: "plain-list" },
        layouts.map((layout) => {
          const items = [...(layout.user_mass_layout_items ?? [])].sort(
            (a, b) => (roleById.get(a.role_id)?.slot_no ?? 0) - (roleById.get(b.role_id)?.slot_no ?? 0)
          );
          const names = items.map((item) => item.display_name || roleById.get(item.role_id)?.name_ko || "");
          return h(
            "li",
            { class: "list-row" },
            h("div", { class: "list-main" },
              h("strong", { text: layout.name }),
              h("span", { class: "meta", text: t("layouts.itemCount", { count: items.length }) }),
              h("p", { class: "meta clamp", text: names.join(" · ") }),
              h("span", { class: "meta", text: t("layouts.updatedAt", { at: formatDateTime(layout.updated_at) }) })
            ),
            h("div", { class: "row-actions" },
              h("button", { type: "button", class: "ghost-button", onclick: () => openLayoutForm(ctx, roles, layout) }, t("common.edit")),
              h(
                "button",
                {
                  type: "button",
                  class: "ghost-button is-danger",
                  onclick: async () => {
                    const ok = await confirmDialog(t("layouts.deleteConfirm", { name: layout.name }), {
                      confirmLabel: t("common.delete"),
                      danger: true
                    });
                    if (!ok) return;
                    try {
                      await ctx.db.deleteLayout(layout.id);
                      notify(t("layouts.deleted"), "success");
                      ctx.refresh();
                    } catch (error) {
                      notify(errorMessage(error, "layouts.deleteFailed"), "error");
                    }
                  }
                },
                t("common.delete")
              )
            )
          );
        })
      )
    : h("p", { class: "empty", text: t("layouts.empty") });

  container.append(
    h("section", { class: "page-head" },
      h("div", {},
        h("h1", { text: t("layouts.title") }),
        h("p", { class: "lead", text: t("layouts.lead") })
      ),
      h("button", { type: "button", class: "solid-button", onclick: () => openLayoutForm(ctx, roles, null) }, t("layouts.new"))
    ),
    list
  );
}
