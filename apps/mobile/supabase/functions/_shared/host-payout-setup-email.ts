export type HostCandidate = { hostId: string; email: string; accountId: string | null };
export type StripeAccountCheck = {
  id: string; object: string; metadata?: { dvnt_host_id?: string };
  payouts_enabled: boolean; charges_enabled: boolean; details_submitted: boolean;
  requirements?: { currently_due?: string[]; past_due?: string[]; pending_verification?: string[]; disabled_reason?: string | null };
};
type Deps = {
  authorized: (req: Request) => boolean;
  candidate: (eventId: number) => Promise<HostCandidate | null>;
  lookup: (accountId: string) => Promise<StripeAccountCheck | null>;
  claim: (eventId: number, host: HostCandidate) => Promise<string | null>;
  send: (request: { to: string; subject: string; html: string; idempotencyKey: string }) => Promise<string | null>;
  accepted: (id: string, receipt: string) => Promise<void>;
  sendEnabled: boolean;
};
const subject = 'Finish setting up your DVNT payouts';
const html = '<p>Connect Stripe in DVNT to finish setting up payouts for your events. If Stripe needs more information, you can review and complete those steps there.</p><p><a href="https://dvntapp.live/feed/events/organizer-setup">Open payout setup in DVNT</a></p><p>This is a setup reminder, not a payment confirmation. DVNT will never ask you to send bank details by email.</p>';
const accountPattern = /^acct_[A-Za-z0-9]{12,}$/;
function requiresSetup(host: HostCandidate, account: StripeAccountCheck | null): boolean | null {
  if (!host.accountId) return true;
  if (!account || account.object !== 'account' || account.id !== host.accountId ||
      account.metadata?.dvnt_host_id !== host.hostId ||
      typeof account.payouts_enabled !== 'boolean' || typeof account.charges_enabled !== 'boolean' ||
      typeof account.details_submitted !== 'boolean') return null;
  if (account.payouts_enabled && account.charges_enabled && account.details_submitted) return false;
  const req = account.requirements;
  if (!req || !Array.isArray(req.currently_due) || !Array.isArray(req.past_due) || !Array.isArray(req.pending_verification)) return null;
  // An explicit reviewing account is not actionable by this setup email.
  // Stripe can put the same field in due and pending-verification lists.
  if (req.disabled_reason && req.disabled_reason !== 'requirements.past_due') return false;
  const pending = new Set(req.pending_verification);
  const actionable = [...req.currently_due, ...req.past_due].some(field =>
    typeof field === 'string' && field.trim().length > 0 && !pending.has(field)
  );
  return actionable || (!account.details_submitted && !pending.size);
}

async function fingerprint(eventId: number, host: HostCandidate) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    JSON.stringify(['host-payout-setup:v1', eventId, host.hostId, host.email, host.accountId, subject, html]),
  ));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/** Explicit service operation only. No client CORS, scheduler, payout, or retry. */
export function createHostPayoutSetupEmailHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!deps.authorized(req)) return reply({ error: 'unauthorized' }, 401);
    let body;
    try { body = await req.json(); } catch { return reply({ error: 'bad_request' }, 400); }
    const id = body?.eventId, mode = body?.mode;
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !['preview', 'send'].includes(mode) ||
        (mode === 'send' && (typeof body.approvalFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.approvalFingerprint)))) {
      return reply({ error: 'explicit_scope_required' }, 400);
    }
    if (mode === 'send' && !deps.sendEnabled) return reply({ error: 'send_disabled' }, 403);
    try {
      const host = await deps.candidate(id);
      if (!host) return reply({ result: 'ineligible' });
      if (!host.hostId || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(host.email) ||
          (host.accountId !== null && !accountPattern.test(host.accountId))) return reply({ error: 'status_unavailable' }, 503);
      const needed = requiresSetup(host, host.accountId ? await deps.lookup(host.accountId) : null);
      if (needed === null) return reply({ error: 'status_unavailable' }, 503);
      if (!needed) return reply({ result: 'no_action_needed' });
      const approvalFingerprint = await fingerprint(id, host);
      if (mode === 'preview') return reply({ result: 'review_required', eventId: id, recipient: host.email, subject, html, approvalFingerprint });
      if (body.approvalFingerprint !== approvalFingerprint) return reply({ error: 'review_changed' }, 409);
      const deliveryId = await deps.claim(id, host);
      if (!deliveryId) return reply({ result: 'already_claimed_or_ineligible' });
      // Terminal hold on unknown outcomes, even after provider deduplication expires.
      try {
        const receipt = await deps.send({ to: host.email, subject, html, idempotencyKey: `host-payout-setup:v1:${deliveryId}` });
        if (!receipt?.trim()) return reply({ result: 'reconcile_required', deliveryId }, 409);
        try {
          await deps.accepted(deliveryId, receipt);
        } catch {
          return reply({ result: 'accepted_record_pending', deliveryId }, 409);
        }
        return reply({ result: 'provider_accepted', deliveryId });
      } catch {
        return reply({ result: 'reconcile_required', deliveryId }, 409);
      }
    } catch {
      return reply({ error: 'status_unavailable' }, 503);
    }
  };
}
