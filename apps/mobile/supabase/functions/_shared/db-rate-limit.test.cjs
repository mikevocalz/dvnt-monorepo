const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Same loader as brand-outbox.test.cjs: transpile, run in a vm context.
function load(file) {
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/${file}`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, console: { log() {}, warn() {}, error() {} } });
  return exports;
}

const { consumeDbRateLimit } = load('db-rate-limit.ts');

// A stand-in for check_rate_limit/record_rate_limit over video_rate_limits:
// it keeps rows in an array, so two "isolates" (two calls to this module)
// share one count the way two edge instances share the table.
function fakeDb({ checkError = null, recordError = null, checkData } = {}) {
  const rows = [];
  const calls = [];
  return {
    rows,
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'check_rate_limit') {
        if (checkError) return { data: null, error: checkError };
        if (checkData !== undefined) return { data: checkData, error: null };
        const n = rows.filter((r) => r.user_id === args.p_user_id && r.action === args.p_action).length;
        return { data: n < args.p_max_attempts, error: null };
      }
      if (name === 'record_rate_limit') {
        if (recordError) return { data: null, error: recordError };
        rows.push({ user_id: args.p_user_id, action: args.p_action });
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

test('allows 40 checks per IP per minute and refuses the 41st', async () => {
  const db = fakeDb();
  for (let i = 0; i < 40; i++) {
    assert.equal((await consumeDbRateLimit(db, 'ip:203.0.113.9', 'checkout-username', 40, 60)).allowed, true, `check ${i + 1}`);
  }
  assert.equal((await consumeDbRateLimit(db, 'ip:203.0.113.9', 'checkout-username', 40, 60)).allowed, false);
  // Another IP has its own count.
  assert.equal((await consumeDbRateLimit(db, 'ip:198.51.100.1', 'checkout-username', 40, 60)).allowed, true);
  // A refused call is not recorded, so hammering does not extend the lockout.
  assert.equal(db.rows.filter((r) => r.user_id === 'ip:203.0.113.9').length, 40);
  const [, checkArgs] = db.calls[0];
  assert.deepEqual(JSON.parse(JSON.stringify(checkArgs)), {
    p_user_id: 'ip:203.0.113.9', p_action: 'checkout-username', p_room_id: null,
    p_max_attempts: 40, p_window_seconds: 60,
  });
});

test('fails closed when the check errors or answers anything but true', async () => {
  const errored = await consumeDbRateLimit(fakeDb({ checkError: { message: 'down' } }), 'ip:x', 'a', 40, 60);
  assert.equal(errored.allowed, false);
  assert.equal(errored.error, 'down');
  assert.equal((await consumeDbRateLimit(fakeDb({ checkData: null }), 'ip:x', 'a', 40, 60)).allowed, false);
  const unrecorded = await consumeDbRateLimit(fakeDb({ recordError: { message: 'ro' } }), 'ip:x', 'a', 40, 60);
  assert.equal(unrecorded.allowed, false);
});

test('checkout-username uses the database limit, not the per-isolate map', () => {
  const src = fs.readFileSync(`${__dirname}/../checkout-username/index.ts`, 'utf8');
  assert.ok(!/from "\.\.\/_shared\/rate-limit\.ts"/.test(src), 'in-memory limiter still imported');
  assert.match(src, /consumeDbRateLimit\(supabase, `ip:\$\{ip\}`, CHECKOUT_USERNAME_ACTION, 40, 60\)/);
  // The limit runs before the body is parsed or the name is looked up.
  assert.ok(src.indexOf('consumeDbRateLimit(') < src.indexOf('checkout_username_available'));
  assert.match(src, /if \(rl\.error\) \{[\s\S]{0,300}503\)/);
});
