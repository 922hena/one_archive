// Only "table or column not created yet". Other errors must reach the screen.
const MISSING_RELATION_CODES = new Set(["42P01", "42703", "PGRST200", "PGRST204", "PGRST205"]);

export function isMissingRelation(error) {
  return MISSING_RELATION_CODES.has(String(error?.code ?? ""));
}
