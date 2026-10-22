// PRD decision D1: from the day after the Missa (Korea time), its linked songs count as played,
// unless the Missa is cancelled or the song is marked "Not played". Same rule as the view performed_entries.
export function countsAsPlayed(mass, today) {
  const date = String(mass?.local_date ?? "");
  return Boolean(date) && date < today && mass?.status !== "cancelled";
}

export function entryPlayed(mass, entry, today) {
  return countsAsPlayed(mass, today) && Boolean(entry) && !entry.not_played_at;
}

export function playedEntries(mass, today) {
  if (!countsAsPlayed(mass, today)) return [];
  return (mass?.mass_music_slots ?? [])
    .flatMap((slot) => slot.mass_music_entries ?? [])
    .filter((entry) => !entry.not_played_at);
}
