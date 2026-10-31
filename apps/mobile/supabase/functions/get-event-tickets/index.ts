/**
 * get-event-tickets Edge Function
 *
 * POST /get-event-tickets
 * Body shapes:
 *   { event_id }
 *     → first page of tickets (page=1, pageSize=50). Host-only view.
 *   { event_id, page, pageSize, status, search }
 *     → paginated, server-filtered. status is one of
 *       'active' | 'scanned' | 'refunded' | 'transfer_pending' | 'void' | 'all'
 *       search matches holder names / @usernames (literal case-insensitive partial),
 *       ticket UUID / legacy qr_token (prefix).
 *   { event_id, offline: true }
 *     → minimal payload for offline check-in: just qr_tokens of active
 *       tickets. Same auth gate. Bypasses pagination since the roster
 *       has to be complete for offline scanner mode.
 *
 * Permission scope follows the V2-SEC ladder (owner / admin / editor /
 * scanner via event_co_organizers). Scanners get a PII-redacted payload.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

import { readAllRows } from "../_shared/read-all-rows.ts";
import { organizerFreeCancellation } from "../_shared/organizer-free-cancellation.ts";

// ── Membership tier resolution (Host & Guest WS-1) ─────────────────────────
// Deno can't import packages/app, so PLAN_RANK and the entitlement rules are
// mirrored here from lib/subscription/plans.ts + entitlements.ts. Keep in
// lockstep — same constraint the SUPPRESSED_FEED_AUTHOR_IDS mirror lives under.
const PLAN_RANK: Record<string, number> = {
  free: 0,
  sneaky_tier_1: 1,
  sneaky_tier_2: 2,
  dvnt_core: 3,
  dvnt_insider: 4,
  dvnt_vip: 5,
  dvnt_founders_circle: 6,
};

// ── Perk resolution (WS-3) ─────────────────────────────────────────────────
// Mirrors lib/perks/perk-config.ts. Resolved HERE, at query time, so the door
// never recomputes entitlement under pressure — the roster ships the answer.
const PERK_KEYS = [
  "skip_line",
  "early_entry",
  "guaranteed_entry",
  "comp_drink",
  "table_priority",
] as const;

const DEFAULT_PERK_CONFIG: Record<string, number | null> = {
  skip_line: PLAN_RANK.dvnt_insider,
  early_entry: PLAN_RANK.dvnt_vip,
  guaranteed_entry: PLAN_RANK.dvnt_founders_circle,
  comp_drink: null,
  table_priority: PLAN_RANK.dvnt_vip,
};

function effectivePerkConfig(raw: unknown): Record<string, number | null> {
  const out = { ...DEFAULT_PERK_CONFIG };
  if (raw && typeof raw === "object") {
    for (const k of PERK_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (v === null) out[k] = null;
      else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

function resolvePerks(
  rank: number | null,
  config: Record<string, number | null>,
): string[] {
  if (rank == null) return [];
  return PERK_KEYS.filter((k) => {
    const min = config[k];
    return typeof min === "number" && rank >= min;
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function clampInt(
  v: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return errorResponse("Unauthorized", 401);

    let body: {
      event_id?: string | number;
      offline?: boolean;
      /** Aggregate-only watch projection; no roster/QR/PII returned. */
      summary?: boolean;
      page?: number;
      pageSize?: number;
      status?: string;
      search?: string;
      /** WS-2 sort key. Defaults to `purchased_at` (the historic order). */
      sort?: string;
      /** WS-2 keyset cursor — `{ value, id }` from the previous page's last row. */
      cursor?: { value?: string | number | null; id?: string } | null;
    } = {};
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const eventIdNum = Number(body.event_id);
    if (!Number.isFinite(eventIdNum) || eventIdNum <= 0) {
      return errorResponse("event_id required", 400);
    }

    // Permission scope: owner is always allowed. Co-organizers with
    // accepted role in (admin, editor, scanner) are also allowed BUT
    // get a PII-redacted payload when their role is 'scanner'.
    const { data: event } = await supabase
      .from("events")
      .select("id, host_id, title, location, status")
      .eq("id", eventIdNum)
      .maybeSingle();
    if (!event) return errorResponse("Event not found", 404);

    const isOwner = String(event.host_id) === String(authId);
    let effectiveRole: "owner" | "admin" | "editor" | "scanner" | null =
      isOwner ? "owner" : null;
    if (!effectiveRole) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role, accepted")
        .eq("event_id", eventIdNum)
        .eq("user_id", authId)
        .eq("accepted", true)
        .in("role", ["scanner", "editor", "admin"])
        .maybeSingle();
      if (coOrg?.role) {
        // NB: inside this `!effectiveRole` block `typeof effectiveRole`
        // narrows to null, so the cast must name the roles explicitly.
        effectiveRole = coOrg.role as "admin" | "editor" | "scanner";
      }
    }
    if (!effectiveRole) {
      return errorResponse("Not your event", 403);
    }

    if (body.summary === true) {
      // The SQL function repeats authorization and reads all counts in one
      // snapshot, avoiding pagination truncation and cross-query drift.
      const { data: summary, error: summaryError } = await supabase.rpc("watch_door_summary", {
        p_event_id: eventIdNum, p_auth_id: authId,
      });
      if (summaryError) {
        console.error("[get-event-tickets] aggregate query failed");
        return errorResponse("Door counts unavailable", 500);
      }
      if (!summary?.ok) return jsonResponse(summary ?? { ok: false, code: "unavailable" }, summary?.code === "forbidden" ? 403 : summary?.code === "not_found" ? 404 : 409);
      return jsonResponse(summary);
    }

    // Offline tokens variant — minimal payload, active tickets only.
    // Scanners need this even in offline mode, so it's allowed at any
    // role tier. Returns just qr_tokens (no PII).
    if (body.offline === true) {
      if (["cancelled", "deleted"].includes(event.status)) {
        return errorResponse("Event is not available for scanning", 409);
      }
      try {
        // Both admission rails are required. PostgREST may cap a response below
        // the requested size, so scan stable IDs until an empty terminal page.
        const [tickets, addons] = await Promise.all([
          readAllRows(() => supabase.from("tickets")
            .select("id, qr_token")
            .eq("event_id", eventIdNum)
            .eq("status", "active")
            .not("qr_token", "is", null)),
          readAllRows(() => supabase.from("order_addons")
            .select("id, qr_token")
            .eq("event_id", eventIdNum)
            .in("status", ["unfulfilled", "fulfilled"])
            .not("qr_token", "is", null)),
        ]);
        // Do not mint a newly downloaded allowlist if cancellation/deletion
        // happened during the multi-page read. Offline use is still a snapshot.
        const { data: latestEvent, error: eventError } = await supabase.from("events")
          .select("id, status").eq("id", eventIdNum).maybeSingle();
        if (eventError) throw eventError;
        if (!latestEvent) return errorResponse("Event not found", 404);
        if (["cancelled", "deleted"].includes(latestEvent.status)) {
          return errorResponse("Event is not available for scanning", 409);
        }
        const tokens = (rows: any[]) => rows.map(row => row.qr_token)
          .filter((token): token is string => typeof token === "string" && token.length > 0);
        return jsonResponse({
          ok: true,
          qr_tokens: tokens(tickets),
          addon_qr_tokens: tokens(addons),
        });
      } catch {
        // An incomplete rail must never look like a successful empty renewal.
        console.error("[get-event-tickets] complete offline allowlist unavailable");
        return errorResponse("Could not fetch complete offline tokens. Please retry.", 503);
      }
    }

    // Pagination + status filter + search — server-side per Phase 5
    // (roster needs to scale to 5,000+ attendees without client-side
    // filtering of the full list).
    const pageSize = clampInt(body.pageSize, 50, 1, 200);
    const page = clampInt(body.page, 1, 1, 1_000_000);
    const offset = (page - 1) * pageSize;
    const status = typeof body.status === "string" ? body.status : "all";
    if (body.search !== undefined && typeof body.search !== "string") {
      return errorResponse("search must be a string", 400);
    }
    const search =
      typeof body.search === "string" ? body.search.trim() : "";

    if (search.length > 200) return errorResponse("Search must be 200 characters or fewer", 400);

    // SQL restricts matches to this authorized event before count/pagination.
    // SETOF tickets preserves the ticket_types relationship and existing sort,
    // cursor, status and response projections; no global profile lookup or
    // unbounded ticket-ID list is sent through a PostgREST URL.
    let query = search
      ? supabase.rpc("search_event_tickets", {
          p_event_id: eventIdNum, p_auth_id: authId, p_search: search,
        }, { count: "exact" }).select("*, ticket_types(name)")
      : supabase.from("tickets").select("*, ticket_types(name)", { count: "exact" }).eq("event_id", eventIdNum);

    if (
      status &&
      status !== "all" &&
      ["active", "scanned", "refunded", "transfer_pending", "void"].includes(
        status,
      )
    ) {
      query = query.eq("status", status);
    }


    // ── Ordering + keyset pagination (WS-2) ────────────────────────────
    // Offset paging (.range) duplicates and skips rows the moment a ticket is
    // sold mid-scroll: every insert shifts the window under the reader. Keyset
    // on the sort tuple is stable under concurrent inserts, which is what the
    // roster's own accept criterion requires.
    //
    // `page`/`offset` remain honoured when no cursor is supplied so existing
    // callers keep working unchanged.
    const SORTS: Record<string, { col: string; asc: boolean }> = {
      purchased_at: { col: "created_at", asc: false },
      checked_in: { col: "checked_in_at", asc: false },
      ticket_tier: { col: "ticket_type_id", asc: true },
      status: { col: "status", asc: true },
    };
    const sortKey = typeof body.sort === "string" ? body.sort : "purchased_at";
    const sort = SORTS[sortKey] ?? SORTS.purchased_at;

    query = query.order(sort.col, { ascending: sort.asc, nullsFirst: false });
    // `id` breaks ties so the tuple is total — without it two tickets sold in
    // the same millisecond can swap places between pages and be served twice.
    query = query.order("id", { ascending: sort.asc });

    const cursor =
      body.cursor && typeof body.cursor === "object" ? body.cursor : null;
    if (cursor && cursor.value !== undefined && cursor.id) {
      // Strict "after the cursor" in the sort's own direction.
      const op = sort.asc ? "gt" : "lt";
      query = query.or(
        `${sort.col}.${op}.${cursor.value},and(${sort.col}.eq.${cursor.value},id.${op}.${cursor.id})`,
      );
      query = query.limit(pageSize);
    } else {
      query = query.range(offset, offset + pageSize - 1);
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("[get-event-tickets] query error:", error);
      return errorResponse("Could not fetch tickets", 500);
    }

    // Fail closed if verification dependencies are unavailable. This is only a
    // roster hint; the cancellation RPC rechecks all facts under row locks.
    const cancellationOrders = new Map<string, any>();
    const cancellationTransfers = new Set<string>();
    let cancellationVerified = false;
    if (isOwner && (data || []).length > 0) {
      const orderIds = [...new Set((data || []).map((t: any) => t.order_id).filter(Boolean))];
      const ticketIds = (data || []).map((t: any) => t.id);
      const [orders, transfers] = await Promise.all([
        orderIds.length ? supabase.from("orders").select("id,user_id,event_id,type,status,total_cents,subtotal_cents,discount_cents,stripe_payment_intent_id,stripe_checkout_session_id,cart_id,promo_code_id").in("id", orderIds) : Promise.resolve({ data: [], error: null }),
        supabase.from("ticket_transfers").select("ticket_id").in("ticket_id", ticketIds).in("status", ["pending", "accepted"]),
      ]);
      cancellationVerified = !orders.error && !transfers.error;
      if (cancellationVerified) {
        for (const order of orders.data || []) cancellationOrders.set(order.id, order);
        for (const transfer of transfers.data || []) cancellationTransfers.add(transfer.ticket_id);
      }
    }

    // ── Batched holder + tier lookup (WS-1). Two queries for the whole page,
    //    never one per row. `tickets.user_id` is the Better Auth auth id (see
    //    the table comment), which is exactly what effective_membership_tiers
    //    keys on, so no id translation is needed.
    const holderIds = [
      ...new Set((data || []).map((t: any) => t.user_id).filter(Boolean)),
    ];
    const tierByUser = new Map<string, { planKey: string; rank: number }>();
    const nameByUser = new Map<string, string>();

    // Host's perk matrix for THIS event (null → the platform defaults).
    const { data: eventRow } = await supabase
      .from("events")
      .select("perk_config")
      .eq("id", eventIdNum)
      .maybeSingle();
    const perkConfig = effectivePerkConfig(eventRow?.perk_config);

    if (holderIds.length > 0) {
      const [subsRes, usersRes] = await Promise.all([
        supabase
          .from("effective_membership_tiers")
          .select(
            "user_id, plan_key, rank",
          )
          .in("user_id", holderIds),
        supabase
          .from("users")
          .select("auth_id, username")
          .in("auth_id", holderIds),
      ]);
      for (const sub of subsRes.data || []) {
        const planKey = sub.plan_key as string;
        if (!(planKey in PLAN_RANK)) continue;
        tierByUser.set(sub.user_id, { planKey, rank: PLAN_RANK[planKey] });
      }
      for (const u of usersRes.data || []) {
        if (u.username) nameByUser.set(u.auth_id, u.username);
      }
    }

    const isScanner = effectiveRole === "scanner";
    const tickets = (data || []).map((t: any) => {
      const base = {
        id: t.id,
        event_id: t.event_id,
        ticket_type_id: t.ticket_type_id,
        status: t.status,
        qr_token: t.qr_token,
        ticket_type_name: t.ticket_types?.name || "General",
        checked_in_at: t.checked_in_at,
        checked_in_by: t.checked_in_by,
      };
      // Holder identity + membership tier. Both axes travel together but stay
      // distinct: `ticket_type_name` is the TICKET tier, `membership_tier` is
      // the SUBSCRIPTION tier. A guest (no user_id) simply has neither — null,
      // never a "Free" chip, so the roster never frames them as lesser.
      // attendee_name FIRST. It is the only one of the three a human chose on
      // purpose — "who is actually using this ticket" — and until 2026-09-18
      // nothing could write it after checkout, so it was always null and this
      // resolution never had to consider it. Now that a holder or the buyer of
      // a multi-ticket order can set it, the door has to read it, or the name
      // someone typed onto their pass never reaches the person calling it out.
      // Falls back to the account username, then the guest name, exactly as
      // before.
      const holderName =
        (typeof t.attendee_name === "string" && t.attendee_name.trim().length > 0
          ? t.attendee_name.trim()
          : null) ??
        (t.user_id ? nameByUser.get(t.user_id) || null : t.guest_name || null);
      const tier = t.user_id ? tierByUser.get(t.user_id) || null : null;
      const membership_tier = tier
        ? { planKey: tier.planKey, rank: tier.rank }
        : null;
      // Resolved server-side per WS-3 so the scanner card and the priority lane
      // read a decision rather than making one. A lapsed member reaches here
      // with tier === null and therefore gets [].
      const perks = resolvePerks(tier?.rank ?? null, perkConfig);

      if (isScanner) {
        // Scanner role (Phase-0 decision, option 3): holder name + membership
        // tier + add-on info, so the door can work the priority lane. Still no
        // emails, no purchase amounts, no Stripe references. Note this is a
        // deliberate WIDENING — the payload previously carried no holder
        // identity at all, despite this comment claiming otherwise.
        return { ...base, holder_name: holderName, membership_tier, perks };
      }
      // Owner/admin/editor get the full row
      return {
        ...t,
        ...(isOwner ? {
          username: nameByUser.get(t.user_id) || undefined,
          event_title: event.title,
          event_location: event.location,
          organizer_free_cancel: cancellationVerified
            ? organizerFreeCancellation(t, cancellationOrders.get(t.order_id), cancellationTransfers.has(t.id))
            : { eligible: false, reason: "Cancellation eligibility is unavailable. Refresh the roster." },
        } : {}),
        ticket_type_name: t.ticket_types?.name || "General",
        holder_name: holderName,
        membership_tier,
        perks,
      };
    });

    return jsonResponse({
      ok: true,
      tickets,
      page,
      pageSize,
      total: count ?? null,
      hasMore: cursor
        ? tickets.length === pageSize
        : count != null
          ? offset + pageSize < count
          : tickets.length === pageSize,
      role: effectiveRole,
      sort: sortKey,
      perk_config: perkConfig,
      // Feed this straight back as `cursor` for the next page. Null when the
      // page came up short — there is nothing after it.
      nextCursor:
        tickets.length === pageSize && data && data.length > 0
          ? {
              value: (data[data.length - 1] as any)[sort.col] ?? null,
              id: (data[data.length - 1] as any).id,
            }
          : null,
    });
  } catch (err) {
    console.error("[get-event-tickets] unexpected:", err);
    return errorResponse("Internal error", 500);
  }
});
