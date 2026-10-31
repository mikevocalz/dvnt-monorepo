const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness}=require('../_shared/payment-safety.test.cjs');
function fixture(options={}){const calls=[];let claims=0;const db={from(){throw Error('No table API allowed')},async rpc(name,args){calls.push({name,args});assert.ok(['claim_platform_fee_snapshots','complete_platform_fee_snapshot'].includes(name));if(options.error)throw Error('private fixture must not be exposed');if(name==='claim_platform_fee_snapshots')return{data:claims++===0&&options.row?[options.row]:[]};return{data:true}}};const h=harness({database:db,stripeFetch:async(url,init)=>{assert.equal(init.method,'GET');return Response.json({id:'pi_fixture',status:'succeeded',currency:'usd',latest_charge:{id:'ch_fixture',payment_intent:'pi_fixture',currency:'usd',paid:true,status:'succeeded',transfer_data:{destination:'acct_fixture'},application_fee:{id:'fee_fixture',object:'application_fee',account:'acct_fixture',currency:'usd',amount:100,amount_refunded:25,charge:'ch_fixture'}}})}});return{h,calls,run:headers=>h.invoke('refresh-platform-fees',{},headers)}};
test('unauthorized reporting requests cannot access database or provider',async()=>{for(const headers of [{},{'x-cron-secret':'wrong'},{authorization:'Bearer test'}]){const f=fixture();assert.equal((await f.run(headers)).status,401);assert.equal(f.calls.length,0);assert.equal(f.h.requests.length,0)}});
test('empty enrolled queue does not discover orders or call Stripe',async()=>{const f=fixture();const r=await f.run({'x-cron-secret':'test'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,verified:0,unavailable:0});assert.equal(f.calls.length,1);assert.equal(f.h.requests.length,0)});
test('actual isolated worker only reads exact enrolled fee and updates reporting receipt',async()=>{const f=fixture({row:{payment_intent_id:'pi_fixture',expected_fee_cents:100,currency:'usd',lease_token:'lease'}});const r=await f.run({'x-cron-secret':'test'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,verified:1,unavailable:0});assert.equal(f.h.requests.length,1);assert.equal(f.calls.find(x=>x.name==='complete_platform_fee_snapshot').args.p_refunded_cents,25);assert.equal(f.h.writes.length,0)});
test('queue failure stays isolated and does not leak error details',async()=>{const f=fixture({error:true});const r=await f.run({'x-cron-secret':'test'});assert.equal(r.status,503);assert.equal(await r.text(),'{"error":"Reporting verification unavailable"}');assert.equal(f.h.requests.length,0)});
test('report-only runtime closure has no recovery dependency or Stripe mutation operation',()=>{const source=fs.readFileSync(path.join(__dirname,'index.ts'),'utf8');assert.doesNotMatch(source,/from\s+["'][^"']*(?:reconcile-orders|cart-issuance|ticket-email|session-issuance|order-state|heartbeat)/);const helper=fs.readFileSync(path.join(__dirname,'../_shared/platform-fee-refund.ts'),'utf8');assert.doesNotMatch(helper,/method:\s*["'](?:POST|DELETE|PATCH|PUT)["']/);assert.doesNotMatch(helper,/\.from\(/);assert.deepEqual([...helper.matchAll(/db\.rpc\("([^"]+)"/g)].map(x=>x[1]),['claim_platform_fee_snapshots','complete_platform_fee_snapshot']);});

test('missing configuration and non-POST requests fail before reporting operations',async()=>{for(const name of ['CRON_SECRET','STRIPE_SECRET_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']){const h=harness({env:{[name]:''}});assert.equal((await h.invoke('refresh-platform-fees',{}, {'x-cron-secret':'test'})).status,503);assert.equal(h.calls.length,0);assert.equal(h.requests.length,0)}const h=harness();assert.equal((await h.invoke('refresh-platform-fees',{}, {'x-cron-secret':'test'},'GET')).status,405);assert.equal(h.calls.length,0)});
test('capability adapter rejects enrollment, payment and arbitrary RPC attempts', async () => {
  for (const name of ['enroll_platform_fee_snapshots','complete_paid_cart_atomic','refund_ticket','anything']) {
    const h = harness({dependencyOverrides: {
      'platform-fee-refund.ts': {
        reconcilePlatformFeeSnapshots: async db => {
          assert.equal(db.from, undefined);
          await db.rpc(name, {});
          return {verified: 1, unavailable: 0};
        },
      },
    }});
    assert.equal((await h.invoke('refresh-platform-fees', {}, {'x-cron-secret':'test'})).status, 503);
    assert.equal(h.calls.length, 0);
    assert.equal(h.requests.length, 0);
  }
});
