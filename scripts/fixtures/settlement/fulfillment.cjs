const {readFileSync}=require('node:fs');const {resolve}=require('node:path');const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');const ts=require('typescript');const vm=require('node:vm');
const root=resolve(__dirname,'../../..');const read=p=>readFileSync(resolve(root,p),'utf8');
const {sourceSchemaSql:sourceSql}=require('./replacement-source-schema.cjs');
const funding={};vm.runInNewContext(ts.transpileModule(read('apps/mobile/supabase/functions/_shared/settlement-funding.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:funding,Date,Set,Number,Error,encodeURIComponent});
const engine={};vm.runInNewContext(ts.transpileModule(read('apps/mobile/supabase/functions/_shared/settlement-engine.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:engine,Date,Set,Number,Error,encodeURIComponent,require:()=>funding});
const TIER='00000000-0000-4000-8000-0000000000aa';const ADDON='00000000-0000-4000-8000-0000000000ab';const VARIANT='00000000-0000-4000-8000-0000000000ac';
async function setup({rail='create-payment-intent',quantity=1,capacity=100,cartAddon=false,addonOnly=false,defaultGrants=false,installGate=true,uuidSpelling=x=>x,secondAdmission=false,hostedPiUnknown=false}={}){
 const pg=new PGlite();
 for(const p of ['scripts/fixtures/settlement/schema.sql','scripts/fixtures/settlement/external-schema.sql'])await pg.exec(read(p));
 if(defaultGrants)await pg.exec('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role;');
 await pg.exec(sourceSql());
 const gate=read('docs/payments/drafts/settlement-fulfillment.sql');
 let artifact=read('apps/mobile/supabase/migrations/20261111040111_settlement_runtime_v1.sql');
 // Test-only legacy simulation can omit the gate, including after its source
 // is added to the generated artifact. No production path can disable it.
 if(!installGate)artifact=artifact.replace(gate.trim().replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,''),'');
 await pg.exec(artifact);
 if(installGate&&!(await pg.query("SELECT to_regclass('dvnt_settlement.fulfillments') v")).rows[0].v)throw Error('Generated artifact is missing the fulfillment gate');
 await pg.exec(read('scripts/fixtures/settlement/approved-policy.sql'));
 await pg.exec("INSERT INTO dvnt_settlement.funding_policy VALUES(true,'acct_platform_fixture',false,0,'synthetic only'); UPDATE dvnt_settlement.controls SET checkout_enabled=true,transfers_enabled=true; INSERT INTO dvnt_settlement.currency_reserves VALUES('usd',0,'synthetic only'); UPDATE event_promoters SET stripe_account_id='acct_promoter';");
 await pg.query("INSERT INTO ticket_types(id,event_id,currency,quantity_total,quantity_sold) VALUES($1,1,'usd',$2,0)",[TIER,capacity]);
 const cart=rail==='cart-checkout'?randomUUID():null;const line=cart&&!addonOnly?randomUUID():null;const addonLine=cart&&(cartAddon||addonOnly)?randomUUID():null;
 const secondTier='00000000-0000-4000-8000-0000000000ad';const secondLine=secondAdmission?randomUUID():null;
 const lines=[];if(cart){await pg.query("INSERT INTO carts(id,user_id,event_id,status,currency,total_cents,stripe_pi_id) VALUES($1,'fixture-buyer',1,'paying','usd',11000,'pi_fixture')",[cart]);
  if(line)lines.push({id:line,tier_id:TIER,addon_id:null,variant_id:null,quantity,unit_price_cents:((cartAddon?9000:10000)-(secondAdmission?1000:0))/quantity});
  if(secondAdmission){await pg.query("INSERT INTO ticket_types(id,event_id,currency,quantity_total,quantity_sold) VALUES($1,1,'usd',100,0)",[secondTier]);lines.push({id:secondLine,tier_id:secondTier,addon_id:null,variant_id:null,quantity:1,unit_price_cents:1000});}
  if(addonLine){await pg.query("INSERT INTO ticket_addons(id,event_id,quantity_total,quantity_sold,is_redeemable) VALUES($1,1,100,0,true)",[ADDON]);await pg.query('INSERT INTO ticket_addon_variants(id,addon_id,quantity_total,quantity_sold) VALUES($1,$2,100,0)',[VARIANT,ADDON]);lines.push({id:addonLine,tier_id:null,addon_id:ADDON,variant_id:VARIANT,quantity:2,unit_price_cents:addonOnly?5000:500});}
  if(secondAdmission&&addonLine)await pg.query('UPDATE ticket_addons SET requires_tier_id=$1 WHERE id=$2',[secondTier,ADDON]);
  for(const l of lines)await pg.query('INSERT INTO cart_line_items(id,cart_id,tier_id,addon_id,variant_id,quantity,unit_price_cents,category) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[l.id,cart,l.tier_id,l.addon_id,l.variant_id,l.quantity,l.unit_price_cents,l.tier_id?'admission':'addon']);}
 const guest=rail==='guest-checkout';const session=['ticket-checkout','guest-checkout'].includes(rail)?'cs_fixture':null;
 const snapshot={rail,selection:cart?{lines:lines.sort((a,b)=>a.id.localeCompare(b.id)).map(l=>({...l,id:uuidSpelling(l.id),tier_id:l.tier_id?uuidSpelling(l.tier_id):null,addon_id:l.addon_id?uuidSpelling(l.addon_id):null,variant_id:l.variant_id?uuidSpelling(l.variant_id):null}))}:{ticket_type_id:uuidSpelling(TIER)},order:{user_id:guest?null:'fixture-buyer',guest_email:guest?'fixture@example.invalid':null,event_id:1,quantity:cart?lines.reduce((n,l)=>n+l.quantity,0):quantity,currency:'usd',total_cents:11000,subtotal_cents:10000,organizer_fee_cents:500,platform_fee_cents:1000,dvnt_total_fee_cents:1000,promoter_code:'FIXTURE',promoter_commission_amount_cents:1000,promoter_commission_bps:1000,promoter_customer_discount_bps:0,...(cart?{cart_id:uuidSpelling(cart)}:{})}};
 const db={async rpc(n,args){try{const r=await pg.query(`SELECT public.${n}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args));return {data:r.rows[0].v,error:null}}catch(e){return {data:null,error:{message:e.message}}}}};
 const call=async(n,a)=>{const r=await db.rpc(n,a);if(r.error)throw Error(r.error.message);return r.data};
 const p=await call('prepare_settlement_checkout',{p_snapshot:snapshot,p_request_key:'fixture-fulfillment'});
 await call('claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});await call('finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:hostedPiUnknown?null:'pi_fixture',p_checkout_session_id:session});
 if(!cart)await pg.query("INSERT INTO ticket_holds(ticket_type_id,quantity,status,expires_at,payment_intent_id,event_id,user_id,guest_email) VALUES($1,$2,'active',now()+interval '1 hour',$3,1,$4,$5)",[TIER,quantity,session||'pi_fixture',snapshot.order.user_id,snapshot.order.guest_email]);
 const ticketRows=Array.from({length:addonOnly?0:quantity},(_,i)=>cart?{ticket_id:randomUUID(),line_item_id:line,qr_token:'qr_fixture_'+i,qr_payload:'signed_fixture_'+i}:{id:randomUUID(),event_id:1,ticket_type_id:TIER,order_id:p.order_id,user_id:snapshot.order.user_id,guest_email:snapshot.order.guest_email,guest_lookup_token:guest?'lookup_fixture_'+i:null,stripe_payment_intent_id:'pi_fixture',stripe_checkout_session_id:session,qr_token:'qr_fixture_'+i,qr_payload:'signed_fixture_'+i,purchase_amount_cents:Math.floor(11000/quantity)+(i<11000%quantity?1:0)});
 if(secondAdmission)ticketRows.push({ticket_id:randomUUID(),line_item_id:secondLine,qr_token:'qr_second',qr_payload:'signed_second'});
 const addonRows=addonLine?[0,1].map(i=>({line_item_id:addonLine,qr_token:'qr_addon_'+i,qr_payload:'signed_addon_'+i})):[];
 const args=cart?{p_cart_id:cart,p_payment_intent_id:'pi_fixture',p_amount_received:11000,p_currency:'usd',p_user_id:'fixture-buyer',p_event_id:1,p_ticket_rows:ticketRows,p_addon_rows:addonRows}:{p_order_id:p.order_id,p_ticket_type_id:TIER,p_payment_intent_id:'pi_fixture',p_checkout_session_id:session,p_amount_cents:11000,p_ticket_rows:ticketRows};
 const issue=(overrides={})=>call(cart?'complete_paid_cart_atomic':'paid_ticket_issuance_atomic',{...args,...overrides});
 const verify=()=>call('settlement_verify_source',{p_order_id:p.order_id,p_charge:'ch_fixture',p_pi:'pi_fixture',p_currency:'usd',p_gross:11000,p_tax:0});
 const metadata={settlement_order_id:p.order_id,charge_model:'separate_charges_and_transfers'};
 const intent={id:'pi_fixture',status:'succeeded',amount:11000,amount_received:11000,currency:'usd',latest_charge:'ch_fixture',metadata};
 const charge={id:'ch_fixture',created:100,payment_intent:'pi_fixture',amount:11000,amount_captured:11000,currency:'usd',paid:true,captured:true,status:'succeeded',refunded:false,amount_refunded:0,disputed:false,balance_transaction:{id:'txn_fixture',object:'balance_transaction',source:'ch_fixture',type:'charge',created:100,status:'available',currency:'usd',amount:11000,fee:500,net:10500}};
 const transfers=[];const requests=[];const provider={async get(path){requests.push(['GET',path]);if(path.startsWith('/v1/payment_intents/'))return structuredClone(intent);if(path.startsWith('/v1/charges/'))return structuredClone(charge);if(path.startsWith('/v1/checkout/sessions/'))return {id:session,metadata,status:'complete',payment_status:'paid',currency:'usd',amount_subtotal:11000,amount_total:11000,payment_intent:'pi_fixture',total_details:{amount_tax:0,amount_shipping:0,amount_discount:0}};if(path.startsWith('/v1/transfers?'))return {data:transfers,has_more:false};if(path==='/v1/account')return {object:'account',id:'acct_platform_fixture',settings:{payouts:{schedule:{interval:'manual'}}}};if(path==='/v1/balance')return {livemode:false,available:[{currency:'usd',amount:100000-transfers.reduce((n,t)=>n+t.amount,0)}]};if(path.startsWith('/v1/balance_transactions?'))return {object:'list',data:[charge.balance_transaction,...transfers.map((t,i)=>({id:'txn_transfer_'+i,object:'balance_transaction',source:t.id,type:'transfer',created:101+i,status:'available',currency:'usd',amount:-t.amount,fee:0,net:-t.amount}))],has_more:false};if(path.startsWith('/v2/core/accounts/')){const id=path.split('/')[4].split('?')[0];return {id,metadata:id==='acct_host'?{dvnt_host_id:'fixture-host'}:{dvnt_promoter_id:'00000000-0000-4000-8000-000000000002'},configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'active'}}}}}}}throw Error('Unexpected read '+path)},async post(path,b,key){requests.push(['POST',path]);const t={id:'tr_'+transfers.length,amount:Number(b.amount),currency:b.currency,destination:b.destination,source_transaction:b.source_transaction,transfer_group:b.transfer_group,metadata:{settlement_order_id:b['metadata[settlement_order_id]'],settlement_allocation_id:b['metadata[settlement_allocation_id]']},reversed:false,amount_reversed:0};transfers.push(t);return t}};
 const candidate=()=>call('settlement_order',{p_order_id:p.order_id});const run=async()=>engine.processSettlementOrder(db,provider,await candidate(),{execute:true});
 return {pg,db,provider,call,p,snapshot,cart,line,addonLine,secondLine,secondTier,ticketRows,addonRows,issue,verify,candidate,run,transfers,requests,intent,charge};
}
function worker(db,provider,env={}) {
 const recovery={};
 vm.runInNewContext(ts.transpileModule(read('apps/mobile/supabase/functions/_shared/settlement-recovery.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:recovery,Date,Set,Number,Error,encodeURIComponent});
 let handler;
 const code=read('apps/mobile/supabase/functions/settlements-process/index.ts').replace(/^import[\s\S]*?from [^;]+;\n/gm,'');
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:{},withSentry:(_n,fn)=>fn,withHeartbeat:(_n,fn)=>fn(),...engine,...recovery,performance,Response,Request,URLSearchParams,AbortSignal,
  Deno:{env:{get:k=>({SETTLEMENT_RUN_BUDGET_MS:'120000',SETTLEMENT_WORKER_SECRET:'fixture_worker',STRIPE_SECRET_KEY:'fixture_provider',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture_service',...env})[k]},serve:fn=>handler=fn},
  createClient:()=>db,
  fetch:async(url,options)=>{const path=url.replace('https://api.stripe.com','');try{return Response.json(options.method==='POST'?await provider.post(path,Object.fromEntries(new URLSearchParams(options.body)),options.headers['Idempotency-Key']):await provider.get(path));}catch{return Response.json({error:{message:'synthetic provider unavailable'}},{status:400});}},
 });
 return ()=>handler(new Request('https://fixture.invalid/settlements-process',{method:'POST',headers:{Authorization:'Bearer fixture_worker'}}));
}
module.exports={setup,sourceSql,read,engine,worker,TIER,ADDON,VARIANT};
