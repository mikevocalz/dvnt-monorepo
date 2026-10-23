import { canShowEventAttendees } from "./event-attendee-visibility.ts";
import { storedEventType, eventTypeUpdate } from "./event-type.ts";
import { URL } from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = fs.readFileSync(new URL('../api/events.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('events.ts', source, ts.ScriptTarget.Latest, true);
const methods: string[] = [];
const wanted = new Set(['createEvent','updateEvent','getEventById','getPastEvents','getMyEvents','getEventsByHost','getLikedEvents']);
function visit(node: any) {
  if (ts.isMethodDeclaration(node) && wanted.has(node.name.getText(tree))) methods.push(node.getText(tree));
  ts.forEachChild(node, visit);
}
visit(tree);
const compiled = ts.transpileModule('exports.api = {' + methods.join(',') + '}', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture() {
  let row: any = {id:1,title:'Fixture',category:'other',price:25,host_id:'host'};
  let deny = false;
  let authId = "host";
  let epoch = 0;
  let beforeDispatch: (() => void) | undefined;
  let bridgeReady = true;
  const dbKeys = new Proxy({}, {get:(_, key: string) => key === 'table' ? 'events' : key.replace(/[A-Z]/g, c=>'_'+c.toLowerCase())});
  const DB: any = { events: dbKeys, users: {table:'users'}, eventRsvps:{table:'event_rsvps'}, eventLikes:{table:'event_likes',eventId:'event_id'} };
  const supabase = {
    rpc: async (name: string) => ({data:name === 'get_event_detail' ? {event:{...row}} : []}),
    from: (table: string) => {
      let patch: any;
      let expectedEpoch: string | undefined;
      const q: any = {setHeader: (_name: string, value: string)=>{expectedEpoch=value;return q;},select:()=>q,eq:()=>q,in:()=>q,or:()=>q,order:()=>q,limit:()=>q,
        update:(value: any)=>{patch=value;return q;},maybeSingle:async()=>({data:null}),
        then:(resolve: any,reject: any)=> {
          if (patch && beforeDispatch) beforeDispatch();
          if (patch && expectedEpoch !== String(epoch)) return Promise.reject(new Error("Your account changed before this request.")).then(resolve, reject);
          if(patch && !deny) row={...row,...patch};
          return Promise.resolve({data:patch && deny ? [] : table === 'events' ? [{...row}] : table === 'event_likes' ? [{event_id:1}] : []}).then(resolve,reject);
        }};
      return q;
    },
  };
  const context: any = {storedEventType,eventTypeUpdate,canShowEventAttendees,exports:{},console:{log(){},error(){},warn(){}},require:()=>({ensureSupabaseJwt:async()=>bridgeReady}),DB,supabase,
    getSessionLifecycle:()=>({ready:true,epoch}),getBridgeRequestEpoch:()=>String(epoch),getCurrentUserAuthId:async()=>authId,getAuthIdFromStore:()=>authId,getCurrentUserIdSync:()=>1,
    formatEventDate:()=>({}),resolveEventImage:()=>null,resolveFlyerVideoUrl:()=>null,parseJsonbArray:()=>[],
    endsBeforeStart:()=>false,publishAtError:()=>null,filterPubliclyListableEvents:(rows: any)=>rows,enrichEventsWithTierPrices:async(rows: any)=>rows,
    invokeEdge:async(_: string,payload: any)=>{row={...row,...payload,event_type:payload.event_type};return {data:{ok:true,data:{event:{...row}}}}},
  };
  vm.runInNewContext(compiled,context);
  const api=context.exports.api;api.canEditEvent=async()=>true;
  return {api,deny:()=>{deny=true;}, switchAccount:()=>{authId="other";epoch++;},
    duringDispatch(fn: () => void) { beforeDispatch=fn; }, noBridge:()=>{bridgeReady=false;}};
}
test('actual API methods preserve create/edit/reload categories across detail and every list mapper', async()=>{
  const {api}=fixture();
  assert.equal((await api.createEvent({title:'Fixture',event_type:'party'})).category,'party');
  for(const category of ['game_night','pool_party','music','other','party']) {
    assert.equal(storedEventType(await api.updateEvent('1',{category})),category);
    assert.equal((await api.getEventById('1')).category,category);
    for(const [method,arg] of [['getPastEvents',20],['getMyEvents',20],['getEventsByHost','host'],['getLikedEvents',1]] as const) {
      const list=await api[method](arg);assert.equal(list[0]?.category,category,method);
    }
  }
});
test('a rejected edit does not report success or replace the last persisted type',async()=>{
  const h=fixture();await h.api.updateEvent('1',{category:'party'});h.deny();
  await assert.rejects(h.api.updateEvent('1',{category:'game_night'}),/Save blocked/);
  assert.equal((await h.api.getEventById('1')).category,'party');
});
test('bootstrap actual formatter preserves canonical type over legacy category',()=>{
  const source=fs.readFileSync(new URL('../../../../apps/mobile/supabase/functions/bootstrap-events/index.ts',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('    const formattedEvents = events.map'),source.indexOf('    const elapsed =',source.indexOf('    const formattedEvents = events.map')));
  const context:any={canShowEventAttendees,events:[{id:1,title:'Party',category:'music',event_type:'party'},{id:2,title:'Legacy',category:'music',event_type:null}],hostsMap:new Map(),attendeesMap:new Map(),exports:{}};
  vm.runInNewContext(ts.transpileModule(body+'\nexports.rows=formattedEvents;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  assert.equal(context.exports.rows[0].category,'party');assert.equal(context.exports.rows[0].event_type,'party');
  assert.equal(context.exports.rows[1].category,'music');assert.equal(context.exports.rows[1].event_type,null);
});
test('live-surface actual event tile selects and returns canonical type for upcoming and recent events',async()=>{
 const source=fs.readFileSync(new URL('../../../../apps/mobile/supabase/functions/live-surface/index.ts',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function buildTile1('),source.indexOf('// ── Tile 2:'));
 const context:any={exports:{},toAbsoluteUrl:(v:any)=>v,buildDeepLink:(v:any)=>v};
 vm.runInNewContext(ts.transpileModule(fn+'\nexports.build=buildTile1;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 for(const upcoming of [true,false]) {
  let calls=0;const selections:string[]=[];
  const db={from:()=>{calls++;const q:any={select:(s:string)=>{selections.push(s);return q;},gte:()=>q,order:()=>q,limit:async()=>({data:upcoming||calls>1?[{id:1,category:'music',event_type:'party'}]:[]})};return q;}};
  assert.equal((await context.exports.build(db,'host')).category,'party');
  assert.ok(selections.every(s=>s.includes('event_type')));
 }
});

test('event save rejects stale editor identity before writing', async()=>{
  const h=fixture();h.switchAccount();
  await assert.rejects(h.api.updateEvent('1',{title:'Wrong account'}, {expectedAuthId:'host',expectedSessionEpoch:0}),/account changed/);
  assert.equal((await h.api.getEventById('1')).title,'Fixture');
});
test('event save cannot switch identity between validation and HTTP dispatch', async()=>{
  const h=fixture();h.duringDispatch(h.switchAccount);
  await assert.rejects(h.api.updateEvent('1',{title:'Wrong account'}),/account changed/);
  assert.equal((await h.api.getEventById('1')).title,'Fixture');
});
test('event save fails closed if bridge identity cannot be verified', async()=>{
  const h=fixture();h.noBridge();
  await assert.rejects(h.api.updateEvent('1',{title:'Unverified'}),/verify the active account/);
  assert.equal((await h.api.getEventById('1')).title,'Fixture');
});
