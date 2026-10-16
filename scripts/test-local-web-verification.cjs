'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { localVerificationSentryOptions } = require('./local-web-verification.cjs');

test('ordinary development and production Sentry build options are unchanged', () => {
  assert.deepEqual(localVerificationSentryOptions({}), {});
  assert.deepEqual(localVerificationSentryOptions({ VERCEL: '1', VERCEL_ENV: 'production' }), {});
});
test('local verification disables telemetry, source-map upload, and remote release writes', () => {
  assert.deepEqual(localVerificationSentryOptions({ NEXT_PUBLIC_DVNT_LOCAL_BUILD_ONLY: '1' }), {
    telemetry: false, sourcemaps: { disable: true }, release: { create: false, finalize: false, setCommits: false },
  });
});
test('local-only mode fails closed on preview and production releases', () => {
  for (const env of [{ VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production' }]) {
    assert.throws(() => localVerificationSentryOptions({ ...env, NEXT_PUBLIC_DVNT_LOCAL_BUILD_ONLY: '1' }), /must never be enabled on Vercel/);
  }
});
test('browser, node and edge telemetry are disabled in the local-only artifact', () => {
  for (const file of ['apps/web/sentry.server.config.ts', 'apps/web/sentry.edge.config.ts', 'apps/web/src/instrumentation-client.ts']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(source, /Sentry\.init\(\{\s*\/\/[^\n]*\n\s*enabled: process\.env\.NEXT_PUBLIC_DVNT_LOCAL_BUILD_ONLY !== "1"/);
  }
  const payload = fs.readFileSync(path.join(__dirname, '../packages/cms/src/payload.config.ts'), 'utf8');
  assert.match(payload, /telemetry: process\.env\.NEXT_PUBLIC_DVNT_LOCAL_BUILD_ONLY !== '1'/);
  const config = fs.readFileSync(path.join(__dirname, '../apps/web/next.config.ts'), 'utf8');
  assert.match(config, /const localSentry = localVerificationSentryOptions\(process\.env\)/);
  assert.match(config, /\.\.\.localSentry,/);
  assert.match(config, /\.\.\.localSentry\.sourcemaps/);
  assert.match(config, /\.\.\.localSentry\.release/);
});
