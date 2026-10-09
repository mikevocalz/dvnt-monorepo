/**
 * The add-ons a ticket holder sees with their ticket.
 *
 * Scope: rows bound to this ticket (order_addons.ticket_id, set at issuance
 * since migration 20261009100200 and carried by transfer-ticket), plus rows
 * on the same cart that are bound to no ticket (issued before ticket_id was
 * set) and owned by the ticket's current holder. A row bound to a DIFFERENT
 * ticket is left out, so one attendee in a
 * group order never sees, or can redeem, another attendee's add-on QR.
 */

export type HolderAddon = {
  id: string;
  name: string;
  variantName: string | null;
  quantity: number;
  status: string;
  isRedeemable: boolean;
  qrToken: string | null;
  qrPayload: string | null;
};

const SELECT =
  "id, ticket_id, quantity, status, qr_token, qr_payload, ticket_addons(name, is_redeemable), ticket_addon_variants(name)";

// deno-lint-ignore no-explicit-any
const first = (value: any) => (Array.isArray(value) ? value[0] : value);

export async function loadTicketAddons(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ticket: {
    id: string;
    cart_id?: string | null;
    user_id?: string | null;
    guest_email?: string | null;
  },
): Promise<HolderAddon[]> {
  // Unbound rows on the cart count only while they belong to the ticket's
  // current holder: after a transfer the sender's unbound rows stay theirs.
  // Values are double-quoted so an email's `+` or `,` cannot break the filter.
  const owner = ticket.user_id
    ? `user_id.eq."${String(ticket.user_id).replace(/"/g, "")}"`
    : ticket.guest_email
      ? `guest_email.eq."${String(ticket.guest_email).replace(/"/g, "")}"`
      : null;
  const filter = ticket.cart_id && owner
    ? `ticket_id.eq.${ticket.id},and(cart_id.eq.${ticket.cart_id},ticket_id.is.null,${owner})`
    : `ticket_id.eq.${ticket.id}`;
  const { data, error } = await supabase
    .from("order_addons")
    .select(SELECT)
    .or(filter)
    .order("created_at", { ascending: true });
  if (error) throw error;

  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((row: any) => {
    const addon = first(row.ticket_addons);
    const variant = first(row.ticket_addon_variants);
    return {
      id: String(row.id),
      name: addon?.name ?? "Add-on",
      variantName: variant?.name ?? null,
      quantity: Number(row.quantity || 1),
      status: String(row.status),
      isRedeemable: !!addon?.is_redeemable,
      qrToken: row.qr_token ?? null,
      qrPayload: row.qr_payload ?? null,
    };
  });
}

/**
 * One line per add-on the holder can still use, units summed:
 * "3 × Drink ticket (Large)". Redeemed and refunded rows are left out.
 * A wallet pass carries a single barcode, so this text is how the pass
 * shows add-ons; the codes themselves are in the app and the guest page.
 */
export function addonPassLines(addons: HolderAddon[]): string[] {
  const totals = new Map<string, number>();
  for (const addon of addons) {
    if (addon.status !== "unfulfilled" && addon.status !== "fulfilled") continue;
    const label = addon.variantName ? `${addon.name} (${addon.variantName})` : addon.name;
    totals.set(label, (totals.get(label) ?? 0) + addon.quantity);
  }
  return [...totals].map(([label, quantity]) => `${quantity} × ${label}`);
}
