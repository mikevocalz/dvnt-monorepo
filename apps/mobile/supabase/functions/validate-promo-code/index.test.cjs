// Real authenticated validation handler; session/database are explicit fixtures.
// Never uses a real account, claim, order, provider key or payment.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {fixture,promo,promoter,TIER,PROMO,ROOT} = require('../guest-checkout/discounts-fixture.cjs');
const make = (options={}) => fixture({...options,entrypoint:path.join(__dirname,'index.ts')});
const check = (f,code='COOLIN',extra={}) => f.call({event_id:1,ticket_type_id:TIER,code,accept_promoter:true,...extra});

test('COOLIN is a promoter, case-insensitive, read-only and never disguised as a promo',async()=>{
 const f=make({promoters:[promoter({code:'Coolin',promoter_commission_bps:1500})]});
 for(const code of ['COOLIN','Coolin',' coolin ']){
  const r=await check(f,code);assert.equal(r.status,200);assert.equal(r.data.valid,true);
  assert.equal(r.data.code_kind,'promoter');assert.equal(r.data.code,'Coolin');assert.equal(r.data.customer_discount_bps,1000);
  assert.equal(r.data.promo_code_id,undefined);assert.equal(r.data.discount_type,undefined);
 }
 assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);assert.equal(f.emails.length,0);
});
test('legacy promo-only callers do not receive an incompatible promoter response',async()=>{
 const f=make({promoters:[promoter({code:'COOLIN'})]});
 const r=await check(f,'COOLIN',{accept_promoter:false});assert.equal(r.data.valid,false);
});
test('normal promos keep their original policy and identity',async()=>{
 const f=make({promos:[promo()]});const r=await check(f,'SAVE10');assert.equal(r.data.valid,true);
 assert.equal(r.data.code_kind,'promo');assert.equal(r.data.promo_code_id,PROMO);assert.equal(r.data.discount_value,10);
});
for(const [title,patch] of [['expired',{valid_until:'2000-01-01'}],['future',{valid_from:'2099-01-01'}],
 ['wrong tier',{ticket_type_id:'another-tier'}],['capped',{max_uses:1,uses_count:1}]]){
 test(title+' exact promo does not fall through to a same-string promoter',async()=>{
  const f=make({promos:[promo({code:'COOLIN',...patch})],promoters:[promoter({code:'COOLIN'})]});
  const r=await check(f);assert.equal(r.data.valid,false);assert.equal(f.writes.length,0);
 });
}
test('active same-string promo takes precedence',async()=>{
 const f=make({promos:[promo({code:'COOLIN',discount_value:20})],promoters:[promoter({code:'COOLIN'})]});
 const r=await check(f);assert.equal(r.data.code_kind,'promo');assert.equal(r.data.discount_value,20);
});
test('invalid, paused, removed and cross-event promoter codes are rejected',async()=>{
 for(const patch of [{code:'OTHER'},{status:'paused'},{status:'removed'},{event_id:2}]){
  const f=make({promoters:[promoter({code:'COOLIN',...patch})]});const r=await check(f);assert.equal(r.data.valid,false);assert.equal(f.writes.length,0);
 }
});
test('literal underscore matches only the exact promoter',async()=>{
 const f=make({promoters:[promoter({code:'TREX1',customer_discount_bps:5000}),promoter({id:'other',code:'TRE_1'})]});
 const r=await check(f,'TRE_1');assert.equal(r.data.valid,true);assert.equal(r.data.customer_discount_bps,1000);
});
test('normal-promo lookup error never falls through to another discount',async()=>{
 const f=make({readError:'promo_codes',promoters:[promoter({code:'COOLIN'})]});const r=await check(f);assert.equal(r.status,503);assert.equal(r.data.valid,false);
});
test('session remains required; no unauthenticated validation or mutation',async()=>{
 const f=make({unauthorized:true,promoters:[promoter({code:'COOLIN'})]});const r=await check(f);assert.equal(r.status,401);assert.equal(f.writes.length,0);
});
test('malformed event and code inputs return a safe validation error',async()=>{
 for(const data of [{event_id:'1junk'},{event_id:1.2},{code:{}},{code:'x'.repeat(65)},{code:'BAD\x00CODE'}]){
  const f=make();const r=await check(f,'COOLIN',data);assert.equal(r.status,400);assert.equal(f.writes.length,0);
 }
});
test('per-member cap and unreadable cap are rejected',async()=>{
 const f=make({promos:[promo({max_per_user:1})]});f.tables.orders.push({id:'past',promo_code_id:PROMO,user_id:'member-fixture',status:'paid'});
 assert.equal((await check(f,'SAVE10')).data.valid,false);
 const fail=make({promos:[promo({max_per_user:1})],readError:'orders'});assert.equal((await check(fail,'SAVE10')).status,503);
});
test('client parser keeps promoter and normal promo payloads distinct',()=>{
 const f=make();const {readCheckoutCodeResult:read,canContinueWithCheckoutCode:ready}=f.load(path.join(ROOT,'packages/app/lib/payments/checkout-code.ts'));
 const result=read({valid:true,code_kind:'promoter',code:'Coolin',customer_discount_bps:1000});
 assert.equal(result.kind,'promoter');assert.equal(result.promo,undefined);
 for(const value of [{},{valid:true,code_kind:'promoter',code:'X',customer_discount_bps:-1},
  {valid:true,code_kind:'promoter',code:'X',customer_discount_bps:10001}, {valid:true,code_kind:'unknown',code:'X',discount_type:'percent',discount_value:10}])assert.equal(read(value).kind,'error');
 const normal={type:'percent',value:10,code:'SAVE10'};
 assert.equal(ready('COOLIN',null,false,null),false);assert.equal(ready('COOLIN',null,false,'Invalid'),false);
 assert.equal(ready('SAVE10',normal,true,null),false);assert.equal(ready('EDITED',normal,false,null),false);
 assert.equal(ready('save10',normal,false,null),true);assert.equal(ready('',null,false,null),true);
});
