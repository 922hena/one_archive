// Pure helpers (no DOM) for turning photos into one PDF. Tested in tests/pdf-build.test.mjs.

const encoder = new TextEncoder();

// Longest side limited to maxEdge, never enlarged.
export function fitSize(width, height, maxEdge) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// hist: 256 luminance counts. Ignores the darkest and lightest `clip` share so a few specks don't decide the range.
// Returns null when the photo is already contrasty (or empty), so it is left alone.
export function levelsFromHistogram(hist, total, clip = 0.01) {
  if (!total) return null;
  let sum = 0;
  let low = 0;
  for (let i = 0; i < 256; i += 1) {
    sum += hist[i];
    if (sum >= total * clip) {
      low = i;
      break;
    }
  }
  sum = 0;
  let high = 255;
  for (let i = 255; i >= 0; i -= 1) {
    sum += hist[i];
    if (sum >= total * clip) {
      high = i;
      break;
    }
  }
  if (high - low < 32) return null;
  if (low <= 4 && high >= 251) return null;
  return { low, high };
}

// Linear stretch of RGBA data in place: low -> 0, high -> 255.
export function applyLevels(data, low, high) {
  const lut = new Uint8ClampedArray(256);
  const span = high - low;
  for (let i = 0; i < 256; i += 1) lut[i] = ((i - low) * 255) / span;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  return data;
}

function concat(chunks, length) {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// pages: [{ jpeg: Uint8Array (baseline RGB JPEG), width, height }] in pixels.
// Each JPEG is embedded as is (DCTDecode); the page size assumes 150 pixels per inch.
export function buildPdf(pages, { pixelsPerInch = 150 } = {}) {
  if (!pages.length) throw new Error("no_pages");
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (number) => {
    offsets[number] = length;
    push(`${number} 0 obj\n`);
  };

  push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
  const total = 2 + pages.length * 3;
  startObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObject(2);
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`);

  pages.forEach((page, index) => {
    const pageObject = 3 + index * 3;
    const widthPt = ((page.width * 72) / pixelsPerInch).toFixed(2);
    const heightPt = ((page.height * 72) / pixelsPerInch).toFixed(2);
    startObject(pageObject);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] ` +
        `/Resources << /XObject << /Im0 ${pageObject + 2} 0 R >> >> /Contents ${pageObject + 1} 0 R >>\nendobj\n`
    );
    const content = `q ${widthPt} 0 0 ${heightPt} 0 0 cm /Im0 Do Q\n`;
    startObject(pageObject + 1);
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
    startObject(pageObject + 2);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
  });

  const xrefOffset = length;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let number = 1; number <= total; number += 1) {
    push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return concat(chunks, length);
}
