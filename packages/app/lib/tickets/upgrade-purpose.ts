/** Legacy payloads may omit category; the schema defaults it to admission.
 * Unknown values fail closed. Services/add-ons are separate purchases, not upgrades.
 */
export function isAdmissionUpgradeCategory(category?: string | null): boolean {
  return (category ?? "admission") === "admission";
}

export function isAdmissionUpgradeSource(
  ticket: { category?: string | null; ticket_type_id?: string | null } | null | undefined,
  tiers: ReadonlyArray<{ id: string; category?: string | null }>,
): boolean {
  if (!ticket || !isAdmissionUpgradeCategory(ticket.category)) return false;
  if (!ticket.ticket_type_id) return true; // Legacy untiered admission.
  const source = tiers.find((tier) => String(tier.id) === String(ticket.ticket_type_id));
  return !!source && isAdmissionUpgradeCategory(source.category);
}
