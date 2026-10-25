// Pure helpers for Music Parts selections (no browser APIs, so they can be tested).
// The official list (liturgical_roles, ordered by slot_no) is never changed here. A member's selection
// keeps its own order in sort_order; the number shown (1, 2, 3 ...) is only the place in that order.

const slotOf = (roleById, roleId) => roleById.get(roleId)?.slot_no ?? 99;

// Saved items in the member's order. Rows saved before there was an order (sort_order 0) follow the official order.
export function sortedParts(items, roleById) {
  return [...(items ?? [])].sort((a, b) => {
    const ao = a.sort_order > 0 ? a.sort_order : Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order > 0 ? b.sort_order : Number.MAX_SAFE_INTEGER;
    return ao - bo || slotOf(roleById, a.role_id) - slotOf(roleById, b.role_id);
  });
}

// "01", "02" ... for the place in the selection (not the official slot number).
export function partNumber(index) {
  return String(index + 1).padStart(2, "0");
}

// A newly ticked item goes where the official order puts it among the items already chosen.
export function insertInOrder(order, roleId, roleById) {
  if (order.includes(roleId)) return [...order];
  const slot = slotOf(roleById, roleId);
  const at = order.findIndex((id) => slotOf(roleById, id) > slot);
  const next = [...order];
  next.splice(at < 0 ? next.length : at, 0, roleId);
  return next;
}

// Moves one item up (step -1) or down (step 1). Out-of-range moves change nothing.
export function moveItem(order, index, step) {
  const target = index + step;
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Items to save: only what is chosen, numbered 1..n in the chosen order.
export function withOrder(items) {
  return items.map((item, index) => ({ ...item, sort_order: index + 1 }));
}

// Connecting a saved selection to a Missa.
// existing: the Missa's slots [{ role_id, display_name, sort_order, linked }] (linked = has scores)
// layoutItems: the selection in its order [{ role_id, display_name }]
// mode "replace": the Missa gets the selection. Items with linked scores are never removed: they stay, after it.
// mode "add": the Missa keeps what it has and gets the selection's other items after it.
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
  return { items: withOrder(items), added, removed, kept };
}
