/**
 * Delete Account Edge Function
 *
 * POST /delete-account
 * Body: { confirm: true }
 *
 * Permanently deletes the authenticated user's account:
 *   1. Cancels active Stripe subscriptions + deletes Stripe customer
 *   2. Refunds/voids tickets; anonymizes financial records (orders, payouts) —
 *      kept for bookkeeping
 *   3. Deletes social content (posts, comments, messages, likes, follows, …)
 *   4. Deletes verification + push + settings rows
 *   5. Anonymizes the users row
 *   6. Deletes Better Auth sessions + account + user record
 *
 * Apple App Store requires account deletion capability.
 *
 * ⚠ DUAL-ID SCHEMA — this app keys rows two different ways and getting it wrong
 * silently deletes NOTHING (supabase-js returns {error} without throwing):
 *   - INTEGER app users.id  → posts.author_id, comments.author_id, messages,
 *     likes, comment_likes, event_likes, event_reviews, follows, notifications,
 *     blocks, conversation_reads, story_views, push_tokens.
 *     conversations_rels.users_id is TEXT but stores the app id as a string.
 *   - TEXT Better Auth id   → stories.author_id, events.host_id, tickets,
 *     orders, payouts, organizer_*, stripe_customers, sneaky_subscriptions,
 *     event_rsvps, video_*, call_signals, verification_*, identity_verifications.
 * Column types verified against the live schema 2026-07-03.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const APPLE_CLIENT_ID = Deno.env.get("APPLE_CLIENT_ID") || "com.dvnt.app";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[delete-account] FATAL: STRIPE_SECRET_KEY env var is not set. Account deletion will refuse to proceed (orphan Stripe customer risk).",
  );
}

async function stripePost(
  endpoint: string,
  body: Record<string, string>,
): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

async function stripeRefund(
  body: Record<string, string>,
): Promise<{ id?: string; status?: string; error?: any }> {
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

async function stripeGet(endpoint: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

/**
 * Revoke Apple Sign In token
 * Required by Apple App Store Guidelines when user deletes account
 */
async function revokeAppleToken(
  refreshToken: string,
  clientId: string,
): Promise<boolean> {
  try {
    const res = await fetch("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }).toString(),
    });
    return res.status === 200;
  } catch (err) {
    console.error("[delete-account] Apple token revocation failed:", err);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  if (!STRIPE_SECRET_KEY) {
    return errorResponse(
      "Account deletion is temporarily unavailable. Contact support.",
      503,
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const userId = await verifySession(supabase, req);
    if (!userId) return errorResponse("Unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    if (body.confirm !== true) {
      return errorResponse(
        "Must send { confirm: true } to delete account",
        400,
      );
    }

    console.log(`[delete-account] Starting deletion for user ${userId}`);
    const deletedAt = new Date().toISOString();
    const anonymizedId = `deleted_${userId.slice(0, 8)}`;

    // The integer app-users id — REQUIRED for every social table below.
    const { data: appUserRow } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", userId)
      .maybeSingle();
    const appUserId: number | null = appUserRow?.id ?? null;

    // ── 1. Cancel active Stripe subscriptions ─────────────────
    try {
      const { data: stripeCustomer } = await supabase
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .single();

      if (stripeCustomer?.stripe_customer_id) {
        const subs = await stripeGet(
          `/subscriptions?customer=${stripeCustomer.stripe_customer_id}&status=active`,
        );
        for (const sub of subs.data || []) {
          await stripePost(`/subscriptions/${sub.id}`, {
            cancel_at_period_end: "false",
          });
          await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
          });
          console.log(`[delete-account] Cancelled subscription ${sub.id}`);
        }
        await fetch(
          `https://api.stripe.com/v1/customers/${stripeCustomer.stripe_customer_id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
          },
        );
        console.log(
          `[delete-account] Deleted Stripe customer ${stripeCustomer.stripe_customer_id}`,
        );
      }
    } catch (err) {
      console.error("[delete-account] Stripe cleanup error:", err);
      // Continue with account deletion even if Stripe fails.
    }

    // ── 2. Cancel active Sneaky Lynk subscriptions (auth-id) ──
    await supabase
      .from("sneaky_subscriptions")
      .update({ status: "canceled", updated_at: deletedAt })
      .eq("host_id", userId)
      .in("status", ["active", "trialing", "past_due"]);

    // ── 3. Anonymize financial records (auth-id, kept for books) ─
    await supabase
      .from("orders")
      .update({ user_id: anonymizedId, updated_at: deletedAt })
      .eq("user_id", userId);
    await supabase
      .from("refund_requests")
      .update({ user_id: anonymizedId })
      .eq("user_id", userId);
    await supabase
      .from("payouts")
      .update({ host_id: anonymizedId })
      .eq("host_id", userId);

    // ── 4. Tickets, transfers, holds (auth-id) ────────────────
    await supabase
      .from("ticket_transfers")
      .update({ status: "cancelled", resolved_at: deletedAt })
      .eq("from_user_id", userId)
      .eq("status", "pending");
    await supabase
      .from("ticket_transfers")
      .update({ status: "cancelled", resolved_at: deletedAt })
      .eq("to_user_id", userId)
      .eq("status", "pending");

    try {
      const { data: activeTickets } = await supabase
        .from("tickets")
        .select("id, stripe_payment_intent_id, purchase_amount_cents")
        .eq("user_id", userId)
        .eq("status", "active")
        .not("stripe_payment_intent_id", "is", null)
        .gt("purchase_amount_cents", 0);

      const paymentIntents = [
        ...new Set(
          (activeTickets || [])
            .map((t) => t.stripe_payment_intent_id)
            .filter(Boolean),
        ),
      ];

      for (const paymentIntentId of paymentIntents) {
        const ticketIds = (activeTickets || [])
          .filter((t) => t.stripe_payment_intent_id === paymentIntentId)
          .map((t) => String(t.id));
        try {
          const refund = await stripeRefund({
            payment_intent: paymentIntentId,
            refund_application_fee: "true",
            reverse_transfer: "true",
            reason: "requested_by_customer",
            "metadata[triggered_by]": "account_deletion",
            "metadata[triggered_by_auth_id]": userId,
            "metadata[ticket_ids]": ticketIds.join(","),
          });
          if (refund.error) {
            console.error("[delete-account] Stripe ticket refund error:", refund.error);
            continue;
          }
          if (refund.id) {
            await supabase
              .from("tickets")
              .update({ status: "refunded", user_id: anonymizedId })
              .eq("user_id", userId)
              .eq("stripe_payment_intent_id", paymentIntentId);
            console.log(
              `[delete-account] Refunded tickets ${ticketIds.join(",")} via ${refund.id}`,
            );
          }
        } catch (refundErr) {
          console.error(
            `[delete-account] Failed to refund payment_intent ${paymentIntentId}:`,
            refundErr,
          );
        }
      }
    } catch (err) {
      console.error("[delete-account] Ticket refund loop error:", err);
    }

    await supabase
      .from("tickets")
      .update({ status: "void", user_id: anonymizedId })
      .eq("user_id", userId)
      .neq("status", "refunded");
    await supabase
      .from("ticket_holds")
      .update({ status: "expired" })
      .eq("user_id", userId)
      .eq("status", "active");

    // ── 5. Social content (INTEGER app-users id) ──────────────
    // These ALL key on the integer app id, not the auth id.
    if (appUserId !== null) {
      // Posts first — with the post_id FKs now ON DELETE CASCADE, this also
      // removes comments/bookmarks/likes/media/tags on the user's posts.
      await supabase.from("posts").delete().eq("author_id", appUserId);
      // The user's own comments (on anyone's posts) + their likes.
      await supabase.from("comments").delete().eq("author_id", appUserId);
      await supabase.from("comment_likes").delete().eq("user_id", appUserId);
      await supabase.from("likes").delete().eq("user_id", appUserId);
      await supabase.from("event_likes").delete().eq("user_id", appUserId);
      await supabase.from("event_reviews").delete().eq("user_id", appUserId);
      // Direct messages (their sent messages; other party's stay).
      await supabase.from("messages").delete().eq("sender_id", appUserId);
      await supabase.from("conversation_reads").delete().eq("user_id", appUserId);
      await supabase.from("conversations_rels").delete().eq("users_id", String(appUserId));
      // Graph.
      await supabase.from("follows").delete().eq("follower_id", appUserId);
      await supabase.from("follows").delete().eq("following_id", appUserId);
      await supabase.from("blocks").delete().eq("blocker_id", appUserId);
      await supabase.from("blocks").delete().eq("blocked_id", appUserId);
      // Notifications where they are recipient or actor.
      await supabase.from("notifications").delete().eq("recipient_id", appUserId);
      await supabase.from("notifications").delete().eq("actor_id", appUserId);
      // Stories they viewed + their push tokens.
      await supabase.from("story_views").delete().eq("user_id", appUserId);
      await supabase.from("push_tokens").delete().eq("user_id", appUserId);
    } else {
      console.warn(`[delete-account] no app users row for ${userId} — skipped social content`);
    }

    // ── 6. Content + events keyed by the auth id (TEXT) ───────
    await supabase.from("stories").delete().eq("author_id", userId);
    await supabase.from("event_rsvps").delete().eq("user_id", userId);

    // ── 7. Video/room data (auth-id) ──────────────────────────
    await supabase
      .from("video_room_members")
      .update({ status: "left" })
      .eq("user_id", userId)
      .eq("status", "active");
    await supabase.from("video_room_tokens").delete().eq("user_id", userId);

    const { data: hostedRooms } = await supabase
      .from("video_rooms")
      .select("id")
      .eq("created_by", userId);
    const hostedRoomIds = (hostedRooms || []).map((r) => r.id);
    await supabase
      .from("video_rooms")
      .update({ status: "ended", ended_at: deletedAt, updated_at: deletedAt })
      .eq("created_by", userId)
      .eq("status", "open");
    if (hostedRoomIds.length > 0) {
      await supabase
        .from("video_room_members")
        .update({ status: "left", left_at: deletedAt })
        .in("room_id", hostedRoomIds)
        .eq("status", "active");
    }

    // ── 8. Organizer data (auth-id) ───────────────────────────
    await supabase
      .from("event_spotlight_campaigns")
      .update({ status: "cancelled" })
      .eq("organizer_id", userId)
      .in("status", ["active", "pending"]);
    await supabase.from("organizer_branding").delete().eq("host_id", userId);
    // Keep organizer_accounts (Stripe Connect payout history) but anonymize.
    await supabase
      .from("organizer_accounts")
      .update({ host_id: anonymizedId, updated_at: deletedAt })
      .eq("host_id", userId);

    // ── 9. Mappings, settings, verification (auth-id) ─────────
    await supabase.from("stripe_customers").delete().eq("user_id", userId);
    await supabase.from("user_settings").delete().eq("user_id", userId);
    await supabase.from("verification_requests").delete().eq("user_id", userId);
    await supabase.from("verification_events").delete().eq("user_id", userId);
    await supabase.from("identity_verifications").delete().eq("user_id", userId);
    await supabase.from("call_signals").delete().eq("caller_id", userId);
    await supabase.from("call_signals").delete().eq("callee_id", userId);

    // ── 10. Anonymize the users row ───────────────────────────
    // NOTE: column is avatar_id (there is no avatar_url); no `name` column.
    await supabase
      .from("users")
      .update({
        username: anonymizedId,
        email: `${anonymizedId}@deleted.local`,
        first_name: "Deleted",
        last_name: "User",
        bio: null,
        avatar_id: null,
        location: null,
        website: null,
        links: null,
        verified: false,
        followers_count: 0,
        following_count: 0,
        posts_count: 0,
        updated_at: deletedAt,
      })
      .eq("auth_id", userId);

    // ── 11. Revoke Apple Sign In token (required by App Store) ─
    try {
      const { data: appleAccount } = await supabase
        .from("account")
        .select("provider, refresh_token")
        .eq("userId", userId)
        .eq("provider", "apple")
        .single();
      if (appleAccount?.refresh_token) {
        await revokeAppleToken(appleAccount.refresh_token, APPLE_CLIENT_ID);
        console.log(`[delete-account] Apple token revoked for ${userId}`);
      }
    } catch (err) {
      console.error("[delete-account] Apple revocation check failed:", err);
    }

    // ── 12. Delete Better Auth sessions + account + user ──────
    // account / session / passkey cascade off the user row, but delete
    // explicitly so a failed cascade can't strand credentials.
    await supabase.from("session").delete().eq("userId", userId);
    await supabase.from("account").delete().eq("userId", userId);
    await supabase.from("user").delete().eq("id", userId);

    console.log(`[delete-account] Account deletion complete for ${userId}`);

    return jsonResponse({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (err: any) {
    console.error("[delete-account] Error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
