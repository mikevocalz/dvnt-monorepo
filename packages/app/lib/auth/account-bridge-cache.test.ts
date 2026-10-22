import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeClaims, createAccountBridgeCache, type BridgeJwt } from './account-bridge-cache.ts';
const jwt = (subject: string, expiresAt = 10000): BridgeJwt => ({ subject, expiresAt, accessToken: `e30.${btoa(JSON.stringify({ sub: subject, exp: expiresAt, role: 'authenticated' }))}.test` });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
function harness() {
  let token: string | null = 'session-A';
  const flights: Array<{ token: string; resolve: (jwt: BridgeJwt | null) => void }> = [];
  const attached: Array<string | null> = [];
  const cache = createAccountBridgeCache({ getSessionToken: async () => token, now: () => 1000,
    mint: t => { const d = deferred<BridgeJwt | null>(); flights.push({ token: t, resolve: d.resolve }); return d.promise; },
    onToken: t => attached.push(t),
  });
  return { cache, flights, attached, setToken(t: string | null) { token = t; }, async start() { const p = cache.get(); await Promise.resolve(); return { p }; } };
}
test('same session deduplicates mint and cached calls still verify Better Auth', async () => {
  const h = harness(); const a = await h.start(); const b = await h.start();
  assert.equal(h.flights.length, 1); h.flights[0].resolve(jwt('A'));
  assert.deepEqual(await Promise.all([a.p, b.p]), [jwt('A'), jwt('A')]);
  assert.deepEqual(await h.cache.get(), jwt('A'));
  h.setToken(null); assert.equal(await h.cache.get(), null); assert.equal(h.attached.at(-1), null);
});
test('unexpired A is not reused for B even without explicit invalidation', async () => {
  const h = harness(); const a = await h.start(); h.flights[0].resolve(jwt('A')); await a.p;
  h.setToken('session-B'); const b = await h.start();
  assert.equal(h.attached.at(-1), null); assert.equal(h.flights[1].token, 'session-B');
  h.flights[1].resolve(jwt('B')); assert.deepEqual(await b.p, jwt('B'));
});
for (const oldResult of [jwt('A'), null]) test(`late ${oldResult ? 'success' : 'failure'} cannot replace B or erase its flight`, async () => {
  const h = harness(); const a = await h.start(); h.cache.invalidate(); h.setToken('session-B'); const b = await h.start();
  h.flights[0].resolve(oldResult); assert.equal(await a.p, null);
  const b2 = await h.start(); assert.equal(h.flights.length, 2);
  h.flights[1].resolve(jwt('B')); assert.deepEqual(await Promise.all([b.p,b2.p]), [jwt('B'),jwt('B')]);
  assert.equal(h.attached.at(-1), jwt('B').accessToken);
});
test('A/B/A and logout invalidate old mint and detach synchronously', async () => {
  const h = harness(); const a = await h.start(); h.cache.invalidate(); h.setToken('session-B'); h.cache.invalidate(); h.setToken('session-A');
  h.flights[0].resolve(jwt('A')); assert.equal(await a.p, null); assert.equal(h.attached.at(-1), null);
});
test('boundary during session resolution cannot mint old token', async () => {
  const token = deferred<string | null>(); let mints = 0;
  const cache = createAccountBridgeCache({ getSessionToken: () => token.promise, mint: async () => { mints++; return jwt('A'); }, onToken: () => {} });
  const old = cache.get(); cache.invalidate(); token.resolve('session-A');
  assert.equal(await old, null); assert.equal(mints, 0);
});
for (const bad of [null, {...jwt('A'), accessToken:'broken'}, {...jwt('A'), subject:'B'}, jwt('A', 1010), {...jwt('A'), expiresAt:Infinity}]) {
  test(`invalid or expired mint fails closed: ${JSON.stringify(bad)}`, async () => {
    const h = harness(); const a = await h.start(); h.flights[0].resolve(bad); assert.equal(await a.p,null); assert.equal(h.attached.at(-1),null);
  });
}
test('JWT shape requires finite expiry, subject and authenticated role', () => {
  for (const claims of [{exp:10000,role:'authenticated'},{sub:'A',role:'authenticated'},{sub:'A',exp:10000,role:'anon'}]) {
    assert.equal(bridgeClaims(`e30.${btoa(JSON.stringify(claims))}.x`),null);
  }
});
