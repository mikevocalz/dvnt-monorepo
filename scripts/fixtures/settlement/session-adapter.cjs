/** Execute the real hosted-session adapter and its real SQL issuance/money RPCs.
 * Only provider reads and non-financial messaging/alert dependencies are faked.
 */
const vm=require('node:vm');const path=require('node:path');const ts=require('typescript');
const {webcrypto}=require('node:crypto');const {read}=require('./fulfillment.cjs');
async function sessionAdapter(f,{tax=1000}={}){
 await f.pg.exec('ALTER TABLE orders ADD COLUMN IF NOT EXISTS ticket_email_status text, ADD COLUMN IF NOT EXISTS payment_method_last4 text, ADD COLUMN IF NOT EXISTS payment_method_brand text; ALTER TABLE order_timeline ADD COLUMN IF NOT EXISTS label text, ADD COLUMN IF NOT EXISTS detail text;');
 const money=read('apps/mobile/supabase/migrations/20260806100100_orders_monotonic_guard.sql');
 await f.pg.exec(money.slice(money.indexOf('CREATE OR REPLACE FUNCTION public.upsert_order_money_state(')));
 const gross=f.snapshot.order.total_cents+tax;
 Object.assign(f.intent,{object:'payment_intent',amount:gross,amount_received:gross});
 Object.assign(f.charge,{object:'charge',amount:gross,amount_captured:gross});
 Object.assign(f.charge.balance_transaction,{amount:gross,net:gross-500});
 const session={id:'cs_fixture',object:'checkout.session',mode:'payment',status:'complete',payment_status:'paid',currency:'usd',amount_subtotal:f.snapshot.order.total_cents,amount_total:gross,payment_intent:'pi_fixture',total_details:{amount_tax:tax,amount_discount:0,amount_shipping:0},metadata:{...f.intent.metadata,type:'event_ticket',event_id:String(f.snapshot.order.event_id),ticket_type_id:f.snapshot.selection.ticket_type_id,quantity:String(f.snapshot.order.quantity),...(f.snapshot.order.user_id?{user_id:f.snapshot.order.user_id}:{guest_email:f.snapshot.order.guest_email})}};
 const get=f.provider.get;f.provider.get=async p=>p.startsWith('/v1/checkout/sessions/')?structuredClone(session):get(p);
 const calls=[],deliveries=[];const db={rpc:async(n,a)=>{calls.push(n);return f.db.rpc(n,a)},from(table){
  let fields='*';let filters=[];let payload;const q={select:s=>{fields=s;return q},eq:(k,v)=>{filters.push([k,v]);return q},insert:p=>{payload=p;return q},
   maybeSingle:async()=>{try{return {data:(await f.pg.query(`SELECT ${fields} FROM ${table} WHERE ${filters.map(([k],i)=>`${k}=$${i+1}`).join(' AND ')}`,filters.map(([,v])=>v))).rows[0]||null,error:null}}catch(e){return {data:null,error:e}}},
   then:(resolve,reject)=>{const run=async()=>{for(const r of Array.isArray(payload)?payload:[payload]){const keys=Object.keys(r);await f.pg.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(r));}return {data:null,error:null}};return run().then(resolve,reject)}
  };return q;
 }};
 const stubs={
  'capacity-alerts.ts':{maybeFireCapacityAlerts:async()=>{}},'apply-promo-code.ts':{incrementPromoUsage:async()=>{}},
  'send-resend-email.ts':{},'checkout-profile.ts':{finalizeCheckoutProfile:async()=>({status:'none'})},
  'ticket-email-delivery.ts':{deliverTicketBundleEmail:async()=>{deliveries.push((await f.pg.query('SELECT status FROM orders WHERE id=$1',[f.p.order_id])).rows[0].status);return {ok:true}}},
 };
 const cache={};function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;
  vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports,crypto:webcrypto,TextEncoder,Uint8Array,btoa,atob,AbortSignal,Response,URLSearchParams,
   Deno:{env:{get:k=>k==='TICKET_HMAC_SECRET'?'synthetic-test-signing-key':k==='STRIPE_SECRET_KEY'?'synthetic-provider-key':undefined}},console:{log(){},error(){},warn(){}},
   fetch:async(url,init)=>{if(init?.method&&init.method!=='GET')throw Error('Unexpected provider mutation');return Response.json(await f.provider.get(url.replace('https://api.stripe.com','')))},
   require:name=>stubs[path.basename(name)]||load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))),
  });return exports;
 }
 const adapter=load('apps/mobile/supabase/functions/_shared/session-issuance.ts');
 const run=(incoming=session)=>adapter.issueTicketsForCheckoutSession(db,structuredClone(incoming),{eventCreatedAt:new Date(Date.now()+1000).toISOString(),logPrefix:'[synthetic]'});
 return {run,session,calls,deliveries,db};
}
module.exports={sessionAdapter};
