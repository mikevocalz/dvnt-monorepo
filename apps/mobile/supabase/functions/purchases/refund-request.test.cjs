const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production handler with offline DB/auth boundaries. No network.
function fixture(overrides = {}, auth = 'buyer') {
  const order = {id:'order-a', user_id:'buyer', status:'paid', total_cents:2500, ...overrides};
  const writes = [];
  const reads = [];
  const db = {from(table) {
    const filters = []; let insert;
    const run = async () => {
      if (insert) { writes.push({table, value:insert}); return {data:{id:'refund-a'}, error:null}; }
      reads.push({table, filters});
      return {data:table === 'orders' && filters.every(([k,v]) => order[k] === v) ? order : null, error:null};
    };
    const query = {select:()=>query, eq:(k,v)=>{filters.push([k,v]);return query;},
      insert:value=>{insert=value;return query;}, single:run, then:(yes,no)=>run().then(yes,no)};
    return query;
  }};
  let handler;
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(source, {
    exports:{}, Request, Response, console:{error(){}},
    Deno:{env:{get:()=> 'offline-fixture'},serve:fn=>{handler=fn;}},
    fetch:()=>{throw Error('Refund request must not execute a gateway operation');},
    require:name=>name.includes('supabase-js')?{createClient:()=>db}:{
      verifySession:async()=>auth, jsonResponse:body=>Response.json(body),
      errorResponse:(error,status=400)=>Response.json({error},{status}),
      optionsResponse:()=>new Response(null,{status:204}),
    },
  });
  return {writes, reads, invoke:()=>handler(new Request('https://fixture.invalid/purchases',{
    method:'POST',body:JSON.stringify({action:'refund_request',orderId:'order-a',reason:'requested_by_customer'}),
  }))};
}

for (const [label, amount] of [['free RSVP',0],['comp/fully discounted',0],['negative',-1],['fractional',0.5],['unsafe integer',Number.MAX_SAFE_INTEGER+1],['missing',undefined],['null',null],['non-finite',NaN],['infinite',Infinity],['numeric string','2500']]) {
  test(`production handler rejects ${label} total without writes`, async()=>{
    const f=fixture({total_cents:amount}); const response=await f.invoke();
    assert.equal(response.status,400); assert.match((await response.json()).error,/not eligible/);
    assert.deepEqual(f.writes,[]); assert.equal(f.reads.length,1);
  });
}
for (const status of ['created','payment_pending','payment_failed','partially_refunded','refunded','disputed']) {
  test(`production handler rejects ${status} order without writes`,async()=>{
    const f=fixture({status}); assert.equal((await f.invoke()).status,400);assert.deepEqual(f.writes,[]);
  });
}
test('positive paid order, including paid add-ons without payment-intent metadata, retains support request',async()=>{
  const f=fixture({total_cents:1000, stripe_payment_intent_id:null});
  const response=await f.invoke(); assert.equal(response.status,200);
  assert.equal((await response.json()).success,true); assert.equal(f.writes.length,2);
  assert.equal(f.writes[0].table,'refund_requests');assert.equal(f.writes[0].value.amount_cents,1000);
  assert.equal(f.writes[0].value.user_id,'buyer');assert.equal(f.writes[1].table,'order_timeline');
});
test('a different owner cannot request even a positive paid order',async()=>{
  const f=fixture({user_id:'other-buyer'});assert.equal((await f.invoke()).status,404);assert.deepEqual(f.writes,[]);
});
test('unauthenticated request cannot read or write an order',async()=>{
  const f=fixture({},null);assert.equal((await f.invoke()).status,401);assert.deepEqual(f.writes,[]);assert.deepEqual(f.reads,[]);
});
