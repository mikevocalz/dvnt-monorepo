// Actual isolated PostgreSQL, no external/live database or private credentials.
const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtempSync,readFileSync,rmSync,existsSync}=require('node:fs');
const {execFileSync,spawnSync}=require('node:child_process');const {tmpdir}=require('node:os');const path=require('node:path');const {Pool}=require('pg');
const migrations=path.resolve(__dirname,'../../migrations');
const schema=`CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE events(id integer PRIMARY KEY,status text,total_attendees integer DEFAULT 0);
CREATE TABLE event_rsvps(event_id integer,user_id text,status text);
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer,type text,status text,paid_at timestamptz,stripe_fee_cents integer,total_cents integer,organizer_fee_cents integer,buyer_fee_cents integer,platform_fee_cents integer,dvnt_total_fee_cents integer);
CREATE TABLE event_financials(event_id integer PRIMARY KEY REFERENCES events,gross_cents integer,refunds_cents integer,dvnt_fee_cents integer,stripe_fee_cents integer,net_cents integer,calculated_at timestamptz);
CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),qr_token text UNIQUE,event_id integer REFERENCES events,status text,ticket_type_id uuid,checked_in_at timestamptz,checked_in_by text,user_id text,purchase_amount_cents integer DEFAULT 0,order_id uuid);
CREATE TABLE ticket_addons(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text);
CREATE TABLE ticket_addon_variants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text);
CREATE TABLE order_addons(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),qr_token text UNIQUE,event_id integer REFERENCES events,status text,ticket_id uuid,addon_id uuid,variant_id uuid,quantity integer DEFAULT 1,redeemed_at timestamptz,redeemed_by text,unit_price_cents integer DEFAULT 0,refunded_amount_cents integer DEFAULT 0,order_id uuid);
CREATE TABLE checkins(id serial PRIMARY KEY,ticket_id uuid,event_id integer NOT NULL REFERENCES events,order_addon_id uuid,scanned_by text,device_id text,result text CHECK(result IN ('valid','already_scanned','refunded','wrong_event','invalid')),offline boolean);
INSERT INTO events(id,status) VALUES(1,'active'),(2,'cancelled');`;
function bins(){for(const b of [process.env.POSTGRES_BIN,'',...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined)){if(['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(b,n),['--version']).status===0))return b;}throw Error('Complete PostgreSQL server required; scanner lifecycle SQL tests DID NOT RUN.');}
test('scanner event lifecycle executes actual PostgreSQL with contention and rollback', {timeout:120000},async t=>{
 const bin=bins(),data=mkdtempSync(path.join(tmpdir(),'dvnt-scan-db-')),socket=mkdtempSync(path.join(tmpdir(),'dvnt-scan-sock-'));let pool;
 const run=(n,a)=>execFileSync(path.join(bin,n),a,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try{
  run('initdb',['-D',data,'-U','harness','--auth=trust','--no-sync']);run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off`,'-w','-l',path.join(data,'log'),'start']);
  pool=new Pool({host:socket,user:'harness',database:'postgres',max:16,options:'-c statement_timeout=8000 -c lock_timeout=6000'});await pool.query(schema);
  const load=f=>pool.query(readFileSync(path.join(migrations,f),'utf8'));
  const source=f=>readFileSync(path.join(migrations,f),'utf8');
  // Execute actual trigger/function definitions, not JS or simplified lock mocks.
  const attendance=source('20261006225000_public_event_people_going.sql');
  await pool.query(attendance.slice(attendance.indexOf('CREATE OR REPLACE FUNCTION'),attendance.indexOf('-- Repair every existing')));
  const financial=source('20261020224444_free_rsvp_event_financials.sql');
  await pool.query(financial.slice(financial.indexOf('CREATE OR REPLACE FUNCTION'),financial.indexOf('-- Preserve the existing restricted')));
  // Read-only production comparison confirms this later body is the deployed
  // accounting definition. Load only its function, never its migration wrapper.
  const currentFinancial=source('20261030050000_free_units_never_have_fees.sql');
  await pool.query(currentFinancial.slice(currentFinancial.indexOf('CREATE OR REPLACE FUNCTION'),currentFinancial.indexOf('COMMIT;')));

  const ticketTriggers=source('20260922100000_free_ticket_orders_and_event_financials.sql');
  await pool.query(ticketTriggers.slice(ticketTriggers.indexOf('CREATE OR REPLACE FUNCTION public.tickets_financials_refresh_ins'),ticketTriggers.indexOf('-- Seed current state')));
  const addonTriggers=source('20261009020000_event_financials_addon_revenue.sql');
  await pool.query(addonTriggers.slice(addonTriggers.indexOf('CREATE OR REPLACE FUNCTION public.order_addons_financials_refresh_ins'),addonTriggers.indexOf('REVOKE ALL ON FUNCTION public.recompute_event_financials')));

  await load('20260806100200_door_single_checkin_cas.sql');await load('20260806300000_door_addon_redeem_cas.sql');
  let next=0;const make=async(kind,event=1,status=kind==='ticket'?'active':'unfulfilled')=>{const token=`synthetic-${++next}`;await pool.query(`INSERT INTO ${kind==='ticket'?'tickets':'order_addons'}(qr_token,event_id,status) VALUES($1,$2,$3)`,[token,event,status]);return token;};
  const scan=(kind,token,event=1,client=pool)=>client.query(`SELECT redeem_${kind}($1,$2,'fixture-staff','fixture-device',false) AS r`,[token,event]).then(r=>r.rows[0].r);
  await t.test('baseline reproduces active credential accepted after event cancellation',async()=>{for(const kind of ['ticket','addon'])assert.equal((await scan(kind,await make(kind,2),2)).result,'valid');});
  await load('20261031035739_scanner_event_lifecycle_guard.sql');await load('20261031035739_scanner_event_lifecycle_guard.sql');
  for(const kind of ['ticket','addon']){
   await t.test(`${kind}: cancelled/deleted reject but null legacy and postponed statuses remain compatible`,async()=>{
    for(const status of ['cancelled','canceled','deleted',null,'postponed','active']){
     await pool.query('UPDATE events SET status=$1 WHERE id=1',[status]);const token=await make(kind);
     assert.equal((await scan(kind,token)).result,['cancelled','canceled','deleted'].includes(status)?'event_cancelled':'valid');
    }
    await pool.query("UPDATE events SET status='active' WHERE id=1");
   });
   await t.test(`${kind}: cancellation holds event lock; scan retries without mutation then rejects`,async()=>{
    const token=await make(kind),a=await pool.connect();try{await a.query('BEGIN');await a.query("UPDATE events SET status='cancelled' WHERE id=1");
     assert.equal((await scan(kind,token)).result,'retry_later');await a.query('COMMIT');assert.equal((await scan(kind,token)).result,'event_cancelled');
     const r=(await pool.query(`SELECT status FROM ${kind==='ticket'?'tickets':'order_addons'} WHERE qr_token=$1`,[token])).rows[0];assert.equal(r.status,kind==='ticket'?'active':'unfulfilled');
    }finally{await a.query('ROLLBACK');a.release();await pool.query("UPDATE events SET status='active' WHERE id=1");}
   });
   await t.test(`${kind}: scan winner commits before cancellation; subsequent scans reject`,async()=>{
    const token=await make(kind),a=await pool.connect(),b=await pool.connect();try{await a.query('BEGIN');assert.equal((await scan(kind,token,1,a)).result,'valid');
     const pending=b.query("UPDATE events SET status='cancelled' WHERE id=1");
     const end=Date.now()+5000;while((await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[b.processID])).rows[0].wait_event_type!=='Lock'){assert.ok(Date.now()<end,'expected real lock contention');await new Promise(r=>setTimeout(r,10));}
     await a.query('COMMIT');await pending;assert.equal((await scan(kind,token)).result,'event_cancelled');
    }finally{await a.query('ROLLBACK');a.release();b.release();await pool.query("UPDATE events SET status='active' WHERE id=1");}
   });
  }
  await t.test('eight concurrent scans of one credential still produce one admission per rail',async()=>{
   for(const kind of ['ticket','addon']){
    const token=await make(kind);const results=await Promise.all(Array.from({length:8},()=>scan(kind,token)));
    assert.equal(results.filter(r=>r.result==='valid').length,1);assert.equal(results.filter(r=>r.result==='already_scanned').length,7);
   }
  });
  await t.test('both rails still reject refunded and void credentials without admission',async()=>{
   for(const kind of ['ticket','addon'])for(const status of ['refunded','void'])assert.equal((await scan(kind,await make(kind,1,status))).result,status==='refunded'?'refunded':'invalid');
  });
  await t.test('different-ticket staff contention retries boundedly; eight tickets each admit once without deadlock',async()=>{
   const tokens=await Promise.all(Array.from({length:8},()=>make('ticket')));
   const results=await Promise.all(tokens.map(async token=>{for(let n=0;n<30;n++){const r=await scan('ticket',token);if(r.result!=='retry_later')return r;await new Promise(r=>setTimeout(r,10));}throw Error('retry budget exhausted');}));
   assert.ok(results.every(r=>r.result==='valid'));
   for(const token of tokens)assert.equal((await scan('ticket',token)).result,'already_scanned');
  });
  await t.test('old QR waiting behind committed credential rotation cannot redeem the new owner token',async()=>{
   const token=await make('ticket'),a=await pool.connect(),b=await pool.connect();const rotated=token+'-recipient';
   try{await a.query('BEGIN');await a.query('UPDATE tickets SET qr_token=$2 WHERE qr_token=$1',[token,rotated]);
    const pending=scan('ticket',token,1,b);const end=Date.now()+5000;
    while((await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[b.processID])).rows[0].wait_event_type!=='Lock'){assert.ok(Date.now()<end,'expected credential lock contention');await new Promise(r=>setTimeout(r,10));}
    await a.query('COMMIT');assert.equal((await pending).result,'invalid');
    assert.equal((await scan('ticket',rotated)).result,'valid');
   }finally{await a.query('ROLLBACK');a.release();b.release();}
  });
  for(const kind of ['ticket','addon']) await t.test(`${kind}: actual order financial trigger contention cannot deadlock scanner/event attendance`,async()=>{
   const token=await make(kind),a=await pool.connect();
   try{await a.query('BEGIN');await a.query("INSERT INTO orders(event_id,type,status,total_cents) VALUES(1,'event_ticket','paid',0)");
    // Issuer holds financials via actual order trigger, not an artificial lock.
    assert.equal((await scan(kind,token)).result,'retry_later');
    // The same issuer can now insert its ticket (event attendance then financial
    // trigger), proving the scanner released its event lock instead of deadlocking.
    await a.query("INSERT INTO tickets(qr_token,event_id,status) VALUES($1,1,'active')",['issuer-'+token]);
    await a.query('COMMIT');assert.equal((await scan(kind,token)).result,'valid');
   }finally{await a.query('ROLLBACK');a.release();}
  });
  for(const kind of ['ticket','addon']) await t.test(`${kind}: missing or uncommitted financial summary fails closed without upsert`,async()=>{
   const token=await make(kind);await pool.query('DELETE FROM event_financials WHERE event_id=1');
   const a=await pool.connect();try{await a.query('BEGIN');await a.query('INSERT INTO event_financials(event_id) VALUES(1)');
    assert.equal((await scan(kind,token)).result,'financials_unavailable');await a.query('ROLLBACK');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_financials WHERE event_id=1')).rows[0].n,0);
    assert.equal((await scan(kind,token)).result,'financials_unavailable');
   }finally{await a.query('ROLLBACK');a.release();await pool.query('SELECT recompute_event_financials(1)');}
   assert.equal((await scan(kind,token)).result,'valid');
  });
  await t.test('cancelled event does not replace wrong-event or unknown-token contract',async()=>{
   const token=await make('ticket');assert.equal((await scan('ticket',token,2)).result,'wrong_event');assert.equal((await scan('ticket','absent',2)).result,'invalid');
  });
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','stop']);}catch{}rmSync(data,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});}
});
