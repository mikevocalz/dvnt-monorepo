// Real, disposable, socket-only PostgreSQL; never uses an external database.
// NODE_PATH=<deps>/node_modules POSTGRES_BIN=<local server bin> node --test <this file>
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const migrations = path.resolve(__dirname, '../../migrations');
function serverBin() {
  for (const dir of [process.env.POSTGRES_BIN, '', ...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined)) {
    if (['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(dir,n),['--version']).status===0)) return dir;
  }
  throw Error('No complete PostgreSQL server; attendee search SQL tests did NOT run. Set POSTGRES_BIN.');
}
const schema=`
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE TABLE events(id serial PRIMARY KEY,host_id text);
CREATE TABLE event_co_organizers(event_id integer,user_id text,role text,accepted boolean);
CREATE TABLE users(id serial PRIMARY KEY,auth_id text UNIQUE,username varchar,first_name varchar,last_name varchar);
CREATE TABLE "user"(id text PRIMARY KEY,email text,username text);
CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer REFERENCES events,status text DEFAULT 'active',user_id text,attendee_name text,guest_name text,guest_email text,qr_token text,created_at timestamptz DEFAULT now(),checked_in_at timestamptz,ticket_type_id uuid);
INSERT INTO users(auth_id,username,first_name,last_name) VALUES('member','Mixed_Handle','HiddenFirst','HiddenLast'),('other','outside_event','Private','Person'),('override','hidden_owner','Hidden','Owner');
INSERT INTO "user" VALUES('member','private-email@example.test','stale_handle');
`;
test('event attendee search filters in real PostgreSQL before paging', {timeout:120000},async t=>{
 const bin=serverBin(),data=mkdtempSync(path.join(tmpdir(),'dvnt-search-')),socket=mkdtempSync(path.join(tmpdir(),'dvnt-search-sock-'));
 const run=(n,a)=>execFileSync(path.join(bin,n),a,{encoding:'utf8',stdio:['ignore','pipe','pipe']});let pool;
 try {
 const args=['-D',data,'-U','harness','--auth=trust','--no-sync'];if(process.env.POSTGRES_SHARE)args.push('-L',process.env.POSTGRES_SHARE);run('initdb',args);
 run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off`,'-w','-l',path.join(data,'log'),'start']);pool=new Pool({host:socket,user:'harness',database:'postgres',max:4});await pool.query(schema);
 await pool.query(readFileSync(path.join(migrations,'20261031031851_event_attendee_search.sql'),'utf8'));
 const make=async()=>{const id=(await pool.query("INSERT INTO events(host_id) VALUES('host') RETURNING id")).rows[0].id;await pool.query("INSERT INTO event_co_organizers VALUES($1,'admin','admin',true),($1,'editor','editor',true),($1,'scanner','scanner',true),($1,'invited','admin',false),($1,'unsupported','billing',true)",[id]);return id;};
 const mint=async(event,fields={})=>{const keys=Object.keys(fields),values=Object.values(fields);return (await pool.query(`INSERT INTO tickets(event_id${keys.length?','+keys.join(','):''}) VALUES($1${values.map((_,i)=>',$'+(i+2)).join('')}) RETURNING *`,[event,...values])).rows[0];};
 const search=(event,term,role='host',extra='',args=[])=>pool.query('SELECT * FROM search_event_tickets($1,$2,$3) '+extra,[event,role,term,...args]).then(r=>r.rows);
 await t.test('name and canonical @handle search reaches tickets beyond 1000 rows without loading all IDs',async()=>{
 const ev=await make();await pool.query("INSERT INTO tickets(event_id,attendee_name) SELECT $1,'Unrelated '||n FROM generate_series(1,1200)n",[ev]);const named=await mint(ev,{attendee_name:'Élodie Example',user_id:'member'});for(const term of ['éLODIE','Example','  @MIXED_hand  ','mixed_handle'])assert.deepEqual((await search(ev,term)).map(x=>x.id),[named.id]);assert.deepEqual(await search(ev,'stale_handle'),[]);assert.deepEqual(await search(ev,'private-email'),[]);assert.deepEqual((await search(ev,' hiddenfirst hiddenLAST ')).map(x=>x.id),[named.id]);assert.deepEqual(await search(ev,'@'),[]);
 });
 await t.test('literal punctuation, %, underscore and backslash never expand wildcards or filters',async()=>{
 const ev=await make();for(const value of ['100% Real','a_b','folder\\name',"O’Connor, (VIP)","x'); SELECT * FROM users; --"]){const row=await mint(ev,{guest_name:value});assert.deepEqual((await search(ev,value)).map(x=>x.id),[row.id]);}assert.deepEqual(await search(ev,'a%b'),[]);
 const literal=await mint(ev,{guest_name:'literal_under'});await mint(ev,{guest_name:'literalXunder'});assert.deepEqual((await search(ev,'literal_under')).map(x=>x.id),[literal.id]);
 });
 await t.test('ticket UUID full/prefix and legacy QR prefix remain supported',async()=>{
 const ev=await make(),row=await mint(ev,{qr_token:'QrFixtureSecret123'});for(const term of [row.id,row.id.slice(0,8).toUpperCase(),'qrfixture'])assert.deepEqual((await search(ev,term)).map(x=>x.id),[row.id]);assert.deepEqual(await search(ev,'Secret123'),[]);
 });
 await t.test('scanner search exposes only its rendered holder identity, not overridden or stale private names',async()=>{
 const ev=await make();const override=await mint(ev,{attendee_name:' Visible Guest ',user_id:'override',guest_name:'HiddenGuest'});const member=await mint(ev,{user_id:'member',guest_name:'StaleGuest'});const guest=await mint(ev,{guest_name:'Guest Name'});
 for(const term of ['hidden_owner','HiddenGuest','StaleGuest','private-email','HiddenFirst'])assert.deepEqual(await search(ev,term,'scanner'),[]);
 assert.deepEqual((await search(ev,'Visible Guest','scanner')).map(x=>x.id),[override.id]);assert.deepEqual((await search(ev,'@mixed_handle','scanner')).map(x=>x.id),[member.id]);assert.ok((await search(ev,'Guest Name','scanner')).some(x=>x.id===guest.id));
 for(const role of ['host','admin','editor']){assert.deepEqual((await search(ev,'hidden_owner',role)).map(x=>x.id),[override.id]);assert.deepEqual((await search(ev,'HiddenGuest',role)).map(x=>x.id),[override.id]);}
 });
 await t.test('authorization repeats inside SQL and profiles outside event never produce results',async()=>{
 const ev=await make(),other=await make();await mint(other,{user_id:'other',guest_name:'Elsewhere'});assert.deepEqual(await search(ev,'outside_event'),[]);assert.deepEqual(await search(ev,'Private Person'),[]);assert.deepEqual(await search(ev,'Elsewhere'),[]);
 for(const role of [null,'stranger','invited','unsupported'])await assert.rejects(search(ev,'',role),/Not authorized/);await assert.rejects(search(999999,'','host'),/Not authorized/);
 for(const role of ['anon','authenticated'])assert.equal((await pool.query("SELECT has_function_privilege($1,'search_event_tickets(integer,text,text)','EXECUTE') ok",[role])).rows[0].ok,false);
 assert.equal((await pool.query("SELECT has_function_privilege('service_role','search_event_tickets(integer,text,text)','EXECUTE') ok")).rows[0].ok,true);
 });
 await t.test('filtered counts/status/sorts/offset and keyset operate on full matching set with no duplicate join rows',async()=>{
 const ev=await make();await pool.query("INSERT INTO tickets(event_id,user_id,status,created_at) SELECT $1,'member',CASE WHEN n<=25 THEN 'active' ELSE 'scanned' END,'2026-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,40)n",[ev]);
 const query="WHERE status='active' ORDER BY created_at DESC,id DESC";const all=await search(ev,'mixed', 'host',query);assert.equal(all.length,25);assert.equal(new Set(all.map(x=>x.id)).size,25);const page=await search(ev,'mixed','host',query+' LIMIT 10 OFFSET 20');assert.deepEqual(page.map(x=>x.id),all.slice(20).map(x=>x.id));
 const first=await search(ev,'mixed','host',query+' LIMIT 10');const last=first.at(-1);const after=await search(ev,'mixed','host',"WHERE status='active' AND (created_at,id)<($4::timestamptz,$5::uuid) ORDER BY created_at DESC,id DESC LIMIT 10",[last.created_at,last.id]);assert.deepEqual(after.map(x=>x.id),all.slice(10,20).map(x=>x.id));
 assert.equal((await pool.query("SELECT count(*)::int n FROM search_event_tickets($1,'host','mixed') WHERE status='active'",[ev])).rows[0].n,25);
 });
 await t.test('blank behaves as event roster and overlong search is bounded',async()=>{
 const ev=await make();await mint(ev);await mint(ev);assert.equal((await search(ev,'   ')).length,2);await assert.rejects(search(ev,'x'.repeat(201)),/200 characters/);
 });
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}catch{}rmSync(data,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});}
});
