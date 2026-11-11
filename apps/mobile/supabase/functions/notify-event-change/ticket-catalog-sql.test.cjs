// Actual migrations in disposable PostgreSQL. Never connects to deployed data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const read = name => fs.readFileSync(path.join(__dirname, '../../migrations', name), 'utf8');

test('public catalog stays readable while secret-bearing base rows require accepted management', {timeout:120000}, async t => {
  const db = new PGlite();
  const query = async (sql, params=[]) => (await db.query(sql, params)).rows;
  const login = async (sub, role='authenticated') => {
    await db.exec('RESET ROLE');
    await query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub, role})]);
    await db.exec(`SET ROLE ${role}`);
  };
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claims',true),'')::jsonb $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      CREATE TABLE events(id integer PRIMARY KEY,host_id text,visibility text DEFAULT 'public',is_hidden boolean DEFAULT false,publish_at timestamptz);
      CREATE TABLE event_invites(event_id integer,invited_user_id text,invited_email text,status text);
      CREATE TABLE public."user"(id text,email text,"emailVerified" boolean);
      CREATE TABLE tickets(id integer PRIMARY KEY,event_id integer,user_id text,category text,status text);
      CREATE TABLE event_co_organizers(event_id integer,user_id text,accepted boolean,role text);
      INSERT INTO events(id,host_id) VALUES(1,'host'),(2,'foreign-host');
      INSERT INTO event_co_organizers VALUES (1,'admin',true,'admin'),(1,'editor',true,'editor'),
        (1,'scanner',true,'scanner'),(1,'pending',false,'editor'),(1,'null-acceptance',null,'admin');
      GRANT SELECT ON events,event_co_organizers TO authenticated;
      CREATE TABLE ticket_addons(id integer PRIMARY KEY,event_id integer,price_cents integer);
      CREATE TABLE ticket_addon_variants(id integer PRIMARY KEY,addon_id integer,price_cents integer);
      ALTER TABLE ticket_addons ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ticket_addon_variants ENABLE ROW LEVEL SECURITY;
      CREATE POLICY addons_select ON ticket_addons FOR SELECT USING(true);
      CREATE POLICY variants_select ON ticket_addon_variants FOR SELECT USING(true);
      INSERT INTO ticket_addons VALUES(1,1,100),(2,2,200);
      INSERT INTO ticket_addon_variants VALUES(1,1,100),(2,2,200);
    `);
    await db.exec(read('20260301_events_ticketing_v2.sql').match(/CREATE TABLE IF NOT EXISTS ticket_types \([\s\S]*?\n\);/)[0]);
    await db.exec(read('20260413100001_fix_event_detail_comments_table.sql').split('\n').filter(l=>l.startsWith('ALTER TABLE ticket_types ADD COLUMN')).join('\n'));
    await db.exec(read('20260424_ticket_types_capacity_alert.sql'));
    await db.exec(read('20260613144937_ticket_tier_model_v2.sql'));
    await db.exec(read('20260516123000_ticket_categories_and_event_visibility.sql'));
    await db.exec(`
      ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ticket_types_select ON ticket_types FOR SELECT USING(true);
      CREATE POLICY ticket_types_select_all ON ticket_types FOR SELECT USING(true);
      CREATE POLICY ticket_types_select_anon ON ticket_types FOR SELECT TO anon USING(true);
      CREATE POLICY drifted_public_select ON ticket_types FOR SELECT USING(true);
      GRANT ALL ON ticket_types TO authenticated, anon, service_role;
      INSERT INTO ticket_types(event_id,name,price_cents,unlock_code) VALUES(1,'GA',100,'private-code'),(2,'Foreign',200,'foreign-code');
      CREATE FUNCTION maintain_inventory() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS
        $$ UPDATE public.ticket_types SET quantity_sold=quantity_sold+1 WHERE event_id=1 $$;
    `);
    await db.exec(read('20261003110000_event_hide_and_publish_at.sql').match(/^CREATE OR REPLACE FUNCTION public\.can_view_event\(p_event_id integer\)[\s\S]*?^\$function\$;/m)[0]);
    await db.exec(`CREATE POLICY event_private_boundary ON ticket_types AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.can_view_event(event_id));`);
    await db.exec(read('20260806200000_ticket_types_public_view.sql'));
    await db.exec(read('20260806400000_ticket_addons_host_write_policies.sql'));
    await db.exec(read('20261111120000_accepted_cohost_event_editing.sql'));
    // Additive schema first: old clients continue reading base rows while new
    // clients gain the safe history relation. Lockdown is a later release step.
    const prerequisite = read('20261111052229_ticket_catalog_safe_labels.sql');
    await db.exec(prerequisite); await db.exec(prerequisite);
    await t.test('additive labels coexist with both legacy and updated buyer clients', async () => {
      await login('buyer');
      assert.equal((await query('SELECT name FROM ticket_types')).length,2);
      assert.equal((await query('SELECT name FROM ticket_types_public')).length,2);
      assert.equal((await query('SELECT name FROM ticket_type_labels')).length,2);
      await assert.rejects(query('SELECT unlock_code FROM ticket_type_labels'),/does not exist/);
      await db.exec('RESET ROLE');
    });
    const migration = read('20261111121000_ticket_catalog_private_management.sql');
    await db.exec(migration); await db.exec(migration);
    await db.exec('ALTER TABLE ticket_types ADD COLUMN future_secret text');
    for (const actor of ['host','admin','editor','scanner','pending','null-acceptance','removed','foreign-host','buyer',null]) {
      await t.test(`${actor}: public projection and private access`, async () => {
        await login(actor);
        const rows = await query('SELECT * FROM ticket_types_public ORDER BY event_id');
        assert.equal(rows.length,2);
        assert.equal(rows[0].price_cents,100);
        assert.equal('unlock_code' in rows[0],false);
        assert.equal('future_secret' in rows[0],false);
        await assert.rejects(query('SELECT unlock_code FROM ticket_types_public'), /does not exist/);
        const privateRows=await query('SELECT event_id,unlock_code FROM ticket_types ORDER BY event_id');
        assert.deepEqual(privateRows, ['host','admin','editor'].includes(actor)
          ? [{event_id:1,unlock_code:'private-code'}]
          : actor==='foreign-host' ? [{event_id:2,unlock_code:'foreign-code'}] : []);
      });
    }
    await t.test('anonymous catalog remains available and cannot become a write bypass', async () => {
      await login(null,'anon');
      assert.equal((await query('SELECT * FROM ticket_types_public')).length,2);
      await assert.rejects(query('SELECT * FROM ticket_types'), /permission denied/);
      for (const sql of ["UPDATE ticket_types_public SET price_cents=1", "DELETE FROM ticket_types_public", "INSERT INTO ticket_types_public(event_id,name,price_cents) VALUES(1,'bad',1)"]) await assert.rejects(query(sql), /permission denied/);
    });
    for (const actor of ['host','admin','editor']) await t.test(`${actor}: manager writes RETURNING survive SELECT restrictions`, async () => {
      await login(actor);
      assert.equal((await query("UPDATE ticket_types SET price_cents=250 WHERE event_id=1 RETURNING unlock_code"))[0].unlock_code,'private-code');
      const inserted=await query("INSERT INTO ticket_types(event_id,name,price_cents,unlock_code) VALUES(1,'Added',300,'new-code') RETURNING unlock_code");
      assert.equal(inserted[0].unlock_code,'new-code');
      await assert.rejects(query('UPDATE ticket_types_public SET price_cents=1'), /permission denied/);
    });
    for (const actor of ['host','admin','editor','scanner','pending','removed']) await t.test(`${actor}: foreign tiers and addons cannot be mutated`, async () => {
      await login(actor);
      assert.equal((await query('UPDATE ticket_types SET price_cents=1 WHERE event_id=2 RETURNING id')).length,0);
      assert.equal((await query('DELETE FROM ticket_types WHERE event_id=2 RETURNING id')).length,0);
      await assert.rejects(query("INSERT INTO ticket_types(event_id,name,price_cents) VALUES(2,'bad',1)"), /row-level security/);
      for(const [table,parent] of [['ticket_addons','event_id'],['ticket_addon_variants','addon_id']]) {
        assert.equal((await query(`UPDATE ${table} SET price_cents=1 WHERE id=2 RETURNING id`)).length,0);
        assert.equal((await query(`DELETE FROM ${table} WHERE id=2 RETURNING id`)).length,0);
        await assert.rejects(query(`INSERT INTO ${table}(id,${parent},price_cents) VALUES(999,2,1)`), /row-level security/);
      }
    });
    await t.test('revocation immediately removes private reads and update visibility', async () => {
      await db.exec("RESET ROLE; DELETE FROM event_co_organizers WHERE user_id='editor'");
      await login('editor');
      assert.deepEqual(await query('SELECT unlock_code FROM ticket_types'),[]);
      assert.deepEqual(await query('UPDATE ticket_types SET price_cents=1 RETURNING id'),[]);
      assert.ok((await query('SELECT * FROM ticket_types_public')).length>0);
    });
    await t.test('real event visibility survives definer views: private, hidden and future remain private', async () => {
      await db.exec(`RESET ROLE;
        INSERT INTO events(id,host_id,visibility,is_hidden,publish_at) VALUES
          (31,'private-owner','private',false,null),(32,'private-owner','public',true,null),(33,'private-owner','public',false,now()+interval '1 day');
        INSERT INTO ticket_types(event_id,name,price_cents) VALUES(31,'Private',1),(32,'Hidden',1),(33,'Future',1);
        INSERT INTO event_co_organizers VALUES(31,'private-editor',true,'editor');
        INSERT INTO event_invites VALUES(31,'invitee',null,'accepted');
        INSERT INTO tickets VALUES(1,31,'holder','admission','active');
        INSERT INTO ticket_types(event_id,name,price_cents,is_active) VALUES(1,'Retired purchased tier',1,false);`);
      for(const role of ['anon','authenticated']) {
        await login('stranger',role);
        assert.deepEqual(await query('SELECT event_id FROM ticket_types_public WHERE event_id>=31'),[]);
      }
      for(const actor of ['private-owner','private-editor','invitee','holder']) {
        await login(actor);
        assert.equal((await query('SELECT event_id FROM ticket_types_public WHERE event_id=31')).length,1,actor);
      }
      for(const actor of ['buyer','scanner']) {
        await login(actor);
        assert.deepEqual(await query("SELECT name FROM ticket_types_public WHERE name='Retired purchased tier'"),[]);
        assert.deepEqual(await query("SELECT name FROM ticket_type_labels WHERE name='Retired purchased tier'"),[{name:'Retired purchased tier'}]);
        assert.deepEqual(await query("SELECT name FROM ticket_type_labels WHERE name IN ('Private','Hidden','Future')"),[]);
        assert.deepEqual((await query("SELECT column_name FROM information_schema.columns WHERE table_name='ticket_type_labels' ORDER BY ordinal_position")).map(r=>r.column_name),['id','name','category']);
        await assert.rejects(query('SELECT unlock_code FROM ticket_type_labels'),/does not exist/);
        await assert.rejects(query("UPDATE ticket_type_labels SET name='bad'"),/permission denied/);
      }
      await login(null,'anon');
      await assert.rejects(query('SELECT * FROM ticket_type_labels'),/permission denied/);
      await db.exec('RESET ROLE; DELETE FROM event_co_organizers WHERE event_id=31; DELETE FROM event_invites WHERE event_id=31; DELETE FROM tickets WHERE event_id=31;');
      for(const actor of ['private-editor','invitee','holder']) {
        await login(actor);
        assert.deepEqual(await query('SELECT event_id FROM ticket_types_public WHERE event_id=31'),[]);
      }
    });
    await t.test('trusted checkout inventory writes still work with a buyer JWT', async () => {
      await login('buyer'); await query('SELECT maintain_inventory()');
      assert.equal((await query("SELECT quantity_sold FROM ticket_types_public WHERE name='GA'"))[0].quantity_sold,1);
      await login(null,'service_role');
      assert.ok((await query('SELECT unlock_code FROM ticket_types')).length>0);
    });
  } finally { await db.close(); }
});

test('actual promo schema persists endpoint payloads with BetterAuth creator IDs and ledger-safe revocation', {timeout:120000}, async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE service_role BYPASSRLS; CREATE TABLE events(id integer PRIMARY KEY);
      CREATE TABLE ticket_types(id uuid PRIMARY KEY); INSERT INTO events VALUES(42);`);
    const schema=read('monetization_v1_package/002_apply.sql');
    await db.exec(schema.match(/CREATE TABLE IF NOT EXISTS promo_codes \([\s\S]*?\n\);/)[0]);
    await db.exec(schema.match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_event_code[\s\S]*?;/)[0]);
    await db.exec(read('20261010160000_promo_codes_soft_delete.sql'));
    await db.exec(`CREATE TABLE orders(id integer PRIMARY KEY,promo_code_id uuid REFERENCES promo_codes(id));
      GRANT ALL ON promo_codes,orders TO service_role; SET ROLE service_role;`);
    const source=fs.readFileSync(path.join(__dirname,'../manage-promo-code/index.ts'),'utf8');
    const payloadExpression=source.match(/createData = (\{[\s\S]*?\n      \});/)[1];
    const buildPayload=new Function('eventId','code','body','value','maxUses','authId', `return ${payloadExpression}`);
    for(const [i,actor] of ['betterauth-owner','betterauth-accepted-admin','betterauth-accepted-editor'].entries()) {
      const payload=buildPayload(42,`PROMO_${i}`,{discount_type:i===1?'fixed_cents':'percent'},i===1?1000:20,null,actor);
      const keys=Object.keys(payload);
      const row=(await db.query(`INSERT INTO promo_codes(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,Object.values(payload))).rows[0];
      assert.match(row.id,/^[0-9a-f-]{36}$/);
      assert.equal(row.created_by,actor);
      assert.equal(row.uses_count,0);
      assert.equal(row.ticket_type_id,null);
      assert.equal(row.max_uses,null);
      assert.equal(row.deleted_at,null);
      await db.query('INSERT INTO orders VALUES($1,$2)',[i,row.id]);
      await assert.rejects(db.query('DELETE FROM promo_codes WHERE id=$1',[row.id]), /foreign key/);
      await db.query("UPDATE promo_codes SET deleted_at=now(), valid_until=now()-interval '1 second' WHERE id=$1",[row.id]);
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM orders WHERE promo_code_id=$1',[row.id])).rows[0].n,1);
      await assert.rejects(db.query(`INSERT INTO promo_codes(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values({...payload,code:payload.code.toLowerCase()})), /duplicate key/);
    }
  } finally { await db.close(); }
});
