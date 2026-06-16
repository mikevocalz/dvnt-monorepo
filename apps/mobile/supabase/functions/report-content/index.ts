/**
 * Edge Function: report-content
 *
 * Files a user report against a piece of UGC. App Store Guideline 1.2
 * requires a working report mechanism for every user-generated content
 * surface; this is the universal primitive used by post, comment, event,
 * story, profile, and DM reports. Lynk video rooms have their own
 * dedicated table (reports_video_rooms).
 *
 * Auth required (Better Auth session token).
 *
 * Request body:
 *   {
 *     entity_type: 'post' | 'comment' | 'event' | 'story' | 'profile' | 'message',
 *     entity_id:   string,                                  // natural key
 *     reason:      'spam' | 'harassment_bullying' | 'hate_speech'
 *                  | 'violence_threats' | 'sexual_content' | 'minor_safety'
 *                  | 'self_harm' | 'misinformation' | 'impersonation' | 'other',
 *     details?:    string,                                  // ≤ 1000 chars
 *   }
 *
 * Response:
 *   200 { ok: true, id: <uuid>, already_reported: false }
 *   200 { ok: true, id: <existing>, already_reported: true }   // idempotent
 *   400 / 401 / 500 errors with { error: string }
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

const ALLOWED_ENTITY_TYPES = new Set([
  "post",
  "comment",
  "event",
  "story",
  "profile",
  "message",
]);

const ALLOWED_REASONS = new Set([
  "spam",
  "harassment_bullying",
  "hate_speech",
  "violence_threats",
  "sexual_content",
  "minor_safety",
  "self_harm",
  "misinformation",
  "impersonation",
  "other",
]);

const MAX_DETAILS_LENGTH = 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return errorResponse("Server configuration error", 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const reporterId = await verifySession(supabase, req);
    if (!reporterId) return errorResponse("Unauthorized", 401);

    let body: {
      entity_type?: string;
      entity_id?: string | number;
      reason?: string;
      details?: string;
    } = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const entityType = String(body.entity_type || "").trim();
    const entityId =
      body.entity_id == null ? "" : String(body.entity_id).trim();
    const reason = String(body.reason || "").trim();
    const details =
      typeof body.details === "string"
        ? body.details.trim().slice(0, MAX_DETAILS_LENGTH)
        : null;

    if (!entityType || !ALLOWED_ENTITY_TYPES.has(entityType)) {
      return errorResponse("Invalid entity_type", 400);
    }
    if (!entityId) {
      return errorResponse("Missing entity_id", 400);
    }
    if (!reason || !ALLOWED_REASONS.has(reason)) {
      return errorResponse("Invalid reason", 400);
    }

    // Idempotency: a user can only meaningfully report the same content once.
    // If they tap report again, return the existing row instead of stacking
    // duplicates that would skew moderation triage.
    const { data: existing } = await supabase
      .from("content_reports")
      .select("id, status")
      .eq("reporter_id", reporterId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .in("status", ["open", "reviewing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return jsonResponse({
        ok: true,
        id: existing.id,
        already_reported: true,
      });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("content_reports")
      .insert({
        reporter_id: reporterId,
        entity_type: entityType,
        entity_id: entityId,
        reason,
        details,
        status: "open",
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      console.error("[report-content] insert error:", insertError);
      return errorResponse("Failed to file report", 500);
    }

    console.log(
      `[report-content] filed: reporter=${reporterId} ${entityType}:${entityId} reason=${reason} id=${inserted.id}`,
    );

    return jsonResponse({
      ok: true,
      id: inserted.id,
      already_reported: false,
    });
  } catch (err: any) {
    console.error("[report-content] error:", err);
    return errorResponse(err?.message || "Internal error", 500);
  }
});
