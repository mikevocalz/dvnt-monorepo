const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');
const sql = fs.readFileSync(__dirname + '/../apps/mobile/supabase/migrations/20261111020731_profile_effective_privacy.sql','utf8');
test('effective privacy is one public boolean, without access to private settings or mutations', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE users(id bigint PRIMARY KEY,auth_id text UNIQUE,is_private boolean);
      CREATE TABLE user_settings(auth_id text PRIMARY KEY,settings jsonb);
      INSERT INTO users VALUES(1,'public',false),(2,'settings-private',false),(3,'flag-private',true),
        (4,'malformed',false),(5,'string-false',false),(6,'null',null);
      INSERT INTO user_settings VALUES
        ('settings-private','{"privacy":{"privateAccount":true},"secret":"never-return"}'),
        ('flag-private','{"privacy":{"privateAccount":false}}'),
        ('malformed','{"privacy":{"privateAccount":"unexpected"}}'),
        ('string-false','{"privacy":{"privateAccount":"false"}}'),
        ('null','{"privacy":{"privateAccount":null}}');
      ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;`);
    const before = (await db.query('SELECT * FROM user_settings ORDER BY auth_id')).rows;
    await db.exec(sql);
    for (const role of ['anon','authenticated','service_role']) {
      await db.exec(`SET ROLE ${role}`);
      const result = (await db.query('SELECT public.profile_is_private(id) AS private FROM generate_series(1,7) AS id')).rows;
      assert.deepEqual(result.map(r=>r.private),[false,true,true,true,false,false,null]);
      await assert.rejects(db.query('SELECT settings FROM user_settings'),/permission denied/);
      await assert.rejects(db.query("UPDATE users SET is_private=false"),/permission denied/);
      await db.exec('RESET ROLE');
    }
    assert.deepEqual((await db.query('SELECT * FROM user_settings ORDER BY auth_id')).rows, before);
    const [fn] = (await db.query(`SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE proname='profile_is_private'`)).rows;
    assert.equal(fn.prosecdef,true);
    assert.equal(fn.provolatile,'s');
    assert.ok(fn.proconfig.some(s=>s.startsWith('search_path=')));
    // Settings changes remain authoritative without backfilling the legacy flag.
    await db.exec(`UPDATE user_settings SET settings='{"privacy":{"privateAccount":false}}' WHERE auth_id='settings-private'`);
    assert.equal((await db.query('SELECT profile_is_private(2) AS private')).rows[0].private,false);
  } finally {await db.close();}
});
