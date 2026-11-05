// Actual shipped Connection/Reload/signals and production authorization policy.
// Only connect()'s transport boundary is replaced: no live relay or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deps = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const sdkDeps = [process.env.LYNK_SDK_DEPS, ...deps].filter(Boolean);
const resolve = name => require.resolve(name, { paths: name.startsWith('@moq/') ? sdkDeps : deps });

(async () => {
  const esbuild = require(resolve('esbuild'));
  const netRoot = path.dirname(resolve('@moq/net'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(netRoot, 'package.json'), 'utf8')).version, '0.4.3',
    'review this transport-boundary fixture before upgrading @moq/net');
  const fixture = global.__lynkRelaySdk = { sessions: [] };
  const bundle = await esbuild.build({
    stdin: { contents: `
      export { Connection } from ${JSON.stringify(path.join(netRoot, 'connection/pool.js'))};
      export { Signal } from ${JSON.stringify(resolve('@moq/signals'))};
      export { SessionError, SessionCode } from ${JSON.stringify(path.join(netRoot, 'error.js'))};
      export { createRelayAuthorization } from ${JSON.stringify(path.join(__dirname, '../packages/app/lib/lynk/moq-relay-authorization.ts'))};
    `, resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'transport-only', setup(build) {
      build.onLoad({ filter: /[/\\]connection[/\\]connect\.js$/ }, ({ path: filename }) => ({
        resolveDir: path.dirname(filename),
        contents: `
          import { Once, Signal } from '@moq/signals';
          import { registerWire } from '../wire.js';
          export function certificateHash() { throw new Error('certificate lookup is outside this fixture'); }
          export async function connect(props) {
            props.signal?.throwIfAborted();
            const closed = new Once();
            const session = {
              url: props.url.href, closed, probe: new Signal(undefined), transport: 'webtransport',
              closeCalls: 0, stats: async () => undefined,
              close(cause = null) { this.closeCalls++; if (closed.peek() === undefined) closed.set(cause); },
            };
            registerWire(session, { goaway: new Once() });
            globalThis.__lynkRelaySdk.sessions.push(session);
            return session;
          }
        `,
      }));
    } }],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports);
  const { Connection, Signal, SessionError, SessionCode, createRelayAuthorization } = mod.exports;
  const tick = () => new Promise(resolve => setTimeout(resolve, 5));
  const settle = async (check, description) => {
    for (let i = 0; i < 100; i++) { if (check()) return; await tick(); }
    assert.fail(description);
  };
  const wires = [];
  const controllers = [];
  const open = () => {
    const url = new Signal(undefined);
    const connection = new Connection({ url, share: false, linger: 0, delay: { timeout: 0 } });
    wires.push(connection);
    return { url, connection };
  };
  let now = Date.parse('2026-11-05T12:00:00Z');
  const grant = n => ({
    relayUrl: `https://relay.example.invalid/application?jwt=fixture-${n}`,
    expiresAt: new Date(now + 120_000).toISOString(),
    intent: 'subscribe', fishjamId: 'application', namespace: 'lynk/room',
    path: 'lynk/room', peerId: 'alice', role: 'participant',
  });
  try {
    // Establish the failure against the real SDK, rather than assuming URL semantics.
    const baseline = open();
    for (let i = 0; i < 4; i++) {
      const before = fixture.sessions.length;
      const previous = fixture.sessions.at(-1);
      baseline.url.set(new URL(grant(i).relayUrl));
      await settle(() => fixture.sessions.length === before + 1 && baseline.connection.status.peek() === 'connected', 'baseline URL did not redial');
      if (i) assert.notEqual(previous.closed.peek(), undefined, 'each renewal closes the old baseline wire');
    }
    baseline.connection.close();
    await tick();

    const retained = open();
    let urlWrites = 0;
    const policy = createRelayAuthorization({
      status: retained.connection.status, error: retained.connection.error, now: () => now,
      setUrl: next => { urlWrites++; retained.url.set(next); },
    });
    controllers.push(policy);
    const start = fixture.sessions.length;
    policy.authorize(grant(100), 'room/account-epoch-1');
    await settle(() => retained.connection.status.peek() === 'connected', 'authorized connection never established');
    const initial = fixture.sessions.at(-1);
    const origin = retained.connection.origin.peek();
    for (let i = 1; i <= 12; i++) {
      now += 60_000;
      policy.authorize(grant(100 + i), 'room/account-epoch-1');
      await tick();
      assert.equal(fixture.sessions.length, start + 1, 'valid renewal must not redial a healthy wire');
      assert.equal(initial.closed.peek(), undefined, 'healthy transport remains open across original JWT expiry');
      assert.equal(retained.connection.origin.peek(), origin, 'same origin remains available');
    }
    assert.equal(urlWrites, 1);

    // Provider-style unauthorized close of the original wire must use the latest grant.
    initial.close(new SessionError(SessionCode.Unauthorized, { reason: 'fixture old credential expired' }));
    await settle(() => fixture.sessions.length === start + 2 && retained.connection.status.peek() === 'connected', 'actual SDK drop did not install freshest grant');
    assert.equal(fixture.sessions.at(-1).url, grant(112).relayUrl);
    assert.equal(urlWrites, 2, 'a drop installs the newest credential once');
    await tick();
    assert.equal(fixture.sessions.length, start + 2);

    const recovered = fixture.sessions.at(-1);
    policy.authorize(null, 'room/account-epoch-1');
    await settle(() => recovered.closed.peek() !== undefined && retained.connection.origin.peek() === undefined, 'denied/null authorization did not close wire');
    const deniedCount = fixture.sessions.length;
    await tick();
    assert.equal(fixture.sessions.length, deniedCount, 'revoked session cannot reconnect');

    policy.authorize(grant(200), 'room/account-epoch-1');
    await settle(() => retained.connection.status.peek() === 'connected', 'new valid authority cannot recover');
    const expiring = fixture.sessions.at(-1);
    const expiryCount = fixture.sessions.length;
    now += 120_001; // Simulate a suspended tab whose token-expiry timer has not run.
    expiring.close();
    await settle(() => retained.url.peek() === undefined, 'expired delayed grant remained available for reconnect');
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(fixture.sessions.length, expiryCount, 'expired grant must not redial after SDK backoff');
    policy.close();
    assert.equal(retained.url.peek(), undefined);
    console.log('PASS actual @moq/net 0.4.3 Connection/Reload + production relay authorization: baseline renewal disconnects, 12 healthy renewals retain wire, real Unauthorized drop uses latest grant once, null revocation closes wire, delayed expired grant cannot reconnect. Only connect() transport is mocked; provider expiry policy, announcements, codecs and audible continuity are not verified.');
  } finally {
    for (const controller of controllers) controller.close();
    for (const wire of wires) wire.close();
    await tick();
    delete global.__lynkRelaySdk;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
