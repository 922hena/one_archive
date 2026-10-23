// Browser-side preparation of a Score before upload: photos -> one PDF, and a small first-page thumbnail.
// Nothing here talks to the server. Pure parts live in pdf-build.js.
import { applyLevels, buildPdf, fitSize, levelsFromHistogram } from "./pdf-build.js";
import { loadPdfJs } from "./views/viewer.js";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const THUMB_WIDTH = 320;

// Tried in order until the PDF fits the upload limit.
const QUALITY_STEPS = [
  { maxEdge: 2000, quality: 0.8 },
  { maxEdge: 1600, quality: 0.7 },
  { maxEdge: 1300, quality: 0.6 }
];

function toBlob(canvas, type, quality) {
  return new Promise((done) => canvas.toBlob(done, type, quality));
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// One photo: shrink, lift the contrast (auto levels), compress to JPEG.
export async function enhancePhoto(file, { maxEdge, quality }) {
  const source = await decode(file);
  try {
    const sourceWidth = source.naturalWidth ?? source.width;
    const sourceHeight = source.naturalHeight ?? source.height;
    const { width, height } = fitSize(sourceWidth, sourceHeight, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);

    const image = context.getImageData(0, 0, width, height);
    const hist = new Array(256).fill(0);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      hist[Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)] += 1;
    }
    const levels = levelsFromHistogram(hist, width * height);
    if (levels) {
      applyLevels(data, levels.low, levels.high);
      context.putImageData(image, 0, 0);
    }
    const blob = await toBlob(canvas, "image/jpeg", quality);
    if (!blob) throw new Error("encode_failed");
    return { blob, jpeg: new Uint8Array(await blob.arrayBuffer()), width, height, canvas };
  } finally {
    source.close?.();
  }
}

// Photos (in the confirmed order) -> one PDF Blob. Returns { pdf, firstPage } where firstPage is a canvas.
export async function photosToPdf(files, onProgress = () => {}) {
  let lastSize = 0;
  for (const step of QUALITY_STEPS) {
    const pages = [];
    let firstCanvas = null;
    for (const [index, file] of files.entries()) {
      onProgress(index + 1, files.length);
      const page = await enhancePhoto(file, step);
      if (index === 0) firstCanvas = page.canvas;
      pages.push({ jpeg: page.jpeg, width: page.width, height: page.height });
    }
    const bytes = buildPdf(pages);
    lastSize = bytes.length;
    if (bytes.length <= MAX_PDF_BYTES) {
      return { pdf: new Blob([bytes], { type: "application/pdf" }), firstPage: firstCanvas, size: bytes.length };
    }
  }
  throw Object.assign(new Error("pdf_too_large"), { code: "pdf_too_large", size: lastSize });
}

// Small first-page image. WebP where the browser can encode it, otherwise JPEG of the same size.
export async function thumbnailFromCanvas(canvas, width = THUMB_WIDTH) {
  const { width: w, height: h } = fitSize(canvas.width, canvas.height, width);
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  small.getContext("2d").drawImage(canvas, 0, 0, w, h);
  const webp = await toBlob(small, "image/webp", 0.7);
  if (webp && webp.type === "image/webp") return { blob: webp, mime: "image/webp", ext: "webp" };
  const jpeg = await toBlob(small, "image/jpeg", 0.75);
  if (!jpeg) throw new Error("thumbnail_failed");
  return { blob: jpeg, mime: "image/jpeg", ext: "jpg" };
}

// First page of a PDF file/blob drawn with pdf.js. The PDF itself is not changed.
export async function pdfFirstPageCanvas(pdfBlob, width = THUMB_WIDTH) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await pdfBlob.arrayBuffer()) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width * 2) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas;
  } finally {
    doc.destroy();
  }
}

// Everything the upload needs. Throws only when the PDF itself can't be made.
// thumb is null when the thumbnail couldn't be created; the Score still saves.
export async function prepareScore({ pdfFile = null, photoFiles = [] }, onProgress = () => {}) {
  let pdf;
  let canvas = null;
  let pdfName;
  if (pdfFile) {
    pdf = pdfFile;
    pdfName = pdfFile.name || "score.pdf";
  } else {
    const built = await photosToPdf(photoFiles, onProgress);
    pdf = built.pdf;
    canvas = built.firstPage;
    pdfName = "score.pdf";
  }
  let thumb = null;
  try {
    canvas ??= await pdfFirstPageCanvas(pdf);
    thumb = await thumbnailFromCanvas(canvas);
  } catch {
    thumb = null;
  }
  return { pdf, pdfName, thumb };
}
