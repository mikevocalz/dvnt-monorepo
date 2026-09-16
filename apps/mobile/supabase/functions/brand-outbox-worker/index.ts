/**
 * brand-outbox-worker Edge Function
 *
 * POST /brand-outbox-worker   (cron only, x-cron-secret)
 * Body: { limit?: number, cap?: number, lookback_days?: number }
 *
 * Drains public.brand_message_outbox as the canonical Deviant account.
 * Claims rows atomically, sends each one with its stable provider idempotency
 * key, records a receipt and stops at the per-recipient frequency cap.
 *
 * It sends nothing until an operator sets DVNT_BRAND_USER_ID,
 * DVNT_BRAND_AUTH_ID and DVNT_BRAND_OUTBOX_ENABLED=true. Unconfigured, it
 * enqueues and reports, and every run logs the reason it stayed quiet.
 *
 * Growth messages only. Ticket email, receipts and order mail keep their own
 * transactional path and never enter this outbox, so a growth opt-out can
 * never stop somebody's ticket.
 *
 * Block, opt-out, already-posted and frequency-cap checks run inside
 * claim_brand_messages before a row is claimed, so a stopped campaign never
 * burns an attempt. There is no mute table in this schema; when one lands, add
 * it to that function rather than to this worker.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { brandSendGate, brandUnsubscribeUrl, verifyBrandSender } from "../_shared/brand-sender.ts";
import { campaignMessage, transition } from "../_shared/brand-outbox.ts";
import {
  ensureDirectConversation,
  postConversationMessage,
} from "../_shared/conversation-delivery.ts";
import { sendResendEmail } from "../_shared/send-resend-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-cron-secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Cron only. Unlike reconcile-orders this refuses to run with no secret
  // configured rather than falling open — the blast radius here is members'
  // inboxes.
  if (!CRON_SECRET) return json({ error: "CRON_SECRET is not set" }, 503);
  if ((req.headers.get("x-cron-secret") || "") !== CRON_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    let body: { limit?: number; cap?: number; lookback_days?: number } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 200);
    const cap = Math.min(Math.max(Number(body.cap) || 2, 1), 10);
    const lookbackDays = Math.min(
      Math.max(Number(body.lookback_days) || 7, 1),
      90,
    );

    // Enqueue runs whether or not sending is enabled: the outbox can fill up
    // safely, and nothing leaves until an operator turns it on.
    const { data: enqueued, error: enqueueError } = await supabase.rpc(
      "enqueue_brand_welcome",
      { p_auth_id: null, p_lookback: `${lookbackDays} days` },
    );
    if (enqueueError) {
      console.error("[brand-outbox-worker] enqueue failed:", enqueueError);
    }

    const configured = brandSendGate();
    // Well-formed is not the same as correct: a typo in either id would pass
    // brandSendGate and then send as whatever account that id names. Prove the
    // pair is one real row before anything leaves.
    const gate = configured.ok
      ? await verifyBrandSender(supabase, configured.sender)
      : configured;
    if (!gate.ok) {
      console.warn(
        `[brand-outbox-worker] sending disabled: ${gate.reason}. Rows stay queued.`,
      );
      return json({
        ok: true,
        data: { enqueued: enqueued ?? 0, claimed: 0, sent: 0, disabled: gate.reason },
      });
    }

    // claim_brand_messages suppresses opted-out, blocked, already-posted and
    // capped rows first, then claims what is left with FOR UPDATE SKIP LOCKED,
    // so two workers never hand the same row to a provider.
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_brand_messages",
      {
        p_sender_id: gate.sender.userId,
        p_limit: limit,
        p_cap: cap,
        p_window: "7 days",
      },
    );
    if (claimError) {
      console.error("[brand-outbox-worker] claim failed:", claimError);
      return json({ error: "Could not claim outbox rows" }, 500);
    }

    const rows = (claimed || []) as Array<Record<string, any>>;
    if (rows.length === 0) {
      return json({ ok: true, data: { enqueued: enqueued ?? 0, claimed: 0, sent: 0 } });
    }

    const recipientIds = rows.map((r) => r.recipient_id);
    const { data: recipients } = await supabase
      .from("users")
      .select("id, auth_id, email")
      .in("id", recipientIds);
    const byId = new Map<number, any>(
      (recipients || []).map((r: any) => [Number(r.id), r]),
    );

    const unsubscribeUrl = brandUnsubscribeUrl();
    let sent = 0;
    let failed = 0;
    let suppressed = 0;

    for (const row of rows) {
      const recipient = byId.get(Number(row.recipient_id));
      const copy = campaignMessage(row.campaign_version, unsubscribeUrl);
      let outcome: "delivered" | "transient_error" | "permanent_error" | "suppress" =
        "delivered";
      let error: string | null = null;
      let receipt: Record<string, unknown> | null = null;
      let providerMessageId: string | null = null;

      if (!recipient) {
        outcome = "permanent_error";
        error = "recipient_missing";
      } else if (!copy) {
        outcome = "permanent_error";
        error = `unknown_campaign_version:${row.campaign_version}`;
      } else if (row.channel === "dm") {
        const result = await sendDirectMessage(
          supabase,
          gate.sender,
          recipient,
          copy.body,
          row.provider_idempotency_key,
        );
        if (result.ok) {
          providerMessageId = result.messageId;
          receipt = { channel: "dm", messageId: result.messageId, at: new Date().toISOString() };
        } else {
          outcome = "transient_error";
          error = result.error;
        }
      } else if (!unsubscribeUrl) {
        // Commercial email without a working unsubscribe path does not go out.
        outcome = "suppress";
        error = "unsubscribe_url_missing";
      } else if (!recipient.email) {
        outcome = "permanent_error";
        error = "recipient_email_missing";
      } else {
        try {
          const id = await sendResendEmail({
            to: recipient.email,
            subject: copy.subject,
            html: copy.body.replace(/\n/g, "<br/>"),
          });
          providerMessageId = id;
          receipt = { channel: "email", providerId: id, at: new Date().toISOString() };
        } catch (err) {
          outcome = "transient_error";
          error = String((err as Error)?.message || err);
        }
      }

      // The state machine decides; complete_brand_message enforces that only a
      // claimed row can move, so a retry lands back on queued with the same
      // provider idempotency key rather than becoming a second message.
      const next = transition("sending", outcome, Number(row.attempt_count));
      if (!next) {
        console.error("[brand-outbox-worker] no transition for row", row.id);
        continue;
      }
      const { error: completeError } = await supabase.rpc(
        "complete_brand_message",
        {
          p_id: row.id,
          p_state: next.state,
          p_provider_message_id: providerMessageId,
          p_receipt: receipt,
          p_error: error,
        },
      );
      if (completeError) {
        console.error("[brand-outbox-worker] complete failed:", completeError);
        continue;
      }
      if (next.state === "sent") sent += 1;
      else if (next.state === "failed") failed += 1;
      else if (next.state === "suppressed") suppressed += 1;
    }

    return json({
      ok: true,
      data: {
        enqueued: enqueued ?? 0,
        claimed: rows.length,
        sent,
        failed,
        suppressed,
        retrying: rows.length - sent - failed - suppressed,
      },
    });
  } catch (err: any) {
    console.error("[brand-outbox-worker] Unexpected:", err);
    return json({ error: err?.message || "Internal error" }, 500);
  }
});

/**
 * Opens (or reuses) the direct conversation between the brand account and the
 * member, then posts through _shared/conversation-delivery.ts — the same
 * helper create-conversation uses. No raw messages insert: the participant
 * rows are written first and the send is membership-checked.
 *
 * ponytail: the idempotency key is carried in message metadata, not enforced
 * by a unique index on messages. A lost acknowledgement between the insert and
 * complete_brand_message re-sends one DM. The upgrade is messages.operation_id,
 * which send-message already has — reuse that column here when the worker
 * moves past its first campaign.
 */
async function sendDirectMessage(
  supabase: any,
  sender: { userId: number; authId: string },
  recipient: { auth_id: string },
  body: string,
  idempotencyKey: string,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const conversation = await ensureDirectConversation(
    supabase,
    sender.authId,
    recipient.auth_id,
  );
  if (!conversation.ok) return { ok: false, error: conversation.error };

  return await postConversationMessage(supabase, {
    conversationId: conversation.conversationId,
    senderAuthId: sender.authId,
    senderId: sender.userId,
    content: body,
    metadata: { automated: true, brandAnnouncement: true, idempotencyKey },
  });
}
