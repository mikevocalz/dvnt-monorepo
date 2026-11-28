/** Signed webhook metadata locates an intent, but never establishes funding.
 * Link the pre-existing immutable order before legacy fulfillment performs its
 * PI/session lookup. No fallback INSERT and no historical model inference.
 */
import { settlementRpc, type SettlementDatabase } from './settlement-engine.ts';
export async function linkSettlementWebhookPayment(db:SettlementDatabase,object:any,eventType:string,read?:((path:string)=>Promise<any>)):Promise<void> {
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded','payment_intent.succeeded','payment_intent.processing','payment_intent.payment_failed'].includes(eventType))return;
 if(object?.metadata?.charge_model!=='separate_charges_and_transfers')return;
 const id=object.metadata.settlement_order_id;
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Settlement order identity missing');
 const order=await settlementRpc(db,'settlement_order',{p_order_id:id});
 const get=read||(async(path:string)=>{
  const key=Deno.env.get('STRIPE_SECRET_KEY');if(!key)throw new Error('Payment verification unavailable');
  const response=await fetch(`https://api.stripe.com${path}`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000)});
  const value=await response.json();if(!response.ok||value.error)throw new Error('Payment verification failed');return value;
 });
 const f=order.snapshot.order;
 const hosted=['ticket-checkout','guest-checkout'].includes(order.snapshot.rail);
 const hostedEvent=eventType.startsWith('checkout.session.');
 let session:any;let intent:any;
 if(hosted) {
  const sessionId=hostedEvent?object.id:order.stripe_checkout_session_id;
  if(typeof sessionId!=='string'||!/^cs_[A-Za-z0-9_]+$/.test(sessionId))throw new Error('Awaiting durable session link');
  session=await get(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if(session.id!==sessionId||session.metadata?.settlement_order_id!==id||session.metadata?.charge_model!=='separate_charges_and_transfers'||
   session.currency!==f.currency||session.amount_subtotal!==f.total_cents||!Number.isSafeInteger(session.total_details?.amount_tax)||
   session.total_details.amount_tax<0||session.total_details.amount_discount!==0||session.total_details.amount_shipping!==0||
   session.amount_total!==f.total_cents+session.total_details.amount_tax)throw new Error('Settlement session evidence mismatch');
  const pi=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
  if(!pi)throw new Error('Session payment is not linked');
  intent=await get(`/v1/payment_intents/${encodeURIComponent(pi)}`);
 } else {
  if(hostedEvent||typeof object.id!=='string'||!/^pi_[A-Za-z0-9_]+$/.test(object.id))throw new Error('Unexpected settlement payment rail');
  intent=await get(`/v1/payment_intents/${encodeURIComponent(object.id)}`);
 }
 if(intent.metadata?.settlement_order_id!==id||intent.metadata?.charge_model!=='separate_charges_and_transfers'||
  intent.currency!==f.currency||intent.amount!==(session?session.amount_total:f.total_cents)||intent.transfer_data!=null||
  intent.application_fee_amount!=null||(!hostedEvent&&intent.id!==object.id))throw new Error('Settlement payment evidence mismatch');
 await settlementRpc(db,'finalize_settlement_checkout',{p_order_id:id,p_payment_intent_id:intent.id,p_checkout_session_id:session?.id||null});
}
