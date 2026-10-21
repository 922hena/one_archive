import { t } from "../i18n.js";
import { h } from "../ui.js";
import { formatBytes } from "../format.js";
import { MAX_FILE_BYTES } from "../upload.js";
import { cameraSupported, openBurstCamera } from "./camera.js";

export function fileProblemMessage(problem, name) {
  if (problem === "type") return t("upload.badType", { name });
  if (problem === "size") return t("upload.tooLarge", { name, limit: formatBytes(MAX_FILE_BYTES) });
  return t("upload.emptyFile", { name });
}

// File picker, phone camera app (one photo) and in-app burst camera.
export function photoSourceButtons({ accept, onFiles, setStatus }) {
  const fileInput = h("input", { type: "file", accept, multiple: true, hidden: true });
  const cameraInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true });
  fileInput.addEventListener("change", () => {
    onFiles([...fileInput.files]);
    fileInput.value = "";
  });
  cameraInput.addEventListener("change", () => {
    onFiles([...cameraInput.files]);
    cameraInput.value = "";
  });
  async function burst() {
    if (!cameraSupported()) {
      setStatus(t("camera.unsupported"));
      return;
    }
    const files = await openBurstCamera();
    if (files.length) onFiles(files);
  }
  return h("div", { class: "button-row" },
    h("button", { type: "button", class: "ghost-button", onclick: () => fileInput.click() }, t("upload.chooseFile")),
    h("button", { type: "button", class: "ghost-button", onclick: () => cameraInput.click() }, t("upload.takePhoto")),
    h("button", { type: "button", class: "ghost-button", onclick: burst }, t("camera.open")),
    fileInput,
    cameraInput
  );
}

export function pageRow({ index, total, thumbUrl, isPdf = false, name, meta, badge, onMove, onEdit, onRemove }) {
  const thumb = isPdf
    ? h("span", { class: "page-thumb is-pdf", text: "PDF" })
    : h("span", { class: "page-thumb" }, thumbUrl ? h("img", { src: thumbUrl, alt: "", loading: "lazy", decoding: "async" }) : null);
  return h("li", { class: "page-row" },
    h("span", { class: "page-no num", text: t("library.pageNo", { page: index + 1 }) }),
    thumb,
    h("span", { class: "list-main" },
      h("span", { class: "page-name", text: name }),
      h("small", { class: "meta" }, badge ? h("span", { class: "badge", text: badge }) : null, meta ?? "")
    ),
    h("span", { class: "page-actions" },
      h("button", {
        type: "button",
        class: "icon-button",
        "aria-label": t("common.moveUp"),
        title: t("common.moveUp"),
        disabled: index === 0,
        onclick: () => onMove(index, index - 1)
      }, "↑"),
      h("button", {
        type: "button",
        class: "icon-button",
        "aria-label": t("common.moveDown"),
        title: t("common.moveDown"),
        disabled: index === total - 1,
        onclick: () => onMove(index, index + 1)
      }, "↓"),
      onEdit ? h("button", { type: "button", class: "link-button", onclick: onEdit }, t("common.edit")) : null,
      h("button", { type: "button", class: "link-button", onclick: onRemove }, t("common.remove"))
    )
  );
}
