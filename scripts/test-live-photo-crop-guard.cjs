// Actual crop screen with OS UI/storage and bitmap boundary adapted; no decoding claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, adapters = {}) {
  const filename = path.join(root, relative);
  const mod = new Module(filename, module);
  mod.require = name => {
    if (name in adapters) return adapters[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unmocked dependency: ${name}`);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return mod.exports;
}
(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const Host = ({ children }) => React.createElement('div', null, children);
  const original = load('packages/app/lib/media/live-photo-original.ts');
  const edit = load('packages/app/features/crop/edit-state.ts');
  const cropExport = load('packages/app/lib/media/crop-export.ts');
  let pending, latest, back, dimensions, exports, header;
  const draftStore = { getState: () => ({ selectedMedia: latest, setSelectedMedia: value => { latest = value; } }) };
  const Screen = load('packages/app/features/routes/screens/(protected)/crop-preview.tsx', {
    'react-native': { View: Host, Text: Host, Pressable: Host, ActivityIndicator: Host, ScrollView: Host, useWindowDimensions: () => ({ width: 300 }), StyleSheet: { create: x => x } },
    'expo-router': { useRouter: () => ({ back: () => back++ }), useNavigation: () => ({}) },
    '@dvnt/app/lib/hooks/use-safe-header': { useSafeHeader: value => { header = value; } },
    '@dvnt/app/components/error-boundary': { ErrorBoundary: Host },
    'expo-image': { Image: Host },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'lucide-react-native': { ArrowLeft: Host, Check: Host, RotateCcw: Host },
    '@dvnt/app/lib/hooks': { useColorScheme: () => ({ colors: {} }) },
    '@dvnt/app/features/crop/ImageCropView': { ImageCropView: Host },
    '@dvnt/app/features/crop/crop-utils': { CROP_ASPECT_RATIO: 0.8, consumePendingCrop: () => ({ media: pending }), getImageDimensions: async uri => { dimensions.push(uri); return { width: 300, height: 400, normalizedUri: uri }; } },
    '@dvnt/app/lib/stores/create-post-store': { useCreatePostStore: draftStore },
    '@dvnt/app/lib/media/crop-export': cropExport,
    '@dvnt/app/features/crop/edit-state': edit,
    '@dvnt/app/features/crop/EditToolbar': { EditToolbar: Host },
    '@dvnt/app/features/crop/export-pipeline': { exportImage: async state => { exports.push(state.sourceUri); return { uri: 'file:///crop.jpg', width: 300, height: 400 }; } },
    '@dvnt/app/components/layout/detail-header': { DetailBackButton: Host },
    '@dvnt/app/lib/media/live-photo-original': original,
  }).default;
  const live = { id: 'live', type: 'image', kind: 'livePhoto', uri: 'file:///live.heic', pairedVideoUri: 'file:///live.mov' };
  const gif = { id: 'gif', type: 'image', kind: 'gif', uri: 'file:///animated.gif' };
  const still = { id: 'still', type: 'image', kind: 'image', uri: 'file:///still.jpg' };
  for (const media of [[live, gif], [live, still, gif]]) {
    pending = media; latest = media; back = 0; dimensions = []; exports = [];
    const container = document.createElement('div'); document.body.appendChild(container);
    const mounted = createRoot(container);
    await React.act(async () => mounted.render(React.createElement(Screen)));
    if (media.length === 2) {
      assert.equal(back, 1);
      assert.deepEqual(dimensions, []);
      assert.deepEqual(exports, []);
    } else {
      assert.deepEqual(dimensions, [still.uri], 'animated originals must never reach EXIF/bitmap normalization');
      const headerButtons = header.headerRight().props.children;
      const video = { id: 'video', type: 'video', kind: 'video', uri: 'file:///new-video.mov' };
      latest = [video, gif, still, live]; // a newer draft order after the editor mounted
      await React.act(async () => headerButtons[1].props.onPress());
      assert.deepEqual(latest.map(item => item.id), ['video', 'gif', 'still', 'live']);
      assert.equal(latest[0], video);
      assert.equal(latest[1], gif);
      assert.equal(latest[2].uri, 'file:///crop.jpg');
      assert.equal(latest[2].cropExportMimeType, 'image/jpeg');
      assert.equal(latest[3], live);
      assert.deepEqual(exports, [still.uri], 'only the ordinary still can be exported');
    }
    await React.act(async () => mounted.unmount()); container.remove();
  }
  console.log('PASS production crop screen: animated-only selection exits untouched; mixed selection exports only the still and preserves the latest carousel order.');
})().catch(error => { console.error(error); process.exitCode = 1; });
