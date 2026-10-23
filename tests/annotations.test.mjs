import test from "node:test";
import assert from "node:assert/strict";
import {
  COLORS,
  addPoint,
  createHistory,
  eraseAt,
  newStrokeId,
  notesKey,
  pageAtPoint,
  pointsBetween,
  record,
  redo,
  sanitizeStrokes,
  strokeHit,
  strokeWidth,
  toPagePoint,
  toScreenPoint,
  undo
} from "../js/annotations.js";

const stroke = (id, points, extra = {}) => ({ id, tool: "pen", color: COLORS[0], width: 0.004, points, ...extra });

test("notes are kept per file page", () => {
  assert.equal(notesKey({ file: { id: "f1" }, pdfPage: 3 }), "f1:3");
  assert.equal(notesKey({ file: { id: "f1" } }), "f1:0");
});

test("a point on screen maps to the original page and back, whatever the zoom", () => {
  const small = { left: 100, top: 50, width: 200, height: 300 };
  const zoomed = { left: -100, top: -250, width: 800, height: 1200 }; // 4x zoom, moved
  const onPage = toPagePoint(small, 150, 125); // a quarter across, a quarter down
  assert.deepEqual(onPage, [0.25, 0.25]);
  const [x, y] = toScreenPoint(zoomed, onPage);
  assert.deepEqual([x, y], [100, 50]);
  assert.deepEqual(toPagePoint(zoomed, x, y), onPage);
  // outside the page is held at the edge
  assert.deepEqual(toPagePoint(small, 0, 9999), [0, 1]);
});

test("the page under the pen is found among the pages on screen", () => {
  const rects = [
    { left: 0, top: 0, width: 100, height: 140 },
    { left: 110, top: 0, width: 100, height: 140 }
  ];
  assert.equal(pageAtPoint(rects, 50, 70), 0);
  assert.equal(pageAtPoint(rects, 150, 70), 1);
  assert.equal(pageAtPoint(rects, 105, 70), -1); // the gap between pages
  assert.equal(pageAtPoint(rects, 50, 500), -1);
  assert.equal(pageAtPoint([{ left: 0, top: 0, width: 0, height: 0 }], 0, 0), -1);
});

test("points that are too close together are skipped", () => {
  const points = [];
  assert.equal(addPoint(points, [0.1, 0.1]), true);
  assert.equal(addPoint(points, [0.1005, 0.1], 1), false);
  assert.equal(addPoint(points, [0.2, 0.1], 1), true);
  assert.equal(points.length, 2);
});

test("a highlighter is wider than a pen of the same size", () => {
  assert.ok(strokeWidth("highlighter", "medium") > strokeWidth("pen", "medium"));
  assert.ok(strokeWidth("pen", "thick") > strokeWidth("pen", "thin"));
  assert.equal(strokeWidth("pen", "unknown"), strokeWidth("pen", "medium"));
});

test("the eraser takes the strokes it touches and nothing else", () => {
  const near = stroke("a", [[0.1, 0.1], [0.3, 0.1]]);
  const far = stroke("b", [[0.1, 0.8], [0.3, 0.8]]);
  assert.equal(strokeHit(near, [0.2, 0.105], 0.01), true);
  assert.equal(strokeHit(near, [0.2, 0.3], 0.01), false);
  const { kept, removed } = eraseAt([near, far], [0.2, 0.1], 0.01);
  assert.deepEqual(kept.map((item) => item.id), ["b"]);
  assert.deepEqual(removed.map((item) => [item.stroke.id, item.at]), [["a", 0]]);
});

test("a fast eraser swipe is followed point by point, so no stroke is skipped", () => {
  const route = pointsBetween([0.5, 0.1], [0.5, 0.9], 0.02, 1);
  assert.ok(route.length >= 40);
  assert.deepEqual(route[route.length - 1], [0.5, 0.9]);
  const line = stroke("line", [[0.4, 0.5], [0.6, 0.5]]);
  const hit = route.some((spot) => strokeHit(line, spot, 0.012));
  assert.equal(hit, true);
  assert.equal(pointsBetween([0, 0], [0, 0], 0.02).length, 1);
});

test("a single dot can be erased too", () => {
  const dot = stroke("dot", [[0.5, 0.5]]);
  assert.equal(strokeHit(dot, [0.502, 0.5], 0.005), true);
  assert.equal(strokeHit(dot, [0.6, 0.5], 0.005), false);
});

test("data read from storage is checked before it is drawn", () => {
  assert.deepEqual(sanitizeStrokes(null), []);
  assert.deepEqual(sanitizeStrokes("nope"), []);
  const result = sanitizeStrokes([
    stroke("ok", [[0, 0], [2, -1], ["x", 1], [0.5, 0.5]], { color: "#D32F2F" }),
    { id: "no-points", tool: "pen", color: "#111111", width: 0.004, points: [] },
    { id: "huge", tool: "pen", color: "#111111", width: 5, points: [[0, 0]] },
    { id: "bad-color", tool: "weird", color: "red; background: url(x)", width: 0.004, points: [[0.2, 0.2]] },
    null,
    "text"
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].points, [[0, 0], [1, 0], [0.5, 0.5]]); // out-of-range points are held inside the page, broken ones dropped
  assert.equal(result[0].color, "#D32F2F");
  assert.equal(result[1].tool, "pen");
  assert.equal(result[1].color, COLORS[0]);
});

test("ids are different each time", () => {
  assert.notEqual(newStrokeId(), newStrokeId());
});

test("undo and redo walk back and forward over drawing, erasing and clearing", () => {
  const pages = new Map();
  const history = createHistory();
  const a = stroke("a", [[0.1, 0.1], [0.2, 0.2]]);
  const b = stroke("b", [[0.3, 0.3], [0.4, 0.4]]);
  const c = stroke("c", [[0.5, 0.5], [0.6, 0.6]]);

  pages.set("p1", [a, b, c]);
  record(history, "p1", { type: "add", stroke: c });

  // the eraser removes a and c
  pages.set("p1", [b]);
  record(history, "p1", { type: "remove", items: [{ stroke: a, at: 0 }, { stroke: c, at: 2 }] });

  // clear page
  record(history, "p1", { type: "clear", items: [{ stroke: b, at: 0 }] });
  pages.set("p1", []);

  assert.equal(undo(history, pages), "p1");
  assert.deepEqual(pages.get("p1").map((item) => item.id), ["b"]);
  assert.equal(undo(history, pages), "p1");
  assert.deepEqual(pages.get("p1").map((item) => item.id), ["a", "b", "c"]); // back in the original order
  assert.equal(undo(history, pages), "p1");
  assert.deepEqual(pages.get("p1").map((item) => item.id), ["a", "b"]);
  assert.equal(undo(history, pages), null);

  assert.equal(redo(history, pages), "p1");
  assert.deepEqual(pages.get("p1").map((item) => item.id), ["a", "b", "c"]);
  assert.equal(redo(history, pages), "p1");
  assert.deepEqual(pages.get("p1").map((item) => item.id), ["b"]);
  assert.equal(redo(history, pages), "p1");
  assert.deepEqual(pages.get("p1"), []);
  assert.equal(redo(history, pages), null);
});

test("drawing something new drops what could have been redone", () => {
  const pages = new Map([["p", [stroke("a", [[0, 0]])]]]);
  const history = createHistory();
  record(history, "p", { type: "add", stroke: pages.get("p")[0] });
  undo(history, pages);
  assert.equal(history.redo.length, 1);
  record(history, "p", { type: "add", stroke: stroke("b", [[1, 1]]) });
  assert.equal(history.redo.length, 0);
});

test("undo works on the page that changed, even when several pages have notes", () => {
  const pages = new Map([
    ["p1", [stroke("a", [[0, 0]])]],
    ["p2", [stroke("b", [[0, 0]])]]
  ]);
  const history = createHistory();
  record(history, "p1", { type: "add", stroke: pages.get("p1")[0] });
  record(history, "p2", { type: "add", stroke: pages.get("p2")[0] });
  assert.equal(undo(history, pages), "p2");
  assert.equal(pages.get("p1").length, 1);
  assert.equal(pages.get("p2").length, 0);
});
