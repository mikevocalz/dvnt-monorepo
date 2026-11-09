/** Adult event types are always Spicy, including legacy human-readable labels. */
export function isSpicyEventType(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return ["bate_session", "kink_fetish_party", "kink_play_party", "sex_party", "glory_hole", "cruising", "cum_dump"].includes(normalized);
}
