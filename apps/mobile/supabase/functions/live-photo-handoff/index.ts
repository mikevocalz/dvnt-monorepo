import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, verifySession } from '../_shared/verify-session.ts';
import { parseLivePhotoHandoff } from '../_shared/live-photo-handoff.ts';

Deno.serve(async (req: Request) => {
  const headers = { ...corsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405);
  try {
    // Bound requests before JSON parsing; no image bytes or URLs belong here.
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8192) {
            await reader.cancel();
            return reply({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Request too large' } }, 413);
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const text = new TextDecoder().decode(bytes);
    let body: ReturnType<typeof parseLivePhotoHandoff>;
    try { body = parseLivePhotoHandoff(JSON.parse(text)); }
    catch { return reply({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid handoff request' } }, 400); }
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const owner = await verifySession(db, req);
    if (!owner) return reply({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue' } }, 401);
    const { data, error } = await db.rpc('live_photo_handoff_action', {
      p_owner: owner, p_action: body.action, p_draft: body.draftId,
      p_id: body.id ?? null, p_max_count: body.maxCount ?? null,
      p_pairs: body.pairs ?? null, p_request: body.requestId ?? null,
    });
    if (error) {
      // Never log request/auth/media contents or return raw database diagnostics.
      console.error('[live-photo-handoff] RPC failure', error.code);
      return reply({ ok: false, error: { code: 'UNAVAILABLE', message: 'Handoff temporarily unavailable' } }, 503);
    }
    return reply(data, data?.ok ? 200 : data?.error?.code === 'NOT_FOUND' ? 404 : 409);
  } catch {
    return reply({ ok: false, error: { code: 'UNAVAILABLE', message: 'Handoff temporarily unavailable' } }, 503);
  }
});
