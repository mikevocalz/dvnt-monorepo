import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHostPayoutSetupEmailHandler } from '../_shared/host-payout-setup-email.ts';
import { sendResendEmail } from '../_shared/send-resend-email.ts';

const url = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
const from = Deno.env.get('RESEND_FROM_EMAIL') || '';
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error('Reminder operation unavailable');
  return data;
}

Deno.serve(createHostPayoutSetupEmailHandler({
  authorized: req => !!serviceKey && req.headers.get('authorization') === `Bearer ${serviceKey}`,
  sendEnabled: Deno.env.get('DVNT_HOST_PAYOUT_SETUP_EMAIL_ENABLED') === 'true' &&
    Boolean(from && Deno.env.get('RESEND_API_KEY') && stripeKey.startsWith('sk_live_')),
  candidate: eventId => rpc('host_payout_setup_candidate', { p_event_id: eventId }),
  async lookup(id) {
    if (!stripeKey.startsWith('sk_live_')) return null;
    const res = await fetch(`https://api.stripe.com/v1/accounts/${id}`, {
      headers: { Authorization: `Bearer ${stripeKey}` }, signal: AbortSignal.timeout(12000),
    });
    return res.ok ? await res.json() : null;
  },
  claim: (eventId, host) => rpc('claim_host_payout_setup_email', {
    p_event_id: eventId, p_host_id: host.hostId, p_email: host.email, p_account: host.accountId,
  }),
  send: request => sendResendEmail({ ...request, from, timeoutMs: 12000 }),
  async accepted(id, receipt) {
    if (await rpc('record_host_payout_setup_email', { p_id: id, p_provider_id: receipt }) !== true) throw new Error('Receipt record pending');
  },
}));
