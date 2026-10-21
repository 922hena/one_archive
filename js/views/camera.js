import { t } from "../i18n.js";
import { h, confirmDialog } from "../ui.js";

// Browsers only allow the camera on https:// (or localhost).
export function cameraSupported() {
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function photoName(date, page) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
  return t("camera.fileName", { stamp, page });
}

function cameraError(error) {
  const name = String(error?.name ?? "");
  if (name === "NotAllowedError" || name === "SecurityError") return t("camera.denied");
  if (name === "NotFoundError" || name === "OverconstrainedError") return t("camera.notFound");
  if (name === "NotReadableError" || name === "AbortError") return t("camera.busy");
  return t("camera.failed");
}

// Resolves with the photos in shooting order, or [] when cancelled.
export function openBurstCamera() {
  return new Promise((resolve) => {
    const shots = [];
    const startedAt = new Date();
    let stream = null;
    let finished = false;
    let capturing = false;

    const video = h("video", { class: "camera-video", autoplay: true, playsinline: true, muted: true });
    video.muted = true;
    video.playsInline = true;
    const shade = h("div", { class: "camera-shade" });
    const status = h("p", { class: "camera-status", role: "status", text: t("camera.starting") });
    const strip = h("ol", { class: "camera-strip", "aria-label": t("camera.stripLabel") });
    const shutter = h("button", { type: "button", class: "camera-shutter", "aria-label": t("camera.shutter"), disabled: true, onclick: capture });
    const doneButton = h("button", { type: "button", class: "camera-button is-done", disabled: true, onclick: () => finish(true) });
    const cancelButton = h("button", { type: "button", class: "camera-button", onclick: cancel }, t("common.cancel"));
    const dialog = h(
      "dialog",
      { class: "camera", "aria-label": t("camera.title") },
      h("div", { class: "camera-view" }, video, shade, status),
      strip,
      h("div", { class: "camera-controls" }, cancelButton, shutter, doneButton)
    );

    function stop() {
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
    }

    function finish(keep) {
      if (finished) return;
      finished = true;
      stop();
      for (const shot of shots) URL.revokeObjectURL(shot.url);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(keep ? shots.map((shot) => shot.file) : []);
    }

    async function cancel() {
      if (shots.length) {
        const ok = await confirmDialog(t("camera.discardConfirm", { count: shots.length }), {
          confirmLabel: t("camera.discard"),
          danger: true
        });
        if (!ok) return;
      }
      finish(false);
    }

    function renderStrip() {
      strip.replaceChildren(
        ...shots.map((shot, index) =>
          h("li", { class: "camera-thumb" },
            h("img", { src: shot.url, alt: t("library.pageNo", { page: index + 1 }) }),
            h("span", { class: "camera-thumb-no num", text: String(index + 1) }),
            h("button", {
              type: "button",
              class: "camera-thumb-remove",
              "aria-label": t("camera.remove", { page: index + 1 }),
              onclick: () => {
                URL.revokeObjectURL(shot.url);
                shots.splice(index, 1);
                renderStrip();
              }
            }, "×")
          )
        )
      );
      doneButton.textContent = t("camera.done", { count: shots.length });
      doneButton.disabled = !shots.length;
      strip.scrollLeft = strip.scrollWidth;
    }

    async function capture() {
      if (capturing || !video.videoWidth) return;
      capturing = true;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      shade.classList.remove("is-flash");
      void shade.offsetWidth;
      shade.classList.add("is-flash");
      const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.92));
      capturing = false;
      if (finished) return;
      if (!blob) {
        status.textContent = t("camera.captureFailed");
        status.hidden = false;
        return;
      }
      const file = new File([blob], photoName(startedAt, shots.length + 1), { type: "image/jpeg", lastModified: Date.now() });
      shots.push({ file, url: URL.createObjectURL(blob) });
      status.hidden = true;
      renderStrip();
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }
        });
        if (finished) {
          stop();
          return;
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
        status.textContent = t("camera.ready");
        shutter.disabled = false;
        shutter.focus();
      } catch (error) {
        status.textContent = cameraError(error);
      }
    }

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancel();
    });
    renderStrip();
    document.body.append(dialog);
    dialog.showModal();
    start();
  });
}
