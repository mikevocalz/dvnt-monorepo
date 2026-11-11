#!/usr/bin/env node
/** Disposable synthetic PostgreSQL/PostgREST contract probe. No existing DB,
 * connection string, credentials or production endpoint is accepted. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),vm=require('node:vm'),assert=require('node:assert/strict');const {spawn,execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),deps=(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),resolve=n=>require.resolve(n,{paths:[ROOT,...deps]});
const ts=require(resolve('typescript'));const {Client}=require(resolve('pg'));
const executable=process.env.SYNTHETIC_POSTGREST_BIN;if(!executable||!path.isAbsolute(executable))throw Error('Set SYNTHETIC_POSTGREST_BIN to an installed official PostgREST binary');if(process.getuid?.()===0)throw Error('Do not create or change OS users for this fixture');
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const CART=id(1),ORDER=id(2),LINE=id(3),TIER=id(4),TICKET=id(5),ALINE=id(6),ADDON=id(7),ADDONROW=id(8);
const helper={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT,'apps/mobile/supabase/functions/_shared/cart-fulfillment.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:helper,Set,Map,Number,Date});
const endpoint=fs.readFileSync(path.join(ROOT,'apps/mobile/supabase/functions/get-cart-status/index.ts'),'utf8');const select=endpoint.match(/\.from\("carts"\)\.select\(`([\s\S]*?)`\)/)[1].replace(/\s/g,'');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cart-status-synthetic-')),port=await freePort();let pg,client,api;let log='';const servers=[];let count=0;
try{const binaries=await import(resolve('@embedded-postgres/linux-x64'));execFileSync(binaries.initdb,['-D',path.join(dir,'db'),'-A','trust','-U','fixture','--locale=C','--encoding=UTF8'],{stdio:'pipe'});pg=spawn(binaries.postgres,['-D',path.join(dir,'db'),'-p',String(port),'-h','127.0.0.1','-k','']);pg.stderr.on('data',x=>log+=String(x));let started=false;for(let i=0;i<100;i++){const probe=new Client({host:'127.0.0.1',port,user:'fixture',database:'postgres'});try{await probe.connect();client=probe;started=true;break;}catch{await probe.end().catch(()=>{});await new Promise(r=>setTimeout(r,100));}}if(!started)throw Error('Synthetic PostgreSQL did not start: '+log.slice(-2000));
await client.query(`CREATE ROLE fixture_reader NOLOGIN; GRANT USAGE ON SCHEMA public TO fixture_reader;
CREATE TABLE events(id int primary key,title text,cover_image_url text,start_date timestamptz,end_date timestamptz,location text);
CREATE TABLE carts(id uuid primary key,user_id text,event_id int references events(id),status text,stripe_pi_id text,total_cents int,fee_cents int,tax_cents int,currency text,updated_at timestamptz);
CREATE TABLE ticket_types(id uuid primary key,name text);
CREATE TABLE ticket_addons(id uuid primary key,name text,is_redeemable boolean);
CREATE TABLE ticket_addon_variants(id uuid primary key,name text);
CREATE TABLE cart_line_items(id uuid primary key,cart_id uuid references carts(id),category text,tier_id uuid references ticket_types(id),addon_id uuid references ticket_addons(id),variant_id uuid references ticket_addon_variants(id),quantity int,unit_price_cents int,refunded_amount_cents int,metadata jsonb);
CREATE TABLE orders(id uuid primary key,cart_id uuid unique references carts(id),user_id text,event_id int references events(id),status text,currency text,total_cents int,paid_at timestamptz,stripe_payment_intent_id text);
CREATE TABLE tickets(id uuid primary key,user_id text,order_id uuid references orders(id),event_id int references events(id),ticket_type_id uuid references ticket_types(id),status text,qr_token text,qr_payload text,purchase_amount_cents int,category text,cart_id uuid references carts(id),cart_line_item_id uuid references cart_line_items(id));
CREATE TABLE order_addons(id uuid primary key,user_id text,order_id uuid references orders(id),event_id int references events(id),cart_id uuid references carts(id),cart_line_item_id uuid references cart_line_items(id),ticket_id uuid references tickets(id),addon_id uuid references ticket_addons(id),variant_id uuid references ticket_addon_variants(id),quantity int,unit_price_cents int,status text,qr_token text,qr_payload text);
CREATE TABLE cart_holds(id uuid primary key,cart_id uuid references carts(id),line_item_id uuid references cart_line_items(id),tier_id uuid,addon_id uuid,variant_id uuid,qty int,expires_at timestamptz,released boolean);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fixture_reader;
INSERT INTO events VALUES(1,'Synthetic event',NULL,now(),now(),NULL);
INSERT INTO carts VALUES('${CART}','fixture-buyer',1,'completed','pi_fixture',1200,200,0,'usd',now());
INSERT INTO ticket_types VALUES('${TIER}','Admission');
INSERT INTO cart_line_items VALUES('${LINE}','${CART}','admission','${TIER}',NULL,NULL,1,1000,0,'{}');
INSERT INTO orders VALUES('${ORDER}','${CART}','fixture-buyer',1,'paid','usd',1200,now(),'pi_fixture');
INSERT INTO tickets VALUES('${TICKET}','fixture-buyer','${ORDER}',1,'${TIER}','active','private-ticket-fixture','signed-fixture',1000,'admission','${CART}','${LINE}');`);
async function start(maxRows){const apiPort=await freePort();const child=spawn(executable,[],{env:{...process.env,PGRST_DB_URI:`postgres://fixture:synthetic-only-password@127.0.0.1:${port}/postgres`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'fixture_reader',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(apiPort),PGRST_DB_MAX_ROWS:String(maxRows),PGRST_DB_POOL:'2'}});servers.push(child);child.stdout.on('data',x=>log+=String(x));child.stderr.on('data',x=>log+=String(x));for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${apiPort}/carts?select=id`);if(r.ok)return apiPort;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Synthetic PostgREST did not start: '+log.slice(-2000));}
api=await start(1000);
async function read(apiPort=api,owner='fixture-buyer'){const r=await fetch(`http://127.0.0.1:${apiPort}/carts?select=${encodeURIComponent(select)}&id=eq.${CART}&user_id=eq.${owner}`);const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
async function check(label,fn){await fn();console.log(`ok ${++count} - ${label}`);}
await check('exact production select resolves all relationship hints and aggregate cardinalities',async()=>{const [c]=await read();assert.equal(helper.cartFulfillmentSnapshot(c,'fixture-buyer').fulfillment.state,'ready');assert.equal(c.ticket_count[0].count,1);assert.equal(c.order_count.count,1);});
await check('parent owner filter returns no embedded rows for another buyer',async()=>assert.deepEqual(await read(api,'different-buyer'),[]));
await client.query(`UPDATE cart_line_items SET quantity=2 WHERE id='${LINE}'; INSERT INTO tickets SELECT '${id(9)}',user_id,order_id,event_id,ticket_type_id,status,'second-private-fixture','signed-second',purchase_amount_cents,category,cart_id,cart_line_item_id FROM tickets WHERE id='${TICKET}'`);
await check('complete two-ticket line is ready with exact count',async()=>{const[c]=await read();assert.equal(c.ticket_count[0].count,2);assert.equal(helper.cartFulfillmentSnapshot(c,'fixture-buyer').fulfillment.state,'ready');});
const limited=await start(1);
await check('server max-rows truncation cannot masquerade as complete usable set',async()=>{const[c]=await read(limited);assert.equal(c.ticket_rows.length,1);assert.equal(c.ticket_count[0].count,2);assert.equal(helper.cartFulfillmentSnapshot(c,'fixture-buyer').fulfillment.state,'unverified');});
await client.query(`INSERT INTO ticket_addons VALUES('${ADDON}','Drink',true);INSERT INTO cart_line_items VALUES('${ALINE}','${CART}','addon',NULL,'${ADDON}',NULL,1,100,0,'{}');INSERT INTO order_addons VALUES('${ADDONROW}','fixture-buyer','${ORDER}',1,'${CART}','${ALINE}','${TICKET}','${ADDON}',NULL,1,100,'unfulfilled','private-addon-fixture','addon-signed');UPDATE tickets SET user_id='transferred-recipient' WHERE id='${TICKET}';`);
await check('same snapshot sees transferred bound-ticket ownership before add-on owner catches up',async()=>{const[c]=await read();const s=helper.cartFulfillmentSnapshot(c,'fixture-buyer');assert.equal(s.fulfillment.state,'history');assert.equal(s.fulfillment.complete,true);assert.equal(s.tickets.length,1);assert.equal(s.addons.length,0);assert.doesNotMatch(JSON.stringify(s),/private-addon-fixture|transferred-recipient|private-ticket-fixture/);});
console.log(`PASS: ${count} disposable native PostgreSQL/PostgREST snapshot cases.`);
}finally{for(const child of servers){if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}}await client?.end();if(pg&&pg.exitCode===null){pg.kill('SIGINT');await new Promise(r=>pg.once('exit',r));}fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
