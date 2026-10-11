import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifySession, corsHeaders } from '../_shared/verify-session.ts';
import { createEmbedSettingsHandler } from '../_shared/ticket-embed-settings.ts';

const enabled = Deno.env.get('TICKET_EMBED_BUILDER_ENABLED') === 'true';
// A disabled builder makes no database client and changes no existing flow.
const db = enabled ? createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
) : null;

Deno.serve(createEmbedSettingsHandler({
  db, enabled, headers: corsHeaders,
  authenticate: (request) => verifySession(db, request),
}));
