/** Category controls entitlement; admission tier/style is not a service type.
 * Keep legacy admission defaults for missing categories, never infer from names.
 * Existing rows may retain tier_type='ga' because the DB enum only describes
 * admission tiers. A service/product must not expose that as its classification.
 */
export function isAdmissionCategory(category?: string | null): boolean {
  return category !== "service" && category !== "product" && category !== "coat_check";
}

export function ticketCategoryLabel(category?: string | null): string {
  if (category === "coat_check") return "Coat check";
  if (category === "service") return "Service";
  if (category === "product") return "Add-on";
  return "Admission";
}

export function ticketTierBadge(category?: string | null, tier?: string | null): string {
  return isAdmissionCategory(category)
    ? (tier || "ga").replaceAll("_", " ").toUpperCase()
    : ticketCategoryLabel(category).toUpperCase();
}

export function defaultTicketTypeName(category?: string | null): string {
  return isAdmissionCategory(category) ? "General Admission" : ticketCategoryLabel(category);
}

/** Door actions require explicit admission evidence, unlike legacy display defaults. */
export function hasAdmissionPurpose(category?: string | null): boolean {
  return category === "admission";
}
