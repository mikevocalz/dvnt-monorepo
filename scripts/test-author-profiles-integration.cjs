// Real Payload HTTP handlers against one EMPTY, disposable loopback database.
// This wrapper deliberately does not inherit application credentials or config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const connection = process.env.DVNT_AUTHOR_TEST_DATABASE_URL;
assert.ok(connection, 'Requires DVNT_AUTHOR_TEST_DATABASE_URL; no production database fallback');
const url = new URL(connection);
assert.equal(url.protocol, 'postgresql:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/dvnt_author_fixture');
assert.equal(url.username, 'dvnt_author_fixture');
assert.equal(url.search, '');
assert.equal(url.hash, '');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-author-profiles-'));

(async () => {
  try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
    // Copy the checked-in migration, never a caller-supplied SQL file. The child
    // can read only this fixed fixture path and rewrites its schema locally.
    const migration = path.join(directory, 'author-version-repair.sql');
    fs.copyFileSync(path.join(root,
      'apps/mobile/supabase/migrations/20261019160345_repair_author_version_fields.sql'), migration);
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'fixtures/author-profiles/integration.ts')],
      outfile: path.join(directory, 'integration.mjs'), bundle: true,
      platform: 'node', format: 'esm', packages: 'external',
      nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    });
    const result = spawnSync(process.execPath, [path.join(directory, 'integration.mjs')], {
      cwd: directory, stdio: 'inherit', timeout: 240000, killSignal: 'SIGKILL',
      env: {
        PATH: process.env.PATH, HOME: directory, NODE_ENV: 'development',
        DVNT_AUTHOR_TEST_DATABASE_URL: connection,
        DVNT_AUTHOR_TEST_MIGRATION_PATH: migration,
        NEXT_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1',
      },
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Author profile HTTP/PostgreSQL integration must pass');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
