const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(source, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, ...mocks });
  return exports;
}

function harness({ ledger = [], attributions = [], failure, cap = 1000,
  userId = 'member', promoter = { id: 'promoter', event_id: 42, user_id: 'member', status: 'active' },
  missingCount = false, eventStatus = "pending", settlement = { verified: true, rows: [] }, legacyHistory = { verified:true, rows:[] } } = {}) {
  let handler;
  const queries = [];
  ledger = ledger.map(row => ({ payout_status: "pending", paid_out_at: null, stripe_transfer_id: null, entry_type: "earning", currency:"usd", external_settlement_id:null, order_id: "order-" + row.id, order: { id: "order-" + row.id, charge_model: null }, ...row }));
  const client = {
    rpc: async (name,args) => { queries.push({rpc:name,args}); return { data: name === "settlement_legacy_actor_summary" ? legacyHistory : settlement, error: null }; },
    from(table) {
      const filters = [];
      let selected, options, cursor, limit = cap;
      const query = {
        select(columns, opts) { selected = columns; options = opts; return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        neq(key, value) { filters.push(row => row[key] !== value); return query; },
        order(key) { cursor = key; return query; },
        limit(value) { limit = Math.min(value, cap); return query; },
        gt(key, value) { filters.push(row => row[key] > value); return query; },
        maybeSingle() { return query.then(result => ({ ...result, data: result.data?.[0] ?? null })); },
        then(resolve, reject) {
          queries.push({ table, selected, options });
          const failed = failure === table || (failure === 'second-ledger-page' &&
            table === 'promoter_ledger_entries' && queries.filter(q => q.table === table).length > 1);
          if (failed) return Promise.resolve({ data: null, count: null, error: { message: 'database unavailable' } }).then(resolve, reject);
          // Model the actual attribution schema: it has order_id, never id.
          if (table === 'promoter_attributions' && selected !== 'order_id') {
            return Promise.resolve({ data: null, count: null, error: { code: '42703' } }).then(resolve, reject);
          }
          let rows = (table === 'event_promoters' ? (promoter ? [promoter] : [])
            : table === 'promoter_ledger_entries' ? ledger
            : table === 'events' ? [{ id: 42, payout_status: eventStatus }] : attributions).filter(row => filters.every(f => f(row)));
          if (cursor) rows = [...rows].sort((a, b) => a[cursor] < b[cursor] ? -1 : 1);
          return Promise.resolve({
            data: options?.head ? null : rows.slice(0, limit),
            count: options?.count === 'exact' && !missingCount ? rows.length : null,
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const shared = load(fs.readFileSync(__dirname + '/../_shared/read-all-rows.ts', 'utf8'), {});
  load(fs.readFileSync(__dirname + '/index.ts', 'utf8'), {
    console: { error() {} }, Response,
    Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
    require: name => {
      if (name.includes('supabase-js')) return { createClient: () => client };
      if (name.includes('verify-session')) return { verifySession: async () => { if(failure==='session-throw')throw Error('private provider token');return userId; } };
      if (name.includes('read-all-rows')) return shared;
      if (name.includes('legacy-ownership-summary')) return load(fs.readFileSync(__dirname + '/../_shared/legacy-ownership-summary.ts','utf8'), {});
      if (name.includes('settlement-status')) return load(fs.readFileSync(__dirname + '/../_shared/settlement-status.ts','utf8'), {});
      if (name.includes('legacy-promoter-rows')) return load(fs.readFileSync(__dirname + '/../_shared/legacy-promoter-rows.ts', 'utf8'), {});
      if (name.includes('promoter-payout-summary')) return load(fs.readFileSync(__dirname + '/../_shared/promoter-payout-summary.ts', 'utf8'), {});
      if (name.includes('sentry')) return { withSentry: (_name, fn) => fn };
      throw new Error('Unexpected import: ' + name);
    },
  });
  return {
    queries,
    async call(body = { action: 'me', event_id: 42 }) {
      const response = await handler(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    },
  };
}


const frozen = (stage='paid_externally') => ({verified:true,rows:[{recipient_role:'promoter',currency:'usd',stage,amount_cents:1000,allocation_count:1}]});
test('active promoter gets only actor-scoped frozen financial summary, not mutable historical totals',async()=>{
 const h=harness({ledger:[{id:'1',promoter_id:'promoter',amount_cents:9000}],settlement:frozen()});
 const r=await h.call();assert.equal(r.status,200);assert.equal(r.body.promoter.earnedCents,null);assert.equal(r.body.promoter.attributedOrders,null);
 assert.equal(r.body.promoter.payout,null);assert.equal(r.body.promoter.earningsScope,'unverified_history');assert.equal(r.body.promoter.settlement.rows[0].amount_cents,1000);
 assert.ok(!h.queries.some(q=>['promoter_ledger_entries','promoter_attributions'].includes(q.table)));
 assert.deepEqual(JSON.parse(JSON.stringify(h.queries.find(q=>q.rpc).args)),{p_actor:'member',p_event_id:42});
});
for(const stage of ['paid_externally','awaiting_settlement','bank_paid','external_needs_review']) {
 test('reassigned original retains frozen '+stage+' history without current promoter powers',async()=>{
  const h=harness({userId:'original',promoter:{id:'promoter',event_id:42,user_id:'reassigned',status:'active'},settlement:frozen(stage)});
  const r=await h.call();assert.equal(r.status,200);assert.equal(r.body.isPromoter,false);assert.equal(r.body.promoter,undefined);
  assert.equal(r.body.paymentHistory.rows[0].stage,stage);assert.equal(h.queries.find(q=>q.rpc).args.p_actor,'original');
 });
}
test('reassigned current member cannot see original earned amount or attribution count',async()=>{
 const r=await harness({userId:'reassigned',promoter:{id:'promoter',event_id:42,user_id:'reassigned',status:'active'},ledger:[{id:'1',promoter_id:'promoter',amount_cents:1000,external_settlement_id:'receipt',payout_status:'paid',paid_out_at:'2026-01-01'}]}).call();
 assert.equal(r.body.isPromoter,true);assert.equal(r.body.promoter.earnedCents,null);assert.equal(r.body.promoter.attributedOrders,null);assert.equal(r.body.promoter.payout,null);assert.deepEqual(r.body.promoter.settlement.rows,[]);
});
test('removed member retains only frozen financial history',async()=>{
 const r=await harness({promoter:{id:'promoter',event_id:42,user_id:'member',status:'removed'},settlement:frozen()}).call();
 assert.equal(r.body.isPromoter,false);assert.equal(r.body.promoter,undefined);assert.equal(r.body.paymentHistory.rows.length,1);
});
test('no owned history does not fabricate former-promoter membership',async()=>{
 assert.deepEqual((await harness({promoter:null}).call()).body,{ok:true,isPromoter:false});
});
test('organizer-only actor summary never grants promoter history',async()=>{
 const r=await harness({promoter:null,settlement:{verified:true,rows:[{...frozen().rows[0],recipient_role:'organizer'}]}}).call();
 assert.deepEqual(r.body,{ok:true,isPromoter:false});
});
test('unavailable frozen history does not silently hide a former promoter',async()=>{
 const r=await harness({promoter:null,settlement:null}).call();assert.equal(r.status,503);assert.equal(r.body.isPromoter,undefined);
});
test('active promoter with unavailable history keeps setup but does not invent financial totals',async()=>{
 const r=await harness({settlement:null}).call();assert.equal(r.status,200);assert.equal(r.body.promoter.earnedCents,null);assert.equal(r.body.promoter.settlement.verified,false);
});
test('unauthenticated requests read nothing',async()=>{const h=harness({userId:null});assert.equal((await h.call()).status,401);assert.equal(h.queries.length,0)});
test('invalid event reads nothing',async()=>{const h=harness();assert.equal((await h.call({action:'me',event_id:-1})).status,400);assert.equal(h.queries.length,0)});
test('body actor cannot override authenticated history scope',async()=>{const h=harness({promoter:null,settlement:frozen()});await h.call({action:'me',event_id:42,user_id:'victim',actor:'victim'});assert.equal(h.queries.find(q=>q.rpc).args.p_actor,'member')});
test('roster lookup error is sanitized',async()=>{const r=await harness({failure:'event_promoters'}).call();assert.equal(r.status,500);assert.equal(r.body.error,'Could not load promoter record')});

const reviewed={verified:true,rows:[{recipient_role:'promoter',currency:'eur',stage:'legacy_ownership_verified',amount_cents:1200,allocation_count:1}]};
test('reviewed legacy ownership restores former financial-only history without payment evidence',async()=>{
 const h=harness({promoter:null,legacyHistory:reviewed});const r=await h.call();assert.equal(r.body.isPromoter,false);assert.equal(r.body.promoter,undefined);assert.equal(r.body.paymentHistory,undefined);assert.equal(r.body.legacyHistory.rows[0].amount_cents,1200);
 assert.equal(h.queries.find(q=>q.rpc==='settlement_legacy_actor_summary').args.p_actor,'member');
});
test('current actor gets reviewed currency amounts separately, never a fabricated total or paid state',async()=>{
 const r=await harness({legacyHistory:reviewed}).call();assert.equal(r.body.promoter.earnedCents,null);assert.equal(r.body.promoter.payout,null);assert.equal(r.body.promoter.legacyHistory.rows[0].currency,'eur');
});
test('changed evidence remains a visible former review with no amount',async()=>{
 const r=await harness({promoter:null,legacyHistory:{verified:true,rows:[{...reviewed.rows[0],stage:'legacy_ownership_needs_review',amount_cents:null}]}}).call();assert.equal(r.body.isPromoter,false);assert.equal(r.body.legacyHistory.rows[0].amount_cents,null);
});
test('failed legacy read is unavailable rather than fabricated former absence',async()=>{const r=await harness({promoter:null,legacyHistory:null}).call();assert.equal(r.status,503)});
