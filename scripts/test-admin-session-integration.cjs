// Run installed Payload/Better Auth HTTP handlers against an EMPTY disposable
// loopback PostgreSQL database. Never inherits application credentials/settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const connection = process.env.DVNT_ADMIN_TEST_DATABASE_URL;
assert.ok(connection, 'Requires isolated DVNT_ADMIN_TEST_DATABASE_URL; no production fallback');
const url = new URL(connection);
assert.equal(url.protocol, 'postgresql:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/dvnt_admin_auth_fixture');
assert.equal(url.username, 'dvnt_admin_fixture');
assert.equal(url.search, '');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-admin-auth-'));
(async () => {
  try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
    await esbuild.build({ entryPoints: [path.join(__dirname, 'fixtures/admin-session/integration.ts')],
      outfile: path.join(directory, 'integration.mjs'), bundle: true, platform: 'node', format: 'esm',
      packages: 'external', nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean) });
    const result = spawnSync(process.execPath, [path.join(directory, 'integration.mjs')], {
      cwd: directory, stdio: 'inherit', timeout: 240000,
      env: { PATH: process.env.PATH, HOME: directory, NODE_ENV: 'development',
        APP_DATABASE_URL: connection, NEXT_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Real server/database integration must pass');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
