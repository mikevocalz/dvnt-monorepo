import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_BYTES = 128 * 1024;

function hosted(value: unknown): string | null {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
}
function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.trim()) return value.split("\n").map((v) => v.trim()).filter(Boolean);
  return [];
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function cents(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n / 100) : "";
}

function safeClientPayload(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const serialized = JSON.stringify(raw);
  if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) return null;

  // Explicit allow-list. Server drafts are product configuration, never a
  // convenient bucket for ticket/order/guest/payment/runtime state.
  const allowed = [
    "title","description","location","locationData","eventImages","tags",
    "eventDate","endDate","ticketPrice","maxAttendees","youtubeUrl",
    "attachLynkRoom","ticketingEnabled","visibility","ageRestriction",
    "isOnline","dressCode","doorPolicy","lineup","perks","ticketTiers",
    "addons","coOrganizers","flyerImage","flyerMediaType","flyerFallbackImage",
    "eventType","disclaimers","isNsfw","currentStep","scheduleNeedsReview",
    "draftSourceEventId","promoterTemplates"
  ];
  const out: Record<string, unknown> = {};
  for (const key of allowed) if (key in raw) out[key] = raw[key];

  // Cross-device drafts can only retain hosted media. Device/browser local
  // URIs remain in the existing local MMKV draft and are intentionally omitted.
  out.flyerImage = hosted(out.flyerImage);
  out.flyerFallbackImage = hosted(out.flyerFallbackImage);
  out.eventImages = Array.isArray(out.eventImages)
    ? out.eventImages.map(hosted).filter(Boolean)
    : [];
  return out;
}

async function duplicatePayload(db: any, authId: string, eventId: number) {
  const { data: event, error } = await db
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !event || String(event.host_id) !== authId) return null;

  const [{ data: tiers }, { data: addons }, { data: coorgs }, { data: promoters }] =
    await Promise.all([
      db.from("ticket_types").select("*").eq("event_id", eventId).order("created_at"),
      db.from("ticket_addons").select("*, ticket_addon_variants(*)").eq("event_id", eventId).order("sort_order"),
      db.from("event_co_organizers").select("user_id,role,accepted").eq("event_id", eventId),
      db.from("event_promoters")
        .select("user_id,display_name,code,customer_discount_bps,promoter_commission_bps,status")
        .eq("event_id", eventId).neq("status", "removed"),
    ]);

  const authIds = [
    ...(coorgs || []).map((r: any) => r.user_id),
    ...(promoters || []).map((r: any) => r.user_id),
  ].filter(Boolean);
  const { data: people } = authIds.length
    ? await db.from("users").select("id,auth_id,username,first_name,last_name,avatar_id(url)").in("auth_id", authIds)
    : { data: [] };
  const peopleByAuth = new Map((people || []).map((u: any) => [u.auth_id, u]));

  const tierIdMap = new Map<string,string>();
  const now = Date.now();
  const ticketTiers = (tiers || [])
    .filter((t: any) => t.is_active !== false)
    .map((t: any, i: number) => {
      const id = `dup_tier_${now}_${i}`;
      tierIdMap.set(String(t.id), id);
      return {
        id,
        name: t.name || "General Admission",
        category: t.category || "admission",
        priceCents: Number(t.price_cents) || 0,
        quantity: Number(t.quantity_total) || 0,
        maxPerUser: Number(t.max_per_user) || 4,
        description: t.description || "",
        saleStart: t.sale_start || "",
        saleEnd: t.sale_end || "",
        tierType: t.tier_type || "ga",
        visibility: t.tier_visibility || "public",
        unlockCode: t.unlock_code || "",
        priceSchedule: (Array.isArray(t.price_schedule) ? t.price_schedule : []).map((p: any) => ({
          effectiveAt: p.effective_at,
          priceDollars: cents(p.price_cents),
        })),
        subAllocations: (Array.isArray(t.sub_allocations) ? t.sub_allocations : []).map((p: any) => ({
          quantity: String(p.quantity ?? ""),
          priceDollars: cents(p.price_cents),
        })),
      };
    });

  const draftAddons = (addons || []).map((a: any, i: number) => ({
    id: `dup_addon_${now}_${i}`,
    name: a.name || "",
    description: a.description || "",
    addonType: a.addon_type,
    bindingMode: a.binding_mode,
    priceDollars: cents(a.price_cents),
    minPriceDollars: cents(a.min_price_cents),
    quantity: a.quantity_total == null ? "" : String(a.quantity_total),
    requiresTierId: a.requires_tier_id ? tierIdMap.get(String(a.requires_tier_id)) ?? null : null,
    isRedeemable: Boolean(a.is_redeemable),
    status: a.status === "sold_out" || a.status === "ended" ? "on_sale" : a.status,
    variants: (a.ticket_addon_variants || []).map((v: any) => ({
      size: v.option_values?.size ?? "",
      color: v.option_values?.color ?? "",
      priceDollars: cents(v.price_cents),
      quantity: v.quantity_total == null ? "" : String(v.quantity_total),
    })),
  }));

  const coOrganizers = (coorgs || []).flatMap((row: any) => {
    const u: any = peopleByAuth.get(row.user_id);
    if (!u?.username) return [];
    return [{
      id: String(u.id),
      authId: u.auth_id,
      username: u.username,
      avatar: Array.isArray(u.avatar_id) ? u.avatar_id[0]?.url ?? "" : u.avatar_id?.url ?? "",
      name: [u.first_name,u.last_name].filter(Boolean).join(" ") || u.username,
    }];
  });

  const promoterTemplates = (promoters || []).map((p: any) => {
    const u: any = p.user_id ? peopleByAuth.get(p.user_id) : null;
    return {
      username: u?.username ?? null,
      displayName: p.display_name || u?.username || "",
      code: p.code || "",
      customerDiscountBps: Number(p.customer_discount_bps) || 0,
      promoterCommissionBps: Number(p.promoter_commission_bps) || 0,
    };
  });

  const primaryVideo = hosted(event.video_flyer_url);
  const flyerImage = hosted(event.flyer_image_url) || hosted(event.cover_image_url) || hosted(event.image);
  const eventImages = Array.isArray(event.images)
    ? event.images.map((m: any) => hosted(typeof m === "string" ? m : m?.url)).filter(Boolean)
    : [];

  return {
    title: event.title ? `${event.title} (Copy)` : "Untitled event (Copy)",
    description: event.description || "",
    location: event.location || "",
    locationData: {
      name: event.location_name || event.location || "",
      latitude: event.location_lat ?? undefined,
      longitude: event.location_lng ?? undefined,
      address: event.location_address || undefined,
    },
    eventImages,
    tags: [],
    // Preserve the old time as reference but force explicit review before publish.
    eventDate: event.start_date || new Date().toISOString(),
    endDate: event.end_date || null,
    ticketPrice: event.price == null ? "" : String(event.price),
    maxAttendees: event.max_attendees == null ? "" : String(event.max_attendees),
    youtubeUrl: event.youtube_video_url || "",
    attachLynkRoom: false,
    ticketingEnabled: Boolean(event.ticketing_enabled),
    visibility: event.visibility === "private" || event.visibility === "link_only" ? event.visibility : "public",
    ageRestriction: ["18+","21+"].includes(event.age_restriction) ? event.age_restriction : "none",
    isOnline: Boolean(event.is_online),
    dressCode: event.dress_code || "",
    doorPolicy: event.door_policy || "",
    lineup: list(event.lineup),
    perks: list(event.perks),
    ticketTiers,
    addons: draftAddons,
    coOrganizers,
    // Guests/attendees are never copied.
    flyerImage: primaryVideo || flyerImage,
    flyerMediaType: primaryVideo ? "video" : "image",
    flyerFallbackImage: primaryVideo ? flyerImage : null,
    eventType: event.category || null,
    disclaimers: event.disclaimers || "",
    isNsfw: Boolean(event.nsfw),
    currentStep: 0,
    scheduleNeedsReview: true,
    draftSourceEventId: eventId,
    promoterTemplates,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  });
  const authId = await verifySession(db, req);
  if (!authId) return errorResponse("Unauthorized", 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON", 400); }
  const action = String(body.action || "list");

  if (action === "list") {
    const { data, error } = await db.from("event_drafts")
      .select("id,title,source_event_id,revision,created_at,updated_at")
      .eq("owner_auth_id", authId).order("updated_at", { ascending: false }).limit(100);
    if (error) return errorResponse("Could not load drafts", 500);
    return jsonResponse({ ok: true, drafts: data || [] });
  }

  if (action === "get") {
    const id = String(body.draftId || "");
    if (!UUID_RE.test(id)) return errorResponse("Invalid draftId", 400);
    const { data } = await db.from("event_drafts").select("*")
      .eq("id", id).eq("owner_auth_id", authId).maybeSingle();
    if (!data) return errorResponse("Draft not found", 404);
    return jsonResponse({ ok: true, draft: data });
  }

  if (action === "delete") {
    const id = String(body.draftId || "");
    if (!UUID_RE.test(id)) return errorResponse("Invalid draftId", 400);
    const { error } = await db.from("event_drafts").delete()
      .eq("id", id).eq("owner_auth_id", authId);
    if (error) return errorResponse("Could not delete draft", 500);
    return jsonResponse({ ok: true, deleted: true });
  }

  if (action === "duplicate_event") {
    const eventId = Number(body.eventId);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return errorResponse("Invalid eventId", 400);
    const payload = await duplicatePayload(db, authId, eventId);
    if (!payload) return errorResponse("Event not found or not owned by you", 404);
    const { data, error } = await db.from("event_drafts").insert({
      owner_auth_id: authId,
      source_event_id: eventId,
      title: text(payload.title).slice(0, 180) || "Untitled event (Copy)",
      payload,
      revision: 1,
    }).select("*").single();
    if (error) return errorResponse("Could not duplicate event", 500);
    return jsonResponse({ ok: true, draft: data });
  }

  if (action === "save") {
    const payload = safeClientPayload(body.payload);
    if (!payload) return errorResponse("Invalid or oversized draft payload", 400);
    const title = text(payload.title).trim().slice(0, 180) || "Untitled event";
    const id = typeof body.draftId === "string" ? body.draftId : "";
    if (id) {
      if (!UUID_RE.test(id)) return errorResponse("Invalid draftId", 400);
      const expected = Number(body.expectedRevision);
      if (!Number.isSafeInteger(expected) || expected <= 0) {
        return errorResponse("expectedRevision is required when updating a draft", 409);
      }
      const { data, error } = await db.from("event_drafts")
        .update({ title, payload, revision: expected + 1, updated_at: new Date().toISOString() })
        .eq("id", id).eq("owner_auth_id", authId).eq("revision", expected)
        .select("*").maybeSingle();
      if (error) return errorResponse("Could not save draft", 500);
      if (!data) return errorResponse("Draft changed on another device. Reload it before saving.", 409);
      return jsonResponse({ ok: true, draft: data });
    }
    const { data, error } = await db.from("event_drafts").insert({
      owner_auth_id: authId,
      source_event_id: Number.isSafeInteger(Number(payload.draftSourceEventId))
        ? Number(payload.draftSourceEventId) : null,
      title,
      payload,
      revision: 1,
    }).select("*").single();
    if (error) return errorResponse("Could not save draft", 500);
    return jsonResponse({ ok: true, draft: data });
  }

  return errorResponse("Unknown action", 400);
});
