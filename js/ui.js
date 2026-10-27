import { t } from "./i18n.js";

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (name === "class") element.className = value;
    else if (name === "text") element.textContent = value;
    else if (name === "dataset") Object.assign(element.dataset, value);
    else if (name === "style" && typeof value === "object") Object.assign(element.style, value);
    else if (name.startsWith("on") && typeof value === "function") {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (value === true) element.setAttribute(name, "");
    else element.setAttribute(name, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

let statusTimer = null;

export function notify(message, tone = "info") {
  const status = document.querySelector("#app-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = !message;
  clearTimeout(statusTimer);
  if (message && tone !== "error") {
    statusTimer = setTimeout(() => {
      status.hidden = true;
    }, 4000);
  }
}

export function errorMessage(error, fallbackKey = "errors.generic", overrides = {}) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  if (overrides[code]) return t(overrides[code]);
  if (message.includes("failed to fetch") || message.includes("network")) return t("errors.network");
  if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) {
    return t("errors.permission");
  }
  if (code === "23503") return t("errors.inUse");
  if (code === "23505") return t("errors.duplicate");
  if (code === "PGRST301" || message.includes("jwt")) return t("errors.session");
  return t(fallbackKey);
}

export function createDialog(title, { wide = false } = {}) {
  const status = h("p", { class: "sheet-status", role: "status", hidden: true });
  const body = h("div", { class: "sheet-body" });
  const footer = h("div", { class: "sheet-footer" });
  const dialog = h(
    "dialog",
    { class: wide ? "sheet is-wide" : "sheet", "aria-label": title },
    h("div", { class: "sheet-head" },
      h("h2", { text: title }),
      h("button", { type: "button", class: "icon-button", "aria-label": t("common.close"), onclick: () => close() }, "×")
    ),
    body,
    status,
    footer
  );
  function close() {
    if (dialog.open) dialog.close();
  }
  function setStatus(message, tone = "error") {
    status.textContent = message ?? "";
    status.dataset.tone = tone;
    status.hidden = !message;
  }
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, body, footer, close, setStatus };
}

export function confirmDialog(message, { confirmLabel = t("common.confirm"), danger = false } = {}) {
  return new Promise((resolve) => {
    const { body, footer, close, dialog } = createDialog(t("common.confirmTitle"));
    let answer = false;
    body.append(h("p", { class: "sheet-message", text: message }));
    footer.append(
      h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")),
      h(
        "button",
        {
          type: "button",
          class: danger ? "solid-button is-danger" : "solid-button",
          onclick: () => {
            answer = true;
            close();
          }
        },
        confirmLabel
      )
    );
    dialog.addEventListener("close", () => resolve(answer));
  });
}

// "…" menu. items: [{ label, onSelect, danger }]. Closes on outside click and Escape.
export function actionMenu(label, items) {
  const button = h("button", {
    type: "button",
    class: "menu-button",
    "aria-label": label,
    "aria-haspopup": "menu",
    "aria-expanded": "false"
  }, "⋯");
  const list = h("ul", { class: "menu-list", role: "menu", hidden: true },
    items.map((item) =>
      h("li", { role: "none" },
        h("button", {
          type: "button",
          role: "menuitem",
          class: item.danger ? "menu-item is-danger" : "menu-item",
          onclick: () => {
            close();
            item.onSelect();
          }
        }, item.label)
      )
    )
  );
  const wrap = h("div", { class: "menu" }, button, list);

  function outside(event) {
    if (!wrap.contains(event.target)) close();
  }
  function onKey(event) {
    if (event.key === "Escape") {
      close();
      button.focus();
    }
  }
  function close() {
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", outside);
    document.removeEventListener("keydown", onKey);
  }
  button.addEventListener("click", () => {
    if (!list.hidden) return close();
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("click", outside);
    document.addEventListener("keydown", onKey);
    list.querySelector("button")?.focus();
  });
  return wrap;
}

export function setBusy(buttons, busy) {
  for (const button of buttons) if (button) button.disabled = busy;
}

export function colorDot(code, swatch) {
  if (!code) return null;
  return h("span", {
    class: code === "white" ? "color-dot is-white" : "color-dot",
    style: { backgroundColor: swatch },
    "aria-hidden": "true"
  });
}

export function displayScoreTitle(score) {
  return score?.title?.trim() || score?.provisional_title || t("library.untitled");
}

// A Score object (score_files) or a search row (file_count). Without a file there is nothing to open or perform.
export function hasScoreFile(score) {
  return Array.isArray(score?.score_files) ? score.score_files.length > 0 : Number(score?.file_count) > 0;
}

export function infoOnlyTag() {
  return h("span", { class: "score-tag", text: t("library.infoOnly") });
}
