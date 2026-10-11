const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal((result.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  const relativeRequire = (name) => {
    if (!name.startsWith('.')) throw new Error(`Unexpected module: ${name}`);
    const resolved = path.resolve(path.dirname(file), name);
    return load(path.extname(resolved) ? resolved : resolved + '.ts');
  };
  new Function('exports', 'module', 'require', result.outputText)(module.exports, module, relativeRequire);
  return module.exports;
}
const { normalizeEmbedOrigin, createEmbedSettingsHandler } = load(path.join(__dirname, '../_shared/ticket-embed-settings.ts'));
const { renderOrganizerEmbedPreview, safeFlyerUrl } = load(path.join(__dirname, '../../../../../packages/app/lib/ticket-embed/preview.ts'));

function harness({ user = 'owner', role = null, accepted = true, enabled = true, paymentsEnabled = false, ready = false, accountReady = true, failTable = '', starting = null } = {}) {
  const calls = [];
  const tables = {
    events: [{ id: 90, host_id: 'owner', title: 'Event <title>', start_date: ready ? new Date(Date.now()+86400000).toISOString() : null, visibility: 'public', status: 'active', ticketing_enabled: true, location: 'NYC', flyer_image_url: null }],
    organizer_accounts: [{host_id:'owner', stripe_account_id:'acct_fixture', charges_enabled:accountReady}],
    event_co_organizers: role ? [{ id: 'staff', event_id: 90, user_id: user, role, accepted }] : [],
    event_ticket_embed_settings: starting ? [{ ...starting }] : [],
  };
  const db = { from(table) {
    assert.ok(table in tables, `Unexpected access to ${table}`);
    const filters = [];
    let action = 'read', patch, columns = '';
    const q = {
      select(value) { columns = value; return q; },
      eq(key, value) { filters.push(row => row[key] === value); return q; },
      insert(value) { action = 'insert'; patch = value; return q; },
      update(value) { action = 'update'; patch = value; return q; },
      async maybeSingle() {
        calls.push({ table, action });
        if (table === failTable) return { data: null, error: { code: '42P01' } };
        let row = tables[table].find(row => filters.every(test => test(row)));
        if (action === 'insert') {
          if (tables[table].some(row => row.event_id === patch.event_id)) return { data: null, error: { code: '23505' } };
          row = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...patch }; tables[table].push(row);
        }
        if (action === 'update' && row) Object.assign(row, patch);
        return { data: row ? Object.fromEntries(columns.split(',').map(k => [k, row[k]])) : null, error: null };
      },
    };
    return q;
  } };
  const handler = createEmbedSettingsHandler({ db, enabled, paymentsEnabled, authenticate: async () => user, headers: () => ({ 'Access-Control-Allow-Origin': 'https://dvntapp.live' }) });
  async function invoke(body = { action: 'get', event_id: 90 }, method = 'POST') {
    const response = await handler(new Request('https://fixture.invalid/manage-ticket-embed', { method, ...(method !== 'GET' && method !== 'OPTIONS' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }));
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  }
  return { invoke, calls, tables };
}
const saved = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', event_id: 90, allowed_origin: 'https://events.example.com', revision: 1, status: 'draft' };

test('normalizes an exact HTTPS origin', () => {
  assert.equal(normalizeEmbedOrigin('https://EVENTS.example.com/'), 'https://events.example.com');
});
for (const value of ['http://example.com', 'https://*.example.com', 'https://example.com/path', 'https://example.com?x=1', 'https://example.com#fragment', 'https://user:password@example.com', 'https://example.com:8443', 'https://localhost', 'https://127.0.0.1', 'https://a.local', 'javascript:alert(1)', 'https://example.com\\@bad.com']) {
  test(`rejects unsafe/ambiguous origin: ${value}`, () => assert.throws(() => normalizeEmbedOrigin(value)));
}
test('disabled feature does not touch the database', async () => {
  const h = harness({ enabled: false }); assert.equal((await h.invoke()).status, 404); assert.equal(h.calls.length, 0);
});
test('anonymous request is denied before any data reads', async () => {
  const h = harness({ user: null }); assert.equal((await h.invoke()).status, 401); assert.equal(h.calls.length, 0);
});
test('owner receives a limited preview without owner ID', async () => {
  const r = await harness().invoke(); assert.equal(r.status, 200); assert.equal(r.body.role, 'owner');
  assert.equal(r.body.event.host_id, undefined); assert.equal(r.body.canGenerate, false); assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('accepted admin is allowed', async () => {
  const r = await harness({ user: 'staff-1', role: 'admin' }).invoke(); assert.equal(r.status, 200); assert.equal(r.body.role, 'admin');
});
for (const options of [{ user: 'other' }, { user: 'staff', role: 'admin', accepted: false }, { user: 'staff', role: 'editor' }, { user: 'staff', role: 'scanner' }]) {
  test(`denies non-manager ${JSON.stringify(options)}`, async () => {
    const h = harness(options); assert.equal((await h.invoke()).status, 403);
    assert.equal(h.calls.some(c => c.table === 'event_ticket_embed_settings'), false);
  });
}
test('settings-read failure stops writes', async () => {
  const h = harness({ failTable: 'event_ticket_embed_settings' });
  assert.equal((await h.invoke({ action: 'save', event_id: 90, expected_revision: 0, allowed_origin: 'https://example.com' })).status, 500);
  assert.equal(h.calls.some(c => c.action !== 'read'), false);
});
test('saving creates only a draft settings row and ignores client live flags', async () => {
  const h = harness(); const r = await h.invoke({ action: 'save', event_id: 90, expected_revision: 0, allowed_origin: 'https://example.com', status: 'active', canGenerate: true });
  assert.equal(r.status, 200); assert.equal(r.body.settings.status, 'draft'); assert.equal(r.body.settings.revision, 1); assert.equal(r.body.canGenerate, false);
  assert.ok(h.calls.filter(c => c.action !== 'read').every(c => c.table === 'event_ticket_embed_settings'));
});
test('stale save cannot overwrite a revoked configuration', async () => {
  const h = harness({ starting: { ...saved, status: 'revoked', revision: 2 } });
  const r = await h.invoke({ action: 'save', event_id: 90, expected_revision: 1, allowed_origin: 'https://example.com' });
  assert.equal(r.status, 409); assert.equal(h.tables.event_ticket_embed_settings[0].status, 'revoked');
});
test('simultaneous edits: only one compare-and-swap succeeds', async () => {
  const h = harness({ starting: saved });
  const responses = await Promise.all([h.invoke({ action: 'save', event_id: 90, expected_revision: 1, allowed_origin: 'https://one.example.com' }), h.invoke({ action: 'save', event_id: 90, expected_revision: 1, allowed_origin: 'https://two.example.com' })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
});
test('revoke changes only the selected settings revision', async () => {
  const h = harness({ starting: saved }); const r = await h.invoke({ action: 'revoke', event_id: 90, expected_revision: 1 });
  assert.equal(r.status, 200); assert.equal(r.body.settings.status, 'revoked'); assert.equal(r.body.settings.revision, 2);
  assert.equal(h.tables.events[0].title, 'Event <title>');
});
test('direct generation cannot bypass the unfinished-checkout gate', async () => {
  const h = harness(); const r = await h.invoke({ action: 'generate', event_id: 90, live: true });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'embed_checkout_not_ready'); assert.equal(h.calls.some(c => c.action !== 'read'), false);
});
test('cross-event manipulation cannot write another event', async () => {
  const h = harness(); assert.equal((await h.invoke({ action: 'save', event_id: 91, expected_revision: 0, allowed_origin: 'https://example.com' })).status, 404);
  assert.equal(h.calls.some(c => c.action !== 'read'), false);
});
test('invalid JSON and numeric ID fail cleanly', async () => {
  const h = harness(); assert.equal((await h.invoke('not json')).status, 400);
  assert.equal((await h.invoke({ action: 'get', event_id: '90' })).status, 400);
  assert.equal((await h.invoke({ action: 'get', event_id: 1.5 })).status, 400);
});
test('preview escapes untrusted event content and contains no script or form', () => {
  const result = renderOrganizerEmbedPreview({ title: '</h1><script>alert(1)</script>', startDate: null, location: 'A & B', flyerUrl: 'javascript:alert(1)' }, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.ok(result.includes('&lt;script&gt;')); assert.ok(result.includes('A &amp; B'));
  assert.equal(result.includes('<script>'), false); assert.equal(result.includes('<form'), false);
  assert.ok(result.includes("connect-src 'none'")); assert.ok(result.includes('aria-disabled="true"'));
  assert.ok(result.includes('top:12px')); assert.ok(result.includes('min-width:740px'));
});
test('flyer preview rejects script, insecure and video sources', () => {
  for (const input of ['javascript:alert(1)', 'http://example.com/a.png', 'https://example.com/a.mov', 'https://user:pass@example.com/a.jpg']) assert.equal(safeFlyerUrl(input), null);
  assert.equal(safeFlyerUrl('https://cdn.example.com/flyer.jpg'), 'https://cdn.example.com/flyer.jpg');
});

const generate = {action:'generate',event_id:90,expected_revision:1};
test('ready organizer publishes a real script/iframe integration, not a sample URL', async () => {
  const h=harness({paymentsEnabled:true,ready:true,starting:saved});
  const r=await h.invoke(generate);
  assert.equal(r.status,200); assert.equal(r.body.settings.status,'published');
  assert.equal(r.body.settings.revision,2); assert.equal(r.body.canGenerate,true);
  assert.equal(r.body.embedCode,'<div data-dvnt-ticket-embed="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"></div>\n<script async src="https://dvntapp.live/embed/tickets.js"></script>');
  assert.ok(h.calls.filter(c=>c.action!=='read').every(c=>c.table==='event_ticket_embed_settings'));
});
test('payment gate rejects even an otherwise ready event',async()=>{
  const h=harness({ready:true,starting:saved}); const r=await h.invoke(generate);
  assert.equal(r.status,409);assert.equal(r.body.code,'embed_checkout_not_ready');
  assert.equal(h.tables.event_ticket_embed_settings[0].status,'draft');
});
for (const options of [{ready:false},{accountReady:false},{starting:{...saved,status:'revoked'}},{starting:null}]) {
  test('publish refuses an unready or revoked setup: '+JSON.stringify(options),async()=>{
    const h=harness({paymentsEnabled:true,ready:true,starting:saved,...options});
    assert.equal((await h.invoke(generate)).status,409);
    assert.equal(h.calls.some(c=>c.action!=='read'),false);
  });
}
test('a stale generation request cannot republish revoked settings',async()=>{
  const h=harness({paymentsEnabled:true,ready:true,starting:{...saved,status:'revoked',revision:2}});
  assert.equal((await h.invoke(generate)).status,409);
});
test('accepted admin can publish, unrelated organizer cannot',async()=>{
  const admin=harness({paymentsEnabled:true,ready:true,starting:saved,user:'admin',role:'admin'});
  assert.equal((await admin.invoke(generate)).status,200);
  const stranger=harness({paymentsEnabled:true,ready:true,starting:saved,user:'other'});
  assert.equal((await stranger.invoke(generate)).status,403);
});
test('editing a published origin returns settings to draft and removes copyable code',async()=>{
  const h=harness({paymentsEnabled:true,ready:true,starting:{...saved,status:'published'}});
  const r=await h.invoke({action:'save',event_id:90,expected_revision:1,allowed_origin:'https://new.example.com'});
  assert.equal(r.status,200);assert.equal(r.body.settings.status,'draft');assert.equal(r.body.embedCode,null);
});
