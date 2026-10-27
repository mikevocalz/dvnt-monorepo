const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function harness({ actor='host', emailFails=false, issuanceFailure=false }={}) {
 let handler;const calls=[],emails=[],stamps=[];
 const db={from(table){
   const filters={};let patch;
   const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q;},in:(k,v)=>{filters[k]=v;return q;},
    insert:()=>q,update:v=>{patch=v;return q;},
    rows(){
     if(table==='events')return [{id:7,host_id:'host',title:'Event',status:'published'}];
     if(table==='ticket_types')return [{id:'tier',event_id:7,name:'GA',is_active:true}];
     if(table==='users')return filters.username?[{id:2,username:'member',auth_id:'member'}]:[{id:1}];
     return [];
    },
    maybeSingle:async()=>({data:q.rows()[0]||null}),
    then(resolve,reject){if(table==='tickets'&&patch)stamps.push({patch,filters});return Promise.resolve({data:q.rows(),error:null}).then(resolve,reject);}
   };return q;
  },async rpc(name,args){
   calls.push({name,args});
   if(issuanceFailure)return {data:{ok:false,error:'Tier capacity would be exceeded',would_exceed:true,remaining:2}};
   const quantity=args.p_quantity;
   if(name==='issue_comp_tickets_atomic')return {data:{ok:true,tickets:Array.from({length:quantity},(_,i)=>({id:`member-${i}`,user_id:'member'}))}};
   if(name==='issue_guest_comp_tickets_atomic')return {data:{ok:true,tickets:Array.from({length:quantity},(_,i)=>({id:`email-${i}`,guest_email:'guest@example.test',guest_lookup_token:`lookup-${i}`}))}};
   if(name==='issue_guest_phone_comp_tickets_atomic')return {data:{ok:true,links:Array.from({length:quantity},(_,i)=>({ticket_id:`phone-${i}`,phone:'+14155550123',token:String(i).repeat(43),expires_at:'2027-01-01T00:00:00Z',reissued:false}))}};
   throw Error(name);
  }};
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);
  const mod={exports:{}};cache.set(file,mod.exports);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const requireStub=name=>name.includes('supabase-js')?{createClient:()=>db}
   :name.includes('verify-session')?{verifySession:async()=>actor,corsHeaders:()=>({}),optionsResponse:()=>new Response(null,{status:204})}
   :name.includes('rate-limit')?{checkRateLimit:()=>({allowed:true})}
   :name.includes('send-resend-email')?{ticketConfirmation:p=>({payload:p}),sendResendEmail:async p=>{emails.push(p);if(emailFails)throw Error('mail failed');return 'message';}}
   :load(path.resolve(path.dirname(file),name));
  new Function('require','exports','module','Deno','console','Response','fetch',source)(requireStub,mod.exports,mod,{env:{get:()=>''},serve:fn=>{handler=fn;}},{error(){},warn(){}},Response,()=>{throw Error('Unexpected live fetch');});
  return mod.exports;
 }
 load(path.join(__dirname,'index.ts'));
 return {calls,emails,stamps,async invoke(body={}){const res=await handler(new Request('https://offline.test',{method:'POST',body:JSON.stringify({event_id:7,tier_id:'tier',recipients:['@member'],...body})}));return {status:res.status,body:await res.json()};}};
}
for(const quantity of [1,2,3])test(`quantity ${quantity} reaches each atomic RPC and sends one email containing every separate guest ticket`,async()=>{
 const h=harness();const r=await h.invoke({quantity,recipients:['@member','guest@example.test','+14155550123']});
 assert.equal(r.status,200);assert.equal(r.body.data.issued,quantity);assert.equal(r.body.data.guest_issued,quantity);assert.equal(r.body.data.phone_guest_issued,quantity);
 assert.equal(h.calls.length,3);assert.ok(h.calls.every(c=>c.args.p_quantity===quantity));
 assert.equal(h.emails.length,1);assert.equal(h.emails[0].payload.tickets.length,quantity);
 assert.equal(new Set(h.emails[0].payload.tickets.map(t=>t.lookupUrl)).size,quantity);
 assert.equal(h.stamps.length,1);assert.deepEqual(h.stamps[0].filters.id,Array.from({length:quantity},(_,i)=>`email-${i}`));
 assert.equal(r.body.data.delivery.length,1);assert.equal(r.body.data.claim_links.length,quantity);
});
test('legacy request omitting quantity still targets one',async()=>{const h=harness();assert.equal((await h.invoke()).status,200);assert.equal(h.calls[0].args.p_quantity,1);});
for(const quantity of [0,4,-1,1.5,'3',null,true,{},[]])test(`malformed/out-of-range quantity ${JSON.stringify(quantity)} is refused before issuance`,async()=>{const h=harness();assert.equal((await h.invoke({quantity})).status,400);assert.equal(h.calls.length,0);});
test('unauthenticated and unauthorized issuers do not reach atomic RPCs',async()=>{for(const actor of [null,'other']){const h=harness({actor});assert.equal((await h.invoke({quantity:3})).status,actor?403:401);assert.equal(h.calls.length,0);}});
test('capacity rejection is surfaced, never reported as successful issuance',async()=>{const h=harness({issuanceFailure:true});const r=await h.invoke({quantity:3});assert.equal(r.status,409);assert.equal(r.body.error.would_exceed,true);assert.equal(r.body.error.remaining,2);assert.equal(h.emails.length,0);});
test('email failure reports three issued tickets but no delivery stamp',async()=>{const h=harness({emailFails:true});const r=await h.invoke({quantity:3,recipients:['guest@example.test']});assert.equal(r.status,200);assert.equal(r.body.data.guest_issued,3);assert.equal(r.body.data.delivery[0].status,'failed');assert.equal(h.stamps.length,0);});
