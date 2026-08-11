/**
 * Ticket Scan / Validate Edge Function
 *
 * POST /ticket-scan  { qr_token, qr_payload?, scanned_by?, device_id?,
 *                      event_id?, offline?, offline_scanned_at? }
 *
 * Door check-in rides the DB-level CAS (WS-8, migration 20260806100200):
 * a single `redeem_ticket` RPC call performs the atomic
 * `UPDATE tickets SET status='scanned' WHERE status='active'` swap AND
 * writes the `checkins` audit row. Two simultaneous scans of the same QR
 * can never both succeed — the loser gets the ticket's actual state back
 * (`already_scanned` with the ORIGINAL checked_in_at/by). Server always
 * wins on double-scan; offline batch sync goes through the same RPC with
 * p_offline := true.
 *
 * Add-on QR codes (order_addons.qr_token, migration 20260613000100) are
 * redeemed through the sibling `redeem_addon` CAS (20260806300000).
 * Ticket scans additionally return the order's add-ons (name, qty,
 * redeemed state) so door staff sees "VIP table ×1 — unredeemed" on the
 * result card.
 *
 * Two token resolution paths:
 * 1. qr_payload (HMAC-signed) — fast-path cryptographic verification
 * 2. qr_token (legacy) — DB lookup (tickets first, then order_addons)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySignedQrPayload } from "../_shared/hmac-qr.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { verifySession } from "../_shared/verify-session.ts";

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

interface AddonSummary {
  id: string;
  name: string;
  variant_name: string | null;
  quantity: number;
  status: string;
  redeemed_at: string | null;
  redeemable: boolean;
}

/**
 * Add-ons attached to a scanned ticket's order: per-ticket bound rows
 * (ticket_id) plus order-level rows sharing the ticket's cart. No buyer
 * PII and no add-on qr_tokens leave the server — door staff only needs
 * name / qty / redeemed state.
 */
async function fetchTicketAddons(
  supabase: any,
  ticket: { id: string; cart_id?: string | null; event_id: number },
): Promise<AddonSummary[]> {
  try {
    let query = supabase
      .from("order_addons")
      .select(
        "id, quantity, status, redeemed_at, ticket_addons(name, is_redeemable), ticket_addon_variants(name)",
      )
      .eq("event_id", ticket.event_id);
    query = ticket.cart_id
      ? query.or(`ticket_id.eq.${ticket.id},cart_id.eq.${ticket.cart_id}`)
      : query.eq("ticket_id", ticket.id);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.ticket_addons?.name ?? "Add-on",
      variant_name: r.ticket_addon_variants?.name ?? null,
      quantity: r.quantity ?? 1,
      status: r.status,
      redeemed_at: r.redeemed_at ?? null,
      redeemable: r.ticket_addons?.is_redeemable ?? false,
    }));
  } catch (e) {
    // Add-on context is display-only; never fail the scan over it.
    console.error("[ticket-scan] addon fetch error:", e);
    return [];
  }
}

/** Display name for the scanner that owns an original check-in (dup card). */
async function fetchScannerName(
  supabase: any,
  authId: string | null | undefined,
): Promise<string | null> {
  if (!authId) return null;
  try {
    const { data } = await supabase
      .from("users")
      .select("username, first_name, last_name")
      .eq("auth_id", authId)
      .maybeSingle();
    if (!data) return null;
    return (
      [data.first_name, data.last_name].filter(Boolean).join(" ") ||
      data.username ||
      null
    );
  } catch {
    return null;
  }
}

// ── Membership tier + perks at the door (Host & Guest WS-3/WS-4) ───────────
// Mirrors lib/subscription/entitlements.ts + lib/perks/perk-config.ts. Resolved
// on the scan response so the door reads a decision instead of computing one.
// Nothing here touches QR validation — it runs strictly after the CAS redeem.
const PLAN_RANK: Record<string, number> = {
  free: 0, sneaky_tier_1: 1, sneaky_tier_2: 2, dvnt_core: 3,
  dvnt_insider: 4, dvnt_vip: 5, dvnt_founders_circle: 6,
};
const PERK_KEYS = ["skip_line","early_entry","guaranteed_entry","comp_drink","table_priority"] as const;
const DEFAULT_PERKS: Record<string, number | null> = {
  skip_line: PLAN_RANK.dvnt_insider,
  early_entry: PLAN_RANK.dvnt_vip,
  guaranteed_entry: PLAN_RANK.dvnt_founders_circle,
  comp_drink: null,
  table_priority: PLAN_RANK.dvnt_vip,
};

function subConfersTier(sub: any, now: number): boolean {
  switch (sub?.status) {
    case "active": return true;
    case "past_due":
      return sub.grace_period_ends_at
        ? new Date(sub.grace_period_ends_at).getTime() > now : false;
    case "canceled":
      return sub.cancel_at_period_end && sub.current_period_end
        ? new Date(sub.current_period_end).getTime() > now : false;
    default: return false;
  }
}

/**
 * Best-effort: a tier lookup must NEVER fail a scan. If this throws or the
 * network hiccups the door still admits on the QR, which is the only thing that
 * decides entry. Returns { tier, perks } or nulls.
 */
async function resolveDoorTier(
  supabase: any,
  userId: string | null,
  eventId: number | string | null,
): Promise<{ membership_tier: any; perks: string[] }> {
  const empty = { membership_tier: null, perks: [] as string[] };
  if (!userId) return empty;
  try {
    const [subRes, evRes] = await Promise.all([
      supabase
        .from("membership_subscriptions")
        .select("plan_key, status, current_period_end, cancel_at_period_end, grace_period_ends_at")
        .eq("user_id", userId)
        .maybeSingle(),
      eventId != null
        ? supabase.from("events").select("perk_config").eq("id", eventId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const sub = subRes?.data;
    if (!sub || !subConfersTier(sub, Date.now())) return empty;
    const rank = PLAN_RANK[sub.plan_key];
    if (rank == null) return empty;

    const cfg = { ...DEFAULT_PERKS };
    const raw = evRes?.data?.perk_config;
    if (raw && typeof raw === "object") {
      for (const k of PERK_KEYS) {
        const v = (raw as Record<string, unknown>)[k];
        if (v === null) cfg[k] = null;
        else if (typeof v === "number" && Number.isFinite(v)) cfg[k] = v;
      }
    }
    const perks = PERK_KEYS.filter((k) => {
      const min = cfg[k];
      return typeof min === "number" && rank >= min;
    });
    return { membership_tier: { planKey: sub.plan_key, rank }, perks };
  } catch (_e) {
    // Never let tier resolution break a door scan.
    return empty;
  }
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const {
      qr_token,
      qr_payload,
      device_id,
      event_id,
      offline,
      offline_scanned_at,
    } = await req.json();

    if (!qr_token && !qr_payload) {
      return json({ error: "Missing qr_token or qr_payload" }, 400);
    }

    // Rate-limit per scanner identity. A single scanner can realistically process
    // at most ~1 scan per 2s in a real door line — 30/minute is a generous ceiling.
    // This prevents brute-force QR token enumeration.
    // Rate limit by raw client identifier; scannerAuthId not available
    // yet (verifySession runs below). x-forwarded-for is acceptable here.
    const rateLimitKey =
      device_id || req.headers.get("x-forwarded-for") || "anon";
    const rl = checkRateLimit(rateLimitKey, "ticket-scan", {
      maxRequests: 30,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return json(
        {
          error: `Too many scan attempts. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
        },
        429,
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // ── AUTH GATE (V2-SEC-01 fix) ─────────────────────────────
    // Require a valid Better Auth session. Without this, anyone who
    // captured a QR token could mark tickets scanned via direct HTTP.
    const scannerAuthId = await verifySession(supabase, req);
    if (!scannerAuthId) {
      return json({ error: "Unauthorized — session required" }, 401);
    }

    // Offline batch sync (syncOfflineScans) flags its replayed scans so
    // the audit row records offline provenance.
    const isOfflineReplay =
      offline === true || typeof offline_scanned_at === "string";

    // ── TOKEN RESOLUTION ───────────────────────────────────────
    // Resolve what the QR belongs to (ticket vs add-on) WITHOUT mutating
    // anything — the atomic state change happens exclusively inside the
    // redeem_* CAS RPCs below.
    let scanKind: "ticket" | "addon" = "ticket";
    let resolvedToken: string | null = null;
    let resolvedEventId: number | null = null;

    if (qr_payload) {
      // Fast path: HMAC-signed QR payload (tickets only).
      const verification = await verifySignedQrPayload(qr_payload);
      if (!verification.valid) {
        return json({ valid: false, reason: "invalid_signature" });
      }
      const { data: byId } = await supabase
        .from("tickets")
        .select("qr_token, event_id")
        .eq("id", verification.ticketId!)
        .maybeSingle();
      if (byId?.qr_token) {
        resolvedToken = byId.qr_token;
        resolvedEventId = byId.event_id ?? verification.eventId!;
      } else {
        resolvedEventId = verification.eventId!;
      }
    } else {
      const { data: byToken } = await supabase
        .from("tickets")
        .select("event_id")
        .eq("qr_token", qr_token)
        .maybeSingle();
      if (byToken) {
        resolvedToken = qr_token;
        resolvedEventId = byToken.event_id;
      } else {
        // Not a ticket token — check the add-on rail (order_addons carry
        // their own qr_token for scan-at-door redeemables).
        const { data: addonRow } = await supabase
          .from("order_addons")
          .select("event_id")
          .eq("qr_token", qr_token)
          .maybeSingle();
        if (addonRow) {
          scanKind = "addon";
          resolvedToken = qr_token;
          resolvedEventId = addonRow.event_id;
        }
      }
    }

    // The scanner is event-scoped: prefer the client's event context
    // (cross-event scans then surface as wrong_event from the CAS),
    // falling back to the token's own event for event-less callers
    // (legacy offline sync).
    const clientEventId = event_id != null ? parseInt(String(event_id)) : NaN;
    const scanEventId = Number.isFinite(clientEventId)
      ? clientEventId
      : resolvedEventId;

    if (!scanEventId) {
      // Unknown token AND no event context — nothing to audit against
      // (checkins.event_id is NOT NULL). Same response as before the CAS.
      return json({ valid: false, reason: "ticket_not_found" });
    }

    // ── HOST-ROLE GATE ─────────────────────────────────────────
    // Confirm the session user may scan for this event BEFORE any
    // status mutation.
    const { data: scanEvent } = await supabase
      .from("events")
      .select("host_id")
      .eq("id", scanEventId)
      .single();
    if (!scanEvent) {
      return json({ valid: false, reason: "event_not_found" }, 404);
    }
    const isHost = String(scanEvent.host_id) === String(scannerAuthId);

    // V2-SEC-02b: also honor event_co_organizers role for non-host staff.
    // The role ladder is owner → admin → editor → scanner; anyone above
    // (or equal to) 'scanner' AND accepted can check in tickets. This
    // unblocks door staff that aren't the actual event owner.
    let isAuthorizedScanner = isHost;
    if (!isAuthorizedScanner) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role, accepted")
        .eq("event_id", scanEventId)
        .eq("user_id", scannerAuthId)
        .eq("accepted", true)
        .in("role", ["scanner", "editor", "admin"])
        .maybeSingle();
      isAuthorizedScanner = !!coOrg;
    }

    if (!isAuthorizedScanner) {
      return json(
        { error: "Forbidden — not the event host or an authorized scanner" },
        403,
      );
    }

    // ── ADD-ON RAIL: atomic redemption via redeem_addon CAS ───
    if (scanKind === "addon") {
      const { data: addonResult, error: addonRpcError } = await supabase.rpc(
        "redeem_addon",
        {
          p_qr_token: resolvedToken,
          p_event_id: scanEventId,
          p_scanned_by: scannerAuthId,
          p_device_id: device_id || null,
          p_offline: isOfflineReplay,
        },
      );
      if (addonRpcError) throw addonRpcError;

      const addon = {
        id: addonResult.orderAddonId,
        name: addonResult.addonName || "Add-on",
        variant_name: addonResult.variantName ?? null,
        quantity: addonResult.quantity ?? 1,
        status: addonResult.status,
        redeemed_at: addonResult.redeemedAt ?? null,
      };

      switch (addonResult.result) {
        case "valid":
          return json({ valid: true, kind: "addon", addon });
        case "already_scanned":
          return json({
            valid: false,
            kind: "addon",
            reason: "already_scanned",
            status: addonResult.status,
            // Same field the clients already render for duplicate tickets —
            // the ORIGINAL redemption time/scanner from the CAS.
            checked_in_at: addonResult.redeemedAt ?? null,
            checked_in_by: addonResult.redeemedBy ?? null,
            checked_in_by_name: await fetchScannerName(
              supabase,
              addonResult.redeemedBy,
            ),
            addon,
          });
        case "refunded":
          return json({
            valid: false,
            kind: "addon",
            reason: "refunded",
            status: addonResult.status,
            checked_in_at: null,
            addon,
          });
        case "wrong_event":
          return json({ valid: false, kind: "addon", reason: "wrong_event" });
        default:
          return json({ valid: false, reason: "ticket_not_found" });
      }
    }

    // ── TICKET RAIL: atomic check-in via redeem_ticket CAS ────
    // Single RPC replaces the old read-then-update path: the CAS flips
    // active → scanned AND writes the audit row in one transaction.
    // checked_in_by is the verified session user; we never trust the
    // client-supplied scanned_by value for the audit trail.
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "redeem_ticket",
      {
        p_qr_token: resolvedToken ?? qr_token ?? "",
        p_event_id: scanEventId,
        p_scanned_by: scannerAuthId,
        p_device_id: device_id || null,
        p_offline: isOfflineReplay,
      },
    );
    if (rpcError) throw rpcError;

    switch (rpcResult.result) {
      case "valid": {
        // CAS won — enrich for the door result card (reads only).
        const { data: ticket } = await supabase
          .from("tickets")
          .select(
            "id, event_id, ticket_type_id, user_id, status, qr_token, checked_in_at, checked_in_by, purchase_amount_cents, cart_id",
          )
          .eq("id", rpcResult.ticketId)
          .single();

        const { data: user } = await supabase
          .from("users")
          .select("username, first_name, last_name")
          .eq("auth_id", ticket?.user_id)
          .maybeSingle();

        const { data: ticketType } = await supabase
          .from("ticket_types")
          .select("name")
          .eq("id", ticket?.ticket_type_id)
          .maybeSingle();

        const addons = ticket
          ? await fetchTicketAddons(supabase, ticket)
          : [];

        // WS-4: tier + perk on the result card. Resolved AFTER the CAS redeem
        // above, so a slow or failing lookup can never affect admission.
        const door = await resolveDoorTier(
          supabase,
          (ticket as any)?.user_id ?? null,
          (ticket as any)?.event_id ?? rpcResult.eventId ?? null,
        );

        return json({
          valid: true,
          membership_tier: door.membership_tier,
          perks: door.perks,
          ticket: {
            ...(ticket ?? {
              id: rpcResult.ticketId,
              event_id: rpcResult.eventId,
              ticket_type_id: rpcResult.ticketTypeId,
              status: rpcResult.ticketStatus,
              checked_in_at: rpcResult.checkedInAt,
            }),
            username: user?.username || "Unknown",
            name:
              [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
              user?.username ||
              "Guest",
            tier_name: ticketType?.name || "General",
          },
          addons,
        });
      }

      case "already_scanned": {
        // CAS lost — server wins. Return the ORIGINAL check-in facts so
        // the door UI can render "scanned at 10:41 by Jane" large.
        // Response contract preserved: scanner.web.tsx:239-246 branches on
        // `data.reason === "already_scanned"`; `status` + `checked_in_at`
        // keep their pre-CAS shapes.
        const ticketRef = rpcResult.ticketId
          ? {
              id: rpcResult.ticketId,
              cart_id: null as string | null,
              event_id: rpcResult.eventId,
            }
          : null;
        if (ticketRef) {
          const { data: t } = await supabase
            .from("tickets")
            .select("cart_id")
            .eq("id", rpcResult.ticketId)
            .maybeSingle();
          ticketRef.cart_id = t?.cart_id ?? null;
        }
        return json({
          valid: false,
          reason: "already_scanned",
          status: "scanned",
          checked_in_at: rpcResult.checkedInAt ?? null,
          checked_in_by: rpcResult.checkedInBy ?? null,
          checked_in_by_name: await fetchScannerName(
            supabase,
            rpcResult.checkedInBy,
          ),
          addons: ticketRef ? await fetchTicketAddons(supabase, ticketRef) : [],
        });
      }

      case "refunded":
        return json({
          valid: false,
          reason: "refunded",
          status: "refunded",
          checked_in_at: null,
        });

      case "wrong_event":
        return json({ valid: false, reason: "wrong_event" });

      case "invalid":
      default: {
        // Preserve the legacy reason granularity clients already parse.
        if (!rpcResult.ticketId) {
          return json({ valid: false, reason: "ticket_not_found" });
        }
        const reason =
          rpcResult.ticketStatus === "void"
            ? "voided"
            : rpcResult.ticketStatus === "transfer_pending"
              ? "transfer_pending"
              : "invalid_status";
        return json({
          valid: false,
          reason,
          status: rpcResult.ticketStatus,
          checked_in_at: null,
        });
      }
    }
  } catch (err: any) {
    console.error("[ticket-scan] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
