// Actual reminder handler, synthetic PostgREST state and offline mail boundary.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const event=(patch={})=>({id:1,title:'Synthetic event',start_date:new Date(Date.now()+180*60000).toISOString(),status:'published',reminder_sent_at:null,...patch});
const ticket=(id,patch={})=>({id,event_id:1,user_id:null,guest_email:'fixture@example.invalid',status:'active',reminder_sent_at:null,qr_token:`qr-${id}`,guest_lookup_token:`lookup-${id}`,ticket_type:{name:'Fixture GA'},...patch});
function harness({events=[event()],tickets=[ticket('1')],users=[],cap=1000,send=async()=> 'provider-fixture'}={}){
 let handler, sequence=0;const calls=[],templates=[],ops=[],deliveries=[],reservations=[];const tables={events,tickets,user:users};
 const db={async rpc(name,args){
  if(name==='reserve_event_reminders'){
   reservations.push(args.p_event_id);
   const eligible=tickets.filter(t=>t.event_id===args.p_event_id&&!t.reminder_sent_at&&['active','scanned'].includes(t.status)&&!deliveries.some(d=>d.ticket_ids.includes(t.id))).slice(0,args.p_limit);
   const groups=new Map();for(const t of eligible){const key=t.user_id||t.guest_email;const group=groups.get(key)||[];group.push(t);groups.set(key,group);}
   const rows=[...groups.values()].map(ts=>({id:`reminder-${++sequence}`,event_id:args.p_event_id,recipient_auth_id:ts[0].user_id,guest_email:ts[0].guest_email,ticket_ids:ts.map(t=>t.id),state:'pending',lease_token:'fixture-lease'}));deliveries.push(...rows);return {data:rows,error:null};
  }
  if(name==='claim_event_reminders'){const rows=deliveries.filter(d=>d.state==='pending'||(d.state==='retry'&&d.retryReady)).slice(0,args.p_limit);rows.forEach(d=>d.state='leased');return {data:rows.map(r=>({...r})),error:null};}
  const row=deliveries.find(d=>d.id===args.p_id);assert.ok(row);assert.equal(row.lease_token,args.p_lease);
  if(name==='prepare_event_reminder'){row.provider_payload??=args.p_payload;return {data:{ok:true,payload:row.provider_payload},error:null};}
  assert.equal(name,'complete_event_reminder');row.state=args.p_outcome;row.retryReady=false;if(args.p_outcome==='sent')for(const t of tickets.filter(t=>row.ticket_ids.includes(t.id)))t.reminder_sent_at=new Date().toISOString();return {data:true,error:null};
 },from(table){let filters=[],patch=null,sort=null,max=Infinity,offset=0;const q={
  select(){return q;},update(value){patch=value;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},
  in(k,vs){filters.push(r=>vs.includes(r[k]));return q;},not(k,op,vs){assert.equal(op,'in');const values=vs.replace(/[()]/g,'').split(',');filters.push(r=>!values.includes(r[k]));return q;},
  gte(k,v){filters.push(r=>r[k]>=v);return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},
  order(k,{ascending=true}={}){sort={k,ascending};return q;},limit(n){max=n;return q;},range(a,b){offset=a;max=b-a+1;return q;},
  result(){let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));if(sort)rows=rows.slice().sort((a,b)=>(a[sort.k]<b[sort.k]?-1:a[sort.k]>b[sort.k]?1:0)*(sort.ascending?1:-1));ops.push({table,patch,ids:rows.map(r=>r.id)});if(patch){rows.forEach(r=>Object.assign(r,patch));return {data:rows,error:null};}return {data:rows.slice(offset,offset+Math.min(cap,max)).map(r=>({...r})),error:null};},
  then(resolve,reject){return Promise.resolve(q.result()).then(resolve,reject);},maybeSingle:async()=>{const r=q.result();return {...r,data:r.data[0]??null};},
 };return q;}};
 const cache={};function load(file){if(cache[file])return cache[file];const out={};cache[file]=out;const src=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(src,{exports:out,Request,Response,Date,Map,Set,URL,crypto,setTimeout,clearTimeout,console:{log(){},warn(){},error(){}},Deno:{env:{get:k=>k==='CRON_SECRET'?'fixture-secret':'fixture'},serve:fn=>{handler=fn;}},require(name){if(name.includes('supabase-js'))return {createClient:()=>db};if(name.endsWith('send-resend-email.ts'))return {ticketConfirmation:input=>{templates.push(input);return {subject:input.subject,html:'synthetic'};},sendResendEmail:async input=>{calls.push(input);return send(input,calls.length);}};if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));throw Error(`Unexpected dependency ${name}`);}});return out;}
 load(path.join(__dirname,'index.ts'));
 return {calls,templates,ops,tables,deliveries,reservations,async invoke(secret='fixture-secret'){for(const d of deliveries)if(d.state==='retry')d.retryReady=true;const response=await handler(new Request('https://offline.invalid',{method:'POST',headers:{'x-cron-secret':secret}}));return {status:response.status,body:await response.json()};}};
}
test('completed event still discovers later eligible unsent tickets',async()=>{const h=harness({events:[event({reminder_sent_at:'2020-01-01'})]});assert.equal((await h.invoke()).status,200);assert.equal(h.calls.length,1);assert.ok(h.tables.tickets[0].reminder_sent_at);});
test('null provider acceptance never stamps tickets or event complete',async()=>{const h=harness({send:async()=>null});await h.invoke();assert.equal(h.tables.tickets[0].reminder_sent_at,null);assert.equal(h.tables.events[0].reminder_sent_at,null);});
test('429 partial failure retries only unsuccessful tickets while preserving earlier flags',async()=>{let fail=true;const h=harness({tickets:[ticket('1',{guest_email:'a@example.invalid'}),ticket('2',{guest_email:'b@example.invalid'})],send:async input=>{if(fail&&input.to==='b@example.invalid')throw Error('429 rate limit');return 'accepted';}});await h.invoke();const stamp=h.tables.tickets[0].reminder_sent_at;assert.ok(stamp);assert.equal(h.tables.tickets[1].reminder_sent_at,null);fail=false;await h.invoke();assert.equal(h.tables.tickets[0].reminder_sent_at,stamp);assert.deepEqual(h.calls.map(x=>x.to),['a@example.invalid','b@example.invalid','b@example.invalid']);assert.ok(h.tables.tickets[1].reminder_sent_at);});
test('same inbox old and new tickets bundles only unsent tickets',async()=>{const h=harness({tickets:[ticket('old',{reminder_sent_at:'2020-01-01'}),ticket('new')]});await h.invoke();assert.equal(h.calls.length,1);assert.equal(h.templates[0].tickets.length,1);assert.equal(h.templates[0].tickets[0].lookupUrl.endsWith('/lookup-new'),true);assert.equal(h.tables.tickets[0].reminder_sent_at,'2020-01-01');});
test('canceled events and ineligible ticket statuses are never emailed',async()=>{const h=harness({events:[event(),event({id:2,status:'cancelled'}),event({id:3,status:'canceled'})],tickets:[ticket('active'),...['refunded','void','transfer_pending','cancelled','canceled'].map(status=>ticket(status,{status})),ticket('cancelled-event',{event_id:2}),ticket('canceled-event',{event_id:3})]});await h.invoke();assert.equal(h.calls.length,1);assert.deepEqual(h.templates[0].tickets.map(t=>t.lookupUrl.split('/').at(-1)),['lookup-active']);});
test('all unsent tickets beyond server row cap are bundled, not silently omitted',async()=>{const h=harness({tickets:Array.from({length:1207},(_,i)=>ticket(String(i+1).padStart(5,'0'))),cap:200});await h.invoke();assert.equal(h.templates.reduce((n,t)=>n+t.tickets.length,0),1207);assert.equal(h.tables.tickets.filter(t=>t.reminder_sent_at).length,1207);});
test('unauthorized cron request performs no queries or sends',async()=>{const h=harness();assert.equal((await h.invoke('wrong')).status,401);assert.equal(h.ops.length,0);assert.equal(h.calls.length,0);});

test('event discovery reads beyond 1000 rows and lower server caps',async()=>{const h=harness({events:Array.from({length:1207},(_,i)=>event({id:i+1})),tickets:[ticket('last',{event_id:1207})],cap:73});const result=await h.invoke();assert.equal(result.body.events_seen,1207);assert.equal(new Set(h.reservations).size,1207);assert.equal(h.reservations.filter(id=>id===1).length,1);assert.equal(h.reservations.filter(id=>id===1207).length,2);assert.equal(h.calls.length,1);assert.ok(h.tables.tickets[0].reminder_sent_at);});

test('one sweep drains more than 25 distinct recipients',async()=>{const h=harness({tickets:Array.from({length:41},(_,i)=>ticket(`distinct-${i}`,{guest_email:`recipient-${i}@example.invalid`}))});const response=await h.invoke();assert.equal(response.status,200);assert.equal(h.calls.length,41);assert.equal(h.tables.tickets.filter(t=>t.reminder_sent_at).length,41);assert.equal(new Set(h.calls.map(c=>c.to)).size,41);});
