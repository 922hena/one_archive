import test from "node:test";
import assert from "node:assert/strict";
import { connectPlan, insertInOrder, moveItem, partNumber, sortedParts, withOrder } from "../js/music-parts.js";

const roles = [
  { id: "entrance", slot_no: 1 },
  { id: "gloria", slot_no: 3 },
  { id: "communion", slot_no: 14 },
  { id: "post_communion", slot_no: 15 },
  { id: "meditation", slot_no: 16 },
  { id: "recessional", slot_no: 17 }
];
const roleById = new Map(roles.map((role) => [role.id, role]));

test("saved items follow sort_order; items without one follow the official order", () => {
  const items = [
    { role_id: "recessional", sort_order: 0 },
    { role_id: "communion", sort_order: 2 },
    { role_id: "entrance", sort_order: 0 },
    { role_id: "meditation", sort_order: 1 }
  ];
  assert.deepEqual(sortedParts(items, roleById).map((item) => item.role_id), ["meditation", "communion", "entrance", "recessional"]);
  assert.deepEqual(sortedParts(null, roleById), []);
});

test("numbers are places in the selection, with no gaps", () => {
  assert.deepEqual([0, 1, 9].map(partNumber), ["01", "02", "10"]);
  const saved = withOrder([{ role_id: "entrance" }, { role_id: "communion" }, { role_id: "recessional" }]);
  assert.deepEqual(saved.map((item) => item.sort_order), [1, 2, 3]);
});

test("a newly ticked part goes where the official order puts it", () => {
  assert.deepEqual(insertInOrder(["entrance", "communion"], "gloria", roleById), ["entrance", "gloria", "communion"]);
  assert.deepEqual(insertInOrder(["entrance"], "recessional", roleById), ["entrance", "recessional"]);
  assert.deepEqual(insertInOrder([], "meditation", roleById), ["meditation"]);
  // after the member moved things, it still lands before the first part that officially comes later
  assert.deepEqual(insertInOrder(["communion", "entrance"], "meditation", roleById), ["communion", "entrance", "meditation"]);
  assert.deepEqual(insertInOrder(["entrance"], "entrance", roleById), ["entrance"]);
});

test("moving up and down swaps neighbours and ignores moves past the ends", () => {
  const order = ["a", "b", "c"];
  assert.deepEqual(moveItem(order, 2, -1), ["a", "c", "b"]);
  assert.deepEqual(moveItem(order, 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(order, 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveItem(order, 2, 1), ["a", "b", "c"]);
  assert.deepEqual(order, ["a", "b", "c"]);
});

const layoutItems = [
  { role_id: "entrance", display_name: null },
  { role_id: "communion", display_name: "Communio" },
  { role_id: "meditation", display_name: null }
];

test("connecting to a Missa without parts gives it the selection in order", () => {
  const plan = connectPlan([], layoutItems, "replace", roleById);
  assert.deepEqual(plan.items, [
    { role_id: "entrance", display_name: null, sort_order: 1 },
    { role_id: "communion", display_name: "Communio", sort_order: 2 },
    { role_id: "meditation", display_name: null, sort_order: 3 }
  ]);
  assert.deepEqual(plan.added, ["entrance", "communion", "meditation"]);
});

const existing = [
  { role_id: "gloria", display_name: "Gloria (Missa brevis)", sort_order: 1, linked: true },
  { role_id: "entrance", display_name: "Introitus", sort_order: 2, linked: false },
  { role_id: "recessional", display_name: null, sort_order: 3, linked: false }
];

test("replace uses the selection, keeps parts with linked Scores at the end and removes the rest", () => {
  const plan = connectPlan(existing, layoutItems, "replace", roleById);
  assert.deepEqual(plan.items.map((item) => [item.role_id, item.sort_order]), [
    ["entrance", 1],
    ["communion", 2],
    ["meditation", 3],
    ["gloria", 4]
  ]);
  assert.equal(plan.items[0].display_name, null);
  assert.equal(plan.items[3].display_name, "Gloria (Missa brevis)");
  assert.deepEqual(plan.kept, ["gloria"]);
  assert.deepEqual(plan.removed, ["recessional"]);
  assert.deepEqual(plan.added, ["communion", "meditation"]);
});

test("add keeps the Missa's parts and names and appends only the missing ones", () => {
  const plan = connectPlan(existing, layoutItems, "add", roleById);
  assert.deepEqual(plan.items.map((item) => [item.role_id, item.display_name, item.sort_order]), [
    ["gloria", "Gloria (Missa brevis)", 1],
    ["entrance", "Introitus", 2],
    ["recessional", null, 3],
    ["communion", "Communio", 4],
    ["meditation", null, 5]
  ]);
  assert.deepEqual(plan.removed, []);
  assert.deepEqual(plan.kept, []);
  assert.deepEqual(plan.added, ["communion", "meditation"]);
});

test("add with nothing new changes nothing", () => {
  const plan = connectPlan(existing, [{ role_id: "entrance", display_name: null }], "add", roleById);
  assert.deepEqual(plan.added, []);
  assert.deepEqual(plan.items.map((item) => item.role_id), ["gloria", "entrance", "recessional"]);
});
