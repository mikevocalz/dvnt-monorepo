#!/usr/bin/env node
// Execute the real picker hooks with only the OS bridge mocked. A multi-pick
// must request Live Photos and preserve every pair's identity and order.
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
    throw new Error(`Unmocked dependency: ${name}`);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
(async () => {
  const { detectMediaKind } = load('packages/app/lib/media/detect-media-kind.ts');
  const pair = i => ({ assetId: `live-${i}`, uri: `file:///original-${i}.heic`, type: 'livePhoto', mimeType: 'image/heic', pairedVideoAsset: { uri: `file:///original-${i}.mov` } });
  for (const relative of ['packages/app/lib/hooks/use-media-picker.ts', 'apps/mobile/lib/hooks/use-media-picker.ts']) {
    let options;
    let selection = [pair(0), pair(1), { type: 'image', uri: 'file:///still.jpg', mimeType: 'image/jpeg' }, pair(2)];
    const hook = load(relative, {
      react: { useCallback: fn => fn, useState: initial => [initial, () => {}] },
      'react-native': { Platform: { OS: 'ios' } },
      'expo-image-picker': {
        requestCameraPermissionsAsync: async () => ({ status: 'granted' }),
        launchImageLibraryAsync: async value => { options = value; return { canceled: false, assets: selection }; },
        UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
      },
      'expo-media-library': { requestPermissionsAsync: async () => ({ status: 'granted' }) },
      'sonner-native': { toast: { error: message => { throw Error(message); } } },
      '@dvnt/app/lib/media/upload-policy': { sizeLimitForKind: () => 18 * 1024 * 1024 },
      '@dvnt/app/lib/media/detect-media-kind': { detectMediaKind },
      '@/lib/media/detect-media-kind': { detectMediaKind },
    }).useMediaPicker();
    const picked = await hook.pickFromLibrary({ maxSelection: 4 });
    assert.deepEqual(options.mediaTypes, ['images', 'videos', 'livePhotos']);
    assert.equal(options.allowsMultipleSelection, true);
    assert.equal(options.selectionLimit, 4);
    assert.deepEqual(picked.map(p => p.kind), ['livePhoto', 'livePhoto', 'image', 'livePhoto']);
    assert.deepEqual(picked.map(p => p.pairedVideoUri), ['file:///original-0.mov', 'file:///original-1.mov', undefined, 'file:///original-2.mov']);
    assert.deepEqual(picked.map(p => p.uri), selection.map(p => p.uri));
    await hook.pickFromLibrary({ mediaTypes: ['images'], allowsMultipleSelection: false });
    assert.deepEqual(options.mediaTypes, ['images'], 'explicit still-only callers remain respected');
    assert.equal(options.allowsMultipleSelection, false);
    selection = [{ type: 'image', uri: 'file:///flattened.jpg', mimeType: 'image/jpeg' }];
    const still = await hook.pickFromLibrary();
    assert.equal(still[0].kind, 'image', 'a JPEG without a paired resource cannot be invented into a Live Photo');
    assert.equal(still[0].pairedVideoUri, undefined);
  }
  console.log('PASS real picker hooks: Live Photo default, ordered array pairs, mixed still, explicit overrides, no invented motion.');
})().catch(error => { console.error(error); process.exitCode = 1; });
