/**
 * brand-outbox-worker Edge Function
 *
 * POST /brand-outbox-worker   (cron only, x-cron-secret)
 * Body: { limit?: number, cap?: number, lookback_days?: number,
 *         follow_backfill_limit?: number }
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
import {
  brandSendGate,
  brandUnsubscribeUrl,
  resolveBrandSender,
  verifyBrandSender,
} from "../_shared/brand-sender.ts";
import { NEW_PROFILE_WINDOW } from "../_shared/brand-follow.ts";
import { campaignMessage, transition } from "../_shared/brand-outbox.ts";
import {
  ensureDirectConversation,
  postConversationMessage,
} from "../_shared/conversation-delivery.ts";
import { sendResendEmail } from "../_shared/send-resend-email.ts";
import { welcome as welcomeEmail } from "../_shared/email/templates.ts";

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

type BrandFollowResult =
  | { status: "ran"; memberToBrandInserted: number; brandToNewMemberInserted: number; remaining: number; done: boolean }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

async function runBrandFollowBackfill(
  supabase: any,
  limit: number,
): Promise<BrandFollowResult> {
  // Never guess the brand from @username: prove the configured ID pair first.
  const resolved = resolveBrandSender();
  const identity = resolved.ok
    ? await verifyBrandSender(supabase, resolved.sender)
    : resolved;
  if (!identity.ok) {
    console.warn(`[brand-outbox-worker] follow backfill skipped: ${identity.reason}`);
    return { status: "skipped", reason: identity.reason };
  }
  const { data, error } = await supabase.rpc("backfill_brand_follows", {
    p_brand_id: identity.sender.userId,
    p_limit: limit,
    p_new_profile_window: NEW_PROFILE_WINDOW,
  });
  if (error) {
    console.error("[brand-outbox-worker] follow backfill failed:", error);
    return { status: "error", error: error.message ?? String(error) };
  }
  const remaining = Number(data?.remaining ?? 0);
  return {
    status: "ran",
    memberToBrandInserted: Number(data?.memberToBrandInserted ?? 0),
    brandToNewMemberInserted: Number(data?.brandToNewMemberInserted ?? 0),
    remaining,
    done: remaining === 0,
  };
}

type CheckoutWelcomeResult =
  | { status: "ran"; claimed: number; sent: number; released: number }
  | { status: "error"; error: string };

/**
 * Welcome email for profiles made at guest checkout, which never pass the
 * auth function's user.create.after hook. claim_checkout_welcome_emails
 * writes the sent marker before anything goes out, so a second worker or the
 * next tick cannot send it again. A failed send releases the marker for the
 * next tick. Runs whether or not DVNT_BRAND_OUTBOX_ENABLED is set: this is the
 * account's welcome, not a growth message.
 */
async function sendCheckoutWelcomeEmails(supabase: any): Promise<CheckoutWelcomeResult> {
  const { data, error } = await supabase.rpc("claim_checkout_welcome_emails", {
    p_lookback: "7 days",
    p_limit: 50,
  });
  if (error) {
    console.error("[brand-outbox-worker] checkout welcome claim failed:", error);
    return { status: "error", error: error.message ?? String(error) };
  }
  const rows = (data || []) as Array<{ auth_id: string; email: string | null; username: string | null }>;
  let sent = 0;
  let released = 0;
  for (const row of rows) {
    let providerId: string | null = null;
    if (row.email) {
      try {
        const { subject, html } = welcomeEmail(row.username, { checkoutProfile: true });
        providerId = await sendResendEmail({ to: row.email, subject, html });
      } catch (err) {
        console.error("[brand-outbox-worker] checkout welcome send failed:", err);
      }
    }
    // sendResendEmail returns null when RESEND_API_KEY is missing: not sent.
    const ok = providerId !== null;
    const { error: completeError } = await supabase.rpc("complete_checkout_welcome_email", {
      p_auth_id: row.auth_id,
      p_sent: ok,
      p_provider_message_id: providerId,
    });
    if (completeError) {
      console.error("[brand-outbox-worker] checkout welcome complete failed:", completeError);
    }
    if (ok) sent += 1;
    else released += 1;
  }
  return { status: "ran", claimed: rows.length, sent, released };
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

    let body: {
      limit?: number;
      cap?: number;
      lookback_days?: number;
      follow_backfill_limit?: number;
    } = {};
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
    const followBackfillLimit = Math.min(
      Math.max(Number(body.follow_backfill_limit) || 250, 1),
      1000,
    );

    // Enqueue runs whether or not sending is enabled: the outbox can fill up
    // safely, and nothing leaves until an operator turns it on.
    const { data: enqueued, error: enqueueError } = await supabase.rpc(
      "enqueue_brand_onboarding",
      {
        p_auth_id: null,
        p_lookback: `${lookbackDays} days`,
        p_first_post_delay: "24 hours",
      },
    );
    if (enqueueError) {
      console.error("[brand-outbox-worker] enqueue failed:", enqueueError);
    }

    // Follow backfill: every eligible member follows @DeviantEvents, up to
    // followBackfillLimit per run, and the brand follows profiles created in
    // the last NEW_PROFILE_WINDOW that skipped auth-sync. It needs the proven
    // brand ID pair but not DVNT_BRAND_OUTBOX_ENABLED. Once nothing is missing
    // the RPC inserts nothing and reports remaining: 0.
    // DB-pinned brand identity keeps follow repair functioning even if the
    // marketing sender environment is accidentally missing. Sending still
    // requires the explicit enabled sender gate below.
    const { data: repairedFollows, error: repairError } = await supabase.rpc(
      "repair_canonical_brand_follows", { p_limit: followBackfillLimit },
    );
    const brandFollows = repairError
      ? await runBrandFollowBackfill(supabase, followBackfillLimit)
      : { status: "ran" as const,
          memberToBrandInserted: Number(repairedFollows?.memberToBrandInserted ?? 0),
          brandToNewMemberInserted: Number(repairedFollows?.brandToNewMemberInserted ?? 0),
          remaining: Number(repairedFollows?.remaining ?? 0),
          done: Number(repairedFollows?.remaining ?? 0) === 0 };

    // One campaign-version key per eligible missing-avatar member. The worker
    // will suppress a resolved profile before delivering the message.
    const { data: photoReminders, error: photoError } = await supabase.rpc(
      "enqueue_missing_avatar_reminder", { p_limit: 2000 },
    );
    if (photoError) console.error("[brand-outbox-worker] photo reminder enqueue failed:", photoError.message);

    const checkoutWelcome = await sendCheckoutWelcomeEmails(supabase);

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
        data: {
          enqueued: enqueued ?? 0,
          brandFollows,
          photoReminders: photoReminders ?? 0,
          checkoutWelcome,
          claimed: 0,
          sent: 0,
          disabled: gate.reason,
        },
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
      return json({
        ok: true,
        data: {
          enqueued: enqueued ?? 0,
          brandFollows,
          photoReminders: photoReminders ?? 0,
          checkoutWelcome,
          claimed: 0,
          sent: 0,
        },
      });
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
      } else if (row.campaign_version === "profile_photo_v1" &&
                 await hasProfilePhoto(supabase, recipient)) {
        outcome = "suppress";
        error = "profile_photo_already_added";
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
        brandFollows,
        checkoutWelcome,
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

/** Recheck right before the DM leaves; photo uploads cancel the campaign. */
async function hasProfilePhoto(supabase: any, recipient: { id: number; auth_id: string }): Promise<boolean> {
  const [{ data: profile, error: pError }, { data: auth, error: aError }] = await Promise.all([
    supabase.from("users").select("avatar_id").eq("id", recipient.id).single(),
    supabase.from("user").select("image").eq("id", recipient.auth_id).single(),
  ]);
  // A read failure must not incorrectly send a profile-shaming nudge.
  if (pError || aError) return true;
  return profile?.avatar_id != null || Boolean(String(auth?.image ?? "").trim());
}
