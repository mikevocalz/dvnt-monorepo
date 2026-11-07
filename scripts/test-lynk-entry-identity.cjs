const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../packages/app/features/sneaky-lynk/api/room-entry-identity.ts'), 'utf8');
function harness() {
  const state = { user: { id: '1', authId: 'auth-a' }, epoch: '0', row: null, error: null, calls: [], room: { id: 77 }, auth: 'auth-a', beforeResolve: null };
  const client = { from: table => builder({ table }), rpc: (name, args) => builder({ name, args }) };
  function builder(call) {
    state.calls.push(call);
    return {
      select(columns) { call.columns = columns; return this; },
      eq(key, value) { (call.filters ??= []).push([key, value]); return this; },
      setHeader(key, value) { call.header = [key, value]; return this; },
      async maybeSingle() { if (state.beforeResolve) await state.beforeResolve(call); return call.table ? { data: state.room, error: null } : { data: state.row, error: state.error }; },
    };
  }
  const out = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, require: name => name.includes('supabase') ? { supabase: client, getBridgeRequestEpoch: () => state.epoch } : name.includes('auth-helper') ? { getCurrentUserAuthId: async () => state.auth } : { useAuthStore: { getState: () => state } } });
  return { state, read: out.getRoomEntryIdentity };
}
test('signed-out visitors have a choice without reading membership', async () => {
  const h = harness(); h.state.user = null;
  assert.equal((await h.read('77')).kind, 'choice'); assert.equal(h.state.calls.length, 0);
});
for (const row of [null, {status:'left',is_anonymous:true}, {status:'invited',is_anonymous:false}]) test(`fresh/inactive membership permits choice: ${row?.status}`, async () => {
  const h=harness();h.state.row=row;assert.equal((await h.read('77')).kind,'choice');
});
for (const anonymous of [true,false]) test(`active identity remains ${anonymous?'anonymous':'named'} and returns only self`, async () => {
  const h=harness();h.state.row={status:'active',is_anonymous:anonymous,anon_label:'Anon 4'};
  const result=await h.read('77');assert.equal(result.kind,'active');assert.equal(result.anonymous,anonymous);assert.equal(result.anonLabel,anonymous?'Anon 4':null);
  assert.deepEqual(h.state.calls[0].filters,[['user_id','auth-a']]);
  assert.equal(h.state.calls[0].name,'lynk_room_roster');
  assert.equal(h.state.calls[0].columns,'status,is_anonymous,anon_label');
  assert.deepEqual(h.state.calls[0].header,['x-dvnt-bridge-epoch','0']);
});
test('UUID resolves numeric room without looking up other identities', async () => {
  const h=harness();await h.read('00000000-0000-4000-8000-000000000001');
  assert.equal(h.state.calls[0].table,'video_rooms');assert.equal(h.state.calls[0].columns,'id');
  assert.equal(h.state.calls[1].args.p_room_id,77);
});
test('failed/malformed identity reads reject instead of falsely promising anonymity', async () => {
  for(const mode of ['error','bad-row','no-auth']) {const h=harness();if(mode==='error')h.state.error={message:'denied'};if(mode==='bad-row')h.state.row={status:'active',is_anonymous:null};if(mode==='no-auth')h.state.auth=null;await assert.rejects(h.read('77'),/verify your room identity/);}
});
test('account switch, A/B/A epoch, and cancelled entry discard late responses', async () => {
  for(const mode of ['account','epoch','entry']) {const h=harness();let current=true;h.state.beforeResolve=()=>{if(mode==='account')h.state.user={id:'2',authId:'auth-b'};if(mode==='epoch')h.state.epoch='2';if(mode==='entry')current=false;};await assert.rejects(h.read('77',{isCurrent:()=>current}),/entry changed/);}
});
test('invalid room ids never reach membership', async () => {
  for(const id of ['-1','0','room?anonymous=1','9007199254740993']) {const h=harness();await assert.rejects(h.read(id),/unavailable/);assert.equal(h.state.calls.length,0);}
});

test('missing room row leaves unavailable handling to the parallel room lookup', async () => {
  const h=harness();h.state.room=null;assert.equal((await h.read('00000000-0000-4000-8000-000000000001')).kind,'choice');assert.equal(h.state.calls.length,1);
});
