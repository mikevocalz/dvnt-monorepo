// Real handler/renderer/route with explicit database/network fixtures. No payment calls.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const ROOT=process.env.WIDGET_ROOT||path.resolve(__dirname,'..');
function load(file,globals={}){if(!path.extname(file))file+='.ts';const exports={};const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});assert.equal((out.diagnostics||[]).filter(x=>x.category===1).length,0);vm.runInNewContext(out.outputText,{exports,Request,Response,URL,Date,Intl,AbortSignal,TextEncoder,crypto,console,process:{env:{}},...globals,require:n=>load(n.startsWith('@dvnt/app/')?path.join(ROOT,'packages/app',n.slice('@dvnt/app/'.length)):path.resolve(path.dirname(file),n),globals)});return exports}
const {createEventWidgetHandler,widgetCode,widgetEventEligible}=load(path.join(ROOT,'apps/mobile/supabase/functions/_shared/event-ticket-widget.ts'));
const {renderEventWidget}=load(path.join(ROOT,'packages/app/lib/ticket-embed/event-widget-html.ts'));
const ID='11111111-1111-4111-8111-111111111111';
const event={id:1,host_id:'owner',title:'Fixture event',visibility:'public',status:'active',ticketing_enabled:true,nsfw:false,start_date:'2099-01-01T20:00:00Z'};
function harness({user='owner',patch={},settings={id:ID,event_id:1,allowed_origin:'https://merchant.example.com',published:true,revision:1},admin=false}={}){
 const tables={events:[{...event,...patch}],event_ticket_widgets:settings?[{...settings}]:[],event_co_organizers:admin?[{id:1,event_id:1,user_id:user,accepted:true,role:'admin'}]:[],ticket_types:[{id:ID,name:'General admission',event_id:1,is_active:true,status:'on_sale',tier_visibility:'public'}]};const writes=[],rpcs=[];
 const db={rpc:async(fn)=>{rpcs.push(fn);assert.ok(['ticket_type_current_price_cents','ticket_type_available'].includes(fn));return{data:fn==='ticket_type_available'?5:2500}},from:t=>{assert.ok(t in tables,'unexpected table '+t);let filters=[],action='read',payload;const run=()=>{let hit=tables[t].filter(r=>filters.every(f=>f(r)));if(action!=='read'){assert.equal(t,'event_ticket_widgets','never write purchasing state');writes.push(t);if(action==='insert'){hit=[{id:ID,...payload}];tables[t].push(...hit)}else hit.forEach(r=>Object.assign(r,payload))}return{data:hit,error:null}};const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},limit(){return q},update(v){action='update';payload=v;return q},insert(v){action='insert';payload=v;return q},maybeSingle:async()=>{const r=run();return{data:r.data[0]||null,error:r.error}},then:(a,b)=>Promise.resolve(run()).then(a,b)};return q}};
 const handler=createEventWidgetHandler({db,authenticate:async()=>user,headers:()=>({})});return{tables,writes,rpcs,call:async(body)=>{const r=await handler(new Request('https://fixture.invalid/widget'+(body?'':'?id='+ID),body?{method:'POST',body:JSON.stringify({eventId:1,...body})}:{}));return{status:r.status,data:await r.json()}}}
}
test('owner creates actual iframe code, not a disabled copy button',async()=>{const h=harness({settings:null}),r=await h.call({action:'publish',revision:0,origin:'https://merchant.example.com'});assert.equal(r.status,200);assert.match(r.data.code,/<iframe/);assert.match(r.data.code,/\/tickets\/embed\//);assert.equal(h.writes.length,1);assert.equal(h.rpcs.length,0)});
test('accepted admin may publish',async()=>{assert.equal((await harness({user:'admin',admin:true}).call({action:'publish',revision:1,origin:'https://merchant.example.com'})).status,200)});
for(const user of [null,'stranger'])test('non-owner '+user+' cannot publish',async()=>{const h=harness({user}),r=await h.call({action:'publish',revision:1,origin:'https://merchant.example.com',userId:'owner'});assert.equal(r.status,user?403:401);assert.equal(h.writes.length,0)});
for(const origin of ['http://merchant.example.com','https://merchant.example.com/path','https://*.example.com','https://u:p@merchant.example.com','https://merchant.example.com?x=1','https://localhost'])test('reject unsafe origin '+origin,async()=>{const h=harness(),r=await h.call({action:'publish',revision:1,origin});assert.equal(r.status,400);assert.equal(h.writes.length,0)});
test('stale revision cannot republish',async()=>{const h=harness();assert.equal((await h.call({action:'publish',revision:0,origin:'https://merchant.example.com'})).status,409);assert.equal(h.writes.length,0)});
test('revocation immediately removes public widget',async()=>{const h=harness();assert.equal((await h.call({action:'revoke',revision:1})).status,200);assert.equal((await h.call()).status,404)});
for(const patch of [{visibility:'private'},{is_hidden:true},{publish_at:'2099-01-01'},{publish_at:'invalid'},{status:'draft'},{status:'cancelled'},{nsfw:true}])test('private/unpublished/restricted event unavailable '+JSON.stringify(patch),async()=>{const h=harness({patch});assert.equal((await h.call()).status,404);assert.equal((await h.call({action:'publish',revision:1,origin:'https://merchant.example.com'})).status,409);assert.equal(h.writes.length,0)});
test('public widget has canonical current price without any holds/charges',async()=>{const h=harness(),r=await h.call();assert.equal(r.status,200);assert.equal(r.data.tiers[0].priceCents,2500);assert.equal(r.data.checkoutUrl,'https://dvntapp.live/feed/events/1');assert.equal(r.data.event.host_id,undefined);assert.equal(h.writes.length,0);assert.equal(h.rpcs.length,2)});
test('hidden/locked tiers never expose their names or prices',async()=>{const h=harness();h.tables.ticket_types[0].tier_visibility='locked';assert.deepEqual((await h.call()).data.tiers,[]);assert.equal(h.rpcs.length,0)});
test('closed sales show event details only',async()=>{const r=await harness({patch:{start_date:'2020-01-01'}}).call();assert.equal(r.data.salesOpen,false);const html=renderEventWidget(r.data);assert.ok(!html.includes('Buy tickets on DVNT'));assert.match(html,/Online ticket sales are closed/)});
test('HTML escapes attacker content and cannot redirect checkout elsewhere',async()=>{const r=await harness().call();r.data.event.title='<script>alert(1)</script>';r.data.tiers[0].name='"><img onerror=alert(1)>';const html=renderEventWidget(r.data);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/target="_blank" rel="noopener noreferrer"/);assert.match(html,/Powered by/);assert.ok(!html.includes('<form'));assert.throws(()=>renderEventWidget({...r.data,checkoutUrl:'https://evil.invalid'}));assert.throws(()=>widgetCode('not-a-uuid'))});
test('route enforces exact frame origin and never forwards user credentials',async()=>{const d=(await harness().call()).data;let observed;const {GET}=load(path.join(ROOT,'apps/web/src/app/tickets/embed/[id]/route.ts'),{process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-fixture'}},fetch:async(url,opts)=>{observed=opts;return Response.json(d)}});const r=await GET(new Request('https://dvntapp.live/tickets/embed/'+ID,{headers:{Cookie:'private',Authorization:'Bearer private'}}),{params:Promise.resolve({id:ID})});assert.equal(r.status,200);assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'self' https:\/\/merchant.example.com/);assert.equal(observed.headers.Authorization,undefined);assert.equal(observed.headers.Cookie,undefined);assert.equal(observed.cache,'no-store');assert.equal(observed.redirect,'error')});
// Production builds from the monorepo root. Checking only apps/web/vercel.json
// misses a real release defect: nested header rules are ignored by that build.
function deploymentHeaders(config,pathname){
 return Object.fromEntries((config.headers||[])
  .filter(rule=>new RegExp('^'+rule.source+'$').test(pathname))
  .flatMap(rule=>rule.headers.map(h=>[h.key.toLowerCase(),h.value])));
}
for(const filename of ['vercel.json','apps/web/vercel.json'])test(filename+' protects ordinary pages and APIs without blocking widget framing',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(ROOT,filename),'utf8'));
 for(const pathname of ['/','/feed/events','/feed/events/1','/feed/events/1/organizer','/api/checkout','/tickets','/tickets/embed','/tickets/embed-other/1','/embed/tickets','/embed/tickets-other/1','/admin']){
  const headers=deploymentHeaders(config,pathname);
  assert.equal(headers['x-frame-options'],'DENY',filename+' '+pathname);
  assert.equal(headers['x-content-type-options'],'nosniff',filename+' '+pathname);
 }
 const widget=deploymentHeaders(config,'/tickets/embed/'+ID);
 assert.equal(widget['x-frame-options'],undefined,'the route sets its exact-origin CSP');
 assert.equal(widget['x-content-type-options'],'nosniff');
 const checkoutWidget=deploymentHeaders(config,'/embed/tickets/'+ID);
 assert.equal(checkoutWidget['x-frame-options'],undefined,'embedded-checkout route has exact-origin CSP');
 assert.equal(checkoutWidget['x-content-type-options'],'nosniff');
 assert.equal(deploymentHeaders(config,'/api/checkout')['cache-control'],'no-store, max-age=0');
});
test('root and standalone web deployments use the same security header rules',()=>{
 const root=JSON.parse(fs.readFileSync(path.join(ROOT,'vercel.json'),'utf8'));
 const web=JSON.parse(fs.readFileSync(path.join(ROOT,'apps/web/vercel.json'),'utf8'));
 assert.deepEqual(root.headers,web.headers);
});
for(const status of ['draft','scheduled','paused',null,'unexpected'])test('only on-sale tiers are public: '+status,async()=>{const h=harness();h.tables.ticket_types[0].status=status;const r=await h.call();assert.deepEqual(r.data.tiers,[]);assert.equal(h.rpcs.length,0)});
test('stored tier currency is preserved in advertised price',async()=>{const h=harness();h.tables.ticket_types[0].currency='gbp';const r=await h.call();assert.equal(r.data.tiers[0].currency,'GBP');const html=renderEventWidget(r.data);assert.match(html,/£25\.00/);assert.ok(!html.includes('$25.00'))});
