/** Deny-only routing for event-money paths not implemented by the new ledger.
 * Never selects a different rail or mutates a payment. Cohort cutovers still
 * require quiescing/draining already admitted legacy requests.
 */
export async function legacyEventCheckoutAllowed(db: any, eventId: unknown): Promise<boolean> {
  if (typeof eventId !== "number" && typeof eventId !== "string") return false;
  const id = Number(eventId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  try {
    const { data, error } = await db.rpc("settlement_checkout_route", { p_event_id: id });
    return !error && data?.ok === true && data.charge_model === "destination_charge";
  } catch { return false; }
}
export const LEGACY_EVENT_CHECKOUT_PAUSED = {
  error: "This payment path is paused for this event. Check any existing payment before trying again.",
  code: "event_checkout_paused",
};
