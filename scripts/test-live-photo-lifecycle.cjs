// Actual renderer + original-resource cache lifecycle. The filesystem and iOS
// decoder bridge are mocked explicitly; this is not on-device decode evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = require('react'), { createRoot } = require('react-dom/client');
  const files = new Map(), settings = new Map(), downloads = [], nativeViews = [];
  const playing = new Set();
  const resetHandlers = [];
  let available = true;
  const fileSystem = {
    cacheDirectory: 'file:///cache/',
    async makeDirectoryAsync() {},
    async deleteAsync(uri) { for (const key of files.keys()) if (key.startsWith(uri)) files.delete(key); },
    async getInfoAsync(uri) { const bytes = files.get(uri); return { exists: !!bytes, size: bytes?.length, isDirectory: false }; },
    createDownloadResumable(uri, target) {
      let complete;
      const config = settings.get(uri) ?? {};
      const bytes = Uint8Array.from([5, 11, 39, 177, 203]);
      const download = {
        uri, target, bytes, cancelled: false,
        finish() { files.set(target, bytes.slice()); complete({ uri: target, status: config.status ?? 200 }); },
      };
      downloads.push(download);
      return {
        downloadAsync: () => new Promise(resolve => { complete = resolve; if (!config.held) download.finish(); }),
        async cancelAsync() { download.cancelled = true; if (!config.late) complete(undefined); },
      };
    },
  };
  const Native = React.forwardRef((props, ref) => {
    assert.match(props.source.photoUri, /^file:\/\/\//, 'native never receives a remote photo URL');
    assert.match(props.source.pairedVideoUri, /^file:\/\/\//, 'native never receives a remote video URL');
    const view = React.useMemo(() => ({
      props, starts: 0,
      startPlayback() { this.starts++; playing.add(this); assert.ok(playing.size <= 1, 'no overlapping native playback'); },
      stopPlayback() { playing.delete(this); },
    }), []);
    view.props = props;
    React.useImperativeHandle(ref, () => view, [view]);
    React.useEffect(() => { nativeViews.push(view); }, [view]);
    return React.createElement('div', { 'data-native': props.source.photoUri });
  });
  Native.isAvailable = () => available;
  const native = { Platform: { OS: 'ios' }, View: ({ children }) => React.createElement('div', null, children) };
  const adapters = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': native,
    'expo-image': { Image: ({ source }) => React.createElement('div', { 'data-still': source.uri }) },
    'expo-live-photo': { LivePhotoView: Native },
    'expo-file-system/legacy': fileSystem,
    '../utils/storage': { registerUserDataReset: reset => { resetHandlers.push(reset); return () => {}; } },
    './DVNTAnimatedVideoView': { DVNTAnimatedVideoView: ({ uri, isPlaying }) =>
      React.createElement('div', { 'data-fallback': uri, 'data-playing': String(isPlaying) }) },
  };
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = new Module(filename, module); modules.set(filename, mod);
    mod.require = name => {
      if (name in adapters) return adapters[name];
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(filename), name);
        return load(['.ts', '.tsx'].map(ext => base + ext).find(file => fs.existsSync(file)));
      }
      throw new Error(`Unexpected import ${name}`);
    };
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, filename);
    return mod.exports;
  }
  const filename = path.resolve(__dirname, '../packages/app/components/media/DVNTLivePhotoView.tsx');
  const { DVNTLivePhotoView } = load(filename);
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const render = async (photoUri, videoUri, isPlaying = true) => React.act(async () => root.render(
    React.createElement(DVNTLivePhotoView, { photoUri, videoUri, width: 100, height: 100, isPlaying }),
  ));
  const finish = async download => React.act(async () => download.finish());
  const current = () => nativeViews.at(-1);

  await render('file:///picker/first.heic', 'file:///picker/first.mov');
  assert.equal(downloads.length, 0, 'local originals bypass network/cache writes');
  assert.equal(current().starts, 0);
  await React.act(async () => current().props.onLoadComplete());
  assert.equal(current().starts, 1);
  const localView = current(), localSource = current().props.source;
  await render('file:///picker/first.heic', 'file:///picker/first.mov', false);
  assert.equal(playing.size, 0);
  assert.strictEqual(current().props.source, localSource, 'playback toggles retain native source identity');
  await render('file:///picker/first.heic', 'file:///picker/first.mov');
  assert.equal(localView.starts, 2);

  const photo = 'https://cdn/remote.heic', video = 'https://cdn/remote.mov';
  settings.set(photo, { held: true }); settings.set(video, { held: true });
  await render(photo, video, false);
  assert.equal(downloads.length, 0, 'unselected remote slide does not start IO');
  assert.ok(node.querySelector('[data-still]'));
  await render(photo, video);
  assert.equal(downloads.length, 1);
  assert.equal(node.querySelector('[data-native]'), null);
  assert.equal(node.querySelector('[data-fallback]'), null, 'no transient fallback plays behind pending native preparation');
  await finish(downloads[0]);
  assert.equal(downloads.length, 2);
  assert.equal(node.querySelector('[data-native]'), null, 'both originals are required before mounting native');
  await finish(downloads[1]);
  assert.ok(node.querySelector('[data-native]'));
  assert.deepEqual(files.get(current().props.source.photoUri), downloads[0].bytes);
  assert.deepEqual(files.get(current().props.source.pairedVideoUri), downloads[1].bytes);
  const remoteView = current();
  assert.equal(remoteView.starts, 0, 'prepared files still wait for native load completion');
  await render(photo, video, false);
  await React.act(async () => remoteView.props.onLoadComplete());
  assert.equal(remoteView.starts, 0, 'late native load cannot start an inactive slide');
  await render(photo, video);
  assert.equal(remoteView.starts, 1);

  const stalePhoto = 'https://cdn/stale.heic'; settings.set(stalePhoto, { held: true, late: true });
  await render(stalePhoto, 'https://cdn/stale.mov');
  const staleDownload = downloads.at(-1);
  const staleCallback = remoteView.props.onLoadComplete;
  await render('file:///picker/replacement.heic', 'file:///picker/replacement.mov');
  assert.equal(staleDownload.cancelled, true, 'source replacement cancels pending original download');
  const replacement = current();
  await React.act(async () => staleCallback());
  assert.equal(playing.size, 0, 'obsolete native callback cannot restart an old pair');
  await finish(staleDownload);
  assert.equal(files.has(staleDownload.target), false, 'late write is deleted after cancellation');
  assert.strictEqual(current(), replacement, 'late preparation cannot replace the current native pair');

  const badPhoto = 'https://cdn/error.heic'; settings.set(badPhoto, { status: 503 });
  await render(badPhoto, 'https://cdn/error.mov');
  assert.equal(node.querySelector('[data-native]'), null);
  assert.equal(node.querySelector('[data-fallback]').getAttribute('data-fallback'), 'https://cdn/error.mov');
  await render(badPhoto, 'https://cdn/error.mov', false);
  assert.equal(node.querySelector('[data-fallback]').getAttribute('data-playing'), 'false');

  const repairPhoto = 'https://cdn/repair.heic', repairVideo = 'https://cdn/repair.mov';
  await render(repairPhoto, repairVideo);
  const rejected = current(), rejectedSource = rejected.props.source;
  await React.act(async () => rejected.props.onLoadError());
  assert.equal(node.querySelector('[data-fallback]').getAttribute('data-fallback'), repairVideo,
    'native pair rejection falls back to the original remote video, not a deleted temp path');
  assert.equal(files.has(rejectedSource.photoUri), false, 'rejected cache originals are released/discarded');
  await React.act(async () => rejected.props.onLoadComplete()); assert.equal(playing.size, 0);
  await render('file:///picker/retry.heic', 'file:///picker/retry.mov');
  const count = downloads.length;
  await render(repairPhoto, repairVideo);
  assert.equal(downloads.length, count + 2, 'same URL may retry after transient native failure or repaired original');
  assert.ok(node.querySelector('[data-native]'));

  available = false;
  await render('file:///picker/no-module.heic', 'file:///picker/no-module.mov');
  assert.equal(node.querySelector('[data-fallback]').getAttribute('data-fallback'), 'file:///picker/no-module.mov');
  available = true;
  await render('file:///picker/still.heic', undefined);
  assert.ok(node.querySelector('[data-still]'));
  assert.equal(node.querySelector('[data-fallback]'), null);

  const unmountPhoto = 'https://cdn/unmount.heic'; settings.set(unmountPhoto, { held: true, late: true });
  await render(unmountPhoto, 'https://cdn/unmount.mov'); const pending = downloads.at(-1);
  await React.act(async () => root.unmount());
  assert.equal(pending.cancelled, true); assert.equal(playing.size, 0);
  await finish(pending); assert.equal(files.has(pending.target), false);
  assert.equal(resetHandlers.length, 1);
  resetHandlers[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(files.size, 0, 'account reset removes cached originals');
  window.happyDOM.abort();
  console.log('PASS actual Live Photo/cache lifecycle: local originals, deferred remote original bytes, both-file readiness, late callbacks, source/unmount cancellation and cleanup, failure fallback, same-URL retry. Native decoding is mocked.');
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
