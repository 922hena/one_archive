import test from "node:test";
import assert from "node:assert/strict";
import { comparePages, isImageScore, moveItem, renumberPages } from "../js/pages.js";
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
} from "../js/image-edit.js";
import { loginUrl, safeNextPath } from "../js/return-to.js";

const near = (actual, expected) => {
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} vs ${expected[key]}`);
};

test("moveItem moves one page and leaves the input alone", () => {
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(list, 0, 1), ["b", "a", "c", "d"]);
  assert.deepEqual(moveItem(list, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(list, 0, -1), list);
  assert.deepEqual(moveItem(list, 3, 4), list);
  assert.deepEqual(list, ["a", "b", "c", "d"]);
});

test("renumberPages returns only changed saved pages, 1-based and without gaps", () => {
  const p1 = { id: "p1", page_no: 1 };
  const p2 = { id: "p2", page_no: 2 };
  const p4 = { id: "p4", page_no: 4 };
  assert.deepEqual(renumberPages([p1, p2]), []);
  assert.deepEqual(renumberPages([p2, p1]), [{ id: "p2", page_no: 1 }, { id: "p1", page_no: 2 }]);
  // page 3 was removed, a new page (null) goes first
  assert.deepEqual(renumberPages([null, p1, p2, p4]), [
    { id: "p1", page_no: 2 },
    { id: "p2", page_no: 3 }
  ]);
});

test("pages sort by number, then by creation", () => {
  const files = [
    { id: "b", page_no: 2, created_at: "2026-10-21T00:00:01Z" },
    { id: "a2", page_no: 1, created_at: "2026-10-21T00:00:05Z" },
    { id: "a1", page_no: 1, created_at: "2026-10-21T00:00:01Z" }
  ];
  assert.deepEqual(files.sort(comparePages).map((file) => file.id), ["a1", "a2", "b"]);
});

test("only photo scores can be page-edited", () => {
  assert.equal(isImageScore([{ mime_type: "image/jpeg" }, { mime_type: "image/png" }]), true);
  assert.equal(isImageScore([{ mime_type: "application/pdf" }]), false);
  assert.equal(isImageScore([]), false);
});

test("four quarter turns bring the crop back", () => {
  const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.3 };
  let turned = crop;
  for (let i = 0; i < 4; i += 1) turned = rotateCrop(turned, 1);
  near(turned, crop);
  near(rotateCrop(rotateCrop(crop, 1), -1), crop);
  // clockwise: the top-left region moves to the top-right
  near(rotateCrop({ x: 0, y: 0, w: 0.5, h: 0.25 }, 1), { x: 0.75, y: 0, w: 0.25, h: 0.5 });
  assert.equal(normalizeTurns(-1), 3);
  assert.deepEqual(rotatedSize(4000, 3000, 1), { width: 3000, height: 4000 });
  assert.deepEqual(rotatedSize(4000, 3000, 2), { width: 4000, height: 3000 });
});

test("dragging keeps the crop inside the picture and not too small", () => {
  near(dragCrop(FULL_CROP, "se", -0.3, -0.2), { x: 0, y: 0, w: 0.7, h: 0.8 });
  near(dragCrop(FULL_CROP, "nw", -0.5, -0.5), { x: 0, y: 0, w: 1, h: 1 });
  near(dragCrop(FULL_CROP, "w", 2, 0), { x: 0.95, y: 0, w: 0.05, h: 1 });
  near(dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, "move", 0.9, -0.9), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
});

test("unchanged photos are not re-encoded", () => {
  assert.equal(isUnchanged(0, FULL_CROP), true);
  assert.equal(isUnchanged(4, { x: 0, y: 0, w: 1, h: 1 }), true);
  assert.equal(isUnchanged(1, FULL_CROP), false);
  assert.equal(isUnchanged(0, { x: 0.1, y: 0, w: 0.9, h: 1 }), false);
});

test("output stays inside mobile canvas limits", () => {
  assert.equal(outputScale(3000, 4000), 1);
  const scale = outputScale(8064, 6048);
  assert.ok(8064 * 6048 * scale * scale <= 12_000_000 + 1);
  assert.ok(Math.max(8064, 6048) * scale <= 5000);
  assert.deepEqual(cropPixels(4000, 3000, 1, { x: 0.5, y: 0, w: 0.5, h: 0.5 }), { width: 3000, height: 4000, x: 1500, y: 0, w: 1500, h: 2000 });
  assert.equal(editedFileName("IMG_0001.PNG"), "IMG_0001.jpg");
  assert.equal(editedFileName(""), "photo.jpg");
});

test("after sign-in only app screens are allowed as the return address", () => {
  assert.equal(safeNextPath("app.html#/library"), "app.html#/library");
  assert.equal(safeNextPath("app.html#/mass/0f8fad5b-d9cb-469f-a165-70867728950e"), "app.html#/mass/0f8fad5b-d9cb-469f-a165-70867728950e");
  assert.equal(safeNextPath("app.html"), "app.html");
  assert.equal(safeNextPath("https://evil.example/app.html"), null);
  assert.equal(safeNextPath("//evil.example"), null);
  assert.equal(safeNextPath("javascript:alert(1)"), null);
  assert.equal(safeNextPath("app.html#/x?<script>"), null);
  assert.equal(safeNextPath(null), null);
  assert.equal(loginUrl("schedule.html", "#/library"), "schedule.html?next=app.html%23%2Flibrary");
  assert.equal(loginUrl("schedule.html", "#bad<"), "schedule.html");
});
