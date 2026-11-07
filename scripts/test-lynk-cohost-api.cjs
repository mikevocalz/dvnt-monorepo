const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,dependencies={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Error,console:{error(){}},require:name=>dependencies[name]??{}});return exports;}
const policy=load('packages/app/features/sneaky-lynk/cohost-invite-policy.ts');
function fixture() {
  const state = { rows: [], events: [], error: null, eventError: null, filters: [], dispatches: [], authId: 'auth-a',
    epoch: '0', reads: 0, eventReads: 0, beforeRead: null, beforeEventRead: null, token: async () => 'fixture-token' };
  const builder = {
    select(value) { state.columns = value; return this; },
    eq(...value) { state.filters.push(value); return this; },
    setHeader(key, value) { state.header = [key, value]; return this; },
    order: async () => { state.reads++; if (state.beforeRead) await state.beforeRead(); return { data: state.rows, error: state.error }; },
  };
  const eventBuilder = {
    select(value) { state.eventColumns = value; return this; },
    in(key, values) { state.eventFilter = [key, values]; return this; },
    setHeader(key, value) { state.eventHeader = [key, value]; return this; },
    then(resolve, reject) { return (async () => { state.eventReads++; if (state.beforeEventRead) await state.beforeEventRead();
      return { data: state.events, error: state.eventError }; })().then(resolve, reject); },
  };
  const supabase = { from: table => table === 'events' ? eventBuilder : builder,
    functions: { invoke: async (name, args) => { state.dispatches.push({ name, args });
      return { data: { ok: true, data: { status: 'accepted', roomId: 'fixture-room', role: 'co-host' } } }; } } };
  const api = load('packages/app/features/sneaky-lynk/api/cohost-invites.ts', {
    '../cohost-invite-policy': policy,
    '@dvnt/app/lib/supabase/client': { supabase, getBridgeRequestEpoch: () => state.epoch },
    '@dvnt/app/lib/api/auth-helper': { getCurrentUserAuthId: async () => state.authId },
    '@dvnt/app/lib/auth/identity': { requireBetterAuthToken: () => state.token() },
  }).lynkCohostInvites;
  return { state, api };
}
test('pending read filters recipient and excludes closed, expired and hidden rooms',async()=>{const{state,api}=fixture();state.rows=[{id:1,room_id:1,video_rooms:{uuid:'room-a',title:'Live',status:'open',ends_at:null}},{id:2,video_rooms:{status:'ended'}},{id:3,video_rooms:{status:'open',ends_at:'2000-01-01T00:00:00Z'}},{id:4,video_rooms:null}];const result=await api.listPending('auth-a');assert.equal(result.length,1);assert.equal(result[0].id,1);assert.deepEqual(state.filters,[['invitee_id','auth-a'],['status','pending']]);assert.match(state.columns,/ends_at/);});
test('failed pending read is not disguised as zero invitations',async()=>{const{state,api}=fixture();state.error={message:'offline'};await assert.rejects(api.listPending('auth-a'),/load co-host invitations/);});
test('account change during token preparation prevents response dispatch',async()=>{const{state,api}=fixture();let current=true;state.token=async()=>{current=false;return'fixture-token';};await assert.rejects(api.accept(1,{isCurrent:()=>current}),/account changed/);assert.equal(state.dispatches.length,0);});
test('accept and decline use explicit response actions without optimistic writes',async()=>{const{state,api}=fixture();await api.accept(1);await api.decline(2);assert.deepEqual(state.dispatches.map(d=>JSON.parse(JSON.stringify(d.args.body))),[{action:'accept',inviteId:1},{action:'decline',inviteId:2}]);assert.equal(state.dispatches[0].args.headers['x-auth-token'],'fixture-token');});

test('delayed pending read for another account never dispatches',async()=>{const{state,api}=fixture();state.authId='auth-b';await assert.rejects(api.listPending('auth-a'),/account changed/);assert.equal(state.reads,0);});
test('pending read carries dispatch epoch and discards a late old-account result',async()=>{const{state,api}=fixture();state.beforeRead=()=>{state.epoch='2';};await assert.rejects(api.listPending('auth-a'),/account changed/);assert.deepEqual(state.header,['x-dvnt-bridge-epoch','0']);assert.equal(state.reads,1);});
test('pending read also respects caller ownership before and after dispatch',async()=>{for(const delayed of [false,true]){const{state,api}=fixture();let current=delayed;state.beforeRead=()=>{current=false;};await assert.rejects(api.listPending('auth-a',{isCurrent:()=>current}),/account changed/);assert.equal(state.reads,delayed?1:0);}});


test('scheduled event cohost invitation remains visible after its preparation-time deadline', async () => {
  const { state, api } = fixture();
  const at = offset => new Date(Date.now() + offset * 60 * 60 * 1000).toISOString();
  state.rows = [{ id: 1, video_rooms: { uuid: 'room-a', status: 'open', created_at: at(-48), ends_at: at(-47.9) } }];
  state.events = [{ lynk_room_id: 'room-a', status: 'active', start_date: at(-0.01), end_date: at(2) }];
  assert.equal((await api.listPending('auth-a')).length, 1);
  assert.equal(state.eventFilter[0], 'lynk_room_id');
  assert.deepEqual(Array.from(state.eventFilter[1]), ['room-a']);
  assert.deepEqual(state.eventHeader, ['x-dvnt-bridge-epoch', '0']);
  state.events[0].status = 'cancelled';
  assert.equal((await api.listPending('auth-a')).length, 0);
  state.events[0].status = 'active';
  state.events.push({ ...state.events[0] });
  assert.equal((await api.listPending('auth-a')).length, 0, 'duplicate links fail closed');
});

test('event-window read failure and account switch cannot return misleading pending invitations', async () => {
  for (const switched of [false, true]) {
    const { state, api } = fixture();
    state.rows = [{ id: 1, video_rooms: { uuid: 'room-a', status: 'open', ends_at: null } }];
    if (switched) state.beforeEventRead = () => { state.epoch = '2'; };
    else state.eventError = { message: 'unavailable' };
    await assert.rejects(api.listPending('auth-a'), switched ? /account changed/ : /load co-host invitations/);
  }
});
