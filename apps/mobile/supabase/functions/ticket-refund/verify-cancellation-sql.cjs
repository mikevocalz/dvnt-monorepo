// Real disposable PostgreSQL, multiple connections, no production/network DB.
// NODE_PATH=<deps>/node_modules POSTGRES_BIN=<bin> node --test <this file>
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { load, ID, ORDER, TIER } = require('./test-fixture.cjs');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migrations = path.resolve(__dirname, '../../migrations');
const migration = readFileSync(path.join(migrations,'20261021161000_cancel_free_ticket_atomic.sql'),'utf8');
function bins() {
  const candidates = [process.env.POSTGRES_BIN, '', ...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)];
  for (const dir of candidates.filter(x=>x!==undefined)) {
    if(['initdb','pg_ctl','postgres'].every(name=>spawnSync(path.join(dir,name),'--version'.split(' ')).status===0)) return dir;
  }
  throw Error('No PostgreSQL installation. Set POSTGRES_BIN to a complete local server bin directory. SQL tests did NOT run.');
}
const schema = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE events(id integer PRIMARY KEY, start_date timestamptz, refund_policy text, refund_days_before integer, title text, total_attendees integer DEFAULT 0);
CREATE TABLE ticket_types(id uuid PRIMARY KEY,event_id integer REFERENCES events,quantity_sold integer);
CREATE TABLE orders(id uuid PRIMARY KEY,event_id integer REFERENCES events,user_id text,status text,total_cents integer,cart_id uuid);
CREATE TABLE tickets(id uuid PRIMARY KEY,event_id integer REFERENCES events,ticket_type_id uuid REFERENCES ticket_types,user_id text,status text,purchase_amount_cents integer,checked_in_at timestamptz,transferred_from text,stripe_payment_intent_id text,order_id uuid REFERENCES orders,cart_id uuid,cart_line_item_id uuid,wallet_voided_at timestamptz,wallet_last_pushed_at timestamptz);
CREATE TABLE event_rsvps(event_id integer REFERENCES events,user_id text,status text,PRIMARY KEY(event_id,user_id));
CREATE TABLE ticket_transfers(id uuid PRIMARY KEY,ticket_id uuid REFERENCES tickets,status text);
CREATE TABLE order_addons(id uuid PRIMARY KEY,order_id uuid REFERENCES orders,ticket_id uuid REFERENCES tickets,status text,price_cents integer);
`;

// Small read adapter: the REAL endpoint and REAL migration execute together.
function endpointDb(pool) {
 return { from(table) {
   const filters=[]; const vals=[];
   const q={select:()=>q,eq:(k,v)=>{vals.push(v);filters.push(`"${k}"=$${vals.length}`);return q;},
    single:()=>q.maybeSingle(), maybeSingle:async()=>{
      try {const r=await pool.query(`SELECT * FROM "${table}" WHERE ${filters.join(' AND ')}`,vals);
        const row=r.rows[0]||null;if(row?.start_date instanceof Date)row.start_date=row.start_date.toISOString();
        return {data:row,error:null};}catch(error){return {data:null,error};}
    }};return q;
 },async rpc(name,args) {
    assert.equal(name,'cancel_free_ticket');
    try {const r=await pool.query('SELECT cancel_free_ticket($1,$2) AS result',[args.p_ticket_id,args.p_user_id]);return {data:r.rows[0].result,error:null};}
    catch(error){return {data:null,error};}
 }};
}

test(process.env.POSTGRES_SINGLE_USER ? 'free cancellation real PostgreSQL sequential contracts (concurrency NOT RUN)' : 'free cancellation real PostgreSQL concurrent contracts', {timeout:120000}, async t => {
 const bin=bins();const data=mkdtempSync(path.join(tmpdir(),'dvnt-cancel-data-'));const socket=mkdtempSync(path.join(tmpdir(),'dvnt-cancel-sock-'));
 const run=(name,args)=>execFileSync(path.join(bin,name),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 let pool;
 try {
  const share=process.env.POSTGRES_SHARE || path.resolve(bin,'../../../share/postgresql',path.basename(path.dirname(bin)));
  const args=['-D',data,'-U','harness','--auth=trust','--no-sync'];if(existsSync(share))args.push('-L',share);
  run('initdb',args);
  if(process.env.POSTGRES_SINGLE_USER) {
    const source=schema+'\n'+readFileSync(path.join(migrations,'20261006225000_public_event_people_going.sql'),'utf8')+'\n'+migration+'\n'+migration+'\n'+readFileSync(path.join(__dirname,'cancellation-assertions.sql'),'utf8');
    const result=execFileSync(path.join(bin,'postgres'),['--single','-j','-D',data,'postgres'],{encoding:'utf8',input:source.replace(/\n\s*\n/g,'\n')+'\n\n',maxBuffer:8*1024*1024});
    assert.match(result,/PASS: cancellation sequential PostgreSQL assertions/);return;
  }
  run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,'-w','-l',path.join(data,'server.log'),'start']);
  pool=new Pool({host:socket,user:'harness',database:'postgres',max:12});
  await pool.query(schema);
  await pool.query(readFileSync(path.join(migrations,'20261006225000_public_event_people_going.sql'),'utf8'));
  await pool.query(migration);await pool.query(migration);
  async function reset() {
   await pool.query(`TRUNCATE order_addons,ticket_transfers,event_rsvps,tickets,orders,ticket_types,events;
    INSERT INTO events VALUES(1,now()+interval '10 days','before_event',NULL,'Event',0);
    INSERT INTO ticket_types VALUES('${TIER}',1,1);
    INSERT INTO orders VALUES('${ORDER}',1,'buyer','paid',0,NULL);
    INSERT INTO tickets(id,event_id,ticket_type_id,user_id,status,purchase_amount_cents,order_id) VALUES('${ID}',1,'${TIER}','buyer','active',0,'${ORDER}');
    INSERT INTO event_rsvps VALUES(1,'buyer','going');`);
  }
  const cancel=(id=ID,user='buyer',client=pool)=>client.query('SELECT cancel_free_ticket($1,$2) AS result',[id,user]).then(r=>r.rows[0].result);
  const snapshot=async()=>{
    const r=await pool.query(`SELECT (SELECT status FROM tickets WHERE id='${ID}') AS status,
      (SELECT quantity_sold FROM ticket_types WHERE id='${TIER}') AS sold,
      (SELECT status FROM event_rsvps WHERE event_id=1 AND user_id='buyer') AS rsvp,
      (SELECT total_attendees FROM events WHERE id=1) AS attendees,
      (SELECT wallet_voided_at IS NOT NULL FROM tickets WHERE id='${ID}') AS wallet`);return r.rows[0];
  };
  async function waitBlocked(pid) {
    const until=Date.now()+5000;
    while(Date.now()<until) {
      const {rows:[s]}=await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
      if(s.wait_event_type==='Lock')return;
      await new Promise(resolve=>setTimeout(resolve,15));
    }
    throw Error('Expected a genuine PostgreSQL lock wait, not a queued same-session call');
  }
  await t.test('eight actual endpoint calls concurrently release exactly one seat and notify once',async()=>{
   await reset();const f=load(endpointDb(pool),{noStripe:true});
   const responses=await Promise.all(Array.from({length:8},()=>f.invoke()));
   for(const r of responses)assert.equal(r.status,200,await r.clone().text());
   assert.equal(f.stripe.length,0);assert.equal(f.wallets.length,1);assert.equal(f.waitlists.length,1);
   assert.deepEqual(await snapshot(),{status:'void',sold:0,rsvp:'not_going',attendees:0,wallet:true});
   assert.equal((await cancel()).changed,false);
  });
  await t.test('different last tickets for same owner serialize; RSVP stays going until last valid ticket',async()=>{
   await reset();await pool.query(`INSERT INTO ticket_types VALUES('${uuid(4)}',1,1);
     INSERT INTO tickets(id,event_id,ticket_type_id,user_id,status,purchase_amount_cents,order_id) VALUES('${uuid(5)}',1,'${uuid(4)}','buyer','active',0,'${ORDER}');`);
   await cancel();assert.equal((await snapshot()).rsvp,'going');assert.equal((await snapshot()).attendees,1);
   await cancel(uuid(5));assert.equal((await snapshot()).rsvp,'not_going');assert.equal((await snapshot()).attendees,0);
   await reset();await pool.query(`INSERT INTO ticket_types VALUES('${uuid(4)}',1,1);
     INSERT INTO tickets(id,event_id,ticket_type_id,user_id,status,purchase_amount_cents,order_id) VALUES('${uuid(5)}',1,'${uuid(4)}','buyer','active',0,'${ORDER}');`);
   const a=await pool.connect(),b=await pool.connect();
   try {await a.query('BEGIN');await cancel(ID,'buyer',a);
     const pending=cancel(uuid(5),'buyer',b);await waitBlocked(b.processID);
     await a.query('COMMIT');assert.equal((await pending).changed,true);
     assert.equal((await snapshot()).rsvp,'not_going');assert.equal((await snapshot()).attendees,0);
     assert.equal((await pool.query('SELECT sum(quantity_sold)::int AS n FROM ticket_types')).rows[0].n,0);
   }finally{await a.query('ROLLBACK');a.release();b.release();}
  });
  await t.test('scan winning the ticket lock prevents cancellation, inventory and RSVP changes',async()=>{
   await reset();const scan=await pool.connect(),buyer=await pool.connect();
   try {await scan.query('BEGIN');await scan.query(`UPDATE tickets SET status='scanned',checked_in_at=now() WHERE id='${ID}'`);
     const pending=cancel(ID,'buyer',buyer);await waitBlocked(buyer.processID);
     await scan.query('COMMIT');assert.equal((await pending).ok,false);
     assert.deepEqual(await snapshot(),{status:'scanned',sold:1,rsvp:'going',attendees:1,wallet:false});
   }finally{await scan.query('ROLLBACK');scan.release();buyer.release();}
  });
  await t.test('legacy comp event lock makes cancellation fail fast and rollback, then retry succeeds',async()=>{
   await reset();const comp=await pool.connect();
   try {await comp.query('BEGIN');await comp.query('SELECT id FROM events WHERE id=1 FOR UPDATE');
     const before=await snapshot();
     await assert.rejects(cancel(),error=>error.code==='55P03');
     assert.deepEqual(await snapshot(),before);
     // The failed cancellation must have released its tier lock, allowing the
     // legacy event-first issuer to obtain it without a deadlock.
     await comp.query('SELECT id FROM ticket_types WHERE id=$1 FOR UPDATE NOWAIT',[TIER]);
     await comp.query('COMMIT');assert.equal((await cancel()).changed,true);
   }finally{await comp.query('ROLLBACK');comp.release();}
  });
  await t.test('in-flight tier issuance finishes before cancellation releases exactly its own seat',async()=>{
   await reset();const issue=await pool.connect(),buyer=await pool.connect();
   try {await issue.query('BEGIN');await issue.query('SELECT id FROM ticket_types WHERE id=$1 FOR UPDATE',[TIER]);
     const pending=cancel(ID,'buyer',buyer);await waitBlocked(buyer.processID);
     await issue.query(`INSERT INTO tickets(id,event_id,ticket_type_id,user_id,status,purchase_amount_cents)
       VALUES('${uuid(5)}',1,'${TIER}','other','active',0);
       UPDATE ticket_types SET quantity_sold=quantity_sold+1 WHERE id='${TIER}'`);
     await issue.query('COMMIT');assert.equal((await pending).changed,true);
     const state=await snapshot();assert.equal(state.sold,1);assert.equal(state.attendees,1);assert.equal(state.rsvp,'not_going');
   }finally{await issue.query('ROLLBACK');issue.release();buyer.release();}
  });
  await t.test('post-CAS inventory failure rolls back ticket, Wallet, RSVP and attendance together',async()=>{
   await reset();await pool.query(`CREATE FUNCTION fail_inventory() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected stock failure';END;$$;
     CREATE TRIGGER fail_inventory BEFORE UPDATE ON ticket_types FOR EACH ROW EXECUTE FUNCTION fail_inventory();`);
   const f=load(endpointDb(pool));assert.equal((await f.invoke()).status,503);
   assert.deepEqual(await snapshot(),{status:'active',sold:1,rsvp:'going',attendees:1,wallet:false});
   assert.equal(f.wallets.length,0);assert.equal(f.waitlists.length,0);
   await pool.query('DROP TRIGGER fail_inventory ON ticket_types;DROP FUNCTION fail_inventory()');
  });
  await t.test('post-inventory RSVP failure also rolls the entire cancellation back',async()=>{
   await reset();await pool.query(`CREATE FUNCTION fail_rsvp() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected RSVP failure';END;$$;
     CREATE TRIGGER fail_rsvp BEFORE UPDATE ON event_rsvps FOR EACH ROW EXECUTE FUNCTION fail_rsvp();`);
   await assert.rejects(cancel(),/injected RSVP failure/);
   assert.deepEqual(await snapshot(),{status:'active',sold:1,rsvp:'going',attendees:1,wallet:false});
   await pool.query('DROP TRIGGER fail_rsvp ON event_rsvps;DROP FUNCTION fail_rsvp()');
  });
  await t.test('SQL itself rechecks stale edge reads: invalid price, ownership, scans, transfers, carts and policies',async()=>{
   for(const mutation of [
    `UPDATE tickets SET purchase_amount_cents=NULL`, `UPDATE tickets SET purchase_amount_cents=500`,
    `UPDATE tickets SET user_id='other'`, `UPDATE tickets SET checked_in_at=now()`,
    `UPDATE tickets SET transferred_from='other'`, `UPDATE tickets SET status='transfer_pending'`,
    `INSERT INTO ticket_transfers VALUES('${uuid(8)}','${ID}','pending')`,
    `UPDATE tickets SET cart_line_item_id='${uuid(9)}'`, `UPDATE orders SET cart_id='${uuid(9)}'`,
    `UPDATE orders SET user_id='other'`, `UPDATE orders SET total_cents=500`,
    `UPDATE orders SET total_cents=NULL`, `UPDATE orders SET status='refunded'`,
    `UPDATE events SET refund_policy='none'`, `UPDATE events SET start_date=NULL`,
    `UPDATE events SET start_date=now()+interval '24 hours'`,
    `UPDATE events SET refund_policy='days_before',refund_days_before=11`,
   ]) {await reset();await pool.query(mutation);const before=await snapshot();assert.equal((await cancel()).ok,false,mutation);assert.deepEqual(await snapshot(),before,mutation);}
  });
  await t.test('synthetic RSVP grouping, null tier and untouched paid add-on records',async()=>{
   await reset();await pool.query(`UPDATE tickets SET cart_id='${uuid(9)}',ticket_type_id=NULL;
     INSERT INTO order_addons VALUES('${uuid(8)}','${ORDER}','${ID}','unfulfilled',500);`);
   assert.equal((await cancel()).ok,true);assert.equal((await snapshot()).sold,1,'null tier must not release unrelated inventory');
   assert.equal((await snapshot()).rsvp,'not_going');
   assert.deepEqual((await pool.query('SELECT status,price_cents FROM order_addons')).rows,[{status:'unfulfilled',price_cents:500}]);
   assert.deepEqual((await pool.query('SELECT status,total_cents FROM orders')).rows,[{status:'paid',total_cents:0}]);
  });
  await t.test('scanned/pending sibling retains attendance and RSVP; inventory never falls below zero',async()=>{
   for(const status of ['scanned','transfer_pending']){await reset();await pool.query(`UPDATE ticket_types SET quantity_sold=0;
     INSERT INTO tickets(id,event_id,user_id,status,purchase_amount_cents) VALUES('${uuid(5)}',1,'buyer','${status}',0)`);
     assert.equal((await cancel()).ok,true);assert.equal((await snapshot()).rsvp,'going');assert.equal((await snapshot()).attendees,1);assert.equal((await snapshot()).sold,0);}
  });
  await t.test('unprivileged roles cannot call service-only RPC',async()=>{
   await reset();const c=await pool.connect();try{await c.query('SET ROLE authenticated');await assert.rejects(c.query('SELECT cancel_free_ticket($1,$2)',[ID,'buyer']),/permission denied/);}finally{await c.query('RESET ROLE');c.release();}
  });
 } finally {
  if(pool)await pool.end();if(!pool && existsSync(path.join(data,'server.log')))console.error(readFileSync(path.join(data,'server.log'),'utf8'));try{run('pg_ctl',['-D',data,'-m','immediate','stop']);}catch{}
  rmSync(data,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});
 }
});
