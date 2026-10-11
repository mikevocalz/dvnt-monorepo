import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifySession, corsHeaders } from '../_shared/verify-session.ts';
import { createEmbedSettingsHandler } from '../_shared/ticket-embed-settings.ts';

const enabled = Deno.env.get('TICKET_EMBED_BUILDER_ENABLED') !== 'false';
// A disabled builder makes no database client and changes no existing flow.
const db = enabled ? createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
) : null;

Deno.serve(createEmbedSettingsHandler({
  db, enabled, headers: corsHeaders,
  paymentsEnabled: Deno.env.get('TICKET_EMBED_PAYMENTS_ENABLED') === 'true' && !!Deno.env.get('STRIPE_PUBLISHABLE_KEY') && !!Deno.env.get('STRIPE_SECRET_KEY'),
  siteOrigin: new URL(Deno.env.get('PUBLIC_SITE_URL') || 'https://dvntapp.live').origin,
  authenticate: (request) => verifySession(db, request),
}));
