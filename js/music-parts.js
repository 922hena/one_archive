// Pure helpers for Music Parts selections (no browser APIs, so they can be tested).
// Parts always follow the official order (liturgical_roles.slot_no); members only choose which parts they use.
// The number shown (1, 2, 3 ...) is the place among the chosen parts.

const slotOf = (roleById, roleId) => roleById.get(roleId)?.slot_no ?? 99;

// Saved items in the official order.
export function sortedParts(items, roleById) {
  return [...(items ?? [])].sort(
    (a, b) => slotOf(roleById, a.role_id) - slotOf(roleById, b.role_id) || (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
}

// "01", "02" ... for the place among the chosen parts (not the official slot number).
export function partNumber(index) {
  return String(index + 1).padStart(2, "0");
}

// Items to save: only what is chosen, numbered 1..n in the order given.
export function withOrder(items) {
  return items.map((item, index) => ({ ...item, sort_order: index + 1 }));
}

// Connecting a saved selection to a Missa.
// existing: the Missa's slots [{ role_id, display_name, sort_order, linked }] (linked = has scores)
// layoutItems: the selection [{ role_id, display_name }]
// mode "replace": the Missa gets the selection. Items with linked scores are never removed: they stay.
// mode "add": the Missa keeps what it has and gets the selection's other items.
// Either way the result is in the official order.
export function connectPlan(existing, layoutItems, mode, roleById = new Map()) {
  const current = sortedParts(existing, roleById);
  const inLayout = new Set(layoutItems.map((item) => item.role_id));
  const have = new Map(current.map((slot) => [slot.role_id, slot]));
  let items;
  let removed = [];
  let kept = [];
  let added;
  if (mode === "replace") {
    kept = current.filter((slot) => slot.linked && !inLayout.has(slot.role_id)).map((slot) => slot.role_id);
    removed = current.filter((slot) => !slot.linked && !inLayout.has(slot.role_id)).map((slot) => slot.role_id);
    added = layoutItems.filter((item) => !have.has(item.role_id)).map((item) => item.role_id);
    items = [
      ...layoutItems.map((item) => ({ role_id: item.role_id, display_name: item.display_name || null })),
      ...kept.map((roleId) => ({ role_id: roleId, display_name: have.get(roleId).display_name ?? null }))
    ];
  } else {
    added = layoutItems.filter((item) => !have.has(item.role_id)).map((item) => item.role_id);
    items = [
      ...current.map((slot) => ({ role_id: slot.role_id, display_name: slot.display_name ?? null })),
      ...layoutItems.filter((item) => !have.has(item.role_id)).map((item) => ({ role_id: item.role_id, display_name: item.display_name || null }))
    ];
  }
  return { items: withOrder(sortedParts(items, roleById)), added, removed, kept };
}
