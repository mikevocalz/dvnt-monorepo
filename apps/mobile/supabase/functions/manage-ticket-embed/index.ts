import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifySession, corsHeaders } from '../_shared/verify-session.ts';
import { createEmbedSettingsHandler } from '../_shared/ticket-embed-settings.ts';
import { resolveTicketEmbedRuntime } from '../_shared/ticket-embed-runtime.ts';

const enabled = Deno.env.get('TICKET_EMBED_BUILDER_ENABLED') !== 'false';
const runtime = resolveTicketEmbedRuntime((name) => Deno.env.get(name));
// Draft settings stay usable even when payments are not configured. Publication
// uses the exact same gate as ticket-embed, never a mere nonempty-key check.
const db = enabled ? createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
) : null;

Deno.serve(createEmbedSettingsHandler({
  db, enabled, headers: corsHeaders,
  paymentsEnabled: runtime.paymentsEnabled,
  siteOrigin: runtime.siteOrigin,
  authenticate: (request) => verifySession(db, request),
}));
