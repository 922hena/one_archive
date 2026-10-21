import { t } from "../i18n.js";
import { h, createDialog, setBusy } from "../ui.js";
import {
  FULL_CROP,
  cropPixels,
  dragCrop,
  editedFileName,
  isUnchanged,
  normalizeTurns,
  outputScale,
  rotateCrop,
  rotatedSize
} from "../image-edit.js";

const HANDLES = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    return { img, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

// Draws the rotated image so that (0, 0) is the top-left of the rotated picture.
function drawRotated(context, img, turns) {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const size = rotatedSize(width, height, turns);
  context.translate(size.width / 2, size.height / 2);
  context.rotate((normalizeTurns(turns) * Math.PI) / 2);
  context.drawImage(img, -width / 2, -height / 2);
}

async function exportEdited(img, turns, crop, name) {
  const area = cropPixels(img.naturalWidth, img.naturalHeight, turns, crop);
  const scale = outputScale(area.w, area.h);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.w * scale));
  canvas.height = Math.max(1, Math.round(area.h * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  context.translate(-area.x, -area.y);
  drawRotated(context, img, turns);
  const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.9));
  if (!blob) throw new Error("export_failed");
  return new File([blob], editedFileName(name), { type: "image/jpeg", lastModified: Date.now() });
}

// Resolves with the edited file, the same file when nothing changed, or null when cancelled.
export function openPhotoEditor(file) {
  return new Promise((resolve) => {
    const { dialog, body, footer, close, setStatus } = createDialog(t("editor.title"), { wide: true });
    let source = null;
    let turns = 0;
    let crop = { ...FULL_CROP };
    let drag = null;
    let result = null;

    const canvas = h("canvas", { class: "crop-canvas" });
    const shade = h("div", { class: "crop-shade" });
    const box = h("div", { class: "crop-box" }, HANDLES.map((handle) => h("span", { class: `crop-handle is-${handle}`, dataset: { handle } })));
    const stage = h("div", { class: "crop-stage" }, canvas, h("div", { class: "crop-clip" }, shade), box);
    const frame = h("div", { class: "crop-frame" }, h("p", { class: "hint", text: t("common.loading") }));
    const applyButton = h("button", { type: "button", class: "solid-button", disabled: true }, t("editor.apply"));
    const tools = [
      h("button", { type: "button", class: "ghost-button", onclick: () => rotate(-1) }, "↺ ", t("editor.rotateLeft")),
      h("button", { type: "button", class: "ghost-button", onclick: () => rotate(1) }, "↻ ", t("editor.rotateRight")),
      h("button", { type: "button", class: "ghost-button", onclick: () => setCrop({ ...FULL_CROP }) }, t("editor.resetCrop"))
    ];
    setBusy(tools, true);

    body.append(h("div", { class: "button-row" }, tools), h("p", { class: "hint", text: t("editor.hint") }), frame);
    footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), applyButton);

    function setCrop(next) {
      crop = next;
      for (const element of [box, shade]) {
        element.style.left = `${crop.x * 100}%`;
        element.style.top = `${crop.y * 100}%`;
        element.style.width = `${crop.w * 100}%`;
        element.style.height = `${crop.h * 100}%`;
      }
    }

    function drawPreview() {
      const size = rotatedSize(source.naturalWidth, source.naturalHeight, turns);
      const maxWidth = Math.max(160, frame.clientWidth);
      const maxHeight = Math.max(200, Math.min(window.innerHeight * 0.58, 640));
      const fit = Math.min(1, maxWidth / size.width, maxHeight / size.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size.width * fit * ratio);
      canvas.height = Math.round(size.height * fit * ratio);
      canvas.style.width = `${Math.round(size.width * fit)}px`;
      canvas.style.height = `${Math.round(size.height * fit)}px`;
      const context = canvas.getContext("2d");
      context.scale(fit * ratio, fit * ratio);
      drawRotated(context, source, turns);
    }

    function rotate(direction) {
      turns = normalizeTurns(turns + direction);
      setCrop(rotateCrop(crop, direction));
      drawPreview();
    }

    stage.addEventListener("pointerdown", (event) => {
      const handle = event.target.dataset?.handle ?? (event.target === box ? "move" : null);
      if (!handle) return;
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      drag = { id: event.pointerId, handle, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, start: { ...crop } };
    });
    stage.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = (event.clientX - drag.x) / drag.width;
      const dy = (event.clientY - drag.y) / drag.height;
      setCrop(dragCrop(drag.start, drag.handle, dx, dy));
    });
    const endDrag = (event) => {
      if (drag?.id === event.pointerId) drag = null;
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);

    applyButton.addEventListener("click", async () => {
      if (isUnchanged(turns, crop)) {
        result = file;
        close();
        return;
      }
      setBusy([applyButton, ...tools], true);
      applyButton.textContent = t("editor.applying");
      try {
        result = await exportEdited(source, turns, crop, file.name);
        close();
      } catch {
        setStatus(t("editor.failed"));
        applyButton.textContent = t("editor.apply");
        setBusy([applyButton, ...tools], false);
      }
    });

    dialog.addEventListener("close", () => {
      if (source) URL.revokeObjectURL(source.src);
      resolve(result);
    });

    loadImage(file)
      .then(({ img }) => {
        source = img;
        frame.replaceChildren(stage);
        setCrop(crop);
        drawPreview();
        setBusy([applyButton, ...tools], false);
      })
      .catch(() => {
        frame.replaceChildren();
        setStatus(t("editor.loadFailed"));
      });
  });
}
