import { invokeEdge } from './invoke-edge';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;
export interface ReplacementQuote {
  resume_only?: boolean;
  quote_id: string; order_id: string; total_cents: number; previous_total_cents: number;
  currency: string; expires_at: string; tax_mode: 'none' | 'at_checkout';
  lines?: { name: string; quantity: number; unit_price_cents: number }[];
}
export interface ReplacementPayment {
  order_id: string; cart_id?: string;
  payment: {kind:'pending'} | { kind: 'hosted'; url: string } | { kind: 'payment_sheet'; client_secret: string; publishable_key: string };
}
export type ReplacementIdentity = { kind: 'member'; actor: string } | { kind: 'guest' };
class CheckoutQuoteRefused extends Error {
  constructor(readonly code: 'quote_changed'|'quote_expired') { super(code); }
}
const cents = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
function validQuote(q: any, orderId: string): q is ReplacementQuote {
  return q && typeof q.quote_id === 'string' && UUID.test(q.quote_id) && q.order_id === orderId && cents(q.total_cents) && q.total_cents > 0 &&
    cents(q.previous_total_cents) && typeof q.currency === 'string' && /^[a-z]{3}$/.test(q.currency) && typeof q.expires_at === 'string' && Number.isFinite(Date.parse(q.expires_at)) &&
    (q.resume_only === undefined || typeof q.resume_only === 'boolean') &&
    (q.resume_only === true || Date.parse(q.expires_at) > Date.now()) && ['none','at_checkout'].includes(q.tax_mode) &&
    (q.lines === undefined || (Array.isArray(q.lines) && q.lines.length <= 100 && q.lines.every((l: any) =>
      typeof l.name === 'string' && l.name.length <= 200 && Number.isSafeInteger(l.quantity) && l.quantity > 0 && cents(l.unit_price_cents))));
}
function validPayment(p: any): p is ReplacementPayment {
  if (!p || typeof p.order_id !== 'string' || !UUID.test(p.order_id) || (p.cart_id !== undefined && (typeof p.cart_id !== 'string' || !UUID.test(p.cart_id)))) return false;
  if (p.payment?.kind === 'pending') return Object.keys(p.payment).length === 1;
  if (p.payment?.kind === 'payment_sheet') return typeof p.payment.client_secret === 'string' && typeof p.payment.publishable_key === 'string' && /^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9]+$/.test(p.payment.client_secret) && /^pk_(test|live)_[A-Za-z0-9]+$/.test(p.payment.publishable_key);
  if (p.payment?.kind !== 'hosted' || typeof p.payment.url !== 'string') return false;
  try { const u = new URL(p.payment.url); return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && !u.port && !u.username && !u.password; } catch { return false; }
}
/** No token/secret is persisted, logged, placed in navigation or put in query caches. */
export const checkoutReplacementApi = {
  async request(orderId: string, email: string) {
    if (!UUID.test(orderId) || !email.trim() || email.length > 254) throw Error('Recovery unavailable');
    const r = await invokeEdge('checkout-recovery', {action:'request',order_id:orderId,email:email.trim()}, {requireAuth:false});
    if (r.error || r.data?.ok !== true) throw Error('Recovery unavailable');
  },
  async exchange(token: string) {
    if (!TOKEN.test(token)) throw Error('Recovery link unavailable');
    const r = await invokeEdge('checkout-recovery', {action:'exchange',token}, {requireAuth:false});
    const d = r.data;
    if (r.error || d?.ok !== true || typeof d.order_id !== 'string' || !UUID.test(d.order_id) || typeof d.recovery_session !== 'string' || !TOKEN.test(d.recovery_session) ||
      typeof d.expires_at !== 'string' || !Number.isFinite(Date.parse(d.expires_at)) || Date.parse(d.expires_at) <= Date.now()) throw Error('Recovery link unavailable');
    return {order_id:d.order_id as string,recovery_session:d.recovery_session as string,expires_at:d.expires_at as string};
  },
  async quote(orderId: string, recoverySession?: string) {
    if (!UUID.test(orderId) || (recoverySession !== undefined && !TOKEN.test(recoverySession))) throw Error('Review unavailable');
    const r = await invokeEdge('checkout-replacement', {action:'quote',order_id:orderId,...(recoverySession ? {recovery_session:recoverySession}: {})}, {requireAuth:!recoverySession});
    if (r.error || r.data?.ok !== true || !validQuote(r.data.quote,orderId)) throw Error('Review unavailable. Check your order before trying again.');
    return r.data.quote as ReplacementQuote;
  },
  async accept(quote: ReplacementQuote, recoverySession?: string) {
    const r = await invokeEdge('checkout-replacement', {action:'accept',order_id:quote.order_id,quote_id:quote.quote_id,
      accepted_total_cents:quote.total_cents,accepted_currency:quote.currency,...(recoverySession ? {recovery_session:recoverySession}: {})}, {requireAuth:!recoverySession});
    // Only an explicit HTTP refusal from the authenticated endpoint proves
    // this attempted acceptance was rejected before successor/dispatch.
    if (r.error?.status === 409 && (r.error.code === 'quote_changed' || r.error.code === 'quote_expired')) throw new CheckoutQuoteRefused(r.error.code);
    if (r.error || r.data?.ok !== true || !validPayment(r.data) || r.data.order_id === quote.order_id) throw Error('Outcome unknown');
    return {order_id:r.data.order_id,cart_id:r.data.cart_id,payment:r.data.payment} as ReplacementPayment;
  },
};
export interface ReplacementState {
  phase: 'idle'|'recovering'|'reviewing'|'quoted'|'accepting'|'unknown'|'payment'|'blocked';
  quote?: ReplacementQuote; payment?: ReplacementPayment; message?: string; recovered?: boolean;
}
/** One in-flight operation. Unknown acceptance can only resume its exact quote.
 * This client guard is not authorization: the server serializes every successor. */
export function createReplacementController(options: {
  identity: ReplacementIdentity; orderId?: string; isCurrent: () => boolean;
  api?: typeof checkoutReplacementApi;
}) {
  const api = options.api || checkoutReplacementApi;
  let state: ReplacementState = {phase:'idle'};
  let orderId = options.orderId, session: string | undefined, sessionExpiry = 0;
  let disposed = false, inFlight = false;
  const listeners = new Set<() => void>();
  const current = () => !disposed && options.isCurrent();
  const publish = (next: ReplacementState) => { if (current()) { state=next; listeners.forEach(fn=>fn()); } };
  const ready = () => (options.identity.kind === 'member' && !!options.identity.actor) || (!!session && sessionExpiry > Date.now());
  async function perform(run: () => Promise<void>) {
    if (!current() || inFlight) return;
    inFlight=true;
    try { await run(); } finally { inFlight=false; }
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    dispose() { disposed=true; session=undefined; orderId=undefined; listeners.clear(); },
    request: (id: string,email: string) => perform(async()=>{
      if(options.identity.kind!=='guest' || state.phase==='unknown' || state.phase==='payment')return;
      publish({phase:'recovering'});
      try {await api.request(id,email);publish({phase:'idle',message:'If this order can be recovered, a link has been sent to its original email address.'});}
      catch {publish({phase:'idle',message:'Recovery is unavailable. Please try again later.'});}
    }),
    exchange: (token: string) => perform(async()=>{
      if(options.identity.kind!=='guest' || state.phase!=='idle')return;
      publish({phase:'recovering'});
      try {const result=await api.exchange(token);if(!current())return;session=result.recovery_session;sessionExpiry=Date.parse(result.expires_at);orderId=result.order_id;publish({phase:'idle',recovered:true,message:'Guest order recovered. Review current availability and price before continuing.'});}
      catch {publish({phase:'blocked',message:'This recovery link is unavailable or has already been used. Request a new link.'});}
    }),
    review: () => perform(async()=>{
      if(!orderId || !ready() || !['idle','quoted'].includes(state.phase))return;
      publish({phase:'reviewing',recovered:!!session});
      try {const quote=await api.quote(orderId,session);publish({phase:'quoted',quote,recovered:!!session});}
      catch {publish({phase:'idle',recovered:!!session,message:'A replacement is not available. Check your existing order or contact support.'});}
    }),
    accept: () => perform(async()=>{
      const quote=state.quote;
      if(!quote || !['quoted','unknown'].includes(state.phase))return;
      if(!ready()){publish({...state,message:'Guest recovery expired. Contact support to resume this exact replacement; do not start another purchase.'});return;}
      const resuming=state.phase==='unknown'||quote.resume_only===true;
      if(!resuming && Date.parse(quote.expires_at)<=Date.now()){publish({...state,message:'This quote expired. Review the latest price and availability.'});return;}
      publish({...state,phase:'accepting',message:undefined});
      try {const payment=await api.accept(quote,session);publish({phase:'payment',quote,payment,recovered:!!session});}
      catch (error) {
        // A previous uncertain acceptance or already accepted quote stays on
        // its exact recovery path even if a later response looks retryable.
        if (!resuming && error instanceof CheckoutQuoteRefused) {
          publish({phase:'idle',recovered:!!session,message:error.code==='quote_changed'?'The price changed. Review a fresh quote before accepting.':'This quote expired. Review current availability and price before accepting.'});
        } else publish({phase:'unknown',quote,recovered:!!session,message:'We could not confirm whether the replacement was created. Do not start another purchase. Resume only this same request, or contact support.'});
      }
    }),
  };
}
export function replacementMoney(cents: number,currency: string) {
  return new Intl.NumberFormat('en-US',{style:'currency',currency:currency.toUpperCase()}).format(cents/100);
}
