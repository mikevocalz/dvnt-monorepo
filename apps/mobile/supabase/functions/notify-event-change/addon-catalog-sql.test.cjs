// Actual source migrations in disposable PostgreSQL; no deployed connections.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const read = name => fs.readFileSync(path.join(__dirname, '../../migrations', name), 'utf8');

test('add-on and variant co-host writes preserve parent identity and server inventory', {timeout:120000}, async t => {
  const db = new PGlite();
  const query = async (sql, params=[]) => (await db.query(sql, params)).rows;
  const login = async (sub, role='authenticated') => {
    await db.exec('RESET ROLE');
    await query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub, role})]);
    await db.exec(`SET ROLE ${role}`);
  };
  const a='00000000-0000-0000-0000-000000000001', b='00000000-0000-0000-0000-000000000002';
  const v='00000000-0000-0000-0000-000000000003';
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE events(id integer PRIMARY KEY,host_id text);
      CREATE TABLE event_co_organizers(event_id integer,user_id text,accepted boolean,role text);
      CREATE TABLE ticket_types(id uuid PRIMARY KEY,event_id integer);
      INSERT INTO events VALUES(1,'host'),(2,'other-host');
      INSERT INTO event_co_organizers VALUES(1,'admin',true,'admin'),(1,'editor',true,'editor'),
        (2,'admin',true,'admin'),(2,'editor',true,'editor'),(1,'scanner',true,'scanner'),
        (1,'pending',false,'admin'),(1,'null-acceptance',null,'editor');
      GRANT SELECT ON events,event_co_organizers,ticket_types TO authenticated;
      INSERT INTO ticket_types VALUES('00000000-0000-0000-0000-000000000011',1),('00000000-0000-0000-0000-000000000012',2);`);
    const schema=read('20260613145014_ticket_addons.sql');
    for(const table of ['ticket_addons','ticket_addon_variants']) {
      await db.exec(schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS public.${table} \\([\\s\\S]*?\\n\\);`))[0]);
      await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY catalog_read ON ${table} FOR SELECT USING(true);
        GRANT ALL ON ${table} TO service_role;
        ALTER TABLE ${table} ADD COLUMN future_private_field text;`);
    }
    await db.exec(read('20260806400000_ticket_addons_host_write_policies.sql'));
    await query(`INSERT INTO ticket_addons(id,event_id,name,price_cents,quantity_sold,quantity_held) VALUES($1,1,'Shirt',100,2,1),($2,2,'Foreign',200,0,0)`,[a,b]);
    await query(`INSERT INTO ticket_addon_variants(id,addon_id,name,quantity_sold,quantity_held) VALUES($1,$2,'Small',1,1)`,[v,a]);
    // Prove the actual pre-existing policies permit the exploit before adding guard.
    await login('editor');
    assert.equal((await query(`UPDATE ticket_addons SET quantity_sold=99 WHERE id=$1 RETURNING id`,[a])).length,1);
    assert.equal((await query(`UPDATE ticket_addon_variants SET addon_id=$1 WHERE id=$2 RETURNING id`,[b,v])).length,1);
    await db.exec('RESET ROLE');
    await query('UPDATE ticket_addons SET quantity_sold=2 WHERE id=$1',[a]);
    await query('UPDATE ticket_addon_variants SET addon_id=$1 WHERE id=$2',[a,v]);
    const migration=read('20261111140000_guard_cohost_addon_catalog.sql');
    await db.exec(migration); await db.exec(migration);
    await t.test('owner and cohosts cannot bind an add-on to a foreign event tier', async()=>{
      for(const actor of ['host','admin','editor']) {
        await login(actor);
        assert.equal((await query("UPDATE ticket_addons SET requires_tier_id='00000000-0000-0000-0000-000000000011' WHERE id=$1 RETURNING id",[a])).length,1);
        await assert.rejects(query("UPDATE ticket_addons SET requires_tier_id='00000000-0000-0000-0000-000000000012' WHERE id=$1",[a]),/own event/);
        await assert.rejects(query("INSERT INTO ticket_addons(event_id,name,requires_tier_id) VALUES(1,'Wrong tier','00000000-0000-0000-0000-000000000012')"),/own event/);
      }
    });
    await login('host');
    await query('UPDATE ticket_addons SET requires_tier_id=NULL WHERE id=$1',[a]);
    for(const actor of ['admin','editor']) await t.test(`${actor}: catalog writes work, counters and parent changes fail`, async()=>{
      await login(actor);
      for(const [table,id,parent,parentValue] of [['ticket_addons',a,'event_id',2],['ticket_addon_variants',v,'addon_id',b]]) {
        assert.equal((await query(`UPDATE ${table} SET name='Updated',price_cents=250,quantity_total=10 WHERE id=$1 RETURNING id`,[id])).length,1);
        for(const assignment of ['quantity_sold=0','quantity_held=0',"created_at=now()+interval '1 day'","future_private_field='injected'","id=gen_random_uuid()"])
          await assert.rejects(query(`UPDATE ${table} SET ${assignment} WHERE id=$1`,[id]),/Only add-on catalog/);
        await assert.rejects(query(`UPDATE ${table} SET ${parent}=$1 WHERE id=$2`,[parentValue,id]),/Only add-on catalog/);
      }
      const inserted=(await query("INSERT INTO ticket_addons(event_id,name) VALUES(1,'New') RETURNING id"))[0];
      assert.equal((await query("INSERT INTO ticket_addon_variants(addon_id,name) VALUES($1,'New variant') RETURNING id",[inserted.id])).length,1);
      for(const counter of ['quantity_sold','quantity_held']) {
        await assert.rejects(query(`INSERT INTO ticket_addons(event_id,name,${counter}) VALUES(1,'Bad',4)`),/server-managed/);
        await assert.rejects(query(`INSERT INTO ticket_addon_variants(addon_id,name,${counter}) VALUES($1,'Bad',4)`,[a]),/server-managed/);
      }
    });
    for(const actor of ['scanner','pending','null-acceptance','removed','outsider']) await t.test(`${actor}: RLS denies catalog writes`,async()=>{
      await login(actor);
      assert.equal((await query('UPDATE ticket_addons SET price_cents=1 RETURNING id')).length,0);
      assert.equal((await query('UPDATE ticket_addon_variants SET price_cents=1 RETURNING id')).length,0);
      await assert.rejects(query("INSERT INTO ticket_addons(event_id,name) VALUES(1,'Bad')"),/row-level security/);
    });
    await t.test('owner retains prior authority and trusted buyer-context maintenance works',async()=>{
      await login('host');
      assert.equal((await query('UPDATE ticket_addons SET quantity_sold=3 WHERE id=$1 RETURNING id',[a])).length,1);
      assert.equal((await query('UPDATE ticket_addon_variants SET quantity_sold=2 WHERE id=$1 RETURNING id',[v])).length,1);
      await db.exec(`RESET ROLE;
        CREATE FUNCTION maintain_addon_inventory() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
        BEGIN UPDATE public.ticket_addons SET quantity_held=quantity_held+1;
          UPDATE public.ticket_addon_variants SET quantity_held=quantity_held+1; END $$;`);
      await login('buyer'); await query('SELECT maintain_addon_inventory()');
      assert.equal((await query('SELECT quantity_held FROM ticket_addons WHERE id=$1',[a]))[0].quantity_held,2);
      assert.equal((await query('SELECT quantity_held FROM ticket_addon_variants WHERE id=$1',[v]))[0].quantity_held,2);
      await login(null,'service_role');
      assert.equal((await query('UPDATE ticket_addons SET quantity_sold=quantity_sold+1 RETURNING id')).length>0,true);
    });
  } finally { await db.close(); }
});
