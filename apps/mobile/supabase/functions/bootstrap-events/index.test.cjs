const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Executes the real Edge handler plus its real privacy helper. All query rows
// and auth identities are synthetic; no environment credentials or network.
function harness({ session = null, failAttendanceQueries = false, onlyProtected = false } = {}) {
  let handler;
  const queries = [];
  const now = Date.now();
  const specs = [
    [1, 'party'], [2, 'sex_party'], [3, 'virtual_session', 'room-3'],
    [4, 'sex_party', null, true], [5, 'kink_fetish_party'], [6, 'bate_session'],
    [7, 'virtual_session'], [8, 'party'], [9, null], [10, 'sex_party', null, null],
    [11, 'sex_party', null, true], [12, 'sex_party', null, true], [13, 'sex_party', null, true],
    [14, 'party', 'room-14'], [15, 'virtual_session', 'room-15', true],
  ];
  const events = specs.map(([id,event_type,lynk_room_id=null,show_attendees=false]) => ({
    id, event_type, lynk_room_id, show_attendees, category:'other',
    title:`Synthetic event ${id}`, host_id:'owner', start_date:new Date(now+86400000*id).toISOString(),
    end_date:new Date(now+86400000*id+3600000).toISOString(), total_attendees:9,
    price:0, location:'Synthetic location', is_hidden:id===12, nsfw:id===8,
    visibility:id===11?'private':'public', status:'active',
    publish_at:id===13?new Date(now+86400000).toISOString():null,
  })).filter(event=>!onlyProtected||[2,3,10,14].includes(event.id));
  const actors=['owner','attendee','friend','ticket-holder','admin','editor','pending','scanner','stranger'];
  const users=actors.map((auth_id,index)=>({id:index+100,auth_id,username:`synthetic_${auth_id}`,avatar_id:index+100}));
  const tables={
    events,users,media:users.map(user=>({id:user.avatar_id,url:`https://avatars.invalid/${user.auth_id}`})),
    event_rsvps:events.flatMap(event=>['attendee','friend'].map(user_id=>({event_id:event.id,user_id,status:'going'}))),
    tickets:events.map(event=>({event_id:event.id,user_id:'ticket-holder',status:'active'})),
    event_co_organizers:events.flatMap(event=>[
      {event_id:event.id,user_id:'admin',role:'admin',accepted:true},
      {event_id:event.id,user_id:'editor',role:'editor',accepted:true},
      {event_id:event.id,user_id:'scanner',role:'scanner',accepted:true},
      {event_id:event.id,user_id:'pending',role:'admin',accepted:false},
    ]),
  };
  const client={from(table){
    assert.ok(table in tables,`unexpected table ${table}`);
    const filters=[];
    let fields='*',limit=Infinity,order=null;
    const record={table,fields,filters};
    queries.push(record);
    const add=(key,operator,value)=>{filters.push({key,operator,value});return query;};
    const execute=()=>{
      if(failAttendanceQueries&&['event_rsvps','tickets','event_co_organizers'].includes(table)&&fields==='event_id') return {data:null,error:{message:'synthetic unavailable'}};
      let rows=tables[table].filter(row=>filters.every(({key,operator,value})=>{
        if(operator==='eq')return row[key]===value;
        if(operator==='in')return value.includes(row[key]);
        if(operator==='gte')return row[key]>=value;
        if(operator==='not-null')return row[key]!==null;
        if(operator==='publication')return row.publish_at==null||row.publish_at<=value;
        throw new Error(`Unexpected filter ${operator}`);
      }));
      if(order)rows=rows.slice().sort((a,b)=>String(a[order]).localeCompare(String(b[order])));
      rows=rows.slice(0,limit);
      record.returned=rows.map(row=>({...row}));
      const keys=fields==='*'?null:fields.split(',').map(field=>field.trim());
      return {data:rows.map(row=>keys?Object.fromEntries(keys.map(key=>[key,row[key]])):{...row}),error:null};
    };
    const query={
      select(value){fields=value;record.fields=value;return query;},
      eq:(key,value)=>add(key,'eq',value),in:(key,value)=>add(key,'in',value),
      gte:(key,value)=>add(key,'gte',value),
      not:(key,operator,value)=>{assert.equal(operator,'is');assert.equal(value,null);return add(key,'not-null',null);},
      or:value=>{assert.match(value,/^publish_at\.is\.null,publish_at\.lte\./);return add('publish_at','publication',value.replace('publish_at.is.null,publish_at.lte.',''));},
      order(key){order=key;return query;},limit(value){limit=value;return query;},
      single:async()=>{const result=execute();return {...result,data:result.data?.[0]||null};},
      maybeSingle:async()=>{const result=execute();return {...result,data:result.data?.[0]||null};},
      then:(resolve,reject)=>Promise.resolve(execute()).then(resolve,reject),
    };
    return query;
  }};
  function load(file) {
    const mod={exports:{}};
    const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText;
    vm.runInNewContext(source,{
      exports:mod.exports,module:mod,Response,console:{log(){},error(){}},
      Deno:{env:{get:()=> 'synthetic-placeholder'},serve:fn=>{handler=fn;}},
      require:name=>name.includes('supabase-js')?{createClient:()=>client}
        : name.includes('verify-session')?{verifySession:async()=>session}
        : name.startsWith('.')?load(path.resolve(path.dirname(file),name))
        : (()=>{throw new Error(`Unexpected dependency ${name}`);})(),
    });
    return mod.exports;
  }
  load(path.join(__dirname,'index.ts'));
  async function request(body={}) {
    const response=await handler(new Request('https://synthetic.invalid/bootstrap-events',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:100,...body}),
    }));
    assert.equal(response.status,200);
    return response.json();
  }
  return {request,queries,tables};
}
const hidden=[2,3,10,14];
const ordinary=[1,5,6,7,8,9];
function expectNoIdentities(event) {
  assert.ok(event,'event is still listed');
  assert.ok(!Array.isArray(event.attendees)||event.attendees.length===0);
  assert.equal(event.totalAttendees,9);
  assert.doesNotMatch(JSON.stringify(event.attendees),/avatars\.invalid|synthetic_|initials/);
}

test('service-role bootstrap omits protected attendee identities for anonymous and authenticated sessions',async()=>{
  for(const session of [null,'attendee','ticket-holder','owner','admin','editor','pending','stranger']) {
    const h=harness({session});const result=await h.request();
    for(const id of hidden)expectNoIdentities(result.events.find(event=>event.id===String(id)));
    for(const id of ordinary)assert.equal(result.events.find(event=>event.id===String(id)).attendees.length,2);
    const identityReads=h.queries.filter(query=>query.table==='event_rsvps'&&query.fields.includes('user_id'));
    for(const query of identityReads)for(const row of query.returned)assert.ok(!hidden.includes(row.event_id),'service role must not fetch protected people for social projection');
    assert.deepEqual(result.events.filter(event=>['11','12','13'].includes(event.id)),[],'publication and visibility stay enforced');
  }
});

test('opt-in protected bootstrap lists require a verified attending session, never caller supplied IDs',async()=>{
  for(const session of [null,'stranger','pending']) {
    const result=await harness({session}).request({viewerId:101,userId:101,authId:'attendee',expectedAuthId:'attendee'});
    for(const id of [4,15])expectNoIdentities(result.events.find(event=>event.id===String(id)));
    assert.deepEqual(result.viewerRsvps,{});
  }
  for(const session of ['attendee','ticket-holder','owner','admin','editor','scanner']) {
    const result=await harness({session}).request();
    for(const id of [4,15])assert.equal(result.events.find(event=>event.id===String(id)).attendees.length,2,session);
  }
});

test('hidden list does not break the verified caller own RSVP state or disclose another account state',async()=>{
  const h=harness({session:'attendee'});const result=await h.request({userId:999,authId:'friend'});
  for(const id of hidden)assert.equal(result.viewerRsvps[id],'going');
  const ownReads=h.queries.filter(query=>query.table==='event_rsvps'&&query.fields==='event_id, status');
  assert.equal(ownReads.length,1);
  assert.ok(ownReads[0].filters.some(filter=>filter.key==='user_id'&&filter.value==='attendee'),'RSVP user_id is text auth identity, not integer profile ID');
  assert.deepEqual((await harness({session:'stranger'}).request({authId:'attendee'})).viewerRsvps,{});
});

test('authorization lookup failures fail closed without hiding ordinary events',async()=>{
  const result=await harness({session:'attendee',failAttendanceQueries:true}).request();
  for(const id of [...hidden,4,15])expectNoIdentities(result.events.find(event=>event.id===String(id)));
  for(const id of ordinary)assert.equal(result.events.find(event=>event.id===String(id)).attendees.length,2);
});

test('an entirely hidden list never queries RSVP identities or attendee profiles',async()=>{
  const h=harness({session:'attendee',onlyProtected:true});const result=await h.request();
  assert.equal(result.events.length,4);
  result.events.forEach(expectNoIdentities);
  assert.ok(!h.queries.some(query=>query.table==='event_rsvps'&&query.fields.includes('user_id')));
  assert.ok(!h.queries.some(query=>query.table==='users'&&query.fields==='auth_id, username, avatar_id'));
});
