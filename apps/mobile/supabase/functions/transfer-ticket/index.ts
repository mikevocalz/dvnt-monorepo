/**
 * Transfer Ticket Edge Function
 *
 * POST /transfer-ticket
 * Actions:
 *   { action: "initiate", ticket_id, to_username }
 *   { action: "accept", transfer_id }
 *   { action: "decline", transfer_id }
 *   { action: "cancel", transfer_id }
 *
 * Transfers a ticket from one user to another with a 24h expiry.
 * - Initiate: creates a pending transfer, marks ticket as "transfer_pending"
 * - Accept: reassigns ticket to recipient, generates new QR token
 * - Decline/Cancel: reverts ticket to active
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { createSignedQrPayload } from "../_shared/hmac-qr.ts";
import { voidWalletPass } from "../_shared/wallet-push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

/**
 * Resolve auth_id → { intId, username, avatar } via the app users table.
 * Returns null if the auth_id has no app users row yet.
 */
async function lookupAppUser(
  supabase: any,
  authId: string,
): Promise<{ id: number; username: string | null; avatar: string | null } | null> {
  const { data } = await supabase
    .from("users")
    .select("id, username, avatar_id(url)")
    .eq("auth_id", authId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    username: data.username ?? null,
    avatar:
      (Array.isArray((data as any).avatar_id)
        ? (data as any).avatar_id[0]?.url
        : (data as any).avatar_id?.url) ?? null,
  };
}

/**
 * Send a push notification + insert in-app notification row.
 * Best-effort — failures are logged but don't break the calling action.
 */
async function notifyTransfer(
  supabase: any,
  params: {
    recipientIntId: number;
    senderIntId: number;
    senderUsername: string | null;
    senderAvatar: string | null;
    title: string;
    body: string;
    notificationType: string;
    entityId: string;
  },
): Promise<void> {
  try {
    // In-app notification feed entry
    await supabase.from("notifications").insert({
      recipient_id: params.recipientIntId,
      sender_id: params.senderIntId,
      type: params.notificationType,
      entity_type: "ticket_transfer",
      entity_id: params.entityId,
    });

    // Push
    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", params.recipientIntId);

    if (tokens && tokens.length > 0) {
      const messages = tokens.map((t: { token: string }) => ({
        to: t.token,
        title: params.title,
        body: params.body,
        data: {
          type: params.notificationType,
          senderId: String(params.senderIntId),
          senderUsername: params.senderUsername ?? undefined,
          senderAvatar: params.senderAvatar ?? undefined,
          entityType: "ticket_transfer",
          entityId: params.entityId,
          // Deep link to My Tickets where pending transfers are surfaced
          url: "https://dvntapp.live/my-tickets",
        },
        sound: "default",
        channelId: "default",
      }));

      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(messages),
      });
      console.log(
        `[transfer-ticket] Push sent to ${tokens.length} device(s) for ${params.notificationType}`,
      );
    }
  } catch (err) {
    console.warn("[transfer-ticket] notifyTransfer failed (non-fatal):", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const userId = await verifySession(supabase, req);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const { action, ticket_id, to_username, transfer_id } = await req.json();

    // ══════════════════════════════════════════════════════════
    // INITIATE TRANSFER
    // ══════════════════════════════════════════════════════════
    if (action === "initiate") {
      if (!ticket_id || !to_username) {
        return json({ error: "ticket_id and to_username required" }, 400);
      }

      // Verify ticket ownership
      const { data: ticket, error: ticketErr } = await supabase
        .from("tickets")
        .select("id, user_id, event_id, status")
        .eq("id", ticket_id)
        .single();

      if (ticketErr || !ticket) return json({ error: "Ticket not found" }, 404);
      if (ticket.user_id !== userId) {
        return json({ error: "You don't own this ticket" }, 403);
      }
      if (ticket.status !== "active") {
        return json(
          { error: `Cannot transfer ticket with status "${ticket.status}"` },
          400,
        );
      }

      // Check no pending transfer exists for this ticket
      const { data: existingTransfer } = await supabase
        .from("ticket_transfers")
        .select("id")
        .eq("ticket_id", ticket_id)
        .eq("status", "pending")
        .single();

      if (existingTransfer) {
        return json(
          { error: "This ticket already has a pending transfer" },
          409,
        );
      }

      // Resolve recipient by username
      const { data: recipient } = await supabase
        .from("user")
        .select("id")
        .eq("username", to_username.toLowerCase())
        .single();

      if (!recipient) {
        return json({ error: "User not found" }, 404);
      }

      if (recipient.id === userId) {
        return json({ error: "Cannot transfer to yourself" }, 400);
      }

      // Check recipient doesn't already have a ticket for this event
      const { data: recipientTicket } = await supabase
        .from("tickets")
        .select("id")
        .eq("event_id", ticket.event_id)
        .eq("user_id", recipient.id)
        .in("status", ["active", "scanned"])
        .limit(1)
        .single();

      if (recipientTicket) {
        return json(
          { error: "This user already has a ticket for this event" },
          409,
        );
      }

      // Mark ticket as transfer_pending to prevent scanning
      await supabase
        .from("tickets")
        .update({ status: "transfer_pending" })
        .eq("id", ticket_id);

      // Void sender's wallet pass (if any)
      await voidWalletPass(supabase, ticket_id);

      // Create transfer record
      const { data: transfer, error: createErr } = await supabase
        .from("ticket_transfers")
        .insert({
          ticket_id,
          from_user_id: userId,
          to_user_id: recipient.id,
          status: "pending",
        })
        .select("id, expires_at")
        .single();

      if (createErr) throw createErr;

      console.log(
        `[transfer-ticket] Transfer initiated: ${ticket_id} from ${userId} to ${recipient.id}`,
      );

      // Notify recipient — push + in-app feed entry
      const senderUser = await lookupAppUser(supabase, userId);
      const recipientUser = await lookupAppUser(supabase, recipient.id);
      if (senderUser && recipientUser) {
        const { data: eventRow } = await supabase
          .from("events")
          .select("title")
          .eq("id", ticket.event_id)
          .maybeSingle();
        const eventTitle = eventRow?.title ?? "an event";
        const senderHandle = senderUser.username
          ? `@${senderUser.username}`
          : "Someone";
        await notifyTransfer(supabase, {
          recipientIntId: recipientUser.id,
          senderIntId: senderUser.id,
          senderUsername: senderUser.username,
          senderAvatar: senderUser.avatar,
          title: "Ticket transfer pending",
          body: `${senderHandle} sent you a ticket for ${eventTitle}. Tap to accept.`,
          notificationType: "ticket_transfer_initiated",
          entityId: String(transfer.id),
        });
      }

      return json({
        transfer_id: transfer.id,
        expires_at: transfer.expires_at,
      });
    }

    // ══════════════════════════════════════════════════════════
    // ACCEPT TRANSFER
    // ══════════════════════════════════════════════════════════
    if (action === "accept") {
      if (!transfer_id) return json({ error: "transfer_id required" }, 400);

      const { data: transfer, error: tErr } = await supabase
        .from("ticket_transfers")
        .select("*, tickets(id, user_id, event_id, status)")
        .eq("id", transfer_id)
        .single();

      if (tErr || !transfer) return json({ error: "Transfer not found" }, 404);

      const ticket = (transfer as any).tickets;
      if (!ticket) return json({ error: "Associated ticket not found" }, 404);

      if (transfer.to_user_id !== userId) {
        return json({ error: "This transfer is not for you" }, 403);
      }
      if (transfer.status !== "pending") {
        return json({ error: `Transfer is ${transfer.status}` }, 400);
      }
      if (new Date(transfer.expires_at) < new Date()) {
        // Auto-expire and revert ticket to active
        await supabase
          .from("ticket_transfers")
          .update({ status: "expired", resolved_at: new Date().toISOString() })
          .eq("id", transfer_id);
        await supabase
          .from("tickets")
          .update({ status: "active" })
          .eq("id", ticket.id);
        return json({ error: "Transfer has expired" }, 400);
      }

      // Atomically claim the transfer (prevents concurrent accept race)
      const { data: claimed, error: claimErr } = await supabase
        .from("ticket_transfers")
        .update({ status: "accepted", resolved_at: new Date().toISOString() })
        .eq("id", transfer_id)
        .eq("status", "pending")
        .select("id")
        .single();

      if (claimErr || !claimed) {
        return json({ error: "Transfer already processed" }, 409);
      }

      // Generate new HMAC-signed QR token for security
      const { qrToken, qrPayload } = await createSignedQrPayload(
        ticket.id,
        ticket.event_id,
      );

      // Reassign ticket to recipient and reactivate
      // Clear wallet fields so new owner gets a fresh pass
      const { error: updateErr } = await supabase
        .from("tickets")
        .update({
          user_id: userId,
          status: "active",
          qr_token: qrToken,
          qr_payload: qrPayload,
          transferred_from: transfer.from_user_id,
          wallet_serial_number: null,
          wallet_auth_token: null,
          wallet_pass_type_id: null,
          wallet_voided_at: null,
          wallet_last_pushed_at: null,
        })
        .eq("id", ticket.id);

      if (updateErr) throw updateErr;

      console.log(
        `[transfer-ticket] Transfer accepted: ${ticket.id} now owned by ${userId}`,
      );

      // Notify sender — their transfer was accepted
      const senderApp = await lookupAppUser(supabase, transfer.from_user_id);
      const accepterApp = await lookupAppUser(supabase, userId);
      if (senderApp && accepterApp) {
        const accepterHandle = accepterApp.username
          ? `@${accepterApp.username}`
          : "The recipient";
        await notifyTransfer(supabase, {
          recipientIntId: senderApp.id,
          senderIntId: accepterApp.id,
          senderUsername: accepterApp.username,
          senderAvatar: accepterApp.avatar,
          title: "Ticket transfer accepted",
          body: `${accepterHandle} accepted your ticket.`,
          notificationType: "ticket_transfer_accepted",
          entityId: String(transfer_id),
        });
      }

      return json({
        success: true,
        ticket_id: ticket.id,
        qr_token: qrToken,
      });
    }

    // ══════════════════════════════════════════════════════════
    // DECLINE TRANSFER (recipient declines)
    // ══════════════════════════════════════════════════════════
    if (action === "decline") {
      if (!transfer_id) return json({ error: "transfer_id required" }, 400);

      const { data: transfer } = await supabase
        .from("ticket_transfers")
        .select("id, to_user_id, ticket_id, status")
        .eq("id", transfer_id)
        .single();

      if (!transfer) return json({ error: "Transfer not found" }, 404);
      if (transfer.to_user_id !== userId) {
        return json({ error: "This transfer is not for you" }, 403);
      }
      if (transfer.status !== "pending") {
        return json({ error: `Transfer is ${transfer.status}` }, 400);
      }

      // Atomically claim decline (prevents race with concurrent accept)
      const { data: declined, error: declineErr } = await supabase
        .from("ticket_transfers")
        .update({ status: "declined", resolved_at: new Date().toISOString() })
        .eq("id", transfer_id)
        .eq("status", "pending")
        .select("id")
        .single();

      if (declineErr || !declined) {
        return json({ error: "Transfer already processed" }, 409);
      }

      // Revert ticket to active so sender can use it
      await supabase
        .from("tickets")
        .update({ status: "active" })
        .eq("id", transfer.ticket_id);

      console.log(`[transfer-ticket] Transfer declined: ${transfer_id}`);

      // Notify sender — their transfer was declined
      const { data: declineTransferRow } = await supabase
        .from("ticket_transfers")
        .select("from_user_id, to_user_id")
        .eq("id", transfer_id)
        .single();
      if (declineTransferRow) {
        const senderApp = await lookupAppUser(
          supabase,
          declineTransferRow.from_user_id,
        );
        const declinerApp = await lookupAppUser(
          supabase,
          declineTransferRow.to_user_id,
        );
        if (senderApp && declinerApp) {
          const declinerHandle = declinerApp.username
            ? `@${declinerApp.username}`
            : "The recipient";
          await notifyTransfer(supabase, {
            recipientIntId: senderApp.id,
            senderIntId: declinerApp.id,
            senderUsername: declinerApp.username,
            senderAvatar: declinerApp.avatar,
            title: "Ticket transfer declined",
            body: `${declinerHandle} declined your ticket. It's back in your wallet.`,
            notificationType: "ticket_transfer_declined",
            entityId: String(transfer_id),
          });
        }
      }

      return json({ success: true });
    }

    // ══════════════════════════════════════════════════════════
    // CANCEL TRANSFER (sender cancels)
    // ══════════════════════════════════════════════════════════
    if (action === "cancel") {
      if (!transfer_id) return json({ error: "transfer_id required" }, 400);

      const { data: transfer } = await supabase
        .from("ticket_transfers")
        .select("id, from_user_id, ticket_id, status")
        .eq("id", transfer_id)
        .single();

      if (!transfer) return json({ error: "Transfer not found" }, 404);
      if (transfer.from_user_id !== userId) {
        return json({ error: "Only the sender can cancel" }, 403);
      }
      if (transfer.status !== "pending") {
        return json({ error: `Transfer is ${transfer.status}` }, 400);
      }

      // Atomically claim cancel (prevents race with concurrent accept)
      const { data: cancelled, error: cancelErr } = await supabase
        .from("ticket_transfers")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("id", transfer_id)
        .eq("status", "pending")
        .select("id")
        .single();

      if (cancelErr || !cancelled) {
        return json({ error: "Transfer already processed" }, 409);
      }

      // Revert ticket to active so sender can use it
      await supabase
        .from("tickets")
        .update({ status: "active" })
        .eq("id", transfer.ticket_id);

      console.log(`[transfer-ticket] Transfer cancelled: ${transfer_id}`);

      // Notify recipient — the transfer was cancelled by sender
      const { data: cancelTransferRow } = await supabase
        .from("ticket_transfers")
        .select("from_user_id, to_user_id")
        .eq("id", transfer_id)
        .single();
      if (cancelTransferRow) {
        const senderApp = await lookupAppUser(
          supabase,
          cancelTransferRow.from_user_id,
        );
        const recipientApp = await lookupAppUser(
          supabase,
          cancelTransferRow.to_user_id,
        );
        if (senderApp && recipientApp) {
          const senderHandle = senderApp.username
            ? `@${senderApp.username}`
            : "Someone";
          await notifyTransfer(supabase, {
            recipientIntId: recipientApp.id,
            senderIntId: senderApp.id,
            senderUsername: senderApp.username,
            senderAvatar: senderApp.avatar,
            title: "Ticket transfer cancelled",
            body: `${senderHandle} cancelled the ticket transfer.`,
            notificationType: "ticket_transfer_cancelled",
            entityId: String(transfer_id),
          });
        }
      }

      return json({ success: true });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (err: any) {
    console.error("[transfer-ticket] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
