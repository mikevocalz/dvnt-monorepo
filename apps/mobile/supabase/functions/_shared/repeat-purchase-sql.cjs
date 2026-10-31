// Actual PostgreSQL, disposable socket-only database; synthetic identifiers only.
// Run explicitly with POSTGRES_BIN (and LD_LIBRARY_PATH for bundled binaries).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const migrationDir = path.resolve(__dirname, '../../migrations');
const read = name => readFileSync(path.join(migrationDir, name), 'utf8');
function serverBin() {
  for (const dir of [process.env.POSTGRES_BIN, '', ...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined)) {
    if (['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(dir,n),['--version']).status===0)) return dir;
  }
  throw Error('Complete PostgreSQL required: repeat-purchase SQL assertions did NOT run.');
}
const extra = `
ALTER TABLE events ADD title text DEFAULT 'Synthetic event', ADD total_attendees integer DEFAULT 0;
CREATE TABLE event_rsvps(event_id integer,user_id text,status text);
CREATE TABLE users(id integer PRIMARY KEY,auth_id text UNIQUE);
ALTER TABLE ticket_types ADD max_per_order integer, ADD max_per_user integer, ADD is_active boolean DEFAULT true,
  ADD sale_start timestamptz, ADD sale_end timestamptz;
ALTER TABLE ticket_holds ADD user_id text, ADD guest_email text, ADD event_id integer,
  ADD payment_intent_id text, ADD hold_kind text;
ALTER TABLE orders ADD subtotal_cents integer DEFAULT 0, ADD idempotency_key text UNIQUE,
  ADD promo_code_id uuid, ADD discount_cents integer, ADD promoter_id uuid,
  ADD promoter_policy_version text, ADD promoter_original_amount_cents integer,
  ADD promoter_customer_discount_bps integer, ADD promoter_discount_amount_cents integer,
  ADD promoter_discounted_amount_cents integer, ADD promoter_code text,
  ADD promoter_commission_bps integer, ADD promoter_commission_amount_cents integer,
  ADD sold_by_staff_user_id text;
ALTER TABLE tickets ADD guest_email text, ADD guest_name text, ADD guest_lookup_token text,
  ADD stripe_checkout_session_id text, ADD checked_in_at timestamptz;
ALTER TABLE order_timeline ADD label text;
`;

test(process.env.POSTGRES_SINGLE_USER ? 'repeat purchases: actual PostgreSQL sequential assertions (concurrency NOT RUN)' : 'repeat purchases: actual PostgreSQL caps, category, independent orders and replay', {timeout:120000}, async t => {
  const bin=serverBin(), data=mkdtempSync(path.join(tmpdir(),'dvnt-repeat-data-')), socket=mkdtempSync(path.join(tmpdir(),'dvnt-repeat-sock-'));
  const run=(name,args)=>execFileSync(path.join(bin,name),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}); let pool;
  try {
    run('initdb',['-D',data,'-U','harness','--auth=trust','--no-sync']);
    if(!process.env.POSTGRES_SINGLE_USER){
      try {run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,'-w','-l',path.join(data,'server.log'),'start']);}
      catch(e){throw Error(`${e.message}\n${readFileSync(path.join(data,'server.log'),'utf8')}`);}
      pool=new Pool({host:socket,user:'harness',database:'postgres',max:10});
    }
    const sql=async(text,args=[],client=pool)=>{
      if(!process.env.POSTGRES_SINGLE_USER)return client.query(text,args).then(r=>r.rows);
      // Socket-free PostgreSQL backend. Real SQL and transactions, but this
      // mode makes no concurrency claim; lock-wait tests are explicitly skipped.
      const quote=value=>value==null?'NULL':typeof value==='number'?String(value):"'"+(Array.isArray(value)?'{'+value.join(',')+'}':String(value)).replaceAll("'","''")+"'";
      let statement=text.replace(/\$(\d+)\b/g,(_,i)=>quote(args[Number(i)-1]));
      const returns=/^\s*SELECT\b/i.test(statement)||/\bRETURNING\b/i.test(statement)&&!statement.includes('CREATE ');
      if(returns)statement=`WITH result AS (${statement.replace(/;\s*$/,'')}) SELECT coalesce(json_agg(result),'[]'::json) AS __result FROM result;`;
      const output=spawnSync(path.join(bin,'postgres'),['--single','-j','-D',data,'postgres'],{encoding:'utf8',input:statement.replace(/\n\s*\n/g,'\n')+'\n\n',maxBuffer:8*1024*1024});
      assert.equal(output.status,0,output.stderr);assert.doesNotMatch(output.stderr+output.stdout,/ERROR:|FATAL:/,statement);
      if(!returns)return[];
      const match=output.stdout.match(/__result = "(.*)"\s*\(typeid/);assert.ok(match,output.stdout);return JSON.parse(match[1]);
    };
    await sql(readFileSync(path.join(__dirname,'paid-cart-fixture.sql'),'utf8')); await sql(extra);
    await sql(read('20261009100000_addon_capacity_counts_variants_and_holds.sql'));
    await sql(read('20261009100200_cart_issuance_addon_ticket_and_units.sql'));
    await sql(read('20261021144500_paid_ticket_issuance_atomic.sql'));
    await sql(read('20261029024347_paid_cart_retry_fulfillment.sql'));
    const release=read('20261031142216_repeat_purchase_tier_limits.sql');
    await sql(release); await sql(release); // repeatable definition rollout, no data backfill
    const tier=async(category='service',max=2,price=1000,total=100)=>(await sql(
      'INSERT INTO ticket_types(event_id,category,max_per_user,price_cents,quantity_total) VALUES(1,$1,$2,$3,$4) RETURNING id',[category,max,price,total]))[0].id;
    const rows=qty=>Array.from({length:qty},()=>({id:randomUUID(),qr_token:randomUUID(),qr_payload:'SYNTHETIC-SIGNED-'+randomUUID(),guest_lookup_token:randomUUID()}));
    const free=(tierId,buyer,key=randomUUID(),qty=1)=>({tierId, rows:rows(qty), order:{event_id:1,...(buyer.includes('@')?{guest_email:buyer}:{user_id:buyer}),quantity:qty,subtotal_cents:0,total_cents:0,discount_cents:0,expected_unit_price_cents:0,idempotency_key:key}});
    const issueFree=async(f,client=pool)=>(await sql('SELECT free_ticket_checkout_atomic($1,$2,$3) AS r',[f.tierId,JSON.stringify(f.rows),JSON.stringify(f.order)],client))[0].r;
    const hold=async(id,buyer,qty=1,client=pool)=>(await sql('SELECT ticket_purchase_hold_atomic($1,$2,$3,$4,$5) AS r',[id,qty,'pi_'+randomUUID().replaceAll('-',''),buyer.includes('@')?null:buyer,buyer.includes('@')?buyer:null],client))[0].r;
    const ticketSnapshot=async(id)=>(await sql('SELECT to_jsonb(t) AS value FROM tickets t WHERE id=$1',[id]))[0].value;
    async function cart(id,buyer,qty=1,category='service') {
      const cartId=(await sql('INSERT INTO carts(user_id,event_id,status,currency) VALUES($1,1,\'draft\',\'usd\') RETURNING id',[buyer]))[0].id;
      const lineId=(await sql('INSERT INTO cart_line_items(cart_id,tier_id,category,quantity,unit_price_cents) VALUES($1,$2,$3,$4,1000) RETURNING id',[cartId,id,category,qty]))[0].id;
      return {cartId,lineId};
    }
    const holdCart=async(c,client=pool)=>(await sql('SELECT cart_create_hold($1) AS r',[c.cartId],client))[0].r;
    async function payCart(c,buyer,qty=1) {
      const pi='pi_'+randomUUID().replaceAll('-','');
      await sql('UPDATE carts SET stripe_pi_id=$2,total_cents=1000,status=\'paying\' WHERE id=$1',[c.cartId,pi]);
      await sql('INSERT INTO orders(cart_id,user_id,status,stripe_payment_intent_id,quantity,event_id,type,currency,total_cents) VALUES($1,$2,\'payment_pending\',$3,$4,1,\'event_ticket\',\'usd\',1000)',[c.cartId,buyer,pi,qty]);
      const prepared=rows(qty).map(r=>({ticket_id:r.id,line_item_id:c.lineId,qr_token:r.qr_token,qr_payload:r.qr_payload}));
      const complete=async()=>(await sql('SELECT complete_paid_cart_atomic($1,$2,1000,\'usd\',$3,1,$4,\'[]\'::jsonb) AS r',[c.cartId,pi,buyer,JSON.stringify(prepared)]))[0].r;
      return {complete,prepared};
    }
    async function blocked(pid) {
      const until=Date.now()+5000;
      while(Date.now()<until){if((await sql('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]))[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}
      throw Error('Expected a real row-lock wait');
    }
    for(const guest of [false,true]) await t.test(`${guest?'guest':'member'} free service: two purchases, same-key replay, cumulative cap and unchanged original`,async()=>{
      const id=await tier('service',2,0), buyer=guest?'free-repeat@fixture.example':'free-repeat-member';
      const first=free(id,buyer), one=await issueFree(first);assert.equal(one.ok,true,JSON.stringify(one));
      const original=await ticketSnapshot(first.rows[0].id);
      assert.equal(original.category,'service');assert.equal(original.ticket_type_id,id);
      const two=await issueFree(free(id,buyer));assert.equal(two.ok,true,JSON.stringify(two));assert.notEqual(one.order_id,two.order_id);
      const replay=await issueFree(first);assert.equal(replay.idempotent,true);assert.equal(replay.order_id,one.order_id);
      const three=await issueFree(free(id,buyer));assert.equal(three.error,'limit');
      assert.deepEqual(await ticketSnapshot(first.rows[0].id),original);
      assert.equal((await sql('SELECT count(*)::int AS n FROM tickets WHERE ticket_type_id=$1',[id]))[0].n,2);
      assert.equal((await sql('SELECT count(*)::int AS n FROM tickets WHERE ticket_type_id=$1 AND category=\'admission\'',[id]))[0].n,0);
    });
    await t.test('paid service cart purchases remain independent, replay-safe and capped',async()=>{
      const id=await tier(),buyer='paid-cart-repeat';
      const a=await cart(id,buyer);assert.equal((await holdCart(a)).ok,true);const paidA=await payCart(a,buyer);assert.equal((await paidA.complete()).ok,true);
      const original=await ticketSnapshot(paidA.prepared[0].ticket_id);assert.equal(original.category,'service');
      const b=await cart(id,buyer);assert.equal((await holdCart(b)).ok,true);const paidB=await payCart(b,buyer);assert.equal((await paidB.complete()).ok,true);
      assert.equal((await paidA.complete()).duplicate,true);assert.deepEqual(await ticketSnapshot(paidA.prepared[0].ticket_id),original);
      const c=await cart(id,buyer);const limit=await holdCart(c);assert.equal(limit.error,'buyer_limit');assert.equal(limit.remaining,0);
      assert.equal((await sql('SELECT count(*)::int AS n FROM tickets WHERE ticket_type_id=$1',[id]))[0].n,2);
      assert.equal((await sql('SELECT count(*)::int AS n FROM orders WHERE cart_id=ANY($1::uuid[])',[[a.cartId,b.cartId,c.cartId]]))[0].n,2);
    });
    for(const guest of [false,true]) await t.test(`${guest?'guest hosted':'member native'} paid service purchases have independent orders and original credentials`,async()=>{
      const id=await tier('service',2),buyer=guest?'paid-guest@fixture.example':'paid-native-member';
      async function prepare(){
        const pi='pi_'+randomUUID().replaceAll('-',''),cs=guest?'cs_'+randomUUID().replaceAll('-',''):null;
        const reserved=(await sql('SELECT ticket_purchase_hold_atomic($1,1,$2,$3,$4) AS r',[id,cs||pi,guest?null:buyer,guest?buyer:null]))[0].r;
        if(!reserved.ok)return{error:reserved.error};
        const order=(await sql("INSERT INTO orders(user_id,guest_email,type,status,event_id,quantity,total_cents,stripe_payment_intent_id,stripe_checkout_session_id) VALUES($1,$2,'event_ticket','payment_pending',1,1,1000,$3,$4) RETURNING id",[guest?null:buyer,guest?buyer:null,pi,cs]))[0].id;
        const row={...rows(1)[0],event_id:1,ticket_type_id:id,user_id:guest?null:buyer,guest_email:guest?buyer:null,order_id:order,stripe_payment_intent_id:pi,stripe_checkout_session_id:cs,purchase_amount_cents:1000,category:'admission'};
        const complete=async()=>(await sql('SELECT paid_ticket_issuance_atomic($1,$2,$3,$4,1000,$5) AS r',[order,id,pi,cs,JSON.stringify([row])]))[0].r;
        return{order,row,complete};
      }
      const a=await prepare();assert.equal((await a.complete()).ok,true);const original=await ticketSnapshot(a.row.id);assert.equal(original.category,'service');
      const b=await prepare();assert.notEqual(b.order,a.order);assert.equal((await b.complete()).ok,true);assert.equal((await a.complete()).duplicate,true);assert.deepEqual(await ticketSnapshot(a.row.id),original);assert.equal((await prepare()).error,'buyer_limit');
      assert.equal((await sql('SELECT count(*)::int AS n FROM tickets WHERE ticket_type_id=$1',[id]))[0].n,2);
    });
    for(const status of ['active','scanned','transfer_pending']) await t.test(`${status} credentials count in member and guest limits`,async()=>{
      for(const guest of [false,true]) {const id=await tier('service',1,0),buyer=guest?`${status}@fixture.example`:`member-${status}`;const f=free(id,buyer);assert.equal((await issueFree(f)).ok,true);await sql('UPDATE tickets SET status=$2 WHERE id=$1',[f.rows[0].id,status]);assert.equal((await hold(id,buyer)).error,'buyer_limit');}
    });
    await t.test('refunded and void credentials release the configured cap',async()=>{
      for(const status of ['refunded','void']) {const id=await tier('service',1,0),f=free(id,'release-'+status);assert.equal((await issueFree(f)).ok,true);await sql('UPDATE tickets SET status=$2 WHERE id=$1',[f.rows[0].id,status]);assert.equal((await issueFree(free(id,'release-'+status))).ok,true);}
    });
    await t.test('pending cart and single-tier holds share the same buyer limit',async()=>{
      const id=await tier('admission',2),buyer='cross-rail';const c=await cart(id,buyer,1,'admission');assert.equal((await holdCart(c)).ok,true);assert.equal((await hold(id,buyer)).ok,true);assert.equal((await hold(id,buyer)).error,'buyer_limit');assert.equal((await holdCart(c)).ok,true,'refresh excludes its own original hold');
    });
    await t.test('two duplicate tier lines cannot evade cap or leave partial holds',async()=>{
      const id=await tier('service',1),c=await cart(id,'duplicate-lines');await sql('INSERT INTO cart_line_items(cart_id,tier_id,category,quantity,unit_price_cents) VALUES($1,$2,\'service\',1,1000)',[c.cartId,id]);assert.equal((await holdCart(c)).error,'buyer_limit');assert.equal((await sql('SELECT count(*)::int AS n FROM cart_holds WHERE cart_id=$1',[c.cartId]))[0].n,0);
    });
    await t.test('service cart cannot masquerade as admission or product',async()=>{
      const id=await tier();for(const category of ['admission','product'])assert.equal((await holdCart(await cart(id,'category-'+category,1,category))).error,'category_mismatch');
      assert.equal((await holdCart(await cart(id,'coat-alias',1,'coat_check'))).ok,true);
    });
    await t.test('delayed paid cart cannot exceed cap after expired hold; blocked allocation stays recoverable',async()=>{
      const id=await tier('service',1),buyer='delayed-buyer';const old=await cart(id,buyer);assert.equal((await holdCart(old)).ok,true);const oldPaid=await payCart(old,buyer);
      await sql("UPDATE cart_holds SET expires_at=now()-interval '1 minute' WHERE cart_id=$1",[old.cartId]);await sql("UPDATE carts SET status='abandoned' WHERE id=$1",[old.cartId]);
      const newer=await cart(id,buyer);assert.equal((await holdCart(newer)).ok,true);const newerPaid=await payCart(newer,buyer);assert.equal((await newerPaid.complete()).ok,true);const original=await ticketSnapshot(newerPaid.prepared[0].ticket_id);
      const blocked=await oldPaid.complete();assert.equal(blocked.error,'insufficient_capacity');assert.equal(blocked.capacity_reason,'buyer_limit');assert.deepEqual(await ticketSnapshot(newerPaid.prepared[0].ticket_id),original);
      assert.equal((await sql('SELECT count(*)::int AS n FROM tickets WHERE cart_id=$1',[old.cartId]))[0].n,0);assert.equal((await sql('SELECT status FROM orders WHERE cart_id=$1',[old.cartId]))[0].status,'payment_pending');
      await sql("UPDATE tickets SET status='refunded' WHERE id=$1",[newerPaid.prepared[0].ticket_id]);assert.equal((await oldPaid.complete()).ok,true);assert.equal((await oldPaid.complete()).duplicate,true);
    });
    await t.test('legacy paid door reservations still use inventory allocator without seller-as-buyer caps',async()=>{
      const id=await tier('service',1);for(let i=0;i<2;i++)assert.equal((await sql("SELECT ticket_hold_create_atomic($1,1,$2,'door-staff',NULL) AS r",[id,'pi_SYNTHETIC_DOOR_'+i]))[0].r.ok,true);
    });
    await t.test('direct legacy paid insertion inherits service category without changing existing rows',async()=>{
      const id=await tier(),row=randomUUID();await sql('INSERT INTO tickets(id,event_id,ticket_type_id,user_id,qr_token,category) VALUES($1,1,$2,\'legacy-writer\',\'SYNTHETIC-DIRECT\',\'admission\')',[row,id]);assert.equal((await ticketSnapshot(row)).category,'service');
      await sql('UPDATE tickets SET category=\'admission\' WHERE id=$1',[row]);await sql(release);assert.equal((await ticketSnapshot(row)).category,'admission','migration never reclassifies old records');
    });
    await t.test('sold-out inventory still blocks both free and paid allocations',async()=>{
      const id=await tier('service',5,0,1);assert.equal((await issueFree(free(id,'stock-one'))).ok,true);assert.equal((await issueFree(free(id,'stock-two'))).error,'insufficient_inventory');assert.equal((await hold(id,'stock-three')).error,'insufficient_inventory');
    });
    await t.test('concurrent distinct free purchases serialize at the per-person cap',{skip:process.env.POSTGRES_SINGLE_USER?'socket unavailable: concurrency NOT RUN':false},async()=>{
      const id=await tier('service',1,0),a=await pool.connect(),b=await pool.connect();try{await a.query('BEGIN');assert.equal((await issueFree(free(id,'racing-member'),a)).ok,true);const pending=issueFree(free(id,'racing-member'),b);await blocked(b.processID);await a.query('COMMIT');assert.equal((await pending).error,'limit');}finally{await a.query('ROLLBACK');a.release();b.release();}
    });
    await t.test('concurrent cart and native reservations cannot exceed one cap',{skip:process.env.POSTGRES_SINGLE_USER?'socket unavailable: concurrency NOT RUN':false},async()=>{
      const id=await tier('service',1),buyer='racing-paid',c=await cart(id,buyer),a=await pool.connect(),b=await pool.connect();try{await a.query('BEGIN');assert.equal((await holdCart(c,a)).ok,true);const pending=hold(id,buyer,1,b);await blocked(b.processID);await a.query('COMMIT');assert.equal((await pending).error,'buyer_limit');}finally{await a.query('ROLLBACK');a.release();b.release();}
    });
    await t.test('legacy numeric owner rows count against the verified member cap',async()=>{
      const id=await tier('service',1,0);await sql("INSERT INTO users(id,auth_id) VALUES(700,'legacy-auth')");await sql("INSERT INTO tickets(event_id,ticket_type_id,user_id,qr_token) VALUES(1,$1,'700','SYNTHETIC-LEGACY-OWNER')",[id]);assert.equal((await hold(id,'legacy-auth')).error,'buyer_limit');assert.equal((await issueFree(free(id,'legacy-auth'))).error,'limit');assert.equal((await holdCart(await cart(id,'legacy-auth'))).error,'buyer_limit');
    });
    await t.test('per-order maximum is independent of cumulative per-person maximum',async()=>{
      const id=await tier('service',10,0);await sql('UPDATE ticket_types SET max_per_order=1 WHERE id=$1',[id]);assert.equal((await hold(id,'order-cap',2)).error,'order_limit');assert.equal((await issueFree(free(id,'order-cap',randomUUID(),2))).error,'order_limit');assert.equal((await holdCart(await cart(id,'order-cap',2))).error,'order_limit');assert.equal((await issueFree(free(id,'order-cap'))).ok,true);assert.equal((await issueFree(free(id,'order-cap'))).ok,true);
    });
    await t.test('public going counts exclude service while preserving RSVP-only attendance',async()=>{
      await sql('TRUNCATE event_rsvps');const before=(await sql('SELECT event_people_going_count(1) AS n'))[0].n;const id=await tier('service',4,0);assert.equal((await issueFree(free(id,'rsvp-service'))).ok,true);assert.equal((await sql('SELECT event_people_going_count(1) AS n'))[0].n,before);await sql("INSERT INTO event_rsvps VALUES(1,'rsvp-service','going')");assert.equal((await sql('SELECT event_people_going_count(1) AS n'))[0].n,before+1);
    });
    await t.test('privileged mutation and count functions are not client RPCs',async()=>{
      for(const fn of ['free_ticket_checkout_atomic(uuid,jsonb,jsonb)','guest_free_checkout_atomic(uuid,jsonb,jsonb)','ticket_hold_create_atomic(uuid,integer,text,text,text,integer,text)','ticket_purchase_hold_atomic(uuid,integer,text,text,text,integer,text)','cart_create_hold(uuid,integer,jsonb)','ticket_buyer_reserved_quantity(uuid,text,text,uuid)'])for(const role of ['anon','authenticated'])assert.equal((await sql('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,'public.'+fn]))[0].allowed,false,`${role} ${fn}`);
    });
  } finally {if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','stop']);}catch{}rmSync(data,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});}
});
