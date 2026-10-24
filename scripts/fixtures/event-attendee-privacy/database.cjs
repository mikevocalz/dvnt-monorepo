const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../../..');
const migrations = path.join(root, 'apps/mobile/supabase/migrations');

// Read published source definitions, never a production dump or private snapshot.
const rpcSources = [
  ['can_view_event', '20261003110000_event_hide_and_publish_at.sql'],
  ['viewer_is_attending', '20260916203000_guest_list_only_for_those_going.sql'],
  ['get_event_attendee_avatars', '20260918000000_going_survives_check_in.sql'],
  ['get_event_attendee_page', '20260918000000_going_survives_check_in.sql'],
  ['get_event_detail', '20261013220000_event_comments_member_boundary.sql'],
  ['get_events_for_you', '20261003120000_discovery_rpcs_return_event_tz.sql'],
  ['get_events_home', '20261003110000_event_hide_and_publish_at.sql'],
  ['get_events_home', '20261003120000_discovery_rpcs_return_event_tz.sql'],
];
function definition(name, filename) {
  const source = fs.readFileSync(path.join(migrations, filename), 'utf8');
  const start = new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'm').exec(source)?.index;
  assert.notEqual(start, undefined, `${filename}: missing published ${name}`);
  const end = source.indexOf('\n$function$;', start);
  assert.ok(end > start, `${filename}: missing published function terminator`);
  return source.slice(start, end + '\n$function$;'.length);
}
function privacyMigration() {
  return fs.readFileSync(path.join(migrations, '20261023231057_sensitive_event_attendee_privacy.sql'), 'utf8');
}
async function database({ migrate = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    for (const [name, filename] of rpcSources) await db.exec(definition(name, filename));
    const installed = (await db.query("SELECT oid::regprocedure::text AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[])", [rpcSources.map(([name])=>name)])).rows;
    for (const { signature } of installed) {
      await db.exec(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.${signature} TO anon,authenticated,service_role`);
    }
    await db.exec(fs.readFileSync(path.join(migrations, '20260614211322_events_write_rls_scope_to_owner.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(migrations, '20261019050000_event_type_taxonomy.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));
    if (migrate) {
      await db.exec(privacyMigration());
      await as(db, 'service_role', null, async () => {
        await db.exec('UPDATE events SET show_attendees=true WHERE id IN (4,11,12,13,14)');
        await db.exec('UPDATE events SET show_attendees=null WHERE id=10');
      });
    }
    // Both deployed overloads have defaults: a ten-argument call is ambiguous.
    // Execute that exact definition under a test-only alias, preserving prod ACLs.
    await aliasLegacyHome(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function installAttendanceCounters(db) {
  // Install real latest counter/admission definitions only in counter regressions.
  // Keeping this opt-in avoids changing the intentional aggregate seed (9) used
  // by the independent social-projection/privacy tests.
  await db.exec(definition('enforce_event_owner_write', '20260916200000_rsvp_counter_is_not_an_event_edit.sql'));
  const ownerSource = fs.readFileSync(path.join(migrations, '20260614211611_enforce_event_owner_write_trigger.sql'), 'utf8');
  const ownerTrigger = ownerSource.match(/create trigger trg_enforce_event_owner_write[\s\S]*?execute function public\.enforce_event_owner_write\(\);/i)?.[0];
  assert.ok(ownerTrigger, 'missing published event ownership trigger');
  await db.exec(ownerTrigger);
  await db.exec('GRANT INSERT,UPDATE,DELETE ON tickets TO service_role');
  // Migration owner needs DDL authority; service claims authorize its backfill.
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({role:'service_role'})]);
  try {
    await db.exec(fs.readFileSync(path.join(migrations, '20261006225000_public_event_people_going.sql'), 'utf8'));
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  } finally {
    await db.query("SELECT set_config('request.jwt.claims','{}',false)");
  }
}
async function aliasLegacyHome(db) {
  const definition = (await db.query("SELECT pg_get_functiondef('public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text)'::regprocedure) AS definition")).rows[0].definition;
  await db.exec(definition.replace('FUNCTION public.get_events_home(', 'FUNCTION public.fixture_home10('));
}
async function as(db, role, sub, action) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, ...(sub ? { sub } : {}) })]);
  try { return await action(); }
  finally {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims','{}',false)");
  }
}
async function call(db, expression, args = []) {
  return (await db.query(`SELECT ${expression} AS result`, args)).rows[0].result;
}
const home10 = 'fixture_home10(100,0,2,NULL,NULL,false,false,NULL,NULL,\'soonest\')';
const home11 = 'get_events_home(100,0,2,NULL,NULL,false,false,NULL,NULL,\'soonest\',NULL)';
const forYou = 'get_events_for_you(2,100,0)';
module.exports = { database, installAttendanceCounters, privacyMigration, aliasLegacyHome, as, call, home10, home11, forYou };
