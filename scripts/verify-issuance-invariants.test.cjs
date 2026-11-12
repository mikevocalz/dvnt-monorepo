const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const scanner = path.join(__dirname, 'verify-issuance-invariants.mjs');

function scan(sql) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issuance-scanner-'));
  try {
    const base = path.join(root, 'apps/mobile/supabase');
    fs.mkdirSync(path.join(base, 'migrations'), { recursive: true });
    fs.mkdirSync(path.join(base, 'functions'), { recursive: true });
    fs.writeFileSync(path.join(base, 'migrations/20261111000000_fixture.sql'), sql);
    const result = spawnSync(process.execPath, [scanner, '--json'], { cwd: root, encoding: 'utf8' });
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return { ...JSON.parse(result.stdout), status: result.status };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('private schema tables never demand direct service grants', () => {
  const r = scan('create table dvnt_settlement.orders(id uuid); create table "private_schema" . "items"(id uuid);');
  assert.equal(r.status, 0);
  assert.equal(r.summary.tablesCreated, 0);
});
test('public, quoted public and unqualified missing grants still fail', () => {
  const r = scan('create table public.one(id uuid); create table "public" . "two"(id uuid); create table three(id uuid);');
  assert.equal(r.status, 1);
  assert.equal(r.failures.length, 3);
  assert.deepEqual(r.failures.map(x => x.where.split('public.')[1]), ['one', 'two', 'three']);
});
test('a private same-name grant cannot cover a public table', () => {
  const r = scan('create table public.items(id uuid); grant select on dvnt_settlement.items to service_role;');
  assert.equal(r.status, 1);
  assert.equal(r.failures.length, 1);
});
test('qualified and unqualified real public grants satisfy the gate', () => {
  const r = scan('create table public.one(id uuid); create table "public" . "two"(id uuid); create table three(id uuid); grant select on public.one to service_role; grant select on "public" . "two" to service_role; grant select on three to service_role;');
  assert.equal(r.status, 0);
  assert.equal(r.summary.tablesCreated, 3);
});
