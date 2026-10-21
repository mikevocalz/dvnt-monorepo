const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ID = '00000000-0000-4000-8000-000000000001';
const ORDER = '00000000-0000-4000-8000-000000000002';
const TIER = '00000000-0000-4000-8000-000000000003';
const future = () => new Date(Date.now() + 10 * 864e5).toISOString();
const baseTicket = () => ({ id: ID, event_id: 1, user_id: 'buyer', status: 'active',
  checked_in_at: null, transferred_from: null, purchase_amount_cents: 0,
  stripe_payment_intent_id: null, ticket_type_id: TIER, order_id: ORDER,
  cart_id: null, cart_line_item_id: null });
const baseOrder = () => ({ id: ORDER, event_id: 1, user_id: 'buyer', status: 'paid', total_cents: 0, cart_id: null });
const baseEvent = () => ({ id: 1, title: 'Event', start_date: future(), refund_policy: 'before_event', refund_days_before: null });
function load(db, options = {}) {
  let handler;
  const stripe = [], wallets = [], waitlists = [];
  const deps = {
    'verify-session.ts': { verifySession: async () => options.auth === undefined ? 'buyer' : options.auth },
    'sentry.ts': { withSentry: (_name, fn) => fn },
    'wallet-push.ts': { voidWalletPass: async (_db, id) => { wallets.push(id); if (options.notificationError) throw Error('push failed'); } },
    'notify-waitlisters.ts': { notifyNextWaitlister: async (_db, data) => { waitlists.push(data); if (options.notificationError) throw Error('push failed'); } },
  };
  function compile(file) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      exports, Response, Request, URLSearchParams, console: { log() {}, warn() {}, error() {} },
      Deno: { env: { get: name => name === 'STRIPE_SECRET_KEY' && options.noStripe ? '' : 'test' }, serve: fn => { handler = fn; } },
      fetch: async (url, init) => { stripe.push({ url, body: new URLSearchParams(init.body) }); return Response.json({ id: 're_test' }); },
      require: name => name.includes('supabase-js') ? { createClient: () => db }
        : deps[path.basename(name)] || compile(path.resolve(path.dirname(file), name)),
    });
    return exports;
  }
  compile(path.join(__dirname, 'index.ts'));
  return { stripe, wallets, waitlists, invoke: (body = { ticket_id: ID, action: 'cancel_free' }, method = 'POST') =>
    handler(new Request('http://test', { method, ...(method !== 'OPTIONS' ? { body: JSON.stringify(body) } : {}) })) };
}
function fixture(options = {}) {
  const tables = { tickets: [{ ...baseTicket(), ...options.ticket }], events: [{ ...baseEvent(), ...options.event }],
    orders: [{ ...baseOrder(), ...options.order }], ...options.tables };
  const writes = [], rpcs = [];
  const db = { from(table) {
    const filters = []; let patch; let mode = 'select';
    const rows = () => (tables[table] || []).filter(r => filters.every(([k,v]) => r[k] === v));
    async function run(single) {
      if (options.readError === table && mode === 'select') return {data:null,error:{message:'read failed'}};
      if (mode === 'update') { writes.push({table, patch, filters}); rows().forEach(r=>Object.assign(r,patch)); }
      const result = rows(); return { data: single ? result[0] || null : result, error: null };
    }
    const q = { select: () => q, eq: (k,v) => {filters.push([k,v]);return q;},
      update: p => {patch=p;mode='update';return q;}, single:()=>run(true), maybeSingle:()=>run(true),
      then:(yes,no)=>run(false).then(yes,no) }; return q;
  }, async rpc(name,args) {
    rpcs.push({name,args});
    if(options.rpcError) return {data:null,error:options.rpcError};
    if(options.rpcResult) return {data:options.rpcResult,error:null};
    if(name==='cancel_free_ticket') {
      const ticket=tables.tickets[0]; const changed=ticket.status==='active';
      if(changed) ticket.status='void';
      return {data:{ok:true,changed,ticket_id:ID,event_id:1,ticket_type_id:TIER},error:null};
    }
    return {data:null,error:null};
  }};
  return { ...load(db, options), tables, writes, rpcs };
}
module.exports = { load, fixture, ID, ORDER, TIER, baseTicket, baseOrder, baseEvent };
