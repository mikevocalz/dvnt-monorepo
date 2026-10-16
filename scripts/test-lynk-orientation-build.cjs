const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { checkBrowserBundle, checkInstalledPublisher, withOrientationCache } = require('./lynk-orientation-build.cjs');
const root = path.resolve(__dirname, '..');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lynk-orientation-build-'));
const markers = ['Video orientation normalization needs a 2D canvas', 'Video capture needs a 2D canvas', 'Video element has no current frame'];
const publisherWarning = 'Using MediaStreamTrackProcessor polyfill; performance might suffer.';

test('production guard rejects absent or unpatched SDK and accepts a patched client chunk', () => {
  const dir = temp();
  assert.throws(() => checkBrowserBundle(dir), /No Lynk publisher/);
  fs.writeFileSync(path.join(dir, 'publisher.js'), JSON.stringify(publisherWarning));
  assert.throws(() => checkBrowserBundle(dir), /missing Lynk orientation correction/);
  fs.writeFileSync(path.join(dir, 'publisher.js'), [publisherWarning, ...markers].map(s => JSON.stringify(s)).join(';'));
  assert.equal(checkBrowserBundle(dir).length, 1);
  fs.writeFileSync(path.join(dir, 'stale-duplicate.js'), JSON.stringify(publisherWarning));
  assert.throws(() => checkBrowserBundle(dir), /stale-duplicate/);
});

test('cache binding preserves Next options and changes for a patch-only edit', () => {
  const config = { cache: { type: 'filesystem', version: 'next-original', buildDependencies: { config: ['/next/config.ts'] } } };
  withOrientationCache(config, { hash: 'one', patchFile: '/repo/orientation.patch' });
  assert.equal(config.cache.version, 'next-original|lynk-orientation:one');
  assert.deepEqual(config.cache.buildDependencies.config, ['/next/config.ts']);
  assert.equal(config.cache.buildDependencies.lynkOrientation[0], '/repo/orientation.patch');
  const next = { cache: { type: 'filesystem', version: 'next-original' } };
  withOrientationCache(next, { hash: 'two', patchFile: '/repo/orientation.patch' });
  assert.notEqual(config.cache.version, next.cache.version);
  assert.equal(withOrientationCache({ cache: false }, {}).cache, false);
});

test('installed byte gate checks capture call sites and exact helper against the committed patch', () => {
  const dir = temp(); const pkg = path.join(dir, 'node_modules/@moq/publish');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@moq/publish', version: '0.5.2', main: 'index.js' }));
  fs.writeFileSync(path.join(pkg, 'index.js'), 'import "./encoder-CjcsUSCu.js";');
  fs.writeFileSync(path.join(pkg, 'encoder-CjcsUSCu.js'), 'import "./video-B0t1PcDc.js";');
  const patch = fs.readFileSync(path.join(root, 'pnpm-patches/@moq__publish@0.5.2.patch'), 'utf8');
  for (const file of patch.split(/^diff --git /m).slice(1)) {
    const name = /^\+\+\+ b\/(.+)$/m.exec(file)[1];
    const source = file.split(/^@@ [^\n]+\n/m).slice(1).map(hunk => hunk.split('\n').filter(line => line.startsWith('+') || line.startsWith(' ')).map(line => line.slice(1)).join('\n')).join('\n');
    fs.mkdirSync(path.dirname(path.join(pkg, name)), { recursive: true }); fs.writeFileSync(path.join(pkg, name), source);
  }
  const importer = path.join(dir, 'package.json'); fs.writeFileSync(importer, '{}');
  assert.match(checkInstalledPublisher(root, importer).hash, /^[a-f0-9]{64}$/);
  const sourceFile = path.join(pkg, 'video-B0t1PcDc.js');
  const source = fs.readFileSync(sourceFile, 'utf8');
  fs.writeFileSync(sourceFile, source.replace('createVideoElementProcessor(t)', 'new ReadableStream()'));
  assert.throws(() => checkInstalledPublisher(root, importer), /missing the Lynk orientation patch/);
  fs.writeFileSync(sourceFile, source);
  fs.writeFileSync(path.join(pkg, 'video/normalize-orientation.js'), '// stale helper');
  assert.throws(() => checkInstalledPublisher(root, importer), /missing the Lynk orientation patch/);
});

test('warm webpack cache must not preserve same-version unpatched hoisted dependency', async () => {
  const deps = path.resolve(process.env.LYNK_PROBE_DEPS || root);
  const webpack = require(require.resolve('webpack', { paths: [deps] }));
  const dir = temp(); const pkg = path.join(dir, 'node_modules/orientation-package');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'orientation-package', version: '0.5.2', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'entry.js'), 'console.log(require("orientation-package"));');
  const source = path.join(pkg, 'index.js');
  const patchFile = path.join(dir, 'orientation.patch');
  fs.writeFileSync(patchFile, 'patch revision one');
  const build = (hash) => new Promise((resolve, reject) => {
    const config = { mode: 'production', context: dir, entry: './entry.js',
      output: { path: path.join(dir, 'dist'), filename: 'bundle.js' },
      cache: { type: 'filesystem', cacheDirectory: path.join(dir, 'cache') },
      snapshot: { managedPaths: [path.join(dir, 'node_modules')], module: { timestamp: true }, resolve: { timestamp: true } } };
    if (hash) withOrientationCache(config, { hash, patchFile });
    const compiler = webpack(config);
    compiler.run((error, stats) => {
      if (error || stats.hasErrors()) { compiler.close(() => reject(error || new Error(stats.toString()))); return; }
      compiler.close(error => error ? reject(error) : resolve(fs.readFileSync(path.join(dir, 'dist/bundle.js'), 'utf8')));
    });
  });
  fs.writeFileSync(source, 'module.exports="UNPATCHED";');
  assert.match(await build(), /UNPATCHED/);
  fs.writeFileSync(source, 'module.exports="PATCHED";');
  // This counterfactual reproduces the old production configuration's bug.
  assert.match(await build(), /UNPATCHED/, 'baseline should reproduce managed-path cache reuse');
  // The production fix discards that stale cache even when package version and
  // hoisted pathname have not changed.
  assert.match(await build('revision-one'), /PATCHED/);
  fs.writeFileSync(source, 'module.exports="PATCHED_AGAIN";');
  fs.writeFileSync(patchFile, 'patch revision two');
  assert.match(await build('revision-two'), /PATCHED_AGAIN/);
});

test('web builds and Vercel patch-only changes cannot bypass the guards', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/package.json'), 'utf8'));
  assert.match(manifest.scripts.build, /^node .*lynk-orientation-build\.cjs && tsc/);
  assert.match(manifest.scripts.build, /next build --webpack && node .*lynk-orientation-build\.cjs --bundle$/);
  assert.match(fs.readFileSync(path.join(root, 'apps/web/next.config.ts'), 'utf8'), /withOrientationCache\(config, checkInstalledPublisher\(\)\)/);
  assert.match(JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).ignoreCommand, /:\/pnpm-patches/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'packages/app/package.json'), 'utf8')).dependencies['@moq/publish'], '0.5.2');
  assert.match(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'), /'@moq\/publish':\n        specifier: 0\.5\.2\n/);
});
