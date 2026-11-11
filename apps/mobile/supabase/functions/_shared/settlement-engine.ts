/** Settlement engine: all provider I/O is injected for isolated testing.
 * No automatic retries on provider writes. Database reservations survive errors.
 */
export interface SettlementProvider {
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
export function verifyRecipient(account:any,destination:string,allocation?:any) {
 if(account?.id!==destination||account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status!=='active') {
  throw new Error('Recipient transfer capability is not active');
 }
 if(allocation) {
  const owner=account.metadata?.dvnt_host_id||account.metadata?.dvnt_user_id;
  const matches=allocation.role==='organizer' ? owner===allocation.recipient_id :
   allocation.recipient_user_id!=null ? owner===allocation.recipient_user_id : account.metadata?.dvnt_promoter_id===allocation.recipient_id;
  if(!matches)throw new Error('Recipient account ownership does not match frozen identity');
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
 const payment=matches[0];modelEvidence(payment,order.order_id);
 const f=order.snapshot.order;
 if(payment.currency!==f.currency||(hosted?payment.amount_subtotal:payment.amount)!==f.total_cents||
   (!hosted&&(payment.transfer_data!=null||payment.application_fee_amount!=null)))throw new Error('Checkout recovery economics mismatch');
 const pi=hosted?ref(payment.payment_intent)||null:payment.id;
 const session=hosted?payment.id:null;
 await settlementRpc(db,'finalize_settlement_checkout',{p_order_id:order.order_id,p_payment_intent_id:pi,p_checkout_session_id:session});
 return {...order,stripe_payment_intent_id:pi,stripe_checkout_session_id:session};
}

export async function processSettlementOrder(db:SettlementDatabase,provider:SettlementProvider,candidate:any,{execute=false}={}) {
 let order=await reconcileCheckout(db,provider,candidate);
 let session:any;
 if(order.stripe_checkout_session_id) {
  session=await provider.get(`/v1/checkout/sessions/${encodeURIComponent(order.stripe_checkout_session_id)}`);
  if(!order.stripe_payment_intent_id&&ref(session.payment_intent)) {
   await settlementRpc(db,'finalize_settlement_checkout',{p_order_id:order.order_id,p_payment_intent_id:ref(session.payment_intent),p_checkout_session_id:session.id});
   order={...order,stripe_payment_intent_id:ref(session.payment_intent)};
  }
 }
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
 if(!order.stripe_payment_intent_id)throw new Error('Payment not yet linked');
 const intent=await provider.get(`/v1/payment_intents/${encodeURIComponent(order.stripe_payment_intent_id)}?expand[]=latest_charge`);
 if(intent.status!=='succeeded')return {order_id:order.order_id,state:'awaiting_payment',transferred:0};
 const chargeId=ref(intent.latest_charge);
 if(!chargeId)throw new Error('Payment has no successful charge');
 const charge=await provider.get(`/v1/charges/${encodeURIComponent(chargeId)}?expand[]=balance_transaction`);
 const source=verifySettlementSource(order,intent,charge,session);
 await settlementRpc(db,'settlement_verify_source',{p_order_id:order.order_id,p_charge:source.charge,p_pi:source.pi,
  p_currency:source.currency,p_gross:source.gross,p_tax:source.tax});
 if(!execute)return {order_id:order.order_id,state:'verified',transferred:0};
 // Fresh list after enrollment, plus reservations from concurrent processes.
 const fresh=await settlementRpc(db,'settlement_order',{p_order_id:order.order_id});
 let transferred=0;const held:string[]=[];
 for(const a of fresh.allocations||[]) {
  if(a.state!=='held')continue;
  const destination=a.candidate_destination;
  try {
   if(!destination)throw new Error('Recipient onboarding incomplete');
   verifyRecipient(await provider.get(`/v2/core/accounts/${encodeURIComponent(destination)}?include[0]=configuration.recipient`),destination,a);
   // Reverify source immediately before each reservation; a prior recipient's
   // transfer never authorizes paying a now-refunded/disputed charge.
   const currentIntent=await provider.get(`/v1/payment_intents/${encodeURIComponent(source.pi)}?expand[]=latest_charge`);
   const currentCharge=await provider.get(`/v1/charges/${encodeURIComponent(source.charge)}?expand[]=balance_transaction`);
   verifySettlementSource(order,currentIntent,currentCharge,session);
   const latest=await settlementRpc(db,'settlement_order',{p_order_id:order.order_id});
   const sent=await auditSourceTransfers(provider,currentCharge,order.order_id,latest.allocations);
   if(sent.has(a.id))throw new Error('Allocation already funded; reconciliation required');
   const checkpoint=await settlementRpc(db,'settlement_balance_checkpoint',{});
   const available=availableCurrency(await provider.get('/v1/balance'),source.currency);
   const reservation=await settlementRpc(db,'settlement_reserve',{p_allocation:a.id,p_destination:destination,p_available:available,p_balance_epoch:checkpoint.epoch});
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
