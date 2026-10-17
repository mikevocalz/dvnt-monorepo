/** Paid public-ticket embeds. Uses the site's canonical fees, holds and webhook issuance. */
import { computeFeesWithMode, MIN_TIER_PRICE_CENTS } from './fee-calculator.ts';
import { isUnpublished } from './event-access.ts';
import { salesCutoffAt } from './sales-cutoff.ts';
import { validateAndApplyPromoterCode } from './apply-promoter-code.ts';
import { consumeDbRateLimit } from './db-rate-limit.ts';

export const EMBED_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PROOF = /^[a-f0-9]{64}$/;
const EVENT_FIELDS = 'id,title,host_id,visibility,status,ticketing_enabled,is_hidden,publish_at,start_date,end_date,event_tz,location_name,location,flyer_image_url,cover_image_url,image,fee_mode,attendee_name_requirement';
const TIER_FIELDS = 'id,event_id,name,price_cents,is_active,status,tier_visibility,sale_start,sale_end,quantity_total,quantity_sold,max_per_user';
export class EmbedError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export async function embedHash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function requireId(value: unknown): string {
  if (typeof value !== 'string' || !EMBED_UUID.test(value)) throw new EmbedError('invalid_request','Invalid request.',400);
  return value.toLowerCase();
}
export function parseEmbedBuyer(body: Record<string, unknown>) {
  const quantity = body.quantity;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const promoterCode = typeof body.promoterCode === 'string' ? body.promoterCode.trim().toUpperCase() : '';
  if (!Number.isSafeInteger(quantity) || (quantity as number)<1 || (quantity as number)>10 ||
      email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length>80 || !name ||
      (promoterCode && !/^[A-Z0-9_-]{2,32}$/.test(promoterCode))) {
    throw new EmbedError('invalid_buyer','Check your email, name, quantity and promoter code.',400);
  }
  if (body.addons || body.promo_code || body.unlock_code) {
    throw new EmbedError('use_full_checkout','Use the full DVNT checkout for add-ons, promo or locked tickets.',400);
  }
  const attendeeNames = Array.isArray(body.attendeeNames) ? body.attendeeNames.map((n) => typeof n==='string' ? n.trim() : '') : [];
  if (attendeeNames.length>(quantity as number) || attendeeNames.some((n)=>n.length>40) || JSON.stringify(attendeeNames).length>500)
    throw new EmbedError('invalid_names','Enter attendee names of at most 40 characters.',400);
  return { tierId: requireId(body.tierId), quantity: quantity as number, email, name, promoterCode, attendeeNames };
}
export function isEmbedEventAvailable(event: any, now = Date.now()): boolean {
  const cutoff = salesCutoffAt(event)?.getTime();
  return !!event && event.visibility==='public' && event.ticketing_enabled===true &&
    event.status==='active' && !isUnpublished(event, now) &&
    typeof cutoff==='number' && cutoff>now;
}
function publicTier(tier: any, now: number): boolean {
  return tier.is_active!==false && !['paused','ended','sold_out'].includes(tier.status) &&
    (!tier.tier_visibility || tier.tier_visibility==='public') && Number.isSafeInteger(tier.price_cents) &&
    tier.price_cents>=MIN_TIER_PRICE_CENTS &&
    (!tier.sale_start || Date.parse(tier.sale_start)<=now) && (!tier.sale_end || Date.parse(tier.sale_end)>now) &&
    (tier.quantity_total==null || (tier.quantity_sold || 0)<tier.quantity_total);
}
function checked(result: any) {
  if (result.error) {
    const messages: Record<string,string> = {
      attempt_conflict:'Resume or cancel the existing checkout before changing tickets.',
      embed_unavailable:'This embed changed. Reload the event before paying.',
      event_unavailable:'This event is not selling tickets right now.',
      selection_changed:'This selection changed. Review the new total before paying.',
      organizer_changed:'Organizer payment setup changed. Please use the full event page.',
      buyer_limit:'This purchase exceeds the ticket limit for your email.',
      promoter_changed:'The promoter offer changed. Review your total again.',
      attempt_cancelled:'This checkout was cancelled. Return to event tickets.',
      sold_out:'These tickets just sold out. Please select another ticket.',
    };
    const message=messages[result.error.message];
    if(message) throw new EmbedError(result.error.message,message);
    throw new EmbedError('service_unavailable','Please retry to recover the same checkout.',503);
  }
  return result.data;
}
export interface EmbedCommerceDependencies {
  db: any;
  enabled: boolean;
  publishableKey: string;
  livemode: boolean;
  siteOrigin: string;
  now?: () => number;
  stripe: (method: 'GET'|'POST', path: string, body?: Record<string,string>, idempotencyKey?: string) => Promise<any>;
}
export function stripeEmbedParameters(attempt: any): Record<string,string> {
  const q=attempt.quote, f=q.fees;
  const metadata: Record<string,string>={ type:'event_ticket',event_id:String(q.eventId),ticket_type_id:q.tierId,
    quantity:String(q.quantity),guest_email:q.email,guest_name:q.name,embed_attempt_id:attempt.id,
    ...(q.attendeeNames.length ? { attendee_names:JSON.stringify(q.attendeeNames) } : {}),
    ...(q.promoter ? {dvnt_promoter_code:q.promoter.code} : {}),
  };
  const result: Record<string,string>={mode:'payment',ui_mode:'embedded',redirect_on_completion:'never',
    'payment_method_types[0]':'card',customer_email:q.email,client_reference_id:attempt.order_id,
    expires_at:String(q.expiresAt),
    'line_items[0][price_data][currency]':'usd',
    'line_items[0][price_data][unit_amount]':String(f.subtotal),
    'line_items[0][price_data][product_data][name]':`${q.title} — ${q.tierName} × ${q.quantity}`,
    'line_items[0][quantity]':'1',
    'payment_intent_data[transfer_data][destination]':q.destination,
    'payment_intent_data[application_fee_amount]':String(f.application_fee_amount),
    'payment_intent_data[metadata][subtotal_cents]':String(f.subtotal),
    'payment_intent_data[metadata][buyer_fee_cents]':String(f.buyer_fee),
    'payment_intent_data[metadata][organizer_fee_cents]':String(f.organizer_fee),
    'payment_intent_data[metadata][fee_mode]':f.fee_mode,
  };
  for (const [key,value] of Object.entries(metadata)) {
    result[`metadata[${key}]`]=value;
    result[`payment_intent_data[metadata][${key}]`]=value;
  }
  if(f.buyer_fee>0) Object.assign(result,{
    'line_items[1][price_data][currency]':'usd','line_items[1][price_data][unit_amount]':String(f.buyer_fee),
    'line_items[1][price_data][product_data][name]':'Service fee','line_items[1][quantity]':'1',
  });
  return result;
}
export function createTicketEmbedHandler(deps: EmbedCommerceDependencies) {
  const {db,stripe}=deps, now=deps.now ?? Date.now;
  return async(req:Request):Promise<Response> => {
    const origin=req.headers.get('origin') || '';
    // Preflight allows a browser to ask; the actual request still checks the saved
    // origin before returning buyer data, making a hold, or contacting Stripe.
    const headers: Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin',
      'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type,apikey',
      ...(origin.startsWith('https://') ? {'Access-Control-Allow-Origin':origin} : {}),
    };
    const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
    // Stripe's /expire confirmation is evidence of a client-requested
    // cancellation, unlike a provider expiry webhook. Update the order
    // atomically so the webhook cannot erase this distinction. No buyer
    // details or Stripe secrets are persisted in the timeline.
    const recordExplicitCancellation = async (orderId: string) => {
      const marked = checked(await db.rpc('mark_embed_checkout_cancelled', {
        p_order_id: orderId,
      }));
      if (!marked) return;
      const { error } = await db.from('order_timeline').insert({
        order_id: orderId,
        type: 'payment_failed',
        label: 'Payment cancelled',
        detail: 'Embedded checkout client requested cancellation; Stripe confirmed expiry',
      });
      // The diagnosis is durable even if a timeline insert fails. Avoid
      // putting SQL errors or customer data in public API responses.
      if (error) throw new EmbedError(
        'cancellation_record_incomplete',
        'Payment was cancelled. Please retry to confirm its status.',
        503,
      );
    };
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(!deps.enabled) return json({error:'Embedded ticket sales are not enabled.',code:'not_enabled'},404);
    if(req.method!=='POST') return json({error:'Method not allowed.'},405);
    try {
      const raw=await req.text();
      if(raw.length>8192) throw new EmbedError('too_large','Request too large.',413);
      let body:Record<string,unknown>;
      try {body=JSON.parse(raw); if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error();}
      catch {throw new EmbedError('invalid_request','Invalid request.',400);}
      const embedId=requireId(body.embedId),action=String(body.action);
      if(!['describe','quote','checkout','resume','status','cancel'].includes(action)) throw new EmbedError('invalid_action','Invalid action.',400);
      let attempt:any=null;
      let proofHash='';
      if(['checkout','resume','status','cancel'].includes(action)) {
        requireId(body.attemptId);
        if(typeof body.token!=='string' || !PROOF.test(body.token)) throw new EmbedError('invalid_request','Invalid request.',400);
        proofHash=await embedHash(body.token);
        attempt=checked(await db.from('ticket_embed_checkout_attempts').select('*').eq('id',body.attemptId).maybeSingle());
        if(attempt && (attempt.proof_hash!==proofHash || attempt.embed_id!==embedId || attempt.origin!==origin))
          throw new EmbedError('not_found','Checkout not found.',404);
        if(!attempt && ['resume','status','cancel'].includes(action)) throw new EmbedError('not_found','Checkout not found.',404);
      }
      // Existing attempts remain recoverable after revocation or event cancellation.
      // Revocation blocks new attempts, not paid order lookup or fulfillment.
      let setting:any, event:any;
      if(!attempt) {
        setting=checked(await db.from('event_ticket_widgets').select('id,event_id,allowed_origin,revision,published').eq('id',embedId).maybeSingle());
        if(!setting || setting.published!==true) throw new EmbedError('not_found','This ticket embed is unavailable.',404);
        if(action!=='describe' && origin!==setting.allowed_origin) throw new EmbedError('origin_denied','This website is not authorized for this embed.',403);
        event=checked(await db.from('events').select(EVENT_FIELDS).eq('id',setting.event_id).maybeSingle());
        if(!isEmbedEventAvailable(event,now())) throw new EmbedError('event_unavailable','This event is not currently selling embedded tickets.',404);
      }
      if(action==='describe') {
        const tiers=checked(await db.from('ticket_types').select(TIER_FIELDS).eq('event_id',event.id));
        return json({embedId,testMode:!deps.livemode,allowedOrigin:setting.allowed_origin,revision:setting.revision,
          event:{id:event.id,title:event.title,startDate:event.start_date,timeZone:event.event_tz,
            location:event.location_name || event.location || '',flyerUrl:event.flyer_image_url || event.cover_image_url || event.image || null,
            attendeeNamesRequired:event.attendee_name_requirement==='required'},
          tiers:tiers.filter((t:any)=>publicTier(t,now())).map((t:any)=>({id:t.id,name:t.name,priceCents:t.price_cents,
            maxQuantity:Math.min(10,t.max_per_user || 10),available:t.quantity_total==null ? null:Math.max(0,t.quantity_total-(t.quantity_sold || 0))})),
          siteOrigin:deps.siteOrigin});
      }
      if(action==='quote' || action==='checkout') {
        const buyer=parseEmbedBuyer(body), requestHash=await embedHash(JSON.stringify({buyer,quoteHash:body.quoteHash ?? null}));
        if(attempt && attempt.request_hash!==requestHash) throw new EmbedError('attempt_conflict','Resume or cancel the existing checkout before changing tickets.');
        if(!attempt) {
          const limiter=await consumeDbRateLimit(db,await embedHash(`${origin}:${buyer.email}`),'ticket-embed-checkout',30,3600);
          if(!limiter.allowed) throw new EmbedError('rate_limited','Too many attempts. Please try again later.',429);
          const globalLimit=await consumeDbRateLimit(db,embedId,'ticket-embed-origin',300,60);
          if(!globalLimit.allowed) throw new EmbedError('rate_limited','This event is receiving many requests. Please try again shortly.',429);
          const tier=checked(await db.from('ticket_types').select(TIER_FIELDS).eq('id',buyer.tierId).maybeSingle());
          if(!tier || tier.event_id!==event.id || !publicTier(tier,now())) throw new EmbedError('tier_unavailable','This ticket is no longer available.');
          if(event.attendee_name_requirement==='required' &&
             (buyer.attendeeNames.length!==buyer.quantity || buyer.attendeeNames.some((n)=>!n)))
            throw new EmbedError('names_required','A name is required for every ticket.',400);
          const organizer=checked(await db.from('organizer_accounts').select('stripe_account_id,charges_enabled').eq('host_id',event.host_id).maybeSingle());
          if(!organizer?.stripe_account_id || !organizer.charges_enabled) throw new EmbedError('organizer_unavailable','The organizer has not completed payment setup.');
          const promo=await validateAndApplyPromoterCode(db,event.id,buyer.promoterCode,tier.price_cents*buyer.quantity,buyer.quantity);
          if(promo.error) throw new EmbedError('promoter_code',promo.error,400);
          if(tier.price_cents*buyer.quantity>90_000_000) throw new EmbedError('use_full_checkout','This selection requires the full DVNT checkout.');
          const subtotal=promo.result?.discounted_amount_cents ?? tier.price_cents*buyer.quantity;
          if(subtotal<MIN_TIER_PRICE_CENTS*buyer.quantity) throw new EmbedError('use_full_checkout','This discounted selection requires the full DVNT checkout.');
          const fees=computeFeesWithMode(subtotal,buyer.quantity,event.fee_mode);
          const expiry=Math.floor(Math.min(now()+35*60_000,salesCutoffAt(event)!.getTime(),tier.sale_end?Date.parse(tier.sale_end):Infinity)/1000);
          if(expiry*1000<now()+31*60_000) throw new EmbedError('sales_closing','Sales close soon. Please purchase through the full DVNT event page.');
          const quote={...buyer,eventId:event.id,revision:setting.revision,title:event.title,tierName:tier.name,unitPrice:tier.price_cents,
            requestedFeeMode:event.fee_mode || 'pass',destination:organizer.stripe_account_id,fees,promoter:promo.result,expiresAt:expiry};
          const totals={subtotal:fees.subtotal,serviceFee:fees.buyer_fee,total:fees.customer_charge_amount,
            discount:promo.result?.discount_cents ?? 0,currency:'usd'};
          const quoteHash=await embedHash(JSON.stringify({revision:setting.revision,tierId:tier.id,unitPrice:tier.price_cents,quantity:buyer.quantity,fees,promoter:promo.result,destination:organizer.stripe_account_id}));
          if(action==='quote') return json({totals,quoteHash});
          if(body.quoteHash!==quoteHash) throw new EmbedError('quote_changed','Your price or selection changed. Review the new total before paying.');
          attempt=checked(await db.rpc('ticket_embed_prepare_checkout',{p_id:body.attemptId,p_embed_id:embedId,p_origin:origin,
            p_proof_hash:proofHash,p_request_hash:requestHash,p_quote:quote}));
        }
      }
      if(attempt && !attempt.stripe_session_id && (action==='cancel' || attempt.quote.expiresAt*1000<=now())) {
        attempt=checked(await db.rpc('ticket_embed_cancel_unattached',{p_id:attempt.id}));
      }
      if(attempt?.state==='cancelled') {
        if(action==='cancel') await recordExplicitCancellation(attempt.order_id);
        return json({state:'expired'});
      }
      if(action==='checkout' || action==='resume') {
        // An old request never starts another provider session after Stripe's
        // idempotency retention window. Unknown outcomes retain their holds.
        if(!attempt.stripe_session_id && Date.parse(attempt.created_at)<now()-23*60*60_000)
          throw new EmbedError('expired','This checkout expired. Please start again.');
        const session=attempt.stripe_session_id ? await stripe('GET',`/checkout/sessions/${attempt.stripe_session_id}`)
          : await stripe('POST','/checkout/sessions',stripeEmbedParameters(attempt),`dvnt-embed-${attempt.id}`);
        verifySession(session,attempt,deps.livemode);
        if(!attempt.stripe_session_id) attempt=checked(await db.rpc('ticket_embed_attach_session',{p_id:attempt.id,p_session:session.id}));
        if(session.status==='expired') return json({state:'expired'});
        if(session.status==='complete') return await status(attempt,session);
        if(!session.client_secret || session.status!=='open') throw new EmbedError('processing','Checkout is processing. Retry to recover it.');
        return json({state:'payment_open',clientSecret:session.client_secret,publishableKey:deps.publishableKey,
          expiresAt:attempt.quote.expiresAt,totals:{subtotal:attempt.quote.fees.subtotal,serviceFee:attempt.quote.fees.buyer_fee,total:attempt.quote.fees.customer_charge_amount,currency:'usd'}});
      }
      if(!attempt.stripe_session_id) return json({state:'preparing',message:'Checkout is being prepared. Retry the same request.'});
      let session=await stripe('GET',`/checkout/sessions/${attempt.stripe_session_id}`);
      verifySession(session,attempt,deps.livemode);
      let explicitlyCancelled = false;
      if(action==='cancel' && session.status==='open') {
        session=await stripe('POST',`/checkout/sessions/${session.id}/expire`,{},`dvnt-embed-cancel-${attempt.id}`);
        verifySession(session,attempt,deps.livemode);
        explicitlyCancelled = session.status==='expired';
      }
      if(session.status==='expired') {
        // Only a confirmed provider expiry may release this hold. No cleanup on
        // a timeout, decline, closing the dialog, or a client-reported success.
        checked(await db.from('ticket_holds').update({status:'expired'}).eq('id',attempt.hold_id).eq('status','active'));
        if(explicitlyCancelled) await recordExplicitCancellation(attempt.order_id);
        return json({state:'expired'});
      }
      return await status(attempt,session);
      async function status(a:any,s:any) {
        const order=checked(await db.from('orders').select('id,status,ticket_email_status').eq('id',a.order_id).maybeSingle());
        if(!order) throw new EmbedError('order_unavailable','Order details are temporarily unavailable.',503);
        if(['refunded','partially_refunded','cancelled','failed','payment_failed','disputed'].includes(order.status)) return json({state:order.status});
        if(s.payment_status!=='paid') return json({state:s.status==='complete'?'payment_processing':'payment_open'});
        const tickets=checked(await db.from('tickets').select('id,guest_lookup_token').eq('order_id',a.order_id).in('status',['active','scanned']));
        if(order.status!=='paid' || tickets.length!==a.quote.quantity || tickets.some((t:any)=>!EMBED_UUID.test(t.guest_lookup_token || ''))) return json({state:'paid_issuing',message:'Payment received. Preparing your tickets.'});
        return json({state:'fulfilled',orderId:order.id,emailStatus:order.ticket_email_status,
          tickets:tickets.map((t:any)=>({url:`${deps.siteOrigin}/public/tickets/guest/${t.guest_lookup_token}`}))});
      }
    } catch(error) {
      // Never send/log provider errors, SQL messages, buyer tokens or secrets.
      if(error instanceof EmbedError) return json({error:error.message,code:error.code},error.status);
      return json({error:'Could not complete checkout. Retry to recover the same attempt.',code:'retry_same_attempt'},503);
    }
  };
}
function verifySession(session:any,attempt:any,livemode:boolean) {
  if(session.metadata?.embed_attempt_id!==attempt.id || session.client_reference_id!==attempt.order_id ||
     typeof session.id!=='string' || !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(session.id) || session.currency!=='usd' || session.amount_total!==attempt.quote.fees.customer_charge_amount || session.livemode!==livemode)
    throw new EmbedError('session_mismatch','Checkout could not be verified. Please contact support.',503);
}
