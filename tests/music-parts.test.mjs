import test from "node:test";
import assert from "node:assert/strict";
import * as musicParts from "../js/music-parts.js";

const { connectPlan, partNumber, sortedParts, withOrder } = musicParts;

const roles = [
  { id: "entrance", slot_no: 1 },
  { id: "gloria", slot_no: 3 },
  { id: "communion", slot_no: 14 },
  { id: "post_communion", slot_no: 15 },
  { id: "meditation", slot_no: 16 },
  { id: "recessional", slot_no: 17 }
];
const roleById = new Map(roles.map((role) => [role.id, role]));

test("saved items always follow the official order, whatever sort_order says", () => {
  const items = [
    { role_id: "recessional", sort_order: 0 },
    { role_id: "communion", sort_order: 2 },
    { role_id: "entrance", sort_order: 0 },
    { role_id: "meditation", sort_order: 1 }
  ];
  assert.deepEqual(sortedParts(items, roleById).map((item) => item.role_id), ["entrance", "communion", "meditation", "recessional"]);
  assert.deepEqual(sortedParts(null, roleById), []);
});

test("there is no way to reorder parts", () => {
  assert.equal(musicParts.moveItem, undefined);
  assert.equal(musicParts.insertInOrder, undefined);
});

test("numbers are places in the selection, with no gaps", () => {
  assert.deepEqual([0, 1, 9].map(partNumber), ["01", "02", "10"]);
  const saved = withOrder([{ role_id: "entrance" }, { role_id: "communion" }, { role_id: "recessional" }]);
  assert.deepEqual(saved.map((item) => item.sort_order), [1, 2, 3]);
});

const layoutItems = [
  { role_id: "entrance", display_name: null },
  { role_id: "communion", display_name: "Communio" },
  { role_id: "meditation", display_name: null }
];

test("connecting to a Missa without parts gives it the selection in the official order", () => {
  const plan = connectPlan([], layoutItems, "replace", roleById);
  assert.deepEqual(plan.items, [
    { role_id: "entrance", display_name: null, sort_order: 1 },
    { role_id: "communion", display_name: "Communio", sort_order: 2 },
    { role_id: "meditation", display_name: null, sort_order: 3 }
  ]);
  assert.deepEqual(plan.added, ["entrance", "communion", "meditation"]);
  const shuffled = connectPlan([], [...layoutItems].reverse(), "replace", roleById);
  assert.deepEqual(shuffled.items.map((item) => [item.role_id, item.sort_order]), [
    ["entrance", 1],
    ["communion", 2],
    ["meditation", 3]
  ]);
});

const existing = [
  { role_id: "gloria", display_name: "Gloria (Missa brevis)", sort_order: 1, linked: true },
  { role_id: "entrance", display_name: "Introitus", sort_order: 2, linked: false },
  { role_id: "recessional", display_name: null, sort_order: 3, linked: false }
];

test("replace uses the selection, keeps parts with linked Scores in their official place and removes the rest", () => {
  const plan = connectPlan(existing, layoutItems, "replace", roleById);
  assert.deepEqual(plan.items.map((item) => [item.role_id, item.sort_order]), [
    ["entrance", 1],
    ["gloria", 2],
    ["communion", 3],
    ["meditation", 4]
  ]);
  assert.equal(plan.items[0].display_name, null);
  assert.equal(plan.items[1].display_name, "Gloria (Missa brevis)");
  assert.deepEqual(plan.kept, ["gloria"]);
  assert.deepEqual(plan.removed, ["recessional"]);
  assert.deepEqual(plan.added, ["communion", "meditation"]);
});

test("add keeps the Missa's parts and names and adds only the missing ones, in the official order", () => {
  const plan = connectPlan(existing, layoutItems, "add", roleById);
  assert.deepEqual(plan.items.map((item) => [item.role_id, item.display_name, item.sort_order]), [
    ["entrance", "Introitus", 1],
    ["gloria", "Gloria (Missa brevis)", 2],
    ["communion", "Communio", 3],
    ["meditation", null, 4],
    ["recessional", null, 5]
  ]);
  assert.deepEqual(plan.removed, []);
  assert.deepEqual(plan.kept, []);
  assert.deepEqual(plan.added, ["communion", "meditation"]);
});

test("add with nothing new changes nothing", () => {
  const plan = connectPlan(existing, [{ role_id: "entrance", display_name: null }], "add", roleById);
  assert.deepEqual(plan.added, []);
  assert.deepEqual(plan.items.map((item) => item.role_id), ["entrance", "gloria", "recessional"]);
});
