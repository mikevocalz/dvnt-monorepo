/**
 * manage-promoters Edge Function (WS-4 promoter economy)
 *
 * POST /manage-promoters
 *   { action: "list",        event_id }
 *   { action: "add",         event_id, display_name?, username?, rev_share_bps, code? }
 *   { action: "update",      promoter_id, rev_share_bps?, status?, display_name? }
 *   { action: "remove",      promoter_id }
 *   { action: "leaderboard", event_id }
 *
 * Permission: caller must be the event owner or an accepted 'admin'
 * co-organizer (mirrors get-event-staff / invite-co-organizer).
 * All writes go through the service role — clients only ever read their
 * own rows via RLS.
 *
 * Distinct from boosts (event_spotlight_campaigns): a promoter is an
 * event-scoped code holder earning a locked bps share of orders they
 * drive. rev_share_bps edits only affect FUTURE orders — past orders
 * keep the bps locked in promoter_attributions.
 *
 * "leaderboard" ranks promoters by net ledger earnings (sum of signed
 * promoter_ledger_entries.amount_cents) so the analytics surface
 * matches the ledger exactly — no client re-math beyond formatting.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CODE_RE = /^[A-Z0-9_-]{2,32}$/;
const VALID_UPDATE_STATUSES = new Set(["active", "paused"]);

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

/** Owner or accepted admin co-organizer — else null. */
async function callerRoleForEvent(
  supabase: any,
  eventId: number,
  authId: string,
): Promise<"owner" | "admin" | null> {
  const { data: event } = await supabase
    .from("events")
    .select("id, host_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;
  if (String(event.host_id) === String(authId)) return "owner";
  const { data: coOrg } = await supabase
    .from("event_co_organizers")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", authId)
    .eq("accepted", true)
    .eq("role", "admin")
    .maybeSingle();
  return coOrg ? "admin" : null;
}

/** Crockford-ish 8-char code — no ambiguous 0/O/1/I. */
function generateCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

interface PromoterRow {
  id: string;
  event_id: number;
  user_id: string | null;
  display_name: string;
  code: string;
  rev_share_bps: number;
  status: string;
  created_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST")
    return json({ error: "Method not allowed" }, 405, req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return json({ error: "Unauthorized" }, 401, req);

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, req);
    }
    const action = String(body.action || "");

    // ── Resolve the event + permission gate ─────────────────────
    // list/add/leaderboard carry event_id; update/remove carry
    // promoter_id (event derived from the row).
    let eventId: number | null = null;
    let promoter: PromoterRow | null = null;

    if (action === "update" || action === "remove") {
      const promoterId = String(body.promoter_id || "");
      if (!promoterId) return json({ error: "promoter_id required" }, 400, req);
      const { data } = await supabase
        .from("event_promoters")
        .select(
          "id, event_id, user_id, display_name, code, rev_share_bps, status, created_at",
        )
        .eq("id", promoterId)
        .maybeSingle();
      if (!data) return json({ error: "Promoter not found" }, 404, req);
      promoter = data as PromoterRow;
      eventId = promoter.event_id;
    } else {
      eventId = Number(body.event_id);
      if (!Number.isFinite(eventId) || eventId <= 0) {
        return json({ error: "event_id required" }, 400, req);
      }
    }

    const callerRole = await callerRoleForEvent(supabase, eventId!, authId);
    if (!callerRole) {
      return json({ error: "Not authorized to manage promoters" }, 403, req);
    }

    // ── list ────────────────────────────────────────────────────
    if (action === "list") {
      const { data: promoters } = await supabase
        .from("event_promoters")
        .select(
          "id, event_id, user_id, display_name, code, rev_share_bps, status, created_at",
        )
        .eq("event_id", eventId)
        .neq("status", "removed")
        .order("created_at", { ascending: true });

      const rows = (promoters || []) as PromoterRow[];
      const promoterIds = rows.map((p) => p.id);

      // Linked-account metadata (one query)
      const linkedIds = rows.map((p) => p.user_id).filter(Boolean) as string[];
      const userByAuthId = new Map<string, any>();
      if (linkedIds.length > 0) {
        const { data: userRows } = await supabase
          .from("users")
          .select("auth_id, username, first_name, last_name, avatar_id(url)")
          .in("auth_id", linkedIds);
        for (const u of userRows || []) userByAuthId.set(u.auth_id, u);
      }

      // Attribution stats: attributed orders + gross (organizer-side
      // subtotal of paid-ish orders) in one query.
      const orderStats = new Map<
        string,
        { orders: number; grossCents: number }
      >();
      if (promoterIds.length > 0) {
        const { data: attrs } = await supabase
          .from("promoter_attributions")
          .select("promoter_id, orders(status, subtotal_cents)")
          .in("promoter_id", promoterIds);
        for (const a of attrs || []) {
          const orderRaw = (a as any).orders;
          const order = Array.isArray(orderRaw) ? orderRaw[0] : orderRaw;
          if (!order) continue;
          const counted = [
            "paid",
            "refunded",
            "partially_refunded",
          ].includes(String(order.status));
          if (!counted) continue;
          const prev = orderStats.get(a.promoter_id) || {
            orders: 0,
            grossCents: 0,
          };
          prev.orders += 1;
          prev.grossCents += Number(order.subtotal_cents) || 0;
          orderStats.set(a.promoter_id, prev);
        }
      }

      // Ledger stats: net earned (signed sum) in one query.
      const earnedByPromoter = new Map<string, number>();
      if (promoterIds.length > 0) {
        const { data: ledger } = await supabase
          .from("promoter_ledger_entries")
          .select("promoter_id, amount_cents")
          .in("promoter_id", promoterIds);
        for (const l of ledger || []) {
          earnedByPromoter.set(
            l.promoter_id,
            (earnedByPromoter.get(l.promoter_id) || 0) +
              (Number(l.amount_cents) || 0),
          );
        }
      }

      const out = rows.map((p) => {
        const u = p.user_id ? userByAuthId.get(p.user_id) : null;
        const avatarRaw = u?.avatar_id;
        const stats = orderStats.get(p.id) || { orders: 0, grossCents: 0 };
        return {
          id: p.id,
          eventId: p.event_id,
          userId: p.user_id,
          displayName: p.display_name,
          username: u?.username ?? null,
          avatarUrl:
            (Array.isArray(avatarRaw) ? avatarRaw[0]?.url : avatarRaw?.url) ??
            null,
          code: p.code,
          revShareBps: p.rev_share_bps,
          status: p.status,
          attributedOrders: stats.orders,
          grossCents: stats.grossCents,
          earnedCents: earnedByPromoter.get(p.id) || 0,
          createdAt: p.created_at,
        };
      });

      return json({ ok: true, promoters: out, callerRole }, 200, req);
    }

    // ── add ─────────────────────────────────────────────────────
    if (action === "add") {
      const revShareBps = Number(body.rev_share_bps);
      if (
        !Number.isInteger(revShareBps) ||
        revShareBps < 0 ||
        revShareBps > 10000
      ) {
        return json(
          { error: "rev_share_bps must be an integer 0–10000" },
          400,
          req,
        );
      }

      // Linked promoter (by @username) or external (name-only).
      const username =
        typeof body.username === "string"
          ? body.username.trim().toLowerCase().replace(/^@/, "")
          : "";
      let userId: string | null = null;
      let displayName =
        typeof body.display_name === "string" ? body.display_name.trim() : "";

      if (username) {
        const { data: recipient } = await supabase
          .from("users")
          .select("auth_id, username, first_name, last_name")
          .eq("username", username)
          .maybeSingle();
        if (!recipient?.auth_id) {
          return json({ error: `No user @${username}` }, 404, req);
        }
        userId = recipient.auth_id;
        if (!displayName) {
          displayName =
            [recipient.first_name, recipient.last_name]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            recipient.username ||
            `@${username}`;
        }
        // One active promoter row per linked user per event.
        const { data: existing } = await supabase
          .from("event_promoters")
          .select("id")
          .eq("event_id", eventId)
          .eq("user_id", userId)
          .neq("status", "removed")
          .maybeSingle();
        if (existing) {
          return json(
            { error: "This user is already a promoter for this event" },
            409,
            req,
          );
        }
      }

      if (!displayName) {
        return json(
          { error: "display_name or username required" },
          400,
          req,
        );
      }
      if (displayName.length > 80) displayName = displayName.slice(0, 80);

      // Code: caller-supplied (validated) or generated. Retry on the
      // per-event uniq index for generated codes.
      const suppliedCode =
        typeof body.code === "string"
          ? body.code.trim().toUpperCase()
          : "";
      if (suppliedCode && !CODE_RE.test(suppliedCode)) {
        return json(
          { error: "Code must be 2–32 letters, numbers, - or _" },
          400,
          req,
        );
      }

      let inserted: PromoterRow | null = null;
      let lastError: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = suppliedCode || generateCode();
        const { data, error } = await supabase
          .from("event_promoters")
          .insert({
            event_id: eventId,
            user_id: userId,
            display_name: displayName,
            code,
            rev_share_bps: revShareBps,
            status: "active",
          })
          .select(
            "id, event_id, user_id, display_name, code, rev_share_bps, status, created_at",
          )
          .single();
        if (!error && data) {
          inserted = data as PromoterRow;
          break;
        }
        lastError = error;
        if (error?.code === "23505") {
          if (suppliedCode) {
            return json(
              { error: "That code is already in use for this event" },
              409,
              req,
            );
          }
          continue; // regenerate and retry
        }
        break;
      }
      if (!inserted) {
        console.error("[manage-promoters] insert failed:", lastError);
        return json({ error: "Could not add promoter" }, 500, req);
      }

      return json(
        {
          ok: true,
          promoter: {
            id: inserted.id,
            eventId: inserted.event_id,
            userId: inserted.user_id,
            displayName: inserted.display_name,
            username: username || null,
            avatarUrl: null,
            code: inserted.code,
            revShareBps: inserted.rev_share_bps,
            status: inserted.status,
            attributedOrders: 0,
            grossCents: 0,
            earnedCents: 0,
            createdAt: inserted.created_at,
          },
        },
        200,
        req,
      );
    }

    // ── update (bps / pause-resume / rename) ────────────────────
    if (action === "update") {
      const patch: Record<string, unknown> = {};
      if (body.rev_share_bps !== undefined) {
        const bps = Number(body.rev_share_bps);
        if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
          return json(
            { error: "rev_share_bps must be an integer 0–10000" },
            400,
            req,
          );
        }
        patch.rev_share_bps = bps;
      }
      if (body.status !== undefined) {
        const status = String(body.status);
        if (!VALID_UPDATE_STATUSES.has(status)) {
          return json({ error: "status must be active or paused" }, 400, req);
        }
        patch.status = status;
      }
      if (body.display_name !== undefined) {
        const name = String(body.display_name).trim().slice(0, 80);
        if (!name) return json({ error: "display_name empty" }, 400, req);
        patch.display_name = name;
      }
      if (Object.keys(patch).length === 0) {
        return json({ error: "Nothing to update" }, 400, req);
      }
      if (promoter!.status === "removed") {
        return json({ error: "Promoter was removed" }, 409, req);
      }

      const { error: updateError } = await supabase
        .from("event_promoters")
        .update(patch)
        .eq("id", promoter!.id);
      if (updateError) {
        console.error("[manage-promoters] update failed:", updateError);
        return json({ error: "Could not update promoter" }, 500, req);
      }
      return json({ ok: true }, 200, req);
    }

    // ── remove (soft — history + ledger survive) ────────────────
    if (action === "remove") {
      const { error: removeError } = await supabase
        .from("event_promoters")
        .update({ status: "removed" })
        .eq("id", promoter!.id);
      if (removeError) {
        console.error("[manage-promoters] remove failed:", removeError);
        return json({ error: "Could not remove promoter" }, 500, req);
      }
      return json({ ok: true }, 200, req);
    }

    // ── leaderboard — ranked by NET ledger earnings ─────────────
    // Single ledger query; ranking matches the ledger exactly.
    if (action === "leaderboard") {
      const { data: ledger } = await supabase
        .from("promoter_ledger_entries")
        .select("promoter_id, amount_cents")
        .eq("event_id", eventId);

      const netByPromoter = new Map<string, number>();
      for (const l of ledger || []) {
        netByPromoter.set(
          l.promoter_id,
          (netByPromoter.get(l.promoter_id) || 0) +
            (Number(l.amount_cents) || 0),
        );
      }
      if (netByPromoter.size === 0) {
        return json({ ok: true, leaderboard: [] }, 200, req);
      }

      const { data: promoterRows } = await supabase
        .from("event_promoters")
        .select("id, display_name, code, status, user_id")
        .in("id", Array.from(netByPromoter.keys()));
      const rowById = new Map<string, any>();
      for (const p of promoterRows || []) rowById.set(p.id, p);

      const leaderboard = Array.from(netByPromoter.entries())
        .map(([promoterId, earnedCents]) => {
          const p = rowById.get(promoterId);
          return {
            promoterId,
            displayName: p?.display_name ?? "Promoter",
            code: p?.code ?? "",
            status: p?.status ?? "active",
            earnedCents,
          };
        })
        .sort((a, b) => b.earnedCents - a.earnedCents);

      return json({ ok: true, leaderboard }, 200, req);
    }

    return json({ error: "Unknown action" }, 400, req);
  } catch (err: any) {
    console.error("[manage-promoters] Unexpected:", err);
    return json({ error: err.message || "Internal error" }, 500, req);
  }
});
