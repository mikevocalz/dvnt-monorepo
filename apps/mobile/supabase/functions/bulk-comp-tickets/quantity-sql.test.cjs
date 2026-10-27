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
const acceptanceMigration = () => readFileSync(path.join(migrations, '20261027212100_atomic_ticket_transfer_acceptance.sql'), 'utf8');
function serverBin() {
  for (const dir of [process.env.POSTGRES_BIN, '', ...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined)) {
    if (['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(dir,n),['--version']).status===0)) return dir;
  }
  throw Error('No complete PostgreSQL server; comp quantity SQL/concurrency tests did NOT run. Set POSTGRES_BIN.');
}
const schema = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE TABLE events(id serial PRIMARY KEY,host_id text,status text,date timestamptz,start_date timestamptz,end_date timestamptz);
CREATE TABLE users(id serial PRIMARY KEY,auth_id text UNIQUE);
CREATE TABLE event_co_organizers(event_id integer,user_id text,role text,accepted boolean);
CREATE TABLE ticket_types(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer REFERENCES events,quantity_total integer,quantity_sold integer DEFAULT 0,is_active boolean DEFAULT true,category text);
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text,status text,currency text,subtotal_cents integer,total_cents integer,event_id integer,quantity integer,user_id text,guest_email text,paid_at timestamptz);
CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer REFERENCES events,ticket_type_id uuid REFERENCES ticket_types,status text DEFAULT 'active',user_id text,guest_email text,guest_lookup_token text,purchase_amount_cents integer,category text,qr_token text UNIQUE NOT NULL,qr_payload text,checked_in_at timestamptz,transferred_from text,attendee_name text,guest_name text,guest_phone text,wallet_serial_number text,wallet_auth_token text,wallet_pass_type_id text,wallet_voided_at timestamptz,wallet_last_pushed_at timestamptz,order_id uuid REFERENCES orders,order_index integer,order_count integer,CONSTRAINT tickets_user_or_guest CHECK(user_id IS NOT NULL OR guest_email IS NOT NULL));
CREATE TABLE ticket_transfers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_id uuid REFERENCES tickets,from_user_id text,to_user_id text,status text DEFAULT 'pending',expires_at timestamptz,resolved_at timestamptz);
CREATE TABLE cart_holds(tier_id uuid,qty integer,released boolean DEFAULT false,expires_at timestamptz);
CREATE TABLE ticket_holds(ticket_type_id uuid,quantity integer,status text,expires_at timestamptz);
INSERT INTO users(auth_id) VALUES('member'),('other'),('recipient');
`;

test(process.env.POSTGRES_SINGLE_USER ? 'comp quantity sequential real PostgreSQL (concurrency NOT RUN)' : 'comp quantity, claims and races execute against real PostgreSQL', {timeout:120000}, async t=>{
 const bin=serverBin();const data=mkdtempSync(path.join(tmpdir(),'dvnt-comp-qty-'));const socket=mkdtempSync(path.join(tmpdir(),'dvnt-comp-sock-'));
 const run=(name,args)=>execFileSync(path.join(bin,name),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 let pool;
 try {
  const args=['-D',data,'-U','harness','--auth=trust','--no-sync'];
  if(process.env.POSTGRES_SHARE)args.push('-L',process.env.POSTGRES_SHARE);
  run('initdb',args);
  if(process.env.POSTGRES_SINGLE_USER) {
    const migration=readFileSync(path.join(migrations,'20261027212000_three_comp_tickets.sql'),'utf8');
    const source=schema+'\n'+readFileSync(path.join(migrations,'20261002190000_phone_comp_claim_links.sql'),'utf8')+'\n'+migration+'\n'+migration+'\n'+acceptanceMigration()+'\n'+acceptanceMigration()+'\n'+readFileSync(path.join(__dirname,'quantity-assertions.sql'),'utf8');
    const r=spawnSync(path.join(bin,'postgres'),['--single','-j','-D',data,'postgres'],{encoding:'utf8',input:source.replace(/\n\s*\n/g,'\n')+'\n\n',maxBuffer:8*1024*1024});
    assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stderr+r.stdout,/ERROR:|FATAL:/);assert.match(r.stderr+r.stdout,/PASS: comp quantity sequential PostgreSQL assertions/);assert.match(r.stderr+r.stdout,/PASS: atomic acceptance sequential PostgreSQL assertions/);return;
  }
  run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,'-w','-l',path.join(data,'server.log'),'start']);
  pool=new Pool({host:socket,user:'harness',database:'postgres',max:12});
  await pool.query(schema);
  await pool.query(readFileSync(path.join(migrations,'20261002190000_phone_comp_claim_links.sql'),'utf8'));
  const migration=readFileSync(path.join(migrations,'20261027212000_three_comp_tickets.sql'),'utf8');
  await pool.query(migration);await pool.query(migration);
  await pool.query(acceptanceMigration());await pool.query(acceptanceMigration());
  // Production attendance triggers UPDATE events when user_id changes.
  // Reproduce that lock dependency rather than masking claim/issuer deadlocks.
  await pool.query(`CREATE FUNCTION fixture_claim_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN UPDATE events SET status=status WHERE id=NEW.event_id;RETURN NEW;END;$$;
    CREATE TRIGGER fixture_claim_attendance AFTER UPDATE OF user_id ON tickets FOR EACH ROW EXECUTE FUNCTION fixture_claim_attendance();`);
  const names={member:'issue_comp_tickets_atomic',email:'issue_guest_comp_tickets_atomic',phone:'issue_guest_phone_comp_tickets_atomic'};
  const recipient={member:'member',email:'guest@example.test',phone:'+14155550123'};
  const make=async(total=null)=>{
    const {rows:[ev]}=await pool.query("INSERT INTO events(host_id,status,start_date) VALUES('host','published',now()+interval '2 days') RETURNING id");
    const {rows:[tier]}=await pool.query("INSERT INTO ticket_types(event_id,quantity_total,category) VALUES($1,$2,'admission') RETURNING id",[ev.id,total]);
    return {event:ev.id,tier:tier.id};
  };
  const issue=(kind,ev,q=1,who=recipient[kind],actor='host',client=pool)=>client.query(`SELECT ${names[kind]}($1,$2,$3,$4::text[],$5::integer) AS result`,[ev.event,ev.tier,actor,Array.isArray(who)?who:[who],q]).then(r=>r.rows[0].result);
  const count=async ev=>(await pool.query('SELECT count(*)::int AS n FROM tickets WHERE event_id=$1',[ev.event])).rows[0].n;
  const sold=async ev=>(await pool.query('SELECT quantity_sold AS n FROM ticket_types WHERE id=$1',[ev.tier])).rows[0].n;
  const claim=(token,user,client=pool)=>client.query('SELECT claim_comp_ticket($1,$2) AS result',[token,user]).then(r=>r.rows[0].result);
  const minted=(kind,r)=>kind==='phone'?r.links.filter(l=>!l.reissued).length:r.tickets.length;
  async function waitBlocked(pid) {
    const until=Date.now()+5000;
    while(Date.now()<until) {
      const {rows:[r]}=await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
      if(r.wait_event_type==='Lock')return;
      await new Promise(r=>setTimeout(r,10));
    }
    throw Error('Expected actual PostgreSQL lock contention');
  }
  for(const kind of Object.keys(names)) {
   await t.test(`${kind}: targets 1, 2, 3 top up; retries and duplicate recipients do not multiply seats`,async()=>{
    const ev=await make();
    for(const q of [1,2,3]){
      const r=await issue(kind,ev,q,[recipient[kind],recipient[kind]]);assert.equal(r.ok,true);assert.equal(minted(kind,r),1);
      assert.equal(await count(ev),q);assert.equal(await sold(ev),q);
      const repeat=await issue(kind,ev,q);assert.equal(repeat.ok,true);assert.equal(minted(kind,repeat),0);
    }
    const tokens=(await pool.query('SELECT qr_token FROM tickets WHERE event_id=$1',[ev.event])).rows.map(r=>r.qr_token);
    assert.equal(new Set(tokens).size,3);
    for(const q of [0,4,-1,null]){const r=await issue(kind,ev,q);assert.equal(r.ok,false);}
    assert.equal(await count(ev),3);
    // Calling an older edge function still uses the four-argument target=1.
    const legacy=(await pool.query(`SELECT ${names[kind]}($1,$2,'host',$3::text[]) AS r`,[ev.event,ev.tier,[recipient[kind]]])).rows[0].r;
    assert.equal(legacy.ok,true);assert.equal(minted(kind,legacy),0);assert.equal(await sold(ev),3);
   });
   await t.test(`${kind}: eight simultaneous quantity-3 requests mint exactly three tickets`,async()=>{
    const ev=await make();const rs=await Promise.all(Array.from({length:8},()=>issue(kind,ev,3)));
    assert.ok(rs.every(r=>r.ok));assert.equal(rs.reduce((s,r)=>s+minted(kind,r),0),3);assert.equal(await count(ev),3);assert.equal(await sold(ev),3);
   });
   await t.test(`${kind}: capacity considers the quantity and both active hold types, no partial issuance`,async()=>{
    const ev=await make(4);
    await pool.query("INSERT INTO cart_holds(tier_id,qty,expires_at) VALUES($1,1,now()+interval '1 hour');",[ev.tier]);
    await pool.query("INSERT INTO ticket_holds(ticket_type_id,quantity,status,expires_at) VALUES($1,1,'active',now()+interval '1 hour')",[ev.tier]);
    const over=await issue(kind,ev,3);assert.equal(over.ok,false);assert.equal(over.would_exceed,true);assert.equal(over.remaining,2);assert.equal(await count(ev),0);
    assert.equal((await issue(kind,ev,2)).ok,true);assert.equal(await sold(ev),2);
   });
   await t.test(`${kind}: authorization remains event-scoped, accepted admin only`,async()=>{
    const ev=await make();assert.equal((await issue(kind,ev,3,recipient[kind],'stranger')).ok,false);
    await pool.query("INSERT INTO event_co_organizers VALUES($1,'scanner','scanner',true),($1,'invited','admin',false),($1,'admin','admin',true)",[ev.event]);
    for(const actor of ['scanner','invited'])assert.equal((await issue(kind,ev,3,recipient[kind],actor)).ok,false);
    assert.equal(await count(ev),0);assert.equal((await issue(kind,ev,3,recipient[kind],'admin')).ok,true);
   });
  }
  await t.test('mixed member/email/phone concurrent batches never oversell one tier',async()=>{
   const ev=await make(4);const rs=await Promise.all(Object.keys(names).map(kind=>issue(kind,ev,3)));
   assert.equal(rs.filter(r=>r.ok).length,1);assert.equal(rs.filter(r=>r.would_exceed).length,2);assert.equal(await count(ev),3);assert.equal(await sold(ev),3);
  });
  await t.test('the second issuer genuinely waits for the first transaction then sees its quantity',async()=>{
   const ev=await make();const a=await pool.connect(),b=await pool.connect();
   try{await a.query('BEGIN');assert.equal((await issue('member',ev,3,'member','host',a)).tickets.length,3);
    const pending=issue('member',ev,3,'member','host',b);await waitBlocked(b.processID);
    await a.query('COMMIT');assert.equal((await pending).tickets.length,0);assert.equal(await sold(ev),3);
   }finally{await a.query('ROLLBACK');a.release();b.release();}
  });
  await t.test('member/email active, scanned, pending and transferred ownership retain prior counting semantics',async()=>{
   for(const kind of ['member','email']) {
    const ev=await make();const r=await issue(kind,ev,3);
    await pool.query("UPDATE tickets SET status=CASE WHEN id=$2 THEN 'scanned' ELSE 'transfer_pending' END WHERE event_id=$1",[ev.event,r.tickets[0].id]);
    assert.equal((await issue(kind,ev,3)).tickets.length,0);
    // Transfer acceptance replaces the owner and clears the original email.
    await pool.query("UPDATE tickets SET user_id='recipient',guest_email=NULL,status='active' WHERE id=$1",[r.tickets[0].id]);
    assert.equal((await issue(kind,ev,3)).tickets.length,1);assert.equal(await count(ev),4);
   }
  });
  await t.test('phone quantity three has independently claimable, single-use links; partial claim and resend keep three seats',async()=>{
   const ev=await make();const first=await issue('phone',ev,3);assert.equal(first.links.length,3);
   assert.equal(new Set(first.links.map(l=>l.token)).size,3);
   assert.equal((await claim(first.links[0].token,'member')).ok,true);
   assert.equal((await claim(first.links[0].token,'other')).code,'claimed_by_other');
   const again=await issue('phone',ev,3);assert.equal(again.links.length,2);assert.ok(again.links.every(l=>l.reissued));assert.deepEqual(again.claimed,[]);
   assert.equal((await claim(first.links[1].token,'member')).code,'invalid_token');
   for(const l of again.links)assert.equal((await claim(l.token,'member')).ok,true);
   const allClaimed=await issue('phone',ev,3);assert.equal(allClaimed.links.length,0);assert.deepEqual(allClaimed.claimed,[recipient.phone]);
   // Phone-origin counting persists even when the owner transfers a claimed ticket.
   await pool.query("UPDATE tickets SET user_id='recipient' WHERE id=$1",[first.links[0].ticket_id]);
   assert.equal((await issue('phone',ev,3)).links.length,0);assert.equal(await count(ev),3);assert.equal(await sold(ev),3);
  });
  await t.test('claim and resend serialize; a claimed token is not rotated after the claim wins',async()=>{
   const ev=await make();const r=await issue('phone',ev,3);const a=await pool.connect(),b=await pool.connect();
   try{await a.query('BEGIN');assert.equal((await claim(r.links[0].token,'member',a)).ok,true);
    const pending=issue('phone',ev,3,recipient.phone,'host',b);await waitBlocked(b.processID);await a.query('COMMIT');
    const resend=await pending;assert.equal(resend.links.length,2);assert.equal((await claim(r.links[0].token,'member')).already_claimed,true);assert.equal(await count(ev),3);
   }finally{await a.query('ROLLBACK');a.release();b.release();}
  });
  await t.test('resend winning the event lock makes a simultaneous claim wait before taking its link lock',async()=>{
   const ev=await make();const r=await issue('phone',ev,3);const a=await pool.connect(),b=await pool.connect();
   try{await a.query('BEGIN');await a.query("SELECT pg_advisory_xact_lock(hashtext('comp-event'),$1)",[ev.event]);
    await a.query('SELECT id FROM events WHERE id=$1 FOR SHARE',[ev.event]);
    const pending=claim(r.links[0].token,'member',b);await waitBlocked(b.processID);
    // Would deadlock if the waiting claimant held a link row while issuer held event SHARE.
    const resend=await issue('phone',ev,3,recipient.phone,'host',a);assert.equal(resend.links.length,3);
    await a.query('COMMIT');assert.equal((await pending).code,'invalid_token');assert.equal(await count(ev),3);
   }finally{await a.query('ROLLBACK');a.release();b.release();}
  });
  const startTransfer = async () => {
    const ev = await make();
    const issued = await issue('member', ev, 3);
    const id = issued.tickets[0].id;
    await pool.query("UPDATE tickets SET status='transfer_pending', guest_lookup_token='old-guest-link' WHERE id=$1", [id]);
    const { rows: [transfer] } = await pool.query("INSERT INTO ticket_transfers(ticket_id,from_user_id,to_user_id,expires_at) VALUES($1,'member','recipient',now()+interval '1 day') RETURNING id", [id]);
    return { ...ev, ticket: id, transfer: transfer.id };
  };
  const accept = (ev, client = pool) => client.query("SELECT accept_ticket_transfer_atomic($1,'recipient',$2,$3,'new-signed-payload') AS r", [ev.transfer, ev.event, require('node:crypto').randomBytes(32).toString('hex')]).then(r => r.rows[0].r);
  await t.test('atomic acceptance moves one of three comps, clears bearer links and is service-only', async () => {
    const ev = await startTransfer(); assert.equal((await accept(ev)).ok, true);
    const { rows: [ticket] } = await pool.query('SELECT * FROM tickets WHERE id=$1', [ev.ticket]);
    assert.equal(ticket.user_id, 'recipient'); assert.equal(ticket.status, 'active');
    assert.equal(ticket.guest_lookup_token, null); assert.equal(ticket.purchase_amount_cents, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM tickets WHERE event_id=$1 AND user_id='member'", [ev.event])).rows[0].n, 2);
    assert.equal((await accept(ev)).ok, false);
    for (const role of ['anon', 'authenticated']) assert.equal((await pool.query("SELECT has_function_privilege($1,'accept_ticket_transfer_atomic(uuid,text,integer,text,text)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
  });
  await t.test('eight concurrent acceptance attempts commit exactly one ownership move', async () => {
    const ev = await startTransfer(); const results = await Promise.all(Array.from({ length: 8 }, () => accept(ev)));
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal((await pool.query('SELECT status FROM ticket_transfers WHERE id=$1', [ev.transfer])).rows[0].status, 'accepted');
  });
  await t.test('acceptance that waits beyond its deadline cannot move the ticket', async () => {
    const ev = await startTransfer(); const a = await pool.connect(), b = await pool.connect();
    try {
      await a.query('BEGIN'); await a.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE', [ev.ticket]);
      await pool.query("UPDATE ticket_transfers SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1", [ev.transfer]);
      const pending = accept(ev, b); await waitBlocked(b.processID);
      await new Promise(resolve => setTimeout(resolve, 1100)); await a.query('COMMIT');
      assert.equal((await pending).ok, false);
      assert.equal((await pool.query('SELECT user_id FROM tickets WHERE id=$1', [ev.ticket])).rows[0].user_id, 'member');
    } finally { await a.query('ROLLBACK'); a.release(); b.release(); }
  });
  await t.test('a failure after ticket mutation rolls back both ownership and transfer state, then retry succeeds', async () => {
    const ev = await startTransfer();
    await pool.query(`CREATE FUNCTION fixture_reject_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='accepted' THEN RAISE EXCEPTION 'fixture rollback';END IF;RETURN NEW;END;$$;
      CREATE TRIGGER fixture_reject_acceptance BEFORE UPDATE ON ticket_transfers FOR EACH ROW EXECUTE FUNCTION fixture_reject_acceptance();`);
    try { await assert.rejects(accept(ev), /fixture rollback/); }
    finally { await pool.query('DROP TRIGGER fixture_reject_acceptance ON ticket_transfers;DROP FUNCTION fixture_reject_acceptance();'); }
    const { rows: [ticket] } = await pool.query('SELECT * FROM tickets WHERE id=$1', [ev.ticket]);
    assert.equal(ticket.user_id, 'member'); assert.equal(ticket.status, 'transfer_pending'); assert.equal(ticket.guest_lookup_token, 'old-guest-link');
    assert.equal((await pool.query('SELECT status FROM ticket_transfers WHERE id=$1', [ev.transfer])).rows[0].status, 'pending');
    assert.equal((await accept(ev)).ok, true);
  });
  await t.test('acceptance waiting behind a refund sees the final state and cannot mark the transfer accepted', async () => {
    const ev = await startTransfer(); const a = await pool.connect(), b = await pool.connect();
    try {
      await a.query('BEGIN'); await a.query("UPDATE tickets SET status='refunded' WHERE id=$1", [ev.ticket]);
      const pending = accept(ev, b); await waitBlocked(b.processID); await a.query('COMMIT');
      assert.equal((await pending).ok, false);
      assert.equal((await pool.query('SELECT status FROM ticket_transfers WHERE id=$1', [ev.transfer])).rows[0].status, 'pending');
    } finally { await a.query('ROLLBACK'); a.release(); b.release(); }
  });
  await t.test('all old and new function signatures remain service-role only',async()=>{
   for(const name of Object.values(names))for(const signature of ['integer,uuid,text,text[]','integer,uuid,text,text[],integer']){
    const fn=`public.${name}(${signature})`;
    for(const role of ['anon','authenticated'])assert.equal((await pool.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,fn])).rows[0].allowed,false);
    assert.equal((await pool.query('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\') AS allowed',[fn])).rows[0].allowed,true);
   }
  });
 }catch(error){const log=path.join(data,'server.log');if(existsSync(log))console.error(readFileSync(log,'utf8'));throw error;}finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','stop']);}catch{}rmSync(data,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});}
});
