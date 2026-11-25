const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// brand-outbox.test.cjs's loader, plus a require() for sibling ./x.ts imports.
function load(file, cache = {}) {
  if (cache[file]) return cache[file];
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/${file}`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  cache[file] = exports;
  vm.runInNewContext(source, {
    exports,
    require: (spec) => load(spec.replace(/^\.\//, ''), cache),
    console: { log() {}, warn() {}, error() {} },
  });
  return exports;
}

const { requireMemberPhone, requireWebMemberTicketContact } = load('member-phone.ts');
const fields = load('checkout-profile-fields.ts');
const plain = (v) => JSON.parse(JSON.stringify(v));

function db(reply) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, plain(args)]); return reply(args); } };
}

test('a buyer with no phone on file is refused with the code the app looks for', async () => {
  const d = db(() => ({ data: { ok: false, error: 'phone_required' }, error: null }));
  const r = await requireMemberPhone(d, 'auth_1', undefined, '[t]');
  assert.deepEqual(plain(r), {
    ok: false, status: 400, code: fields.PHONE_REQUIRED_CODE, message: fields.PHONE_REQUIRED_MESSAGE,
  });
  assert.deepEqual(d.calls, [['ensure_member_phone', { p_auth_id: 'auth_1', p_phone_e164: null }]]);
});

test('a typed number is normalized before it reaches the database', async () => {
  const d = db(() => ({ data: { ok: true, status: 'stored' }, error: null }));
  assert.equal((await requireMemberPhone(d, 'auth_1', '(212) 555-0142', '[t]')).ok, true);
  assert.deepEqual(d.calls[0][1], { p_auth_id: 'auth_1', p_phone_e164: '+12125550142' });
});

test('a malformed number is refused without a database call', async () => {
  const d = db(() => { throw new Error('should not be called'); });
  const r = await requireMemberPhone(d, 'auth_1', '555', '[t]');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_phone');
  assert.equal(d.calls.length, 0);
});

test('fails closed when the check errors or refuses', async () => {
  const errored = await requireMemberPhone(db(() => ({ data: null, error: { message: 'down' } })), 'a', null, '[t]');
  assert.equal(errored.ok, false);
  assert.equal(errored.status, 503);
  const conflict = await requireMemberPhone(db(() => ({ data: { ok: false, error: 'conflict' } })), 'a', '+12125550142', '[t]');
  assert.equal(conflict.ok, false);
  assert.equal(conflict.status, 409);
  const garbage = await requireMemberPhone(db(() => ({ data: null, error: null })), 'a', '+12125550142', '[t]');
  assert.equal(garbage.ok, false);
});

// Every signed-in purchase rail checks the phone before it holds inventory,
// issues a free ticket or calls Stripe.
test('every signed-in purchase rail calls requireMemberPhone before money or inventory moves', () => {
  for (const [fn, firstEffect] of [
    ['create-payment-intent', '// This rail inserts ticket_holds directly'],
    ['cart-checkout', 'stripeRequest("/payment_intents"'],
    ['ticket-checkout', '// This rail inserts ticket_holds directly'],
  ]) {
    const src = fs.readFileSync(`${__dirname}/../${fn}/index.ts`, 'utf8');
    const at = Math.max(src.indexOf('await requireMemberPhone('),
      src.indexOf('await (webContact ? requireWebMemberTicketContact : requireMemberPhone)('));
    if (fn !== 'cart-checkout') {
      assert.ok(src.indexOf('await requireWebMemberTicketContact(') > 0);
      assert.ok(src.indexOf('await requireWebMemberTicketContact(') < src.indexOf('const replayRequest ='),
        'v1 acknowledgments validate the member before reaching either success route');
    }
    assert.ok(at > 0, `${fn} does not check the phone`);
    const effect = src.indexOf(firstEffect);
    assert.ok(effect > at, `${fn}: phone check must run before ${firstEffect}`);
    assert.match(src, /code: memberPhone\.code/);
  }
});

test('web checks only the authenticated member canonical identity and writes only the normalized private phone', async () => {
  const reads = [];
  const d = db(() => ({ data: { ok: true }, error: null }));
  let username = "";
  d.from = (table) => ({
    select: (field) => ({ eq: (key, id) => ({ maybeSingle: async () => {
      reads.push([table, field, key, id]);
      return {data:table === "user" ? {email:"member@example.test"} : {username},error:null};
    } }) }),
  });
  assert.equal((await requireWebMemberTicketContact(d,"verified-id","+12125550123","fixture")).code,"ticket_account_required");
  assert.equal(d.calls.length,0);
  username = "existing_member";
  assert.equal((await requireWebMemberTicketContact(d,"verified-id","2125550123","fixture")).ok,true);
  assert.deepEqual(reads.slice(-2),[["user","email","id","verified-id"],["users","username","auth_id","verified-id"]]);
  assert.deepEqual(d.calls,[["ensure_member_phone",{p_auth_id:"verified-id",p_phone_e164:"+12125550123"}]]);
});
