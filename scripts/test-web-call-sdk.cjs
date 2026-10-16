#!/usr/bin/env node
/** Real installed Fishjam React SDK regressions; no live endpoint/device access.
 * NODE_PATH may point to an isolated dependency installation with the exact
 * apps/web Fishjam versions, React, React DOM, esbuild and jsdom.
 * jsdom exercises async SDK/state behavior, not physical-device WebRTC.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const paths = [path.join(ROOT, 'apps/web'), ROOT, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
const resolve = (name) => require.resolve(name, { paths });
const { build } = require(resolve('esbuild'));
const { JSDOM, VirtualConsole } = require(resolve('jsdom'));
// Fishjam uses import-only exports, so find its manifest rather than require it.
const roots = paths.flatMap(p => [p, path.join(p, 'node_modules')]);
const sdkRoot = roots.map(p => path.join(p, '@fishjam-cloud/react-client')).find(p => fs.existsSync(path.join(p, 'package.json')));
assert.ok(sdkRoot, 'Install the exact apps/web Fishjam SDK before running this test');
const sdk = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json')));
const appDependencies = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/package.json'))).dependencies;
const required = appDependencies['@fishjam-cloud/react-client'];
for (const name of ['@fishjam-cloud/ts-client', '@fishjam-cloud/webrtc-client']) {
  assert.equal(appDependencies[name], required, 'keep the three web Fishjam SDK packages on one exact version');
}
assert.equal(sdk.version, required, 'test the committed application SDK, not a globally installed version');
(async () => {
  const bundle = await build({
    stdin: {
      contents: `import './scripts/fixtures/web-call-sdk-client.tsx'; import './scripts/fixtures/web-call-rejoin-client.tsx';`,
      resolveDir: ROOT, sourcefile: 'web-call-regressions.ts', loader: 'ts',
    },
    plugins: [{ name: 'production-rejoin-effect', setup(builder) {
      builder.onLoad({ filter: /web-call-rejoin-client\.tsx$/ }, ({ path: filename }) => {
        const screen = fs.readFileSync(path.join(ROOT, 'packages/app/features/call/call.web.tsx'), 'utf8');
        const marker = screen.indexOf('// ── Auto-rejoin:');
        assert.ok(marker >= 0, 'production reconnect effect marker is present');
        const start = screen.indexOf('  useEffect(() => {', marker);
        const closing = '  }, [peerStatus, getStore]);';
        const end = screen.indexOf(closing, start);
        assert.ok(start >= 0 && end > start, 'extract the exact current reconnect effect');
        const contents = fs.readFileSync(filename, 'utf8').replace('/* __CALL_REJOIN_EFFECT__ */', screen.slice(start, end + closing.length));
        return { contents, loader: 'tsx', resolveDir: path.dirname(filename) };
      });
    } }],
    bundle: true, platform: 'browser', format: 'iife', write: false,
    alias: { '@fishjam-cloud/react-client': path.join(sdkRoot, 'dist/index.js') },
    nodePaths: roots, define: { 'process.env.NODE_ENV': '"development"' },
    tsconfigRaw: { compilerOptions: { target: 'ES2022', jsx: 'react-jsx' } },
  });
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => console.error(error));
  virtualConsole.on('error', (...args) => console.error(...args));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://fixture.invalid', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  });
  // React's act scheduler needs MessageChannel, which jsdom does not provide.
  dom.window.MessageChannel = class {
    port1 = { onmessage: null };
    port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) };
  };
  try {
    dom.window.eval(bundle.outputFiles[0].text);
    const sdkCases = await dom.window.runWebCallSdkTests();
    const rejoinCases = await dom.window.runWebCallRejoinTests();
    const cases = [...sdkCases, ...rejoinCases];
    console.log(JSON.stringify({ sdk: sdk.version, passed: cases.length, sdkCases: sdkCases.length, rejoinCases: rejoinCases.length, cases }, null, 2));
  } finally { dom.window.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
