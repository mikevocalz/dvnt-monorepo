import { SettlementProviderError } from "../_shared/settlement-recipient.ts";
import { reconcileReplacementInventoryOrder } from "../_shared/settlement-replacement-cleanup.ts";
import { withSentry } from "../_shared/sentry.ts";
import { withHeartbeat } from "../_shared/heartbeat.ts";
/** Internal settlement worker. No schedule is installed. Both deployment-level
 * and database gates default off. Never expose to browser JWT authorization.
 * Disabling transfer execution does NOT make this endpoint read-only: source
 * enrollment, paid-order evidence, queue leases and reconciliation still write.
 */
import { reconcileSettlementRefunds, executeSettlementRecovery, reconcileSettlementRecovery, reconcileSettlementBankEvents } from '../_shared/settlement-recovery.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { processSettlementOrder, settlementRpc, settlementFailureCode, verifyPlatformPayoutPolicy, type SettlementProvider } from '../_shared/settlement-engine.ts';
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
 // Admission deadline only: never race/cancel a mutation to reclaim run time.
 // Reserve one complete transport timeout plus persistence/response headroom.
 // Host wall time and DB latency must be validated separately before rollout.
 const configuredBudget=Number(Deno.env.get('SETTLEMENT_RUN_BUDGET_MS'));
 if(!Number.isInteger(configuredBudget)||configuredBudget<90000||configuredBudget>600000)
  return respond({error:'invalid_run_budget'},503);
 const started=performance.now();
 const canStart=()=>performance.now()-started<configuredBudget-35000;
 let admissionDenials=0;
 const assertCanStart=()=>{if(!canStart()){admissionDenials++;throw new Error('Settlement run admission budget exhausted');}};
 // SDK-independent HTTP adapter preserves one explicit request per reservation;
 // no transport retry middleware can silently resend a financial mutation.
 const request=async(path:string,body?:Record<string,string>,idempotencyKey?:string,connectedAccount?:string)=>{
  assertCanStart();
  if(connectedAccount&&!/^acct_[A-Za-z0-9_]+$/.test(connectedAccount))throw new Error("Invalid connected account");
  const normalizedPath=/^\/v[12]\//.test(path)?path:`/v1${path}`;
  const response=await fetch(`https://api.stripe.com${normalizedPath}`,{method:body?'POST':'GET',
   headers:{Authorization:`Bearer ${key}`,'Stripe-Version':'2026-09-30.endive',
    ...(connectedAccount?{'Stripe-Account':connectedAccount}:{}),
    ...(body?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':idempotencyKey!}:{})},
   ...(body?{body:new URLSearchParams(body)}:{}),signal:AbortSignal.timeout(30000)});
  const value=await response.json().catch(()=>{throw new SettlementProviderError(response.status,null)});
  if(!response.ok||value?.error)throw new SettlementProviderError(response.status,value?.error?.code);
  return value;
 };
 const provider:SettlementProvider={assertCanStart,get:(path,account)=>request(path,undefined,undefined,account),post:(path,body,idempotencyKey)=>request(path,body,idempotencyKey)};
 return withHeartbeat('settlements-process',async()=>{
 try {
  const run=await settlementRpc(db,'settlement_worker_observation',{p_phase:'started'});
  const observeRuntime=async(phase:string,workKey:string,before:number,completed:boolean)=>{
   const exhausted=admissionDenials>before;
   if(exhausted||completed)await settlementRpc(db,'settlement_runtime_observation',{p_phase:phase,p_work_key:workKey,
    p_outcome:exhausted?'budget':'completed',p_run_started_at:run.observed_at});
   return exhausted;
  };
  let platformPolicyVerified=false;
  try{verifyPlatformPayoutPolicy(await provider.get('/v1/account'));platformPolicyVerified=true;}catch{/* Fixed aggregate policy observation only. */}
  await settlementRpc(db,'settlement_platform_policy_observation',{p_verified:platformPolicyVerified});
  const results=[];
  // Claim just one item at a time. Candidate RPCs persist fair retry order;
  // fetching a whole batch here would lease work we might never reach.
  let emptyPhases=0;let turns=0;
  while(canStart()&&turns++<100&&emptyPhases<5){
   const phase=await settlementRpc(db,'settlement_worker_next_phase',{});
   if(!canStart())break;
   let count=0;
   if(phase===0){
    const refunds=await settlementRpc(db,'settlement_refund_candidates',{p_limit:1});count=refunds.length;
    for(const item of refunds){const before=admissionDenials;let completed=false;let reason;
     try{await reconcileSettlementRefunds(db,provider,item.order_id);completed=true;}catch(error){reason=settlementFailureCode(error);}
     const exhausted=await observeRuntime('refund',item.order_id,before,completed);
     results.push({order_id:item.order_id,phase:'refund',state:completed?'processed':'refund_review_required',
      ...(!completed?{reason:exhausted?'runtime_budget_required':reason}:{})});
    }
   }else if(phase===1){
    const recoveries=await settlementRpc(db,'settlement_recovery_candidates',{p_limit:1});count=recoveries.length;
    for(const item of recoveries){const before=admissionDenials;let completed=false;let reason;
     try{
      if(item.state==='open')await executeSettlementRecovery(db,provider,item.id,Deno.env.get('SETTLEMENT_RECOVERY_ENABLED')==='true');
      else await reconcileSettlementRecovery(db,provider,item.id);
      completed=true;
     }catch(error){reason=settlementFailureCode(error);}
     const exhausted=await observeRuntime('recovery',item.id,before,completed);
     results.push({recovery_id:item.id,phase:'recovery',state:completed?'processed':'recovery_review_required',
      ...(!completed?{reason:exhausted?'runtime_budget_required':reason}:{})});
    }
   }else if(phase===2){
    const before=admissionDenials;
    let rows;
    try{rows=await reconcileSettlementBankEvents(db,provider,1);}catch(error){
     const exhausted=await observeRuntime('bank','candidate_scan',before,false);
     results.push({phase:'bank',state:'bank_reconciliation_required',reason:exhausted?'runtime_budget_required':settlementFailureCode(error)});
     emptyPhases=0;continue;
    }
    count=rows.length;
    for(const row of rows){
     const completed=row.state!=='unverified';
     const exhausted=await observeRuntime('bank',`${row.allocationId}:${row.payoutId}`,before,completed);
     results.push({allocation_id:row.allocationId,payout_id:row.payoutId,phase:'bank',
      state:completed?'verified':'bank_reconciliation_required',
      ...(!completed?{reason:exhausted?'runtime_budget_required':settlementFailureCode(row.reason)}:{})});
    }
   }else if(phase===3){
    const candidates=await settlementRpc(db,'settlement_candidates',{p_limit:1});count=candidates.length;
    for(const order of candidates){const before=admissionDenials;let completed=false;
     try{const result=await processSettlementOrder(db,provider,order,{execute:Deno.env.get('SETTLEMENT_TRANSFERS_ENABLED')==='true'});
      results.push(result);completed=['processed','verified','awaiting_payment'].includes(result.state);}
     catch(error){const reason=settlementFailureCode(error);
      await settlementRpc(db,'settlement_processing_error',{p_order_id:order.order_id,p_code:reason});
      results.push({order_id:order.order_id,state:'held_for_reconciliation',reason});}
     await observeRuntime('order',order.order_id,before,completed);
    }
   }else if(phase===4){
    // Separate default-off capability; transfer flags never enable cancellation.
    if(Deno.env.get('CHECKOUT_REPLACEMENT_ENABLED')==='true'&&Deno.env.get('CHECKOUT_REPLACEMENT_CLEANUP_ENABLED')==='true'){
     const candidates=await settlementRpc(db,'settlement_replacement_cleanup_candidates',{p_limit:1});count=candidates.length;
     for(const item of candidates){const before=admissionDenials;
      const result=await reconcileReplacementInventoryOrder(db,provider,item.order_id);
      const completed=['released','not_dispatched','fulfilled'].includes(result.state);
      const exhausted=await observeRuntime('cleanup',item.order_id,before,completed);
      results.push({order_id:item.order_id,phase:'cleanup',cleanup_state:result.state,
       state:completed?'processed':'replacement_cleanup_attention',
       ...(!completed?{reason:exhausted?'runtime_budget_required':result.reason||'verification_required'}:{})});
     }
    }
   }else throw new Error('Invalid durable worker phase');
   emptyPhases=count===0?emptyPhases+1:0;
  }
  const budget_exhausted=!canStart();
  await settlementRpc(db,'settlement_worker_observation',{p_phase:'completed',p_summary:{budget_exhausted,turns,checked:results.length,
   needs_attention:results.filter((r:any)=>!['processed','verified','awaiting_payment'].includes(r.state)).length}});
  return respond({results,budget_exhausted});
 }catch{
  try{await settlementRpc(db,'settlement_worker_observation',{p_phase:'error'});}catch{/* Primary failure retained. */}
  return respond({error:'settlement_read_failed'},500);
 }
 });
}));
