import { readRecipientProof, verifyRecipientFundingMode } from "./settlement-recipient.ts";
export { verifyRecipient } from "./settlement-recipient.ts";
import { auditFundingTransactions, fundingSourceProof } from "./settlement-funding.ts";
/** Settlement engine: all provider I/O is injected for isolated testing.
 * No automatic retries on provider writes. Database reservations survive errors.
 */
export interface SettlementProvider {
 assertCanStart?():void;
 get(path:string,connectedAccount?:string):Promise<any>;
 post(path:string,body:Record<string,string>,idempotencyKey:string):Promise<any>;
}
export interface SettlementDatabase { rpc(name:string,args:Record<string,unknown>):Promise<{data:any;error:any}>; }
export async function settlementRpc(db:SettlementDatabase,name:string,args:Record<string,unknown>) {
 const {data,error}=await db.rpc(name,args);
 if(error) throw new Error(`${name}: ${error.message || 'database failure'}`);
 if(data?.ok===false || data==null) throw new Error(`${name}: rejected`);
 return data;
}
export function settlementFailureCode(error:unknown):string {
 const message=error instanceof Error?error.message:String(error);
 if(/run admission budget/i.test(message))return 'runtime_budget_required';
 if(/fulfillment_required/i.test(message))return 'fulfillment_required';
 if(/platform payout policy/i.test(message))return 'platform_payout_policy_unverified';
 if(/promoter settlement pending/i.test(message))return 'promoter_pending';
 if(/onboarding/i.test(message))return 'onboarding_required';
 if(/capability|ownership|recipient binding/i.test(message))return 'recipient_restricted';
 if(/page limit|pagination/i.test(message))return 'source_audit_limit';
 if(/stale/i.test(message))return 'source_verification_stale';
 if(/fund|balance/i.test(message))return 'funding_required';
 if(/hold|held|release window/i.test(message))return 'hold_required';
 return 'verification_required';
}
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const ref=(v:any)=>typeof v==='string'?v:v?.id;
function modelEvidence(object:any,orderId:string) {
 if(object?.metadata?.settlement_order_id!==orderId || object?.metadata?.charge_model!=='separate_charges_and_transfers') {
  throw new Error('Provider order/model evidence mismatch');
 }
}
export function verifySettlementSource(order:any,intent:any,charge:any,session?:any) {
 const frozen=order.snapshot.order;
 modelEvidence(intent,order.order_id);
 let tax=0; let gross=frozen.total_cents;
 if(session) {
  modelEvidence(session,order.order_id);
  tax=session.total_details?.amount_tax;
  if(session.payment_status!=='paid'||session.status!=='complete'||session.currency!==frozen.currency||
   session.amount_subtotal!==frozen.total_cents||!integer(tax)||
   session.total_details?.amount_discount!==0||session.total_details?.amount_shipping!==0||
   session.amount_total!==frozen.total_cents+tax||ref(session.payment_intent)!==intent.id) throw new Error('Session economics mismatch');
  gross=session.amount_total;
 }
 if(!integer(gross)||gross<=0||intent.id!==order.stripe_payment_intent_id||intent.status!=='succeeded'||
  intent.amount!==gross||intent.amount_received!==gross||intent.currency!==frozen.currency||
  intent.transfer_data!=null||intent.application_fee_amount!=null||intent.on_behalf_of!=null||
  ref(intent.latest_charge)!==charge.id||ref(charge.payment_intent)!==intent.id||
  charge.amount!==gross||charge.amount_captured!==gross||charge.currency!==frozen.currency||
  charge.paid!==true||charge.captured!==true||charge.status!=='succeeded'||charge.refunded!==false||
  charge.amount_refunded!==0||charge.disputed!==false||charge.transfer!=null||charge.transfer_data!=null||
  charge.destination!=null||charge.application_fee!=null||charge.application_fee_amount!=null) {
  throw new Error('Source charge is not an unencumbered separate platform charge');
 }
 const net=frozen.subtotal_cents-frozen.organizer_fee_cents;
 const balance=charge.balance_transaction;
 if(!integer(net)||net<Number(frozen.promoter_commission_amount_cents||0)||!balance||typeof balance!=='object'||
  balance.status!=='available'||balance.currency!==frozen.currency||balance.amount!==gross||
  !integer(balance.fee)||!integer(balance.net)||balance.net!==gross-balance.fee||balance.net<net+tax) {
  throw new Error('Source funds unavailable or fees exceed retained amount');
 }
 return {charge:charge.id,pi:intent.id,currency:frozen.currency,gross,tax};
}
/** A database reserve is bookkeeping, not segregated provider funds. This
 * initial runtime only supports an independently verified manual platform
 * payout schedule. Never change provider settings to satisfy this guard. */
export function verifyPlatformPayoutPolicy(account:any) {
 if(account?.object!=='account'||typeof account.id!=='string'||!account.id.startsWith('acct_')||
    account.settings?.payouts?.schedule?.interval!=='manual') {
  throw new Error('Platform payout policy is not verified for protected funds');
 }
}
export function availableCurrency(balance:any,currency:string):number {
 const rows=balance?.available?.filter((x:any)=>x.currency===currency);
 if(!Array.isArray(rows)||rows.length!==1||!integer(rows[0].amount)) throw new Error('Platform available funds invalid or negative');
 return rows[0].amount;
}
export function transferMatches(t:any,a:any,orderId:string) {
 return t?.metadata?.settlement_allocation_id===a.id&&t?.metadata?.settlement_order_id===orderId&&
  t.transfer_group===`dvnt_settlement_${orderId}`&&ref(t.destination)===a.destination&&
  ref(t.source_transaction)===a.charge_id&&t.currency===a.currency&&t.amount===Number(a.amount_cents)&&
  typeof t.id==='string'&&t.id.startsWith('tr_')&&t.reversed===false&&t.amount_reversed===0;
}
async function listAll(provider:SettlementProvider,path:string,maxPages=100):Promise<any[]> {
 const rows:any[]=[];let cursor:string|undefined;
 for(let page=0;page<maxPages;page++) {
  const result=await provider.get(`${path}${path.includes('?')?'&':'?'}limit=100${cursor?'&starting_after='+encodeURIComponent(cursor):''}`);
  if(!Array.isArray(result.data))throw new Error('Incomplete provider list');
  rows.push(...result.data);
  if(result.has_more===false)return rows;
  const last=result.data.at(-1)?.id;
  if(!last||last===cursor)throw new Error('Provider pagination stalled');cursor=last;
 }
 throw new Error('Provider reconciliation page limit reached');
}
/** A transfer_group is bookkeeping, not funding proof: inspect every transfer
 * since charge creation and reject untracked uses of this source transaction.
 */
export async function auditSourceTransfers(provider:SettlementProvider,charge:any,orderId:string,allocations:any[]) {
 if(!Number.isSafeInteger(charge.created)||charge.created<0)throw new Error('Source creation time missing');
 const transfers=await listAll(provider,`/v1/transfers?created[gte]=${charge.created}`);
 const used=transfers.filter(t=>ref(t.source_transaction)===charge.id);const seen=new Set<string>();
 for(const t of used) {
  const a=allocations.find(x=>x.id===t.metadata?.settlement_allocation_id);
  if(!a||seen.has(a.id)||!transferMatches(t,{...a,destination:a.destination||a.candidate_destination,
   charge_id:charge.id,currency:charge.currency},orderId))throw new Error('Untracked, duplicate or reversed source allocation');
  seen.add(a.id);
 }
 return seen;
}

async function recordTransfer(db:SettlementDatabase,a:any,t:any,orderId:string) {
 if(!transferMatches(t,a,orderId))throw new Error('Transfer evidence mismatch or reversal requires recovery');
 await settlementRpc(db,'settlement_reconcile_transfer',{p_allocation:a.id,p_transfer:t.id,p_destination:a.destination,
  p_charge:a.charge_id,p_currency:a.currency,p_amount:Number(a.amount_cents)});
}

/** Lost checkout response recovery never creates another provider payment. */
export async function reconcileCheckout(db:SettlementDatabase,provider:SettlementProvider,order:any) {
 if(order.stripe_payment_intent_id||order.stripe_checkout_session_id)return order;
 const hosted=['ticket-checkout','guest-checkout'].includes(order.snapshot.rail);
 const since=Math.floor(new Date(order.created_at).getTime()/1000)-60;
 const rows=await listAll(provider,`${hosted?'/v1/checkout/sessions':'/v1/payment_intents'}?created[gte]=${since}`);
 const matches=rows.filter(x=>x.metadata?.settlement_order_id===order.order_id);
 if(matches.length!==1)throw new Error(`Uncertain checkout: ${matches.length} matching payments; no automatic retry`);
 const matched=matches[0];
 if(typeof matched.id!=='string'||!(hosted?/^cs_[A-Za-z0-9_]+$/:/^pi_[A-Za-z0-9_]+$/).test(matched.id))throw new Error('Invalid recovered payment identity');
 // List entries discover an object, but only an exact fresh retrieve binds it.
 const payment=await provider.get(`${hosted?'/v1/checkout/sessions':'/v1/payment_intents'}/${encodeURIComponent(matched.id)}`);
 if(payment.id!==matched.id)throw new Error('Recovered payment identity mismatch');
 modelEvidence(payment,order.order_id);
 const f=order.snapshot.order;
 if(payment.currency!==f.currency||(hosted?payment.amount_subtotal:payment.amount)!==f.total_cents||
   (!hosted&&(payment.transfer_data!=null||payment.application_fee_amount!=null||payment.on_behalf_of!=null)))throw new Error('Checkout recovery economics mismatch');
 const pi=hosted?ref(payment.payment_intent)||null:payment.id;
 const session=hosted?payment.id:null;
 await settlementRpc(db,'finalize_settlement_checkout',{p_order_id:order.order_id,p_payment_intent_id:pi,p_checkout_session_id:session});
 return {...order,stripe_payment_intent_id:pi,stripe_checkout_session_id:session};
}

export async function processSettlementOrder(db:SettlementDatabase,provider:SettlementProvider,candidate:any,{execute=false}={}) {
 let order=candidate;
 let session:any;
 // Reconcile unknown transfers even when a subsequent refund/dispute blocks
 // new sends. Otherwise recovery obligations could disappear behind the hold.
 const unresolved=(order.allocations||[]).filter((a:any)=>['reserved','uncertain'].includes(a.state));
 if(unresolved.length) {
  const transfers=await listAll(provider,`/v1/transfers?transfer_group=${encodeURIComponent('dvnt_settlement_'+order.order_id)}`);
  for(const a of unresolved) {
   const matches=transfers.filter(t=>t.metadata?.settlement_allocation_id===a.id);
   if(matches.length===1) await recordTransfer(db,a,matches[0],order.order_id);
   else if(matches.length>1)await settlementRpc(db,'settlement_hold',{p_order_id:order.order_id,p_event_id:`duplicate:${a.id}`,p_reason:'manual'});
   // Zero matches retains the reservation forever until reviewed, never sends.
  }
 }
 let source:ReturnType<typeof verifySettlementSource>; let charge:any;
 try {
  order=await reconcileCheckout(db,provider,candidate);
  if(order.stripe_checkout_session_id) {
   session=await provider.get(`/v1/checkout/sessions/${encodeURIComponent(order.stripe_checkout_session_id)}`);
   modelEvidence(session,order.order_id);
   if(session.id!==order.stripe_checkout_session_id||session.currency!==order.snapshot.order.currency||
    session.amount_subtotal!==order.snapshot.order.total_cents)throw new Error('Session identity/economics mismatch');
   if(!order.stripe_payment_intent_id&&ref(session.payment_intent)) {
    await settlementRpc(db,'finalize_settlement_checkout',{p_order_id:order.order_id,p_payment_intent_id:ref(session.payment_intent),p_checkout_session_id:session.id});
    order={...order,stripe_payment_intent_id:ref(session.payment_intent)};
   }
  }
  if(!order.stripe_payment_intent_id)throw new Error('Payment not yet linked');
  const intent=await provider.get(`/v1/payment_intents/${encodeURIComponent(order.stripe_payment_intent_id)}?expand[]=latest_charge`);
  if(intent.status!=='succeeded') {
   // Nonpaid is not a balance source. A strict service RPC validates exact
   // retrieved identity/economics before clearing an observation or retiring
   // an unencumbered, zero-received canceled attempt from automatic polling.
   await settlementRpc(db,'settlement_checkout_observation',{p_order_id:order.order_id,p_outcome:'nonpaid',
    p_intent:intent,p_session:session?{...session,payment_intent:ref(session.payment_intent)}:null});
   return {order_id:order.order_id,state:'awaiting_payment',transferred:0};
  }
  const chargeId=ref(intent.latest_charge);
  if(!chargeId)throw new Error('Payment has no successful charge');
  charge=await provider.get(`/v1/charges/${encodeURIComponent(chargeId)}?expand[]=balance_transaction`);
  source=verifySettlementSource(order,intent,charge,session);
  await settlementRpc(db,'settlement_verify_source',{p_order_id:order.order_id,p_charge:source.charge,p_pi:source.pi,
   p_currency:source.currency,p_gross:source.gross,p_tax:source.tax});
 } catch(error) {
  // This records an unresolved operational outcome, not an amount owed.
  // Preserve the first observation and all financial state until proof arrives.
  await settlementRpc(db,'settlement_checkout_observation',{p_order_id:order.order_id,p_outcome:'unknown'});
  throw error;
 }
 if(!execute)return {order_id:order.order_id,state:'verified',transferred:0};
 // Enrollment alone never recognizes pooled funds. Bind the actual provider
 // balance transaction before the exhaustive source-accounted funding audit.
 const platform=await provider.get('/v1/account');
 await settlementRpc(db,'settlement_record_funding_source',{p_order_id:order.order_id,
  p_platform_account:platform.id,p_proof:fundingSourceProof(charge,source.tax)});
 // Fresh list after enrollment, plus reservations from concurrent processes.
 const fresh=await settlementRpc(db,'settlement_order',{p_order_id:order.order_id});
 let transferred=0;const held:string[]=[];
 // Explicit order is necessary even if a database JSON aggregate reorders.
 // The database repeats the dependency check under lock; sorting is not a lock.
 const allocations=[...(fresh.allocations||[])].sort((a:any,b:any)=>
  (a.role==='promoter'?0:1)-(b.role==='promoter'?0:1));
 for(const a of allocations) {
  if(a.state!=='held'||a.obligation_satisfied===true)continue;
  const destination=a.candidate_destination;
  try {
   if(a.role==='organizer') {
    const current=await settlementRpc(db,'settlement_order',{p_order_id:order.order_id});
    if(current.allocations.some((p:any)=>p.role==='promoter'&&p.obligation_satisfied!==true)) {
     throw new Error('promoter settlement pending');
    }
   }
   if(!destination)throw new Error('Recipient onboarding incomplete');
   const recipientProof=await readRecipientProof(provider,destination,a,source.currency);
   // Reverify source immediately before each reservation; a prior recipient's
   // transfer never authorizes paying a now-refunded/disputed charge.
   const currentIntent=await provider.get(`/v1/payment_intents/${encodeURIComponent(source.pi)}?expand[]=latest_charge`);
   const currentCharge=await provider.get(`/v1/charges/${encodeURIComponent(source.charge)}?expand[]=balance_transaction`);
   verifySettlementSource(order,currentIntent,currentCharge,session);
   const latest=await settlementRpc(db,'settlement_order',{p_order_id:order.order_id});
   const sent=await auditSourceTransfers(provider,currentCharge,order.order_id,latest.allocations);
   if(sent.has(a.id))throw new Error('Allocation already funded; reconciliation required');
   // Platform context: no connected-account header. Account v1 settings remain
   // supported for existing platforms; recipient proof remains independently gated.
   const account=await provider.get('/v1/account');
   verifyPlatformPayoutPolicy(account);
   const checkpoint=await settlementRpc(db,'settlement_balance_checkpoint',{});
   verifyRecipientFundingMode(recipientProof,checkpoint.funding_policy?.livemode);
   if(account.id!==checkpoint.funding_policy?.platform_account)throw Error('Funding platform account mismatch');
   const before=await provider.get('/v1/balance');
   const transactions=await auditFundingTransactions(provider,checkpoint.funding_policy);
   const after=await provider.get('/v1/balance');
   if(before.livemode!==checkpoint.funding_policy.livemode||after.livemode!==checkpoint.funding_policy.livemode)
    throw Error('Funding provider mode mismatch');
   const funding=await settlementRpc(db,'settlement_record_funding_audit',{p_currency:source.currency,
    p_available:Math.min(availableCurrency(before,source.currency),availableCurrency(after,source.currency)),
    p_balance_epoch:checkpoint.epoch,p_started_at:checkpoint.observed_at,p_platform_account:account.id,
    p_livemode:after.livemode,p_audit_from:checkpoint.funding_policy.audit_from,p_transactions:transactions});
   provider.assertCanStart?.();
   const reservation=await settlementRpc(db,'settlement_reserve',{p_allocation:a.id,p_destination:destination,
    p_available:funding.available,p_balance_epoch:funding.epoch});
   const expected={...a,destination,charge_id:source.charge,currency:source.currency};
   try {
    const transfer=await provider.post('/v1/transfers',{
     amount:String(reservation.amount),currency:reservation.currency,destination:reservation.destination,
     source_transaction:reservation.source_transaction,transfer_group:reservation.transfer_group,
     'metadata[settlement_order_id]':order.order_id,'metadata[settlement_allocation_id]':a.id,
    },reservation.idempotency_key);
    await recordTransfer(db,expected,transfer,order.order_id);transferred++;
   } catch(error) {
    // A network error OR DB commit error after success is ambiguous. Persist
    // quarantine without guessing whether Stripe moved funds.
    await settlementRpc(db,'settlement_uncertain',{p_allocation:a.id,p_error:'transfer outcome requires verified reconciliation'});
    throw error;
   }
  } catch(error) {
   const reason=settlementFailureCode(error);held.push(`${a.id}: ${reason}`);
   await settlementRpc(db,'settlement_processing_error',{p_order_id:order.order_id,p_allocation:a.id,p_code:reason});
  }
 }
 return {order_id:order.order_id,state:held.length?'held':'processed',transferred,held};
}
