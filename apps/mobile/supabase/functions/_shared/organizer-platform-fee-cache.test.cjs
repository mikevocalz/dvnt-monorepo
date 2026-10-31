const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {harness}=require('./payment-safety.test.cjs');const now=new Date('2026-10-20T12:00:00Z');
function fixture(patch={},error=null){const calls=[];const report={status:'ready',amountCents:12345,currency:'usd',asOf:'2026-10-20T11:00:00Z',through:'2026-10-20T10:00:00Z',...patch};const db={async rpc(name,args){calls.push({name,args});return{data:{ok:true,report},error}}};const mod=harness().load(path.join(__dirname,'organizer-platform-fee-cache.ts'));return{calls,db,mod,run:()=>mod.loadCachedOrganizerPlatformFees(db,'owner',[1],now)}};
test('actual cache wrapper enrolls only authenticated current NY month and preserves dated complete report',async()=>{const f=fixture(),r=await f.run();assert.equal(r.amountCents,12345);assert.equal(r.through,'2026-10-20T10:00:00.000Z');assert.equal(r.asOf,'2026-10-20T11:00:00.000Z');assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{name:'enroll_platform_fee_snapshots',args:{p_auth_id:'owner',p_month_start:'2026-10-01T04:00:00.000Z',p_month_end:'2026-11-01T04:00:00.000Z'}}])});
test('pending/failed RPC never reports partial or zero',async()=>{for(const p of [{status:'pending',amountCents:999},{status:'unavailable'},{status:'other'}])assert.equal((await fixture(p).run()).amountCents,null);assert.equal((await fixture({},Error('fixture')).run()).amountCents,null)});
test('invalid numeric, stale, future and out-of-period evidence fail closed',async()=>{for(const p of [{amountCents:null},{amountCents:''},{amountCents:'1e2'},{amountCents:-1},{currency:null},{currency:'bad_currency'},{through:'2026-09-30T23:00:00Z'},{through:'2026-11-01T04:00:00Z'},{through:'2026-10-20T13:00:00Z'},{asOf:'2026-10-18T00:00:00Z'},{asOf:null},{asOf:'2026-10-21T00:00:00Z'}])assert.equal((await fixture(p).run()).status,'unavailable')});
test('zero/no-activity preserved without invented currency',async()=>{assert.equal((await fixture({amountCents:0}).run()).amountCents,0);const r=await fixture({amountCents:0,currency:null}).run();assert.equal(r.status,'ready');assert.equal(r.currency,null)});
test('unauthenticated wrapper does not enroll or read',async()=>{const f=fixture();assert.equal((await f.mod.loadCachedOrganizerPlatformFees(f.db,'',[1],now)).status,'unavailable');assert.equal(f.calls.length,0)});

test('four-hour large-cohort completion stays unavailable at40h and56h, never a stale or partial total',async()=>{
 const initial=Date.parse('2026-10-10T00:07:00Z');
 for(const [elapsed,firstVerified] of [[40,4],[56,20]]){
  const f=fixture({amountCents:200000,through:new Date(initial).toISOString(),asOf:new Date(initial+firstVerified*3600000).toISOString()});
  const r=await f.mod.loadCachedOrganizerPlatformFees(f.db,'owner',[1],new Date(initial+elapsed*3600000));
  assert.equal(r.status,'unavailable');assert.equal(r.amountCents,null);assert.equal(f.calls.length,1);
 }
 const small=fixture({amountCents:40000,through:new Date(initial).toISOString(),asOf:new Date(initial+4*3600000).toISOString()});
 assert.equal((await small.mod.loadCachedOrganizerPlatformFees(small.db,'owner',[1],new Date(initial+8*3600000))).status,'ready','two-run200-payment cohort is still within freshness policy');
});
