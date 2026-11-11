/** Separate-charge refund/recovery and bank reconciliation. Provider I/O is
 * injected; reversal execution requires both an explicit flag and a DB gate.
 * Never infer a bank payout from a transfer or from an account-wide total.
 */
export interface RecoveryProvider {
 get(path:string, connectedAccount?:string):Promise<any>;
 post(path:string,body:Record<string,string>,key:string):Promise<any>;
}
const id=(v:any):string|null=>typeof v==='string'?v:typeof v?.id==='string'?v.id:null;
const cents=(v:any)=>Number.isSafeInteger(v)&&v>=0;
async function rpc(db:any,name:string,args:Record<string,unknown>) {
 const {data,error}=await db.rpc(name,args);
 if(error||data==null||data.ok===false)throw new Error(`${name}: ${error?.message||'rejected'}`);
 return data;
}
/** Read actual charge-model rows; caller-controlled metadata is never authority. */
export async function holdSettlementPayment(db:any,paymentIntent:string|null,eventId:string,reason:'refund'|'dispute'|'manual') {
 if(!paymentIntent)return [];
 const {data,error}=await db.from('orders').select('id,charge_model').eq('stripe_payment_intent_id',paymentIntent);
 if(error||!Array.isArray(data))throw new Error('Could not verify refund settlement model');
 const orders=data.filter((o:any)=>o.charge_model==='separate_charges_and_transfers');
 for(const order of orders) {
  await rpc(db,'settlement_hold',{p_order_id:order.id,p_event_id:eventId,p_reason:reason});
  if(reason==='refund')await rpc(db,'settlement_recovery_wake',{p_order_id:order.id});
 }
 return orders.map((o:any)=>o.id) as string[];
}
/** Called before provider I/O. A stable durable intent survives every uncertain
 * result. Destination-charge behavior stays unchanged while coexistence is off. */
export async function beforeSettlementRefund(db:any,body:Record<string,string>,requestKey?:string) {
 const {data,error}=await db.from('orders').select('id,charge_model').eq('stripe_payment_intent_id',body.payment_intent||'');
 if(error||!Array.isArray(data))throw new Error('Could not verify refund settlement model');
 const orders=data.filter((o:any)=>o.charge_model==='separate_charges_and_transfers');
 if(!orders.length)return body;
 if(orders.length!==1)throw new Error('Ambiguous separate-charge refund ownership');
 const key=requestKey||`refund:${body['metadata[ticket_id]']||body['metadata[order_id]']||body.payment_intent}`;
 const result={...body};delete result.refund_application_fee;delete result.reverse_transfer;
 const intent=await rpc(db,'settlement_refund_outflow_begin',{p_order_id:orders[0].id,p_request_key:key,p_body:result});
 if(intent.claimed!==true||!intent.id)throw new Error('Refund already attempted; reconciliation required');
 result['metadata[settlement_order_id]']=orders[0].id;
 result['metadata[settlement_refund_intent_id]']=intent.id;
 return result;
}
/** The only new-ledger refund dispatch boundary. No automatic transport retries. */
export async function executeSettlementRefund(db:any,body:Record<string,string>,requestKey:string|undefined,
 send:(body:Record<string,string>,key:string|undefined)=>Promise<any>) {
 const params=await beforeSettlementRefund(db,body,requestKey);
 const intent=params['metadata[settlement_refund_intent_id]'];
 if(!intent)return send(params,requestKey);
 try {
  const result=await send(params,`dvnt:refund:v1:${intent}`);
  if(!/^re_[A-Za-z0-9_]+$/.test(result?.id||'')||id(result.payment_intent)!==params.payment_intent||
   result.metadata?.settlement_refund_intent_id!==intent||!cents(result.amount)||result.amount<=0||
   (params.amount!==undefined&&result.amount!==Number(params.amount)))throw Error('Refund outcome requires reconciliation');
  await rpc(db,'settlement_refund_outflow_observe',{p_intent:intent,p_refund_id:result.id});
  return result;
 }catch(error){
  try{await rpc(db,'settlement_refund_outflow_observe',{p_intent:intent,p_refund_id:null});}catch{/* The initial durable debit remains reserved. */}
  throw error;
 }
}
/** Close a debit only after the actual refund and available balance transaction
 * agree. Pending/unknown results retain the maximum reservation indefinitely. */
export async function reconcileSettlementRefundOutflow(db:any,provider:RecoveryProvider,order:any,refund:any) {
 const intent=refund.metadata?.settlement_refund_intent_id;
 if(!intent)return;
 if(refund.metadata?.settlement_order_id!==order.order_id||id(refund.payment_intent)!==order.stripe_payment_intent_id||
  refund.currency!==order.snapshot.order.currency||!cents(refund.amount)||refund.amount<=0)throw Error('Refund debit source mismatch');
 if(!['succeeded','failed','canceled'].includes(refund.status))return;
 const txnId=id(refund.balance_transaction);
 let txn:any=null;
 if(refund.status==='succeeded') {
  if(!txnId)return;
  txn=await provider.get(`/balance_transactions/${txnId}`);
  if(txn.id!==txnId||id(txn.source)!==refund.id||txn.amount!==-refund.amount||txn.currency!==refund.currency||txn.type!=='refund'||txn.status!=='available')throw Error('Refund debit balance proof mismatch');
 }else if(txnId||id(refund.failure_balance_transaction))return;
 await rpc(db,'settlement_refund_outflow_reconcile',{p_intent:intent,p_proof:{intent_id:intent,order_id:order.order_id,
  payment_intent:order.stripe_payment_intent_id,refund_id:refund.id,currency:refund.currency,amount:refund.amount,status:refund.status,
  transaction_id:txnId,failure_transaction_id:id(refund.failure_balance_transaction),transaction_source:txn?id(txn.source):null,transaction_amount:txn?.amount??null,
  transaction_currency:txn?.currency??null,transaction_status:txn?.status??null,transaction_type:txn?.type??null}});
}
/** Unknown partial amounts never become a gross-based commission clawback.
 * A complete standalone-ticket refund maps to its frozen admission allocation.
 * Cart/add-on line prices are not yet frozen per unit, so those remain held. */
export function eligibleRefundAllocation(order:any,refund:any,ticket?:any) {
 const frozen=order.snapshot?.order;const selection=order.snapshot?.selection;
 if(!frozen||!cents(refund.amount)||refund.amount<=0)return null;
 if(!selection?.ticket_type_id||!ticket||ticket.order_id!==order.order_id||
  ticket.ticket_type_id!==selection.ticket_type_id||ticket.stripe_payment_intent_id!==order.stripe_payment_intent_id||
  !Number.isInteger(frozen.quantity)||frozen.quantity<1||!Number.isInteger(ticket.order_index)||
  ticket.order_index<1||ticket.order_index>frozen.quantity||ticket.order_count!==frozen.quantity||
  ticket.purchase_amount_cents!==refund.amount||!cents(frozen.subtotal_cents)||frozen.subtotal_cents<=0)return null;
 const basis=frozen.subtotal_cents;
 const eligible=Math.floor(basis/frozen.quantity)+(ticket.order_index<=basis%frozen.quantity?1:0);
 return {eligibleCents:eligible,basisCents:basis,unitKey:`ticket:${ticket.id}`};
}
/** A verified provider refund creates obligations even when allocation is
 * unknown. Full refunds recover only the outstanding allocation remainder. */
export async function recordVerifiedSettlementRefund(db:any,order:any,charge:any,refund:any,ticket?:any,fullRefundProven=false) {
 if(id(charge.payment_intent)!==order.stripe_payment_intent_id||id(refund.charge)!==charge.id||
  id(refund.payment_intent)!==order.stripe_payment_intent_id||refund.status!=='succeeded'||
  !/^re_[A-Za-z0-9]+$/.test(refund.id)||refund.currency!==order.snapshot.order.currency||
  !cents(refund.amount)||refund.amount<=0||!cents(charge.amount)||!cents(charge.amount_refunded)||
  charge.amount_refunded>charge.amount||refund.amount>charge.amount_refunded)throw new Error('Refund source mismatch');
 await rpc(db,'settlement_hold',{p_order_id:order.order_id,p_event_id:refund.id,p_reason:'refund'});
 const allocation=eligibleRefundAllocation(order,refund,ticket);
 // Full remainder is proven by the charge, never inferred from refund metadata.
 const full=fullRefundProven&&charge.refunded===true&&charge.amount_refunded===charge.amount;
 return rpc(db,'settlement_record_refund',{p_order_id:order.order_id,p_refund_id:refund.id,p_charge_id:charge.id,
  p_amount:refund.amount,p_currency:refund.currency,p_full:full,
  p_eligible:allocation?.eligibleCents??null,p_basis:allocation?.basisCents??null,p_unit_key:allocation?.unitKey??null});
}
export async function reconcileSettlementRefunds(db:any,provider:RecoveryProvider,orderId:string) {
 const order=await rpc(db,'settlement_order',{p_order_id:orderId});
 if(!order?.stripe_payment_intent_id)throw new Error('Refund order missing payment');
 const pi=await provider.get(`/payment_intents/${order.stripe_payment_intent_id}`);
 if(pi.id!==order.stripe_payment_intent_id||pi.metadata?.settlement_order_id!==orderId||
  pi.metadata?.charge_model!=='separate_charges_and_transfers'||pi.transfer_data!=null||pi.application_fee_amount!=null||!id(pi.latest_charge))throw new Error('Refund PI mismatch');
 const charge=await provider.get(`/charges/${id(pi.latest_charge)}`);
 if(charge.id!==id(pi.latest_charge)||id(charge.payment_intent)!==pi.id||charge.currency!==order.snapshot.order.currency||
  charge.amount!==pi.amount||charge.paid!==true||charge.captured!==true||charge.status!=='succeeded'||
  charge.transfer!=null||charge.transfer_data!=null||charge.application_fee!=null)throw new Error('Refund charge mismatch');
 const refunds=await allPages(provider,`/refunds?charge=${encodeURIComponent(charge.id)}&limit=100`);
 for(const refund of refunds)await reconcileSettlementRefundOutflow(db,provider,order,refund);
 const succeeded=refunds.filter((r:any)=>r.status==='succeeded');
 const fullySettledRefund=charge.refunded===true&&succeeded.every((r:any)=>cents(r.amount))&&
  succeeded.reduce((sum:number,r:any)=>sum+r.amount,0)===charge.amount&&charge.amount_refunded===charge.amount;
 for(const refund of refunds.filter((r:any)=>r.status==='succeeded').sort((a:any,b:any)=>a.created-b.created||a.id.localeCompare(b.id))) {
  let ticket;
  if(refund.metadata?.ticket_id) {
   const {data,error}=await db.from('tickets').select('id,order_id,ticket_type_id,stripe_payment_intent_id,order_index,order_count,purchase_amount_cents').eq('id',refund.metadata.ticket_id).maybeSingle();
   if(error)throw new Error('Refund ticket allocation unavailable');ticket=data;
  }
  await recordVerifiedSettlementRefund(db,order,charge,refund,ticket,fullySettledRefund);
 }
}
async function allPages(provider:RecoveryProvider,path:string,account?:string) {
 const result:any[]=[];let cursor:string|null=null;const seen=new Set<string>();
 for(let pages=0;pages<1000;pages++) {
  const page=await provider.get(path+(cursor?`&starting_after=${encodeURIComponent(cursor)}`:''),account);
  if(!Array.isArray(page?.data)||typeof page.has_more!=='boolean')throw new Error('Incomplete provider page');
  for(const item of page.data){if(!id(item)||seen.has(item.id))throw new Error('Duplicate provider page');seen.add(item.id);result.push(item);}
  if(!page.has_more)return result;
  if(!page.data.length)throw new Error('Empty unfinished provider page');cursor=page.data[page.data.length-1].id;
 }
 throw new Error('Provider pagination limit exceeded');
}
/** A reversal is attempted once. Ambiguous outcome is permanently quarantined
 * until read-only reconciliation proves the exact provider reversal exists. */
export async function executeSettlementRecovery(db:any,provider:RecoveryProvider,recoveryId:string,enabled=false) {
 if(!enabled)throw new Error('Recovery execution disabled');
 const intent=await rpc(db,'settlement_claim_recovery',{p_recovery_id:recoveryId});
 if(intent.claimed!==true)throw new Error('Recovery already attempted; reconciliation required');
 try {
  const reversal=await provider.post(`/transfers/${intent.transfer_id}/reversals`,{
   amount:String(intent.amount_cents),'metadata[settlement_recovery_id]':intent.id,
   'metadata[settlement_allocation_id]':intent.allocation_id,'metadata[refund_id]':intent.refund_id,
  },intent.idempotency_key);
  if(!reversalMatches(reversal,intent))throw new Error('Reversal response mismatch');
  await rpc(db,'settlement_finish_recovery',{p_recovery_id:intent.id,p_reversal_id:reversal.id,p_amount:reversal.amount});
  return reversal.id;
 }catch(error){await rpc(db,'settlement_uncertain_recovery',{p_recovery_id:intent.id,p_error:error instanceof Error?error.message:'uncertain provider outcome'});throw error;}
}
function reversalMatches(r:any,i:any) {
 return /^trr_[A-Za-z0-9]+$/.test(r?.id||'')&&id(r.transfer)===i.transfer_id&&r.amount===i.amount_cents&&
  r.metadata?.settlement_recovery_id===i.id&&r.metadata?.settlement_allocation_id===i.allocation_id&&r.metadata?.refund_id===i.refund_id;
}
export async function reconcileSettlementRecovery(db:any,provider:RecoveryProvider,recoveryId:string) {
 const intent=await rpc(db,'settlement_recovery',{p_recovery_id:recoveryId});
 const reversals=await allPages(provider,`/transfers/${intent.transfer_id}/reversals?limit=100`);
 const matched=reversals.filter(r=>reversalMatches(r,intent));
 if(matched.length!==1)throw new Error('Reversal outcome remains uncertain');
 return rpc(db,'settlement_finish_recovery',{p_recovery_id:intent.id,p_reversal_id:matched[0].id,p_amount:matched[0].amount});
}
/** Verify the incoming connected-account transaction is explicitly a member of
 * this automatic payout. A transfer and a similarly-sized payout are no proof. */
export async function verifyAllocationBankPayout(provider:RecoveryProvider,allocation:any,payoutId:string) {
 if(!/^tr_[A-Za-z0-9]+$/.test(allocation.stripe_transfer_id||'')||!/^acct_[A-Za-z0-9]+$/.test(allocation.destination||'')||!/^po_[A-Za-z0-9]+$/.test(payoutId))throw new Error('Invalid bank references');
 const transfer=await provider.get(`/transfers/${allocation.stripe_transfer_id}`);
 if(transfer.id!==allocation.stripe_transfer_id||id(transfer.destination)!==allocation.destination||
  transfer.amount!==allocation.amount_cents||transfer.currency!==allocation.currency||
  transfer.metadata?.settlement_allocation_id!==allocation.id||transfer.metadata?.settlement_order_id!==allocation.order_id||
  transfer.reversed===true||transfer.amount_reversed!==0||!id(transfer.destination_payment))throw new Error('Transfer proof mismatch');
 const payment=await provider.get(`/charges/${id(transfer.destination_payment)}`,allocation.destination);
 if(payment.id!==id(transfer.destination_payment)||id(payment.source_transfer)!==transfer.id||payment.amount!==transfer.amount||
  payment.currency!==transfer.currency||payment.paid!==true||payment.status!=='succeeded'||!id(payment.balance_transaction))throw new Error('Incoming payment proof mismatch');
 const txn=await provider.get(`/balance_transactions/${id(payment.balance_transaction)}`,allocation.destination);
 if(txn.id!==id(payment.balance_transaction)||id(txn.source)!==payment.id||txn.amount!==transfer.amount||txn.currency!==transfer.currency||txn.status!=='available'||!cents(txn.net)||txn.net<=0||txn.net>txn.amount)throw new Error('Incoming balance proof mismatch');
 const payout=await provider.get(`/payouts/${payoutId}`,allocation.destination);
 if(payout.id!==payoutId||payout.automatic!==true||payout.currency!==transfer.currency||!['paid','pending','in_transit','failed','canceled'].includes(payout.status))throw new Error('Payout is not a verified automatic payout');
 const members=await allPages(provider,`/balance_transactions?payout=${encodeURIComponent(payoutId)}&limit=100`,allocation.destination);
 const matching=members.filter(x=>x.id===txn.id&&id(x.source)===payment.id&&x.amount===txn.amount&&x.net===txn.net&&x.currency===txn.currency);
 if(matching.length!==1)throw new Error('Incoming transaction not in this payout');
 return {account:allocation.destination,transferId:transfer.id,destinationPayment:payment.id,transactionId:txn.id,
  payoutId,grossCents:transfer.amount,netContributionCents:txn.net,currency:txn.currency,status:payout.status==='paid'?'paid':['failed','canceled'].includes(payout.status)?'failed':'pending',created:payout.created};
}
export async function reconcileAllocationBankPayout(db:any,provider:RecoveryProvider,allocation:any,payoutId:string) {
 const proof=await verifyAllocationBankPayout(provider,allocation,payoutId);
 return rpc(db,'settlement_bank_proof',{p_allocation:allocation.id,p_proof:proof});
}
/** Signed webhook failure is saved even before an allocation has bank proof. */
export async function recordSettlementPayoutEvent(db:any,event:any) {
 if(!event.account||!['payout.failed','payout.canceled','payout.paid','payout.reconciliation_completed'].includes(event.type))return;
 const payout=event.data?.object;
 if(!payout?.id||!Number.isSafeInteger(event.created))throw new Error('Invalid payout event');
 await rpc(db,'settlement_bank_event',{p_account:event.account,p_payout:payout.id,p_event_id:event.id,p_created:event.created,
  p_state:event.type==='payout.paid'?'paid':event.type==='payout.reconciliation_completed'?'reconcile':'failed'});
}

/** Re-run after paid/reconciliation-completed notifications or a manual sweep.
 * A paid payout whose membership is not ready remains explicitly unverified. */
export async function reconcileSettlementBankEvents(db:any,provider:RecoveryProvider,limit=100) {
 const rows=await rpc(db,'settlement_bank_candidates',{p_limit:limit});const results=[];
 for(const row of rows) {
  try {const proof=await reconcileAllocationBankPayout(db,provider,row,row.payout_id);results.push({allocationId:row.id,payoutId:row.payout_id,...proof});}
  catch(error){results.push({allocationId:row.id,payoutId:row.payout_id,state:'unverified',reason:error instanceof Error?error.message:'verification failed'});}
 }
 return results;
}
