import { withSentry } from "../_shared/sentry.ts";
import { withHeartbeat } from "../_shared/heartbeat.ts";
/** Internal settlement worker. No schedule is installed. Both deployment-level
 * and database gates default off. Never expose to browser JWT authorization.
 */
import { reconcileSettlementRefunds, executeSettlementRecovery, reconcileSettlementRecovery, reconcileSettlementBankEvents } from '../_shared/settlement-recovery.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { processSettlementOrder, settlementRpc, settlementFailureCode, type SettlementProvider } from '../_shared/settlement-engine.ts';
const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(withSentry("settlements-process",async(req:Request)=>{
 const secret=Deno.env.get('SETTLEMENT_WORKER_SECRET');
 if(req.method!=='POST')return respond({error:'method_not_allowed'},405);
 if(!secret||req.headers.get('Authorization')!==`Bearer ${secret}`)return respond({error:'unauthorized'},401);
 const input=await req.json().catch(()=>({}));
 const healthOnly=input?.action==='health';
 if(!healthOnly&&Deno.env.get('SETTLEMENT_WORKER_ENABLED')!=='true')return respond({error:'settlement_worker_disabled'},503);
 const key=Deno.env.get('STRIPE_SECRET_KEY');
 const url=Deno.env.get('SUPABASE_URL');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if((!healthOnly&&!key)||!url||!service)return respond({error:'not_configured'},503);
 const db=createClient(url,service);
 if(healthOnly){try{return respond({...await settlementRpc(db,'settlement_health',{}),provider_configured:!!key,
  worker_enabled:Deno.env.get('SETTLEMENT_WORKER_ENABLED')==='true'});}catch{return respond({error:'readiness_unavailable'},503);}}
 // SDK-independent HTTP adapter preserves one explicit request per reservation;
 // no transport retry middleware can silently resend a financial mutation.
 const request=async(path:string,body?:Record<string,string>,idempotencyKey?:string,connectedAccount?:string)=>{
  if(connectedAccount&&!/^acct_[A-Za-z0-9_]+$/.test(connectedAccount))throw new Error("Invalid connected account");
  const normalizedPath=/^\/v[12]\//.test(path)?path:`/v1${path}`;
  const response=await fetch(`https://api.stripe.com${normalizedPath}`,{method:body?'POST':'GET',
   headers:{Authorization:`Bearer ${key}`,'Stripe-Version':'2026-09-30.endive',
    ...(connectedAccount?{'Stripe-Account':connectedAccount}:{}),
    ...(body?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':idempotencyKey!}:{})},
   ...(body?{body:new URLSearchParams(body)}:{}),signal:AbortSignal.timeout(30000)});
  const value=await response.json();
  if(!response.ok||value.error)throw new Error(`Stripe request failed (${response.status})`);
  return value;
 };
 const provider:SettlementProvider={get:(path,account)=>request(path,undefined,undefined,account),post:(path,body,idempotencyKey)=>request(path,body,idempotencyKey)};
 return withHeartbeat('settlements-process',async()=>{
 try {
  await settlementRpc(db,'settlement_worker_observation',{p_phase:'started'});
  const results=[];
  const refunds=await settlementRpc(db,'settlement_refund_candidates',{p_limit:100});
  for(const item of refunds){try{await reconcileSettlementRefunds(db,provider,item.order_id);}catch{results.push({order_id:item.order_id,state:'refund_review_required'});}}
  const recoveries=await settlementRpc(db,'settlement_recovery_candidates',{p_limit:100});
  for(const item of recoveries){try{
   if(item.state==='open')await executeSettlementRecovery(db,provider,item.id,Deno.env.get('SETTLEMENT_RECOVERY_ENABLED')==='true');
   else await reconcileSettlementRecovery(db,provider,item.id);
  }catch{results.push({recovery_id:item.id,state:'recovery_review_required'});}}
  try{await reconcileSettlementBankEvents(db,provider,100);}catch{results.push({state:'bank_reconciliation_required'});}
  const candidates=await settlementRpc(db,'settlement_candidates',{p_limit:100});
  for(const order of candidates) {
   try {results.push(await processSettlementOrder(db,provider,order,{execute:Deno.env.get('SETTLEMENT_TRANSFERS_ENABLED')==='true'}));}
   catch(error) {
    const reason=settlementFailureCode(error);
    await settlementRpc(db,'settlement_processing_error',{p_order_id:order.order_id,p_code:reason});
    results.push({order_id:order.order_id,state:'held_for_reconciliation',reason});
   }
  }
  await settlementRpc(db,'settlement_worker_observation',{p_phase:'completed',p_summary:{checked:results.length,
   needs_attention:results.filter((r:any)=>!['processed','verified','awaiting_payment'].includes(r.state)).length}});
  return respond({results});
 }catch{
  try{await settlementRpc(db,'settlement_worker_observation',{p_phase:'error'});}catch{/* Primary failure retained. */}
  return respond({error:'settlement_read_failed'},500);
 }
 });
}));
