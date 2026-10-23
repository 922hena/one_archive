import test from "node:test";
import assert from "node:assert/strict";
import { applyLevels, buildPdf, fitSize, levelsFromHistogram } from "../js/pdf-build.js";

const text = (bytes) => new TextDecoder("latin1").decode(bytes);

test("fitSize shrinks the longest side and never enlarges", () => {
  assert.deepEqual(fitSize(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(fitSize(3000, 4000, 2000), { width: 1500, height: 2000 });
  assert.deepEqual(fitSize(1200, 800, 2000), { width: 1200, height: 800 });
});

test("levelsFromHistogram finds the range and skips already contrasty or flat photos", () => {
  const hist = new Array(256).fill(0);
  for (let i = 60; i <= 200; i += 1) hist[i] = 10;
  const levels = levelsFromHistogram(hist, 141 * 10);
  assert.ok(levels.low >= 60 && levels.low < 70);
  assert.ok(levels.high <= 200 && levels.high > 190);

  const wide = new Array(256).fill(1);
  assert.equal(levelsFromHistogram(wide, 256), null);
  const flat = new Array(256).fill(0);
  flat[128] = 100;
  assert.equal(levelsFromHistogram(flat, 100), null);
  assert.equal(levelsFromHistogram(flat, 0), null);
});

test("applyLevels stretches RGB and keeps alpha", () => {
  const data = new Uint8ClampedArray([60, 130, 200, 255, 100, 100, 100, 7]);
  applyLevels(data, 60, 200);
  assert.deepEqual([...data.slice(0, 4)], [0, 128, 255, 255]);
  assert.equal(data[7], 7);
});

test("buildPdf writes a valid structure with correct xref offsets", () => {
  const jpegA = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const jpegB = new Uint8Array([0xff, 0xd8, 9, 9, 0xff, 0xd9]);
  const pdf = buildPdf([
    { jpeg: jpegA, width: 1500, height: 2000 },
    { jpeg: jpegB, width: 2000, height: 1500 }
  ]);
  const body = text(pdf);
  assert.ok(body.startsWith("%PDF-1.4"));
  assert.ok(body.trimEnd().endsWith("%%EOF"));
  assert.match(body, /\/Count 2 /);
  assert.match(body, /\/MediaBox \[0 0 720\.00 960\.00\]/);
  assert.match(body, /\/MediaBox \[0 0 960\.00 720\.00\]/);

  const startxref = Number(/startxref\n(\d+)\n/.exec(body)[1]);
  assert.equal(body.slice(startxref, startxref + 4), "xref");
  const entries = [...body.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((match) => Number(match[1]));
  assert.equal(entries.length, 8);
  entries.forEach((offset, index) => {
    assert.equal(body.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`);
  });

  // The JPEG bytes are embedded untouched.
  const start = pdf.findIndex((byte, i) => byte === 0xff && pdf[i + 1] === 0xd8 && pdf[i + 2] === 1);
  assert.deepEqual([...pdf.slice(start, start + jpegA.length)], [...jpegA]);
});

test("buildPdf rejects an empty page list", () => {
  assert.throws(() => buildPdf([]), /no_pages/);
});
