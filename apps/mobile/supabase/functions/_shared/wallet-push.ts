/**
 * Shared helper: Push update notifications to Apple Wallet devices.
 *
 * When a ticket's status changes (refund, cancel, transfer, event update),
 * this helper marks the pass as updated (or voided) and sends APNs push
 * notifications to all registered devices so they fetch the latest pass.
 *
 * Usage in edge functions:
 *   import { voidWalletPass, notifyWalletPassUpdate } from "../_shared/wallet-push.ts";
 *   await voidWalletPass(supabase, ticketId);
 *   await notifyWalletPassUpdate(supabase, ticketId);
 */

/**
 * Mark a wallet pass as voided. Called when a ticket is refunded, cancelled,
 * or transferred away from the current owner.
 *
 * This sets wallet_voided_at and wallet_last_pushed_at on the ticket.
 * When Apple's device checks for updates, the web service returns 410 Gone
 * and the pass is removed from the user's wallet.
 */
export async function voidWalletPass(
  supabase: any,
  ticketId: string,
): Promise<void> {
  const now = new Date().toISOString();

  // Get the ticket's wallet info
  const { data: ticket } = await supabase
    .from("tickets")
    .select("wallet_serial_number, wallet_pass_type_id")
    .eq("id", ticketId)
    .single();

  if (!ticket?.wallet_serial_number) {
    // No wallet pass exists for this ticket
    return;
  }

  // Mark the pass as voided
  await supabase
    .from("tickets")
    .update({
      wallet_voided_at: now,
      wallet_last_pushed_at: now,
    })
    .eq("id", ticketId);

  // Send push notifications to registered devices
  await pushToRegisteredDevices(
    supabase,
    ticket.wallet_serial_number,
    ticket.wallet_pass_type_id,
  );

  console.log(
    `[wallet-push] Voided wallet pass for ticket ${ticketId}, serial ${ticket.wallet_serial_number}`,
  );
}

/**
 * Notify registered devices that a pass has been updated (not voided).
 * Called when event details change (title, date, venue, etc.).
 */
export async function notifyWalletPassUpdate(
  supabase: any,
  ticketId: string,
): Promise<void> {
  const now = new Date().toISOString();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("wallet_serial_number, wallet_pass_type_id, wallet_voided_at")
    .eq("id", ticketId)
    .single();

  if (!ticket?.wallet_serial_number || ticket.wallet_voided_at) {
    return;
  }

  // Update the last pushed timestamp so the web service includes this serial
  // in the "updated since" response
  await supabase
    .from("tickets")
    .update({ wallet_last_pushed_at: now })
    .eq("id", ticketId);

  await pushToRegisteredDevices(
    supabase,
    ticket.wallet_serial_number,
    ticket.wallet_pass_type_id,
  );

  console.log(
    `[wallet-push] Notified update for ticket ${ticketId}, serial ${ticket.wallet_serial_number}`,
  );
}

/**
 * Batch void all wallet passes for tickets on a given event.
 * Called when an event is cancelled.
 */
export async function voidAllEventPasses(
  supabase: any,
  eventId: number,
): Promise<void> {
  const now = new Date().toISOString();

  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, wallet_serial_number, wallet_pass_type_id")
    .eq("event_id", eventId)
    .not("wallet_serial_number", "is", null)
    .is("wallet_voided_at", null);

  if (!tickets || tickets.length === 0) return;

  // Batch update
  const ticketIds = tickets.map((t: any) => t.id);
  await supabase
    .from("tickets")
    .update({
      wallet_voided_at: now,
      wallet_last_pushed_at: now,
    })
    .in("id", ticketIds);

  // Push to all registered devices
  for (const ticket of tickets) {
    if (ticket.wallet_serial_number) {
      await pushToRegisteredDevices(
        supabase,
        ticket.wallet_serial_number,
        ticket.wallet_pass_type_id,
      );
    }
  }

  console.log(
    `[wallet-push] Voided ${tickets.length} wallet passes for event ${eventId}`,
  );
}

/**
 * Batch notify all wallet passes for tickets on a given event.
 * Called when event details (title, date, venue) change.
 */
export async function notifyAllEventPassUpdates(
  supabase: any,
  eventId: number,
): Promise<void> {
  const now = new Date().toISOString();

  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, wallet_serial_number, wallet_pass_type_id")
    .eq("event_id", eventId)
    .not("wallet_serial_number", "is", null)
    .is("wallet_voided_at", null);

  if (!tickets || tickets.length === 0) return;

  const ticketIds = tickets.map((t: any) => t.id);
  await supabase
    .from("tickets")
    .update({ wallet_last_pushed_at: now })
    .in("id", ticketIds);

  for (const ticket of tickets) {
    if (ticket.wallet_serial_number) {
      await pushToRegisteredDevices(
        supabase,
        ticket.wallet_serial_number,
        ticket.wallet_pass_type_id,
      );
    }
  }

  console.log(
    `[wallet-push] Notified ${tickets.length} wallet passes for event ${eventId}`,
  );
}

// ── APNs Push ───────────────────────────────────────────────────────
// Apple Wallet devices register with a push token.
// When we send an empty push to that token, the device fetches the
// latest pass from our web service endpoint.
//
// This requires APNs credentials. For now, we log the intent.
// When APNs is configured, replace with actual HTTP/2 push.

async function pushToRegisteredDevices(
  supabase: any,
  serialNumber: string,
  passTypeId: string,
): Promise<void> {
  const { data: registrations } = await supabase
    .from("wallet_registrations")
    .select("device_library_id, push_token")
    .eq("serial_number", serialNumber)
    .eq("pass_type_id", passTypeId);

  if (!registrations || registrations.length === 0) {
    console.log(
      `[wallet-push] No registered devices for serial ${serialNumber}`,
    );
    return;
  }

  // TODO: When APNs is configured (APPLE_APNS_KEY_ID, APPLE_APNS_TEAM_ID,
  // APPLE_APNS_KEY_PEM), send HTTP/2 push notifications to each device.
  //
  // For each registration:
  //   POST https://api.push.apple.com/3/device/{pushToken}
  //   Headers:
  //     apns-topic: {passTypeId}
  //     apns-push-type: background
  //     authorization: bearer {jwt}
  //   Body: {} (empty)
  //
  // Apple will then call our web service to fetch the updated pass.

  console.log(
    `[wallet-push] Would push to ${registrations.length} device(s) for serial ${serialNumber}`,
  );

  for (const reg of registrations) {
    console.log(
      `[wallet-push]   Device: ${reg.device_library_id}, token: ${reg.push_token?.slice(0, 16)}...`,
    );
  }
}
