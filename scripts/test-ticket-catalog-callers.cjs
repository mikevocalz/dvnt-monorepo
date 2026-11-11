// Exercise buyer readers with a client that refuses secret-bearing base reads.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function client(data) {
 const calls=[];
 return {calls,db:{from(table){
  calls.push(table);
  assert.notEqual(table,'ticket_types','non-manager read must never require the secret-bearing table');
  const result=data[table]??[];
  const q=new Proxy({}, {get:(_,key)=>key==='then'?Promise.resolve({data:result,error:null}).then.bind(Promise.resolve({data:result,error:null})):()=>q});
  return q;
 }}};
}
for(const file of ['apps/mobile/lib/api/events.ts','packages/app/lib/api/events.ts']) test(`${file}: paid discovery prices survive manager-only RLS`,async()=>{
 const text=read(file),start=text.indexOf('async function enrichEventsWithTierPrices');
 const source=text.slice(start,text.indexOf('\nexport const eventsApi',start));
 const f=client({ticket_types_public:[{event_id:1,price_cents:2500},{event_id:1,price_cents:1200}]});
 const enrich=new Function('supabase',transpile(source)+';return enrichEventsWithTierPrices;')(f.db);
 assert.deepEqual(await enrich([{id:'1',price:0},{id:'2',price:0}]),[{id:'1',price:12},{id:'2',price:0}]);
 assert.deepEqual(f.calls,['ticket_types_public']);
 assert.deepEqual(await enrich([]),[]);
});
test('watch attendee tiers use safe projection and preserve capacity data',async()=>{
 const text=read('packages/app/features/watch/use-watch-event-sync.ts');
 const source=text.slice(text.indexOf('export async function loadWatchEventEnvelope'),text.indexOf('\nexport interface WatchEventTransport')).replace('export async','async');
 const tier={id:'tier',event_id:1,quantity_total:10,quantity_sold:3,tier_visibility:'public'};
 const f=client({event_rsvps:[{event_id:1,status:'going'}],events:[{id:1,title:'Show'}],ticket_types_public:[tier]});
 let relations;
 const names=['supabase','assertAccount','eventIdentity','eventWindow','allEventRelations','buildWatchEvents','eventWindowPage','enrichVenueWeather','useAuthStore','useWatchSessionStore'];
 const values=[f.db,()=>{},async()=>({authId:'buyer',integerId:5}),{generation:'g',offset:0},async factory=>await factory(),(events,r)=>{relations=r;return events;},events=>({events,hasMore:false,hasPrevious:false}),async events=>events,{getState:()=>({user:{id:'buyer'}})},{getState:()=>({accountGen:'g'})}];
 const load=new Function(...names,transpile(source)+';return loadWatchEventEnvelope;')(...values);
 const result=await load('buyer','g');
 assert.equal(result.status,'ready');assert.deepEqual(relations.tiers,[tier]);
 assert.ok(f.calls.includes('ticket_types_public'));
});
test('transfer history and scanner feeds use the safe historical label relation',()=>{
 for(const file of ['packages/app/lib/api/tickets.ts','packages/app/features/events/event-live.web.tsx','packages/app/features/routes/screens/(protected)/events/[id]/live.tsx']) {
  const source=read(file);
  assert.ok(source.includes('ticket_types:ticket_type_labels(name'),file);
  assert.ok(!source.includes('ticket_types(name'),file);
  assert.ok(!source.includes('.from("ticket_types")'),file);
 }
 assert.ok(read('packages/app/features/routes/screens/(protected)/events/[id]/live.tsx').includes('.from("ticket_type_labels")'));
});
test('buyer catalog refreshes in foreground without access to base-table realtime',()=>{
 const source=read('packages/app/lib/hooks/use-tickets.ts').split('export function useTicketTypes(eventId: string) {')[1].split('\n}')[0];
 assert.match(source,/refetchInterval: 30_000/);assert.match(source,/refetchIntervalInBackground: false/);
});
