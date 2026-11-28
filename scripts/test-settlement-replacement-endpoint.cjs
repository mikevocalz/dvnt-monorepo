/** Actual endpoint + coordinator + ownership/proof/accept/claim SQL. Every
 * account, email, catalog row and provider object is synthetic and local. */
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');const {webcrypto}=require('node:crypto');
const {fixture,rpc}=require('./fixtures/settlement/replacement-db.cjs');
const ROOT=path.resolve(__dirname,'..'),SHARED=path.join(ROOT,'apps/mobile/supabase/functions/_shared');const modules=new Map();
function load(name){const file=path.join(SHARED,name),exports={};if(modules.has(file))return modules.get(file);modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:p=>load(p.replace(/^\.\//,'')),Date,Number,Error,URL,Response,Request,URLSearchParams,AbortSignal,encodeURIComponent,crypto:webcrypto,Uint8Array,TextEncoder,console:{error(){}}});return exports;}
const coordinator=load('checkout-replacement.ts'),recovery=load('checkout-recovery.ts'),verification=load('verify-session.ts');
async function setup(options={}){
 const f=await fixture(options);let handler;const calls=[],reads=[],writes=[],payments=new Map();let lose=false,failFinalize=false,afterProof=null,afterCreate=null;
 const guestToken='1'.repeat(64);if(options.guest)await f.db.query('UPDATE dvnt_settlement.guest_recovery_sessions SET session_hash=$1',[await recovery.recoveryHash(guestToken)]);
 const db={from:name=>{assert.equal(name,'session');let token;const chain={select:()=>chain,eq:(_key,v)=>{token=v;return chain},order:()=>chain,limit:()=>chain,maybeSingle:async()=>({data:token==='buyer-token'?{userId:'fixture-buyer',expiresAt:'2099-01-01'}:token==='other-token'?{userId:'another-buyer',expiresAt:'2099-01-01'}:token==='expired-token'?{userId:'fixture-buyer',expiresAt:'2000-01-01'}:null,error:null})};return chain;},rpc:async(name,args)=>{calls.push([name,args]);if(name==='finalize_settlement_checkout'&&failFinalize){failFinalize=false;return {data:null,error:{message:'PRIVATE DB persistence failed'}};}try{return {data:await rpc(f.db,name,args),error:null};}catch(e){return {data:null,error:{message:e.message}};}}};
 const provider={get:async p=>{reads.push(p);if(p==='/v1/account')return {object:'account',id:'acct_fixture'};if(p.startsWith('/v1/payment_intents/pi_fixture'))return structuredClone(f.intent);if(p==='/v1/checkout/sessions/cs_fixture')return structuredClone(f.session);if(p==='/v1/charges?payment_intent=pi_fixture&limit=100'){if(afterProof){const fn=afterProof;afterProof=null;await fn();}return {object:'list',data:[],has_more:false};}const id=p.split('/').pop();if(payments.has(id))return structuredClone(payments.get(id));throw Error('Unexpected provider GET '+p);},post:async(p,params,key)=>{assert.ok(['/v1/payment_intents','/v1/checkout/sessions'].includes(p));writes.push({p,params,key});const metadata={};for(const [k,v]of Object.entries(params)){const m=/^metadata\[(.+)\]$/.exec(k);if(m)metadata[m[1]]=v;}const hosted=p.includes('sessions');let amount=Number(params.amount);if(hosted){amount=0;for(const [k,v]of Object.entries(params)){const m=/^line_items\[(\d+)\]\[price_data\]\[unit_amount\]$/.exec(k);if(m)amount+=Number(v)*Number(params[`line_items[${m[1]}][quantity]`]);}}
 const id=hosted?'cs_successorfixture':'pi_successorfixture';const result={id,object:hosted?'checkout.session':'payment_intent',livemode:false,currency:hosted?params['line_items[0][price_data][currency]']:params.currency,metadata,...(hosted?{mode:'payment',status:'open',payment_status:'unpaid',amount_subtotal:amount,amount_total:amount,total_details:{amount_tax:0,amount_discount:0,amount_shipping:0},payment_intent:null,url:'https://checkout.stripe.com/c/pay/cs_successorfixture'}:{status:'requires_payment_method',amount,amount_received:0,transfer_data:null,application_fee_amount:null,on_behalf_of:null,client_secret:'pi_successorfixture_secret_synthetic'})};payments.set(id,result);if(afterCreate){const fn=afterCreate;afterCreate=null;await fn();}if(lose){lose=false;throw Error('PRIVATE lost response');}return result;}};
 const env={CHECKOUT_REPLACEMENT_ENABLED:'true',TICKET_SEPARATE_CHARGES_ENABLED:'true',STRIPE_SECRET_KEY:'fixture-secret',STRIPE_PUBLISHABLE_KEY:'pk_test_fixture',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',...options.env};
 const source=fs.readFileSync(path.join(ROOT,'apps/mobile/supabase/functions/checkout-replacement/index.ts'),'utf8').replace(/^import[^\n]+\n/gm,'');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},...coordinator,...recovery,verifySession:verification.verifySession,Response,Request,URLSearchParams,AbortSignal,JSON,createClient:()=>db,Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},fetch:async(url,opts)=>{try{const p=url.replace('https://api.stripe.com','');return Response.json(opts.method==='POST'?await provider.post(p,Object.fromEntries(new URLSearchParams(opts.body)),opts.headers['Idempotency-Key']):await provider.get(p));}catch{return Response.json({error:{message:'PRIVATE provider failure'}},{status:500});}}});
 const send=(body,token=options.guest?null:'buyer-token')=>handler(new Request('https://fixture.invalid/checkout-replacement',{method:'POST',headers:token?{'x-auth-token':token}: {Authorization:'Bearer fixture-anon'},body:JSON.stringify({...body,...(options.guest?{recovery_session:guestToken}:{})})}));
 const quote=()=>send({action:'quote',order_id:f.original.order_id});const accept=q=>send({action:'accept',order_id:f.original.order_id,quote_id:q.quote_id,accepted_total_cents:q.total_cents,accepted_currency:q.currency});
 return {...f,calls,reads,writes,payments,send,quote,accept,lose:()=>lose=true,failFinalize:()=>failFinalize=true,afterProof:fn=>afterProof=fn,afterCreate:fn=>afterCreate=fn,guestToken};
}

test('actual endpoint defaults off, rejects forged identity/evidence and owner/session crossover before provider I/O',async()=>{const f=await setup();try{
 for(const token of [null,'other-token','expired-token']){const r=await f.send({action:'quote',order_id:f.original.order_id},token);assert.ok([401,409].includes(r.status));}
 for(const patch of [{actor_id:'fixture-buyer'},{intent:{status:'canceled'}},{guest_email:'buyer@example.invalid'},{recovery_session:'1'.repeat(64)}])assert.ok([400,401].includes((await f.send({action:'quote',order_id:f.original.order_id,...patch})).status));
 assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);
}finally{await f.db.close();}const g=await setup({env:{CHECKOUT_REPLACEMENT_ENABLED:'false'}});try{assert.equal((await g.quote()).status,503);assert.equal(g.calls.length,0);assert.equal(g.reads.length,0);}finally{await g.db.close();}});

test('actual all-rail quote/accept dispatches once, preserves tax, inventory lineage and replayed provider identity',async()=>{for(const options of [{},{rail:'ticket-checkout'},{rail:'guest-checkout',guest:true},{cart:true}]){const f=await setup(options);try{
 const qresponse=await f.quote();assert.equal(qresponse.status,200,await qresponse.clone().text());const q=(await qresponse.json()).quote;assert.equal(f.writes.length,0);assert.equal(q.previous_total_cents,10350);
 const r=await f.accept(q);assert.equal(r.status,200,await r.clone().text());const value=await r.json();assert.notEqual(value.order_id,f.original.order_id);assert.equal(f.writes.length,1);
 assert.equal((await f.accept(q)).status,200);assert.equal(f.writes.length,1);assert.equal((await f.db.query('SELECT count(*)::int n FROM dvnt_settlement.checkout_replacements')).rows[0].n,1);
 assert.equal(f.writes[0].params.confirm,undefined);assert.equal(Object.keys(f.writes[0].params).some(k=>k.includes('payment_method_types')),false);
 if(options.rail==='ticket-checkout'){assert.equal(q.tax_mode,'at_checkout');assert.equal(f.writes[0].params['automatic_tax[enabled]'],'true');}else assert.equal(f.writes[0].params['automatic_tax[enabled]'],undefined);
 if(options.cart){assert.ok(value.cart_id);assert.notEqual(value.cart_id,f.snapshot.order.cart_id);}
 assert.doesNotMatch(JSON.stringify(q),/NEVER_PERSIST|client_secret|stripe_params|guest_email/);
}finally{await f.db.close();}}});

test('concurrent explicit accepts create one successor and at most one provider dispatch',async()=>{const f=await setup();try{const q=(await (await f.quote()).json()).quote;const responses=await Promise.all([f.accept(q),f.accept(q)]);assert.ok(responses.some(r=>r.status===200));assert.ok(responses.every(r=>[200,409].includes(r.status)));assert.equal(f.writes.length,1);assert.equal((await f.db.query('SELECT count(*)::int n FROM orders')).rows[0].n,2);}finally{await f.db.close();}});

test('lost provider response and DB persistence failure never trigger an automatic second create',async()=>{for(const failure of ['lose','failFinalize']){const f=await setup();try{const q=(await (await f.quote()).json()).quote;f[failure]();const first=await f.accept(q);assert.equal(first.status,409);assert.doesNotMatch(await first.text(),/PRIVATE|fixture-secret/);assert.equal((await f.accept(q)).status,409);assert.equal(f.writes.length,1);const id=(await f.db.query('SELECT successor_order_id FROM dvnt_settlement.checkout_replacements')).rows[0].successor_order_id;
 // Synthetic exact-object reconciliation binds the one observed provider
 // object. Resuming retrieves it; no fresh key or create is introduced.
 await rpc(f.db,'finalize_settlement_checkout',{p_order_id:id,p_payment_intent_id:'pi_successorfixture',p_checkout_session_id:null});assert.equal((await f.accept(q)).status,200);assert.equal(f.writes.length,1);
}finally{await f.db.close();}}});

test('changed economics, sold out inventory and hold committed after provider proof all block before dispatch',async()=>{for(const change of ['price','stock','hold']){const f=await setup();try{const q=(await (await f.quote()).json()).quote;
 if(change==='price')await f.db.exec('UPDATE ticket_types SET price_cents=12000');if(change==='stock')await f.db.exec('UPDATE ticket_types SET quantity_total=0');if(change==='hold')f.afterProof(()=>rpc(f.db,'settlement_hold',{p_order_id:f.original.order_id,p_event_id:'fixture-hold-race',p_reason:'refund'}));
 assert.equal((await f.accept(q)).status,409);assert.equal(f.writes.length,0);assert.equal((await f.db.query('SELECT count(*)::int n FROM dvnt_settlement.checkout_replacements')).rows[0].n,0);
}finally{await f.db.close();}}});

test('active, captured and wrong-account proof is never upgraded by a local failed status or buyer assertion',async()=>{for(const patch of [{status:'processing'},{status:'requires_payment_method'},{amount_received:100},{latest_charge:'ch_captured'},{livemode:true}]){const f=await setup();try{Object.assign(f.intent,patch);await f.db.query("UPDATE orders SET status='payment_failed' WHERE id=$1",[f.original.order_id]);assert.equal((await f.quote()).status,409);assert.equal(f.writes.length,0);assert.equal((await f.db.query('SELECT count(*)::int n FROM dvnt_settlement.replacement_quotes')).rows[0].n,0);}finally{await f.db.close();}}});


test('financial hold arriving during provider creation preserves identity but withholds the payment capability',async()=>{const f=await setup();try{const q=(await (await f.quote()).json()).quote;f.afterCreate(()=>rpc(f.db,'settlement_hold',{p_order_id:f.original.order_id,p_event_id:'fixture-hold-after-create',p_reason:'refund'}));const response=await f.accept(q);assert.equal(response.status,409);assert.doesNotMatch(await response.text(),/client_secret|checkout.stripe.com/);assert.equal(f.writes.length,1);assert.equal((await f.db.query('SELECT stripe_payment_intent_id FROM orders WHERE id<>( $1::uuid )',[f.original.order_id])).rows[0].stripe_payment_intent_id,'pi_successorfixture');assert.equal((await f.accept(q)).status,409);assert.equal(f.writes.length,1);}finally{await f.db.close();}});

for (const change of ['price','expiry']) test('actual API/controller handles '+change+' refusal then requires a new explicit accepted quote',async()=>{
 const f=await setup();try{
  const errors={},api={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT,'packages/app/lib/api/function-error.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:errors});
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT,'packages/app/lib/api/checkout-replacement.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,Date,Number,URL,Intl,Set,Error,require:name=>{assert.equal(name,'./invoke-edge');return{invokeEdge:async(_name,body)=>{const response=await f.send(body);return response.ok?{data:await response.json()}:{error:await errors.describeFunctionError({context:response})};}}}});
  const c=api.createReplacementController({identity:{kind:'member',actor:'fixture-buyer'},orderId:f.original.order_id,isCurrent:()=>true});
  await c.review();const old=c.getSnapshot().quote;
  if(change==='price')await f.db.exec('UPDATE ticket_types SET price_cents=12000');
  else { // Synthetic clock fixture only; no production quote can be modified.
   await f.db.exec("ALTER TABLE dvnt_settlement.replacement_quotes DISABLE TRIGGER immutable_replacement_quote");
   await f.db.query("UPDATE dvnt_settlement.replacement_quotes SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[old.quote_id]);
   await f.db.exec("ALTER TABLE dvnt_settlement.replacement_quotes ENABLE TRIGGER immutable_replacement_quote");
  }
  await c.accept();assert.equal(c.getSnapshot().phase,'idle');assert.equal(c.getSnapshot().quote,undefined);
  assert.equal(f.writes.length,0);assert.equal((await f.db.query('SELECT count(*)::int n FROM dvnt_settlement.checkout_replacements')).rows[0].n,0);
  await c.review();const fresh=c.getSnapshot().quote;assert.notEqual(fresh.quote_id,old.quote_id);if(change==='price')assert.ok(fresh.total_cents>old.total_cents);
  assert.equal(f.writes.length,0);await c.accept();assert.equal(c.getSnapshot().phase,'payment');assert.equal(f.writes.length,1);
  assert.equal(Number(f.writes[0].params.amount),fresh.total_cents);
 }finally{await f.db.close();}
});
