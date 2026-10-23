// Pure helpers for Performance Mode (no browser APIs, so they can be tested).
// A "song" is one linked score in a Missa's Music list: { key, number, label, score, files }.

function roleName(role) {
  if (!role) return "";
  return role.name_la || role.name_en || role.name_ko || "";
}

// Songs in the order of the Missa: Music Part order (liturgical slot_no), then link order.
// Links whose score has no file are left out, because there is nothing to show.
export function setlistFromMass(mass, roles = []) {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const slots = [...(mass?.mass_music_slots ?? [])].sort(
    (a, b) => (roleById.get(a.role_id)?.slot_no ?? 99) - (roleById.get(b.role_id)?.slot_no ?? 99)
  );
  const songs = [];
  for (const slot of slots) {
    const role = roleById.get(slot.role_id);
    const entries = [...(slot.mass_music_entries ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
    );
    for (const entry of entries) {
      const files = entry.owned_scores?.score_files ?? [];
      if (!entry.owned_scores || !files.length) continue;
      songs.push({
        key: entry.id,
        number: String((role?.slot_no ?? 0) + 1).padStart(2, "0"),
        label: slot.display_name || roleName(role) || "",
        score: entry.owned_scores,
        files
      });
    }
  }
  return songs;
}

// Number of linked scores in a Missa (used by the date screen, which only has link ids).
export function linkedCount(mass) {
  return (mass?.mass_music_slots ?? []).reduce((sum, slot) => sum + (slot.mass_music_entries?.length ?? 0), 0);
}

// counts[i] = pages of song i once loaded (undefined while loading). Songs load in order,
// so a song's first page is the sum of the songs before it.
export function songStarts(counts) {
  const starts = [];
  let sum = 0;
  for (const count of counts) {
    if (count === undefined) break;
    starts.push(sum);
    sum += count;
  }
  return starts;
}

// Which song and which page of it a global page index (0-based) belongs to.
export function locatePage(counts, index) {
  const starts = songStarts(counts);
  for (let song = starts.length - 1; song >= 0; song -= 1) {
    if (index >= starts[song]) return { song, page: index - starts[song] };
  }
  return { song: 0, page: 0 };
}
