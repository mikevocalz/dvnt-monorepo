/**
 * Only benefits explicitly stored on this ticket type may appear in an upgrade.
 * `ticket_types.perks` is an existing JSONB column returned by getByEvent; older
 * rows may omit it. Never infer promises from a tier name, price, or event-wide
 * perks. The organizer's ticket description is displayed separately.
 */
export function ticketUpgradeBenefits(tier: object | null | undefined): string[] {
  if (!tier || !("perks" in tier) || !Array.isArray(tier.perks)) return [];

  const benefits = tier.perks.flatMap((perk: unknown) => {
    // Existing event detail supports strings and legacy { label } / { text }
    // records. Accept only explicit text, never stringify arbitrary JSON.
    let value: unknown = perk;
    if (typeof perk === "object" && perk !== null) {
      value =
        "label" in perk && typeof perk.label === "string"
          ? perk.label
          : "text" in perk
            ? perk.text
            : undefined;
    }
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  });

  return [...new Set(benefits)];
}
