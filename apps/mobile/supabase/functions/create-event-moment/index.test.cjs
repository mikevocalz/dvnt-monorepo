// Executes the real endpoint against synthetic database/session boundaries only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function fixture({actor='buyer',tickets=[],coorganizers=[]}={}){
 let handler;const writes=[],calls=[];
 const tables={events:[{id:7,host_id:'host',start_date:'2099-01-01T12:00:00Z'}],tickets,event_co_organizers:coorganizers,event_moments:[]};
 const db={from(table){let predicates=[],limit=Infinity,payload;const q={select(){return q},eq(k,v){calls.push({table,k,v});predicates.push(r=>r[k]===v);return q},in(k,vs){predicates.push(r=>vs.includes(r[k]));return q},limit(n){limit=n;return q},insert(value){payload=value;return q},async maybeSingle(){const rows=tables[table].filter(r=>predicates.every(f=>f(r))).slice(0,limit);return rows.length>1?{data:null,error:{code:'PGRST116'}}:{data:rows[0]??null,error:null}},async single(){assert.equal(table,'event_moments');writes.push(payload);return{data:{id:'synthetic-moment',...payload},error:null}}};return q}};
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'index.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports:{},Request,Response,Date,console,Deno:{env:{get:()=> 'fixture'},serve:fn=>handler=fn},require(name){if(name.includes('supabase-js'))return{createClient:()=>db};if(name.endsWith('verify-session.ts'))return{verifySession:async()=>actor,corsHeaders:()=>({}),optionsResponse:()=>new Response(null,{status:204})};if(name.endsWith('resolve-user.ts'))return{resolveOrProvisionUser:async()=>({id:123})};if(name.endsWith('rate-limit.ts'))return{checkRateLimit:()=>({allowed:true})};throw Error(name)}});
 return{writes,calls,async call(){const r=await handler(new Request('https://fixture.test/moment',{method:'POST',body:JSON.stringify({eventId:7,user_id:'host',mediaUrl:'https://fixture.test/photo.jpg',mediaType:'photo'})}));return{status:r.status,body:await r.json()}}};
}
const ticket=(category='admission',patch={})=>({id:'synthetic',event_id:7,user_id:'buyer',status:'active',category,...patch});
test('multiple separate admission purchases still allow event moments',async()=>{
 const f=fixture({tickets:[ticket(),ticket('admission',{id:'second-order-ticket'})]});const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(f.writes.length,1);
});
test('scanned admission remains an attendee and can post moments',async()=>{
 const f=fixture({tickets:[ticket('admission',{status:'scanned'})]});assert.equal((await f.call()).status,200);
});
for(const category of ['service','coat_check','product'])test(`${category} purchase is not admission to post moments`,async()=>{
 const f=fixture({tickets:[ticket(category)]});assert.equal((await f.call()).status,403);assert.equal(f.writes.length,0);
});
for(const status of ['void','refunded','transfer_pending'])test(`${status} admission cannot post moments`,async()=>{
 const f=fixture({tickets:[ticket('admission',{status})]});assert.equal((await f.call()).status,403);assert.equal(f.writes.length,0);
});
test('other event/owner tickets and spoofed request user do not grant upload',async()=>{
 const f=fixture({tickets:[ticket('admission',{event_id:8}),ticket('admission',{user_id:'other'})]});assert.equal((await f.call()).status,403);assert.equal(f.writes.length,0);
});
test('host and accepted coorganizer privileges remain independent of tickets',async()=>{
 for(const options of [{actor:'host'},{coorganizers:[{event_id:7,user_id:'buyer',accepted:true}]}]){const f=fixture(options);assert.equal((await f.call()).status,200);assert.equal(f.writes.length,1)}
 const pending=fixture({coorganizers:[{event_id:7,user_id:'buyer',accepted:false}]});assert.equal((await pending.call()).status,403);
});
