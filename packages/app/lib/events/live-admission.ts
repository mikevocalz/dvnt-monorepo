/** Read-only classification for the live admission feed. A legacy ticket row
 * can be stamped admission while its joined tier is a separately sold service. */
export function isLiveAdmission(row: {
  category?: string | null;
  ticket_type_id?: string | null;
  ticket_types?: { category?: string | null } | { category?: string | null }[] | null;
}): boolean {
  const tier = Array.isArray(row.ticket_types) ? row.ticket_types[0] : row.ticket_types;
  if (tier) return tier.category == null || tier.category === "admission";
  // Untyped legacy admission is still entry; a missing typed join is unverified.
  return row.ticket_type_id == null && row.category === "admission";
}
