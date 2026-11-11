const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');const {resolve}=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const ROOT=resolve(__dirname,'../../..');const read=p=>readFileSync(resolve(ROOT,p),'utf8');
const TIER='00000000-0000-4000-8000-000000000010';
async function rpc(db,name,args={}){const keys=Object.keys(args);return (await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args))).rows[0].v;}
const {sourceSchemaSql,functionSql}=require('./replacement-source-schema.cjs');
async function fixture({rail='create-payment-intent',guest=false,cart=false,addon=false,includePrices=false}={}){
 const db=new PGlite();
 for(const p of ['scripts/fixtures/settlement/schema.sql','scripts/fixtures/settlement/external-schema.sql'])await db.exec(read(p));
 await db.exec(sourceSchemaSql());
 await db.exec(read('apps/mobile/supabase/migrations/20261111040111_settlement_runtime_v1.sql'));
 await db.exec(read('scripts/fixtures/settlement/approved-policy.sql'));
 await db.exec("INSERT INTO public.ticket_types(id,event_id,price_cents,quantity_total) VALUES('00000000-0000-4000-8000-000000000010',1,10000,20);\nUPDATE public.events SET status='active',end_date=clock_timestamp()+interval '10 days',start_date=clock_timestamp()+interval '9 days',payout_release_at=NULL;\n");
 await db.exec("INSERT INTO dvnt_settlement.funding_policy VALUES(true,'acct_fixture',false,0,'synthetic replacement'); INSERT INTO dvnt_settlement.currency_reserves VALUES('usd',0,'synthetic replacement'); UPDATE dvnt_settlement.controls SET checkout_enabled=true,checkout_replacement_enabled=true,guest_checkout_recovery_enabled=true");
 const snapshot={rail,selection:{ticket_type_id:TIER},order:{user_id:guest?null:'fixture-buyer',guest_email:guest?'buyer@example.invalid':null,event_id:1,quantity:1,currency:'usd',total_cents:10350,subtotal_cents:10000,organizer_fee_cents:350,platform_fee_cents:700,dvnt_total_fee_cents:700}};
 if(cart){snapshot.rail='cart-checkout';snapshot.order.cart_id='00000000-0000-4000-8000-000000000020';snapshot.selection={lines:[{id:'00000000-0000-4000-8000-000000000030',tier_id:TIER,addon_id:null,variant_id:null,quantity:1}]};await db.exec(`INSERT INTO carts(id,user_id,event_id,status,stripe_pi_id,idempotency_key) VALUES('${snapshot.order.cart_id}','fixture-buyer',1,'paying','pi_fixture','fixture-original-cart'); INSERT INTO cart_line_items(id,cart_id,category,tier_id,quantity,unit_price_cents) VALUES('00000000-0000-4000-8000-000000000030','${snapshot.order.cart_id}','admission','${TIER}',1,10000)`);}
 if(addon){assert.ok(cart);await db.exec(`INSERT INTO ticket_addons(id,event_id,name,price_cents,quantity_total) VALUES('00000000-0000-4000-8000-000000000040',1,'Fixture add-on',1000,1); INSERT INTO ticket_addon_variants(id,addon_id,price_cents,quantity_total) VALUES('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000040',1500,1); INSERT INTO cart_line_items(id,cart_id,category,addon_id,variant_id,quantity,unit_price_cents) VALUES('00000000-0000-4000-8000-000000000031','${snapshot.order.cart_id}','addon','00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000041',1,1500)`);snapshot.selection.lines.push({id:'00000000-0000-4000-8000-000000000031',tier_id:null,addon_id:'00000000-0000-4000-8000-000000000040',variant_id:'00000000-0000-4000-8000-000000000041',quantity:1});Object.assign(snapshot.order,{quantity:2,subtotal_cents:11500,total_cents:11988,organizer_fee_cents:488,platform_fee_cents:976,dvnt_total_fee_cents:976});}
 if(includePrices&&cart)for(const line of snapshot.selection.lines)line.unit_price_cents=line.addon_id?1500:10000;
 const original=await rpc(db,'prepare_settlement_checkout',{p_snapshot:snapshot,p_request_key:'fixture-original-key'});
 await rpc(db,'claim_settlement_checkout',{p_order_id:original.order_id,p_params:{'automatic_tax[enabled]':rail==='ticket-checkout'?'true':'false'}});
 const hosted=['ticket-checkout','guest-checkout'].includes(rail);
 await rpc(db,'finalize_settlement_checkout',{p_order_id:original.order_id,p_payment_intent_id:'pi_fixture',p_checkout_session_id:hosted?'cs_fixture':null});
 const metadata={settlement_order_id:original.order_id,charge_model:'separate_charges_and_transfers'};
 const intent={id:'pi_fixture',object:'payment_intent',status:'canceled',amount:snapshot.order.total_cents,currency:'usd',amount_received:0,amount_capturable:0,latest_charge:null,livemode:false,transfer_data:null,application_fee_amount:null,on_behalf_of:null,metadata,canceled_at:1,client_secret:'NEVER_PERSIST'};
 const session=hosted?{id:'cs_fixture',object:'checkout.session',mode:'payment',status:'expired',payment_status:'unpaid',livemode:false,currency:'usd',amount_subtotal:snapshot.order.total_cents,amount_total:snapshot.order.total_cents,payment_intent:'pi_fixture',metadata,total_details:{amount_tax:0,amount_discount:0,amount_shipping:0}}:null;
 let guestHash=null;if(guest){guestHash='c'.repeat(64);await rpc(db,'settlement_guest_recovery_issue',{p_order_id:original.order_id,p_email:'buyer@example.invalid',p_capability_hash:'a'.repeat(64),p_email_hash:'b'.repeat(64),p_ip_hash:'d'.repeat(64)});assert.equal((await rpc(db,'settlement_guest_recovery_exchange',{p_capability_hash:'a'.repeat(64),p_session_hash:guestHash,p_ip_hash:'d'.repeat(64)})).ok,true);}
 const auth={p_actor_id:guest?null:'fixture-buyer',p_guest_session_hash:guestHash};
 const quote=()=>rpc(db,'settlement_replacement_quote',{p_order_id:original.order_id,...auth});
 const accept=(q,patch={})=>rpc(db,'settlement_replacement_accept',{p_quote_id:q.quote_id,...auth,p_accepted_total_cents:q.total_cents,p_accepted_currency:q.currency,p_intent:intent,p_session:session,p_platform_account:'acct_fixture',p_livemode:false,p_charges:[],...patch});
 return {db,original,snapshot,intent,session,auth,quote,accept};
}


module.exports={fixture,rpc,TIER,functionSql};
