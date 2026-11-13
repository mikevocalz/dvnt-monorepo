const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const verifier = path.join(__dirname, 'verify-issuance-invariants.mjs');

// Execute the actual CLI against an isolated synthetic migration tree.
// No database connection, credentials, or repository-file mutations.
function verify(sql) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issuance-schema-test-'));
  try {
    const migrations = path.join(root, 'apps/mobile/supabase/migrations');
    fs.mkdirSync(migrations, { recursive: true });
    fs.mkdirSync(path.join(root, 'apps/mobile/supabase/functions/_shared'), { recursive: true });
    fs.writeFileSync(path.join(migrations, '20260101000000_fixture.sql'), sql);
    const result = spawnSync(process.execPath, [verifier, '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.ok([0, 1].includes(result.status), result.stderr);
    return { exit: result.status, ...JSON.parse(result.stdout) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('private qualified tables do not require direct service grants', () => {
  for (const name of ['dvnt_settlement.receipts', '"dvnt_settlement"."receipts"', 'private_space . receipts']) {
    const result = verify(`CREATE TABLE ${name} (id uuid PRIMARY KEY);`);
    assert.equal(result.exit, 0, name);
    assert.equal(result.summary.tablesCreated, 0, name);
  }
});

test('ungranted public and implicit-public tables remain failures', () => {
  for (const name of ['public.receipts', '"public"."receipts"', 'public . receipts', 'receipts']) {
    const result = verify(`CREATE TABLE IF NOT EXISTS ${name} (id uuid PRIMARY KEY);`);
    assert.equal(result.exit, 1, name);
    assert.equal(result.failures[0].check, 'service_role-grant');
    assert.match(result.failures[0].where, /public\.receipts$/);
  }
});

test('a private same-name grant cannot satisfy a public table', () => {
  for (const grant of ['dvnt_settlement.receipts', '"dvnt_settlement"."receipts"', 'private_space . receipts']) {
    const result = verify(`CREATE TABLE public.receipts (id uuid); GRANT ALL ON TABLE ${grant} TO service_role;`);
    assert.equal(result.exit, 1, grant);
    assert.equal(result.summary.tablesGranted, 0);
  }
});

test('real public grants still satisfy qualified and unqualified tables', () => {
  for (const grant of ['public.receipts', '"public"."receipts"', 'public . receipts', 'receipts']) {
    const result = verify(`CREATE TABLE public.receipts (id uuid); GRANT SELECT, INSERT ON TABLE ${grant} TO service_role;`);
    assert.equal(result.exit, 0, grant);
    assert.equal(result.summary.tablesCreated, 1);
    assert.equal(result.summary.tablesGranted, 1);
  }
});

test('private tables and public tables with the schema name are distinct', () => {
  const result = verify(`
    CREATE TABLE dvnt_settlement.external_receipts (id uuid);
    CREATE TABLE public.dvnt_settlement (id uuid);
    GRANT ALL ON dvnt_settlement.external_receipts TO service_role;
  `);
  assert.equal(result.exit, 1);
  assert.equal(result.summary.tablesCreated, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].where, /public\.dvnt_settlement$/);
});

test('comments cannot manufacture a public grant', () => {
  const result = verify(`
    CREATE TABLE public.receipts (id uuid);
    -- GRANT ALL ON public.receipts TO service_role;
    /* GRANT ALL ON public.receipts TO service_role; */
  `);
  assert.equal(result.exit, 1);
});
