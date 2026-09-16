/**
 * bulk-comp-tickets Edge Function
 *
 * POST /bulk-comp-tickets
 * Body: {
 *   event_id: number,
 *   tier_id: string,                // ticket_types.id (must belong to event)
 *   recipients: string[],           // usernames OR emails, mixed allowed
 *   note?: string,                  // optional message tucked in entity_payload
 * }
 *
 * Owner or accepted admin only. Issues free tickets (status=active,
 * purchase_amount_cents=0) to every resolved recipient. Skips silently
 * if a recipient already has an active/transfer_pending ticket on
 * this tier (no duplicates). Enforces tier capacity — if the comp
 * batch would exceed quantity_total, returns 409 with a "would_exceed"
 * indicator and issues NOTHING.
 *
 * Sends push + activity feed entry to every issued recipient. The
 * actor is the host (so the recipient sees who comped them).
 *
 * Rate-limited 3 per 5 minutes per (sender, event).
 *
 * Returns:
 *   { ok: true, data: { issued, skipped: [{recipient, reason}] } }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { normalizeCompRecipient as normRecipient, dedupeCompAccounts } from "../_shared/comp-recipients.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const MAX_BATCH = 100;

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

function err(message: string, status: number, req: Request, extras?: any) {
  return json(
    { ok: false, error: { message, ...(extras || {}) } },
    status,
    req,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return err("Method not allowed", 405, req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) return err("Unauthorized", 401, req);

    let body: {
      event_id?: number | string;
      tier_id?: string;
      recipients?: string[];
      note?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON body", 400, req);
    }

    const eventId = Number(body.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return err("event_id required", 400, req);
    }
    const tierId = typeof body.tier_id === "string" ? body.tier_id : "";
    if (!tierId) return err("tier_id required", 400, req);

    const recipientsRaw = Array.isArray(body.recipients) ? body.recipients : [];
    if (recipientsRaw.length === 0) {
      return err("At least one recipient required", 400, req);
    }
    if (recipientsRaw.length > MAX_BATCH) {
      return err(
        `Batch too large; max ${MAX_BATCH} recipients per call`,
        400,
        req,
      );
    }

    // Permission: owner or accepted admin only.
    const { data: event } = await supabase
      .from("events")
      .select("id, host_id, title, status")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) return err("Event not found", 404, req);
    if (event.status === "cancelled") {
      return err("Event is cancelled", 409, req);
    }
    const isOwner = String(event.host_id) === String(authId);
    if (!isOwner) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role, accepted")
        .eq("event_id", eventId)
        .eq("user_id", authId)
        .eq("accepted", true)
        .eq("role", "admin")
        .maybeSingle();
      if (!coOrg) {
        return err(
          "Only the event owner or an admin co-organizer can comp tickets",
          403,
          req,
        );
      }
    }

    const rl = checkRateLimit(authId, `bulk-comp:${eventId}`, {
      maxRequests: 3,
      windowMs: 5 * 60_000,
    });
    if (!rl.allowed) {
      return err(
        "Too many comp batches. Wait a few minutes and try again.",
        429,
        req,
      );
    }

    // Tier must belong to this event.
    const { data: tier } = await supabase
      .from("ticket_types")
      .select("id, event_id, name, quantity_total, quantity_sold, is_active, category")
      .eq("id", tierId)
      .maybeSingle();
    if (!tier || tier.event_id !== eventId) {
      return err("Tier not found for this event", 404, req);
    }
    if (tier.is_active === false) {
      return err("Tier is inactive", 409, req);
    }

    // Get host's integer user id (for actor_id on notifications).
    const { data: hostRow } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", authId)
      .maybeSingle();
    const hostIntId = hostRow?.id ?? null;

    // Normalize + dedupe input.
    const seen = new Set<string>();
    const parsed: { raw: string; norm: ReturnType<typeof normRecipient> }[] = [];
    for (const r of recipientsRaw) {
      const norm = normRecipient(r);
      if (!norm) {
        parsed.push({ raw: String(r), norm: null });
        continue;
      }
      const k = `${norm.kind}:${norm.value}`;
      if (seen.has(k)) continue; // dedupe within batch
      seen.add(k);
      parsed.push({ raw: String(r), norm });
    }

    const skipped: { recipient: string; reason: string }[] = [];
    const validParsed = parsed.filter((p) => {
      if (!p.norm) {
        skipped.push({ recipient: p.raw, reason: "Use a DVNT username or account email; phone delivery is not available" });
        return false;
      }
      return true;
    });

    // Resolve usernames → auth_ids via app users table (username + auth_id)
    const usernames = validParsed
      .filter((p) => p.norm!.kind === "username")
      .map((p) => p.norm!.value);
    const emails = validParsed
      .filter((p) => p.norm!.kind === "email")
      .map((p) => p.norm!.value);

    const userByUsername = new Map<
      string,
      { authId: string; intId: number | null }
    >();
    const userByEmail = new Map<
      string,
      { authId: string; intId: number | null }
    >();

    if (usernames.length > 0) {
      const { data: rows, error: lookupError } = await supabase
        .from("users")
        .select("id, username, auth_id")
        .in("username", usernames);
      if (lookupError) throw new Error("Could not resolve recipients. Try again.");
      for (const r of rows || []) {
        userByUsername.set(String((r as any).username).toLowerCase(), {
          authId: (r as any).auth_id,
          intId: (r as any).id,
        });
      }
    }
    if (emails.length > 0) {
      const { data: rows, error: lookupError } = await supabase
        .from("user")
        .select("id, email")
        .in("email", emails);
      if (lookupError) throw new Error("Could not resolve recipients. Try again.");
      for (const r of rows || []) {
        // also enrich int id
        const authId2 = (r as any).id;
        const { data: appUser, error: appUserError } = await supabase
          .from("users")
          .select("id")
          .eq("auth_id", authId2)
          .maybeSingle();
        if (appUserError) throw new Error("Could not resolve recipient account");
        if (!appUser) continue;
        userByEmail.set(String((r as any).email).toLowerCase(), {
          authId: authId2,
          intId: appUser?.id ?? null,
        });
      }
    }

    // Resolve each recipient → authId, intId or skipped reason.
    type Resolved = {
      raw: string;
      authId: string;
      intId: number | null;
    };
    const resolved: Resolved[] = [];
    for (const p of validParsed) {
      const n = p.norm!;
      const u =
        n.kind === "username"
          ? userByUsername.get(n.value)
          : userByEmail.get(n.value);
      if (!u?.authId) {
        skipped.push({ recipient: p.raw, reason: "No DVNT account found; ask the guest to sign up, then comp their account" });
        continue;
      }
      resolved.push({ raw: p.raw, authId: u.authId, intId: u.intId });
    }

    if (resolved.length === 0) {
      return json(
        { ok: true, data: { issued: 0, skipped } },
        200,
        req,
      );
    }

    // Dedupe identities after resolution: @name and name@email may be one user.
    const accounts = dedupeCompAccounts(resolved);
    skipped.push(...accounts.skipped);
    const { data: issuance, error: issueError } = await supabase.rpc("issue_comp_tickets_atomic", {
      p_event_id: eventId,
      p_tier_id: tierId,
      p_actor_id: authId,
      p_user_ids: accounts.unique.map((recipient) => recipient.authId),
    });
    if (issueError) {
      console.error("[bulk-comp-tickets] atomic issuance failed:", issueError);
      return err("Could not issue tickets. Try again.", 500, req);
    }
    if (!issuance?.ok) {
      return err(issuance?.error || "Could not issue tickets", 409, req, {
        would_exceed: issuance?.would_exceed === true,
        remaining: issuance?.remaining,
      });
    }
    const inserted = (issuance.tickets || []) as { id: string; user_id: string }[];
    const issuedIds = new Set(inserted.map((ticket) => ticket.user_id));
    const toIssue = accounts.unique.filter((recipient) => issuedIds.has(recipient.authId));
    for (const recipient of accounts.unique) {
      if (!issuedIds.has(recipient.authId)) skipped.push({
        recipient: recipient.raw, reason: "Already holds a ticket in this tier",
      });
    }

    // In-app notifications
    const intIds = toIssue
      .map((r) => r.intId)
      .filter((id): id is number => typeof id === "number");
    if (intIds.length > 0) {
      const note = (body.note || "").toString().trim().slice(0, 240) || null;
      await supabase.from("notifications").insert(
        intIds.map((uid) => ({
          recipient_id: uid,
          actor_id: hostIntId,
          type: "ticket_comped",
          entity_type: "event",
          entity_id: String(eventId),
          entity_payload: {
            title: event.title || "You're on the list",
            body: note || `${event.title || "An event"} — comped`,
            tier: tier.name,
          },
        })),
      );

      // Push
      const { data: tokens } = await supabase
        .from("push_tokens")
        .select("token")
        .in("user_id", intIds);
      if (tokens && tokens.length > 0) {
        const pushTitle = `${event.title || "Event"}: You're comped`;
        const pushBody =
          (body.note || "").toString().trim().slice(0, 180) ||
          `${tier.name} ticket added to your wallet.`;
        const messages = tokens.map((t: any) => ({
          to: t.token,
          title: pushTitle,
          body: pushBody,
          data: {
            type: "ticket_comped",
            entityType: "event",
            entityId: String(eventId),
            url: `https://dvntapp.live/e/${eventId}`,
          },
          sound: "default",
          channelId: "default",
        }));
        try {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(messages),
          });
        } catch (pushErr) {
          console.warn("[bulk-comp-tickets] push failed:", pushErr);
        }
      }
    }

    return json(
      {
        ok: true,
        data: {
          issued: inserted?.length || 0,
          skipped,
          tier: tier.name,
        },
      },
      200,
      req,
    );
  } catch (e: any) {
    console.error("[bulk-comp-tickets] unexpected:", e);
    return err(e?.message || "Internal error", 500, req);
  }
});
