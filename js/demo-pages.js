// Sample score pages for the demo page (demo.html), drawn on this device. They show a title, staves and notes
// so the viewer has something to turn; the notes are not the real music of the work. Texts under the chant
// are the public-domain Latin texts of the Ordinary and the hymns.

const WIDTH = 1000;
const HEIGHT = 1414;
const MARGIN = 72;
const INK = "#16171a";
const SERIF = 'Georgia, "Times New Roman", "Noto Serif", serif';

function hashText(text) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function randomFrom(seedText) {
  let seed = hashText(seedText) || 1;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

let glyphCheck = null;

// True when this device has a font with the clef signs; otherwise simple drawn clefs are used.
function hasClefGlyphs() {
  if (glyphCheck !== null) return glyphCheck;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    const draw = (text) => {
      ctx.clearRect(0, 0, 40, 40);
      ctx.font = '30px "Segoe UI Symbol", "Noto Music", "Apple Symbols", "Noto Sans Symbols 2", serif';
      ctx.fillText(text, 4, 32);
      return ctx.getImageData(0, 0, 40, 40).data.join(",");
    };
    const clef = draw("\u{1D11E}");
    glyphCheck = clef !== draw("\uFFFF") && clef !== draw("\u{10FFFD}");
  } catch {
    glyphCheck = false;
  }
  return glyphCheck;
}

function drawTrebleClef(ctx, x, top, gap) {
  if (hasClefGlyphs()) {
    ctx.font = `${gap * 6.4}px "Segoe UI Symbol", "Noto Music", "Apple Symbols", "Noto Sans Symbols 2", serif`;
    ctx.fillText("\u{1D11E}", x - gap * 0.6, top + gap * 4.7);
    return;
  }
  const g = gap;
  const y = top + 3 * g; // the G line
  ctx.save();
  ctx.lineWidth = g * 0.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + 0.15 * g, y - 0.1 * g);
  ctx.bezierCurveTo(x - 0.3 * g, y - 0.5 * g, x - 0.85 * g, y + 0.1 * g, x - 0.55 * g, y + 0.7 * g);
  ctx.bezierCurveTo(x - 0.25 * g, y + 1.3 * g, x + 0.95 * g, y + 1.15 * g, x + 0.95 * g, y + 0.3 * g);
  ctx.bezierCurveTo(x + 0.95 * g, y - 0.6 * g, x - 0.1 * g, y - 1.1 * g, x - 0.5 * g, y - 1.6 * g);
  ctx.bezierCurveTo(x - 0.95 * g, y - 2.2 * g, x - 0.2 * g, y - 3.9 * g, x + 0.25 * g, y - 3.6 * g);
  ctx.bezierCurveTo(x + 0.55 * g, y - 3.4 * g, x + 0.2 * g, y - 2.4 * g, x - 0.05 * g, y - 1.9 * g);
  ctx.lineTo(x + 0.25 * g, y + 2.1 * g);
  ctx.bezierCurveTo(x + 0.3 * g, y + 2.7 * g, x - 0.5 * g, y + 2.8 * g, x - 0.45 * g, y + 2.25 * g);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - 0.3 * g, y + 2.2 * g, 0.28 * g, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBassClef(ctx, x, top, gap) {
  if (hasClefGlyphs()) {
    ctx.font = `${gap * 4.2}px "Segoe UI Symbol", "Noto Music", "Apple Symbols", "Noto Sans Symbols 2", serif`;
    ctx.fillText("\u{1D122}", x - gap * 0.6, top + gap * 3.05);
    return;
  }
  const g = gap;
  const y = top + g; // the F line
  ctx.save();
  ctx.beginPath();
  ctx.arc(x - 0.2 * g, y, 0.3 * g, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = g * 0.22;
  ctx.beginPath();
  ctx.moveTo(x - 0.45 * g, y - 0.1 * g);
  ctx.bezierCurveTo(x - 0.3 * g, y - 1.1 * g, x + 1.3 * g, y - 1.0 * g, x + 1.15 * g, y + 0.5 * g);
  ctx.bezierCurveTo(x + 1.0 * g, y + 1.6 * g, x + 0.1 * g, y + 2.3 * g, x - 0.5 * g, y + 2.7 * g);
  ctx.stroke();
  for (const dy of [-0.5, 0.5]) {
    ctx.beginPath();
    ctx.arc(x + 1.65 * g, y + dy * g, 0.14 * g, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function staffLines(ctx, left, right, top, gap, count = 5) {
  ctx.lineWidth = 1.2;
  for (let line = 0; line < count; line += 1) {
    ctx.beginPath();
    ctx.moveTo(left, top + line * gap);
    ctx.lineTo(right, top + line * gap);
    ctx.stroke();
  }
}

// Key signature positions in half-gaps below the top line of the treble staff.
const SHARP_STEPS = [0, 3, -1, 2, 5, 1, 4];
const FLAT_STEPS = [4, 1, 5, 2, 6, 3, 7];
const KEY_SIGNATURES = { C: 0, G: 1, D: 2, A: 3, E: 4, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5 };

function drawKeySignature(ctx, x, top, gap, tonic, bass) {
  const count = KEY_SIGNATURES[tonic] ?? 0;
  if (!count) return 0;
  const steps = count > 0 ? SHARP_STEPS : FLAT_STEPS;
  ctx.font = `${gap * 2.3}px ${SERIF}`;
  for (let index = 0; index < Math.abs(count); index += 1) {
    const y = top + (steps[index] + (bass ? 2 : 0)) * (gap / 2);
    ctx.fillText(count > 0 ? "\u266F" : "\u266D", x + index * gap * 0.95, y + gap * 0.55);
  }
  return Math.abs(count) * gap * 0.95 + gap * 0.4;
}

function notehead(ctx, x, y, gap, hollow) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.35);
  ctx.beginPath();
  ctx.ellipse(0, 0, gap * 0.62, gap * 0.42, 0, 0, Math.PI * 2);
  if (hollow) {
    ctx.lineWidth = gap * 0.16;
    ctx.stroke();
  } else {
    ctx.fill();
  }
  ctx.restore();
}

// One measure of one staff: quarter notes, half notes or beamed eighths, kept inside the staff.
function drawMeasure(ctx, random, left, width, top, gap, { calm = false } = {}) {
  const middle = top + 2 * gap;
  const patterns = calm ? [[2, 2], [4], [2, 1, 1]] : [[1, 1, 1, 1], [0.5, 0.5, 1, 1, 1], [2, 1, 1], [1, 1, 2], [1, 0.5, 0.5, 2]];
  const pattern = patterns[Math.floor(random() * patterns.length)];
  let beat = 0;
  let step = 1 + Math.floor(random() * 7);
  let pendingBeam = null;
  for (const length of pattern) {
    step = Math.max(-1, Math.min(9, step + Math.floor(random() * 5) - 2));
    const x = left + gap * 1.2 + (beat / 4) * (width - gap * 2.2);
    const y = top + step * (gap / 2);
    notehead(ctx, x, y, gap, length >= 2);
    if (length < 4) {
      const up = y > middle;
      const stemX = up ? x + gap * 0.55 : x - gap * 0.55;
      const stemEnd = up ? y - gap * 3.3 : y + gap * 3.3;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(stemX, y);
      ctx.lineTo(stemX, stemEnd);
      ctx.stroke();
      if (length === 0.5) {
        if (pendingBeam) {
          ctx.lineWidth = gap * 0.45;
          ctx.beginPath();
          ctx.moveTo(pendingBeam.x, pendingBeam.end);
          ctx.lineTo(stemX, pendingBeam.end);
          ctx.stroke();
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(stemX, stemEnd);
          ctx.lineTo(stemX, pendingBeam.end);
          ctx.stroke();
          pendingBeam = null;
        } else {
          pendingBeam = { x: stemX, end: stemEnd };
        }
      }
    }
    beat += length;
  }
}

function barLine(ctx, x, top, bottom, double = false) {
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  if (double) {
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + 6, top);
    ctx.lineTo(x + 6, bottom);
    ctx.stroke();
  }
}

function drawModernPage(ctx, sample, page, pages, startY) {
  const random = randomFrom(`${sample.key}:${page}`);
  const gap = 11;
  const left = MARGIN;
  const right = WIDTH - MARGIN;
  const systemHeight = gap * 4 * 2 + gap * 6;
  const spacing = gap * 7.5;
  let y = startY;
  let system = 0;
  while (y + systemHeight < HEIGHT - 110) {
    const trebleTop = y;
    const bassTop = y + gap * 4 + gap * 6;
    staffLines(ctx, left, right, trebleTop, gap);
    staffLines(ctx, left, right, bassTop, gap);
    barLine(ctx, left, trebleTop, bassTop + gap * 4);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(left - 8, trebleTop);
    ctx.lineTo(left - 8, bassTop + gap * 4);
    ctx.stroke();

    drawTrebleClef(ctx, left + gap * 1.6, trebleTop, gap);
    drawBassClef(ctx, left + gap * 1.3, bassTop, gap);
    let x = left + gap * 4;
    const keyWidth = drawKeySignature(ctx, x, trebleTop, gap, sample.tonic, false);
    drawKeySignature(ctx, x, bassTop, gap, sample.tonic, true);
    x += keyWidth;
    if (page === 1 && system === 0) {
      ctx.font = `bold ${gap * 2.1}px ${SERIF}`;
      for (const top of [trebleTop, bassTop]) {
        ctx.fillText(String(sample.meter?.[0] ?? 4), x, top + gap * 1.75);
        ctx.fillText(String(sample.meter?.[1] ?? 4), x, top + gap * 3.75);
      }
      x += gap * 2.2;
    }
    const measures = 4;
    const measureWidth = (right - x) / measures;
    for (let measure = 0; measure < measures; measure += 1) {
      const mx = x + measure * measureWidth;
      drawMeasure(ctx, random, mx, measureWidth, trebleTop, gap);
      drawMeasure(ctx, random, mx, measureWidth, bassTop, gap, { calm: true });
      const last = measure === measures - 1;
      const finalBar = last && page === pages && y + systemHeight * 2 + spacing >= HEIGHT - 110;
      barLine(ctx, mx + measureWidth - (finalBar ? 6 : 0), trebleTop, bassTop + gap * 4, finalBar);
    }
    system += 1;
    y += systemHeight + spacing;
  }
}

function syllablesOf(text) {
  const out = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const parts = word.split("-");
    parts.forEach((part, index) => out.push({ text: index < parts.length - 1 ? `${part}-` : part, endOfWord: index === parts.length - 1 }));
  }
  return out;
}

// Square notes on a four-line staff with the Latin text underneath. Returns where the text stopped.
function drawChantPage(ctx, sample, page, startY, from) {
  const random = randomFrom(`${sample.key}:${page}`);
  const syllables = syllablesOf(sample.text);
  const gap = 13;
  const left = MARGIN;
  const right = WIDTH - MARGIN;
  const rowHeight = gap * 3 + 74;
  let index = from;
  let y = startY;
  let step = 3;
  while (index < syllables.length && y + rowHeight < HEIGHT - 100) {
    ctx.strokeStyle = INK;
    staffLines(ctx, left, right, y, gap, 4);
    // C clef on the second line from the top
    const clefY = y + gap;
    ctx.fillRect(left + 6, clefY - gap * 0.9, 4, gap * 1.8);
    ctx.fillRect(left + 10, clefY - gap * 0.85, gap * 0.7, gap * 0.6);
    ctx.fillRect(left + 10, clefY + gap * 0.25, gap * 0.7, gap * 0.6);
    let x = left + gap * 3;
    ctx.font = `20px ${SERIF}`;
    while (index < syllables.length) {
      const syllable = syllables[index];
      const notes = random() < 0.28 ? 2 : 1;
      const textWidth = ctx.measureText(syllable.text).width;
      const width = Math.max(textWidth + (syllable.endOfWord ? 14 : 4), notes * gap * 1.4 + 8);
      if (x + width > right - gap) break;
      const noteX = x + Math.max(0, (Math.min(textWidth, width) - notes * gap) / 2);
      for (let note = 0; note < notes; note += 1) {
        step = Math.max(0, Math.min(6, step + Math.floor(random() * 3) - 1));
        const ny = y + step * (gap / 2);
        ctx.fillRect(noteX + note * gap * 1.15, ny - gap * 0.42, gap * 0.95, gap * 0.84);
      }
      ctx.fillText(syllable.text, x, y + gap * 3 + 34);
      const punctuation = /[.,:;]$/.test(syllable.text);
      x += width;
      if (punctuation) {
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const full = /[.:;]$/.test(syllable.text);
        ctx.moveTo(x - 4, full ? y : y + gap * 0.5);
        ctx.lineTo(x - 4, full ? y + gap * 3 : y + gap * 2.5);
        ctx.stroke();
        x += 10;
      }
      index += 1;
    }
    y += rowHeight;
  }
  if (index >= syllables.length) {
    const lastY = y - rowHeight;
    ctx.lineWidth = 1.6;
    for (const dx of [0, 8]) {
      ctx.beginPath();
      ctx.moveTo(right - 2 - dx, lastY);
      ctx.lineTo(right - 2 - dx, lastY + gap * 3);
      ctx.stroke();
    }
  }
  return index;
}

function chantStart(sample, page) {
  // Where the text starts on this page: draw the earlier pages without keeping them.
  if (page === 1) return 0;
  const scratch = document.createElement("canvas").getContext("2d");
  let from = 0;
  for (let earlier = 1; earlier < page; earlier += 1) {
    from = drawChantPage(scratch, sample, earlier, earlier === 1 ? 230 : 120, from);
  }
  return from;
}

function header(ctx, sample, page) {
  ctx.fillStyle = INK;
  if (page === 1) {
    ctx.textAlign = "center";
    ctx.font = `bold 40px ${SERIF}`;
    ctx.fillText(sample.title, WIDTH / 2, 118);
    if (sample.composer) {
      ctx.textAlign = "right";
      ctx.font = `italic 22px ${SERIF}`;
      ctx.fillText(sample.composer, WIDTH - MARGIN, 172);
    }
    ctx.textAlign = "left";
    return 230;
  }
  ctx.font = `16px ${SERIF}`;
  ctx.fillStyle = "#6b6f78";
  ctx.fillText(`${sample.title} — ${page}`, MARGIN, 64);
  ctx.fillStyle = INK;
  return 120;
}

function footer(ctx, page, pages) {
  ctx.textAlign = "center";
  ctx.font = `14px ${SERIF}`;
  ctx.fillStyle = "#8a8e96";
  ctx.fillText(`Sample page for the YEAR SCORE demo · ${page} / ${pages}`, WIDTH / 2, HEIGHT - 44);
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
}

// sample: one entry of SAMPLE_SCORES (demo-seed.js). Resolves to a PNG image of the page.
export function renderSamplePage(sample, page, pages) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  const startY = header(ctx, sample, page);
  if (sample.style === "chant") drawChantPage(ctx, sample, page, startY, chantStart(sample, page));
  else drawModernPage(ctx, sample, page, pages, startY + 20);
  footer(ctx, page, pages);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("sample_page_failed"))), "image/png");
  });
}
