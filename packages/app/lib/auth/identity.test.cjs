const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  let user = null;
  const listeners = [];
  const requests = [];
  const store = { getState: () => ({user}), subscribe: fn => {listeners.push(fn); return () => {};} };
  const fields = new Proxy({}, {get: (_, key) => key});
  const supabase = {from: () => {const query = {select: () => query, eq: () => query, single: () => new Promise(resolve => requests.push(resolve))}; return query;}};
  const exports = {};
  const context = {exports, console, setTimeout, require: name => {
    if (name.endsWith('/client')) return {supabase};
    if (name.endsWith('/db-map')) return {DB: {users: fields}};
    if (name.endsWith('/auth-store')) return {useAuthStore: store};
    if (name.endsWith('/auth-client')) return {};
    if (name.endsWith('/auth-logger')) return {logAuth: () => {}};
    throw Error(name);
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/identity.ts`, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText, context);
  return {api: exports, setUser: value => {user = value; listeners.forEach(fn => fn());}, resolve: (index, id, authId) => requests[index]({data:{id,authId,username:`person${id}`},error:null})};
}

test('cached identity is never returned after logout or another account login', async () => {
  const h = harness(); h.setUser({id:'account-a'});
  const first = h.api.getCurrentUserRow(); h.resolve(0, 7, 'account-a'); await first;
  assert.equal(h.api.getCachedUserIdInt(), 7);
  h.setUser(null);
  assert.equal(h.api.getCurrentUserIdSync(), null);
  assert.equal(await h.api.getCurrentUserRow(), null);
  h.setUser({id:'account-b'});
  assert.equal(h.api.getCachedUserIdInt(), null);
  assert.equal(h.api.getCurrentUserIdSync(), null);
});

test('late prior-account query cannot return stale identity or erase new cache', async () => {
  const h = harness(); h.setUser({id:'account-a'});
  const old = h.api.getCurrentUserRow();
  h.setUser({id:'account-b'});
  const current = h.api.getCurrentUserRow(); h.resolve(1, 8, 'account-b'); await current;
  h.resolve(0, 7, 'account-a');
  assert.equal(await old, null);
  assert.equal(h.api.getCachedUserIdInt(), 8);
});

test('A to B to A and explicit invalidation discard old lookup completions', async () => {
  const h = harness(); h.setUser({id:'account-a'});
  const old = h.api.getCurrentUserRow();
  h.setUser({id:'account-b'}); h.setUser({id:'account-a'});
  h.resolve(0, 7, 'account-a'); assert.equal(await old, null);
  const invalidated = h.api.getCurrentUserRow(); h.api.clearUserRowCache();
  const latest = h.api.getCurrentUserRow(); h.resolve(2, 7, 'account-a'); await latest;
  h.resolve(1, 7, 'account-a'); assert.equal(await invalidated, null);
  assert.equal(h.api.getCurrentUserIdSync(), 7);
  h.api.updateUserRowCache({id:999,authId:'account-b',username:'new name'});
  assert.equal(h.api.getCachedUserIdInt(), 7);
  assert.equal((await h.api.getCurrentUserRow()).authId, 'account-a');
});
