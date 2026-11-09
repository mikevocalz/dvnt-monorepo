// Execute the actual auth edge configuration with Better Auth 1.6.26 routes.
// Only DB, provider identity and outbound email delivery are synthetic boundaries.
// This proves current source behavior, not the deployed auth bundle or client versions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { betterAuth } = require('better-auth');
const { memoryAdapter } = require('better-auth/adapters/memory');
const origin = 'http://localhost:3000';
async function fixture() {
  const db = { user: [], account: [], session: [], verification: [] }, sent = [], magic = [];
  const exports = {};
  const source = fs.readFileSync(`${__dirname}/../auth/index.ts`, 'utf8') + '\nexports.loadAuth = getAuth;';
  class Pool {
    async connect() { return { query: async () => ({ rows: [{ ok: 1 }] }), release() {} }; }
    async query() { return { rows: [] }; }
  }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, URL, Request, Response, console: { log() {}, error() {}, warn() {} },
    Deno: { env: { get: name => ({ SUPABASE_URL: origin, BETTER_AUTH_SECRET: 'synthetic-test-secret-not-for-production' }[name] || '') }, serve() {} },
    require(name) {
      if (name === 'npm:better-auth@1.6.26') return { betterAuth(options) {
        assert.equal(options.emailAndPassword.requireEmailVerification, false);
        assert.equal(options.user.additionalFields.emailVerified, undefined);
        assert.equal(options.user.changeEmail, undefined);
        return betterAuth({ ...options, database: memoryAdapter(db), logger: { disabled: true },
          emailVerification: { ...options.emailVerification, sendVerificationEmail: async value => { sent.push(value); } },
        });
      } };
      if (name === 'npm:pg@8.13.1') return { Pool };
      if (name.startsWith('npm:')) return require(name.slice(4).replace('@1.6.26', ''));
      if (name.endsWith('/email/templates.ts')) return { welcome: () => ({ subject: '', html: '' }), magicLinkEmail: url => { magic.push(url); return { subject: '', html: '' }; } };
      if (name.endsWith('/email/wrapper.ts')) return { brandEmailWrapper: value => value };
      if (name.endsWith('/age-policy.ts')) return require('../_shared/age-policy.ts');
      if (name.endsWith('/rate-limit.ts')) return {};
      throw Error(`Unexpected auth dependency ${name}`);
    },
  });
  const auth = await exports.loadAuth();
  async function request(path, body, cookie) {
    return auth.handler(new Request(`${origin}/api/auth${path}`, {
      method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
  }
  const signup = await request('/sign-up/email', { email: 'synthetic@example.test', name: 'Synthetic',
    password: 'fixture-only-password-123', username: 'synthetic', dateOfBirth: '2000-01-01', emailVerified: true });
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.ok(cookie);
  return { db, sent, magic, request, cookie };
}
test('actual configured signup and authenticated update cannot forge email verification', async () => {
  const f = await fixture();
  assert.equal(f.db.user[0].emailVerified, false);
  for (const emailVerified of [true, 'true', 1]) {
    await f.request('/update-user', { name: 'Still synthetic', emailVerified }, f.cookie);
    assert.equal(f.db.user[0].emailVerified, false);
  }
  const changed = await f.request('/update-user', { email: 'different@example.test', emailVerified: true }, f.cookie);
  assert.equal(changed.status, 400);
  assert.equal(f.db.user[0].email, 'synthetic@example.test');
  assert.equal(f.db.user[0].emailVerified, false);
});
test('actual signed email token verifies only its bound email; email changes remain disabled', async () => {
  const f = await fixture();
  assert.equal(f.sent.length, 1);
  const bad = await f.request('/verify-email?token=invalid');
  assert.ok(bad.status >= 300);
  assert.equal(f.db.user[0].emailVerified, false);
  const verified = await f.request(`/verify-email?token=${encodeURIComponent(f.sent[0].token)}`);
  assert.equal(verified.status, 200);
  assert.equal(f.db.user[0].emailVerified, true);
  const changed = await f.request('/change-email', { newEmail: 'different@example.test' }, f.cookie);
  assert.equal(changed.status, 400);
  assert.equal(f.db.user[0].email, 'synthetic@example.test');
  assert.equal(f.db.user[0].emailVerified, true);
});

test('actual magic-link plugin verifies only a consumed server-issued token', async () => {
  const f = await fixture();
  const requested = await f.request('/sign-in/magic-link', { email: 'synthetic@example.test' });
  assert.equal(requested.status, 200); assert.equal(f.magic.length, 1);
  await f.request('/magic-link/verify?token=invalid');
  assert.equal(f.db.user[0].emailVerified, false);
  const url = new URL(f.magic[0]);
  const verified = await f.request('/magic-link/verify' + url.search);
  assert.ok(verified.status < 400);
  assert.equal(f.db.user[0].emailVerified, true);
  const replay = await f.request('/magic-link/verify' + url.search);
  assert.ok(replay.headers.get('location')?.includes('INVALID_TOKEN'));
  assert.equal(f.db.user.length, 1);
});
