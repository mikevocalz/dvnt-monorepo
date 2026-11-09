/** Explicit organizer cancellation of one verified free admission. Never refunds or sends. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, jsonResponse, errorResponse, optionsResponse } from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { parseOrganizerCancellation, cancellationErrors } from "../_shared/organizer-free-cancellation.ts";

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);
  try {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const db = createClient(Deno.env.get('SUPABASE_URL') || '', key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${key}` } },
    });
    const actor = await verifySession(db, req);
    if (!actor) return errorResponse('Unauthorized', 401);
    if (!checkRateLimit(actor, 'organizer-cancel-free-ticket', { maxRequests: 20, windowMs: 60_000 }).allowed)
      return errorResponse('Too many cancellation requests. Please wait.', 429);
    let body;
    try { body = await req.json(); } catch { return errorResponse('Invalid JSON body', 400); }
    const input = parseOrganizerCancellation(body);
    if (!input) return errorResponse(cancellationErrors.invalid_request, 400);
    // Authorization, current-holder comparison, financial evidence, scan/transfer
    // races, audit insertion and inventory are one database transaction.
    const { data, error } = await db.rpc('organizer_cancel_free_ticket', { ...input, p_actor_id: actor });
    if (error) {
      console.error('[organizer-cancel-free-ticket] transaction unavailable:', error.code);
      return errorResponse('Cancellation could not be confirmed. Refresh the roster before retrying.', 503);
    }
    if (!data?.ok) {
      const code = data?.error || 'not_cancellable';
      return jsonResponse({ ok: false, code, error: cancellationErrors[code] || cancellationErrors.not_cancellable }, code === 'not_authorized' ? 403 : 409);
    }
    return jsonResponse({ ok: true, ticket_id: input.p_ticket_id, changed: data.changed === true,
      message: 'Free ticket cancelled. No refund, replacement or message was sent.' });
  } catch {
    return errorResponse('Cancellation could not be confirmed. Refresh the roster before retrying.', 500);
  }
});
