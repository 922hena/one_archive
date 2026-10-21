// Rotation and crop math for the photo editor. Crop values are fractions (0..1) of the rotated image.

export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
export const MIN_CROP = 0.05;
export const MAX_OUTPUT_PIXELS = 12_000_000;
export const MAX_OUTPUT_EDGE = 5000;

export function normalizeTurns(turns) {
  return ((turns % 4) + 4) % 4;
}

export function rotatedSize(width, height, turns) {
  return normalizeTurns(turns) % 2 ? { width: height, height: width } : { width, height };
}

// direction 1 = 90° clockwise, -1 = 90° counter-clockwise
export function rotateCrop(crop, direction) {
  if (direction > 0) return { x: 1 - (crop.y + crop.h), y: crop.x, w: crop.h, h: crop.w };
  return { x: crop.y, y: 1 - (crop.x + crop.w), w: crop.h, h: crop.w };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// handle: "move" or any mix of n/s/e/w; dx, dy are fractions of the displayed image.
export function dragCrop(start, handle, dx, dy, min = MIN_CROP) {
  if (handle === "move") {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - min);
  if (handle.includes("e")) right = clamp(right + dx, left + min, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + min, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function isUnchanged(turns, crop) {
  const c = crop ?? FULL_CROP;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  return normalizeTurns(turns) === 0 && near(c.x, 0) && near(c.y, 0) && near(c.w, 1) && near(c.h, 1);
}

// Keeps the output inside mobile canvas limits.
export function outputScale(width, height, maxPixels = MAX_OUTPUT_PIXELS, maxEdge = MAX_OUTPUT_EDGE) {
  if (!width || !height) return 1;
  return Math.min(1, Math.sqrt(maxPixels / (width * height)), maxEdge / Math.max(width, height));
}

// Pixel rectangle of the crop inside the rotated image.
export function cropPixels(width, height, turns, crop) {
  const size = rotatedSize(width, height, turns);
  const x = Math.round(crop.x * size.width);
  const y = Math.round(crop.y * size.height);
  const w = Math.max(1, Math.round(crop.w * size.width));
  const h = Math.max(1, Math.round(crop.h * size.height));
  return { ...size, x, y, w: Math.min(w, size.width - x), h: Math.min(h, size.height - y) };
}

export function editedFileName(name) {
  const base = String(name ?? "").replace(/\.[^./\\]+$/, "") || "photo";
  return `${base}.jpg`;
}
