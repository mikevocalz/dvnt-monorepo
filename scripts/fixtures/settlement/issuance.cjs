/** Synthetic preparation around the real production issuers. Never seeds a receipt. */
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {randomUUID}=require('node:crypto');
const root=resolve(__dirname,'../../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const fixtureTier='00000000-0000-4000-8000-0000000000aa';
const issuerSources=[
 ['20261021144500_paid_ticket_issuance_atomic.sql','-- Shared legacy-hold admission:'],
 ['20261009100200_cart_issuance_addon_ticket_and_units.sql'],
 ['20261029024347_paid_cart_retry_fulfillment.sql'],
];
function issuerSql(){
 const initial=issuerSources.map(([name,end])=>{
  const sql=read('apps/mobile/supabase/migrations/'+name);
  return end?sql.split(end)[0]:sql;
 }).join('\n');
 const latest=read('apps/mobile/supabase/migrations/20261031142216_repeat_purchase_tier_limits.sql');
 const dependencies=latest.split('-- Online purchase reservation')[0].replace(/^BEGIN;\s*$/m,'');
 const paidCart=latest.match(/CREATE OR REPLACE FUNCTION public\.complete_paid_cart_atomic\([\s\S]*?GRANT EXECUTE ON FUNCTION public\.complete_paid_cart_atomic\([^;]*;/)?.[0];
 if(!paidCart)throw Error('Latest canonical paid cart issuer not found');
 return initial+'\n'+dependencies+'\n'+paidCart;
}
async function installIssuers(pg){
 await pg.exec(read('scripts/fixtures/settlement/fulfillment-schema.sql'));
 await pg.exec(issuerSql());
}
async function rpc(pg,name,args){
 return (await pg.query(`SELECT public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args))).rows[0].v;
}
async function issuePaidOrder(pg,orderId){
 const row=(await pg.query('SELECT o.*,c.snapshot FROM orders o JOIN dvnt_settlement.checkouts c ON c.order_id=o.id WHERE o.id=$1',[orderId])).rows[0];
 if(!row?.stripe_payment_intent_id)throw Error('Fixture requires the canonical linked PaymentIntent before issuance');
 if(row.cart_id)throw Error('Use the cart fulfillment fixture for exact cart/addon setup');
 const tier=row.snapshot.selection?.ticket_type_id;
 if(!/^[a-f0-9-]{36}$/.test(tier||''))throw Error('Fixture snapshot must use a real UUID ticket_type_id, such as fixtureTier');
 await pg.query("INSERT INTO ticket_types(id,event_id,currency,quantity_total,quantity_sold) VALUES($1,$2,$3,1000000,0) ON CONFLICT DO NOTHING",[tier,row.event_id,row.currency]);
 const key=row.stripe_checkout_session_id||row.stripe_payment_intent_id;
 if(!(await pg.query('SELECT 1 FROM tickets WHERE order_id=$1',[orderId])).rows.length){
  await pg.query("INSERT INTO ticket_holds(ticket_type_id,quantity,status,expires_at,payment_intent_id,event_id,user_id,guest_email) SELECT $1,$2,'active',now()+interval '1 hour',$3,$4,$5,$6 WHERE NOT EXISTS(SELECT 1 FROM ticket_holds WHERE payment_intent_id=$3)",[tier,row.quantity,key,row.event_id,row.user_id,row.guest_email]);
 }
 const tickets=Array.from({length:row.quantity},(_,index)=>({
  id:randomUUID(),event_id:row.event_id,ticket_type_id:tier,order_id:orderId,user_id:row.user_id,guest_email:row.guest_email,
  guest_lookup_token:'fixture_lookup_'+index,stripe_payment_intent_id:row.stripe_payment_intent_id,
  stripe_checkout_session_id:row.stripe_checkout_session_id,qr_token:'fixture_qr_'+orderId+'_'+index,
  qr_payload:'fixture_signed_'+orderId+'_'+index,
  purchase_amount_cents:Math.floor(row.total_cents/row.quantity)+(index<row.total_cents%row.quantity?1:0),
 }));
 const result=await rpc(pg,'paid_ticket_issuance_atomic',{p_order_id:orderId,p_ticket_type_id:tier,
  p_payment_intent_id:row.stripe_payment_intent_id,p_checkout_session_id:row.stripe_checkout_session_id,
  p_amount_cents:row.total_cents,p_ticket_rows:tickets});
 if(result.ok!==true||result.terminal===true)throw Error('Actual fixture issuer rejected: '+JSON.stringify(result));
 return result;
}
module.exports={installIssuers,issuerSql,issuePaidOrder,fixtureTier};
