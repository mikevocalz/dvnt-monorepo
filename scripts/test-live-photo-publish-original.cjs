// Execute the production publish hook; only storage/network/React hooks are adapted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let descriptor;
function load(relative, adapters = {}) {
  const filename = path.join(root, relative);
  const mod = new Module(filename, module);
  mod.require = name => {
    if (name in adapters) return adapters[name];
    throw new Error(`Unmocked dependency: ${name}`);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const original = load('packages/app/lib/media/live-photo-original.ts');
const hook = load('packages/app/lib/hooks/use-publish-post.ts', {
  react: { useCallback: fn => fn, useEffect: () => {}, useMemo: fn => fn() },
  'react-native': { Platform: { OS: 'ios' } },
  '@dvnt/app/lib/hooks/use-posts': { useCreatePost: () => ({ mutateAsync: () => { throw Error('No writes'); } }) },
  '@dvnt/app/lib/hooks/use-media-upload': { useMediaUpload: () => ({ uploadMultiple: () => { throw Error('No uploads'); } }) },
  '@dvnt/app/lib/stores/auth-store': { useAuthStore: { getState: () => ({ user: { id: 'owner' } }) } },
  '@dvnt/app/lib/posts/publish-queue': { postPublishQueue: { configure() {}, enqueue(_owner, _label, _task, input) { descriptor = input; return input; } } },
  '@dvnt/app/lib/posts/publish-task': { createPublishTask: () => () => {} },
  '@dvnt/app/lib/api/post-tags': { postTagsApi: {} },
  '@dvnt/app/lib/posts/text-post': { TEXT_POST_MAX_LENGTH: 2200 },
  '@dvnt/app/lib/media/persist-local-selection': {},
  '@dvnt/app/lib/utils/storage': { storage: {} },
  '@dvnt/app/lib/posts/first-post-event': {},
  '@dvnt/app/lib/stores/first-post-offer-store': {},
  '@dvnt/app/lib/media/video-pick-policy': {},
  '@dvnt/app/lib/media/live-photo-original': original,
  '@dvnt/app/lib/posts/post-caption': { validatePostCaption: () => ({ valid: true }) },
});
const publish = hook.usePublishPost();
const pair = { uri: 'file:///crop.jpg', originalUri: 'file:///original.heic', editedUri: 'file:///crop.jpg', editorOpened: true, type: 'image', kind: 'livePhoto', mimeType: 'image/heic', pairedVideoUri: 'file:///original.mov' };
const still = { type: 'image', kind: 'image', uri: 'file:///still.jpg', editedUri: 'file:///still-crop.jpg', editorOpened: true };
const draft = { postKind: 'media', caption: 'Motion', tags: [], textSlides: [], selectedMedia: [pair, still, { ...pair, uri: 'file:///second-crop.jpg', originalUri: 'file:///second.heic', pairedVideoUri: 'file:///second.mov' }], placedTags: [] };
publish(draft);
assert.equal(descriptor.files[0].uri, pair.originalUri);
assert.equal(descriptor.files[0].pairedVideoUri, pair.pairedVideoUri);
assert.equal(descriptor.files[0].mimeType, 'image/heic');
assert.equal(descriptor.files[0].kind, 'livePhoto');
assert.deepEqual(descriptor.files.map(file => file.uri), ['file:///original.heic', 'file:///still-crop.jpg', 'file:///second.heic']);
assert.deepEqual(descriptor.files.map(file => file.pairedVideoUri), ['file:///original.mov', undefined, 'file:///second.mov']);
descriptor = undefined;
assert.throws(() => publish({ ...draft, selectedMedia: [{ ...pair, originalUri: undefined }] }), /original Live Photo is missing/);
assert.equal(descriptor, undefined, 'damaged pair must not reach the queue');
console.log('PASS production publish hook: legacy crop restores original pair, missing original rejects before enqueue.');
const handoffUpload = {ownerId:'owner', type:'image', url:'https://cdn.example/original.jpg',livePhotoVideoUrl:'https://cdn.example/original.mov',mimeType:'image/jpeg'};
const remotePair = {uri:handoffUpload.url,originalUri:handoffUpload.url,pairedVideoUri:handoffUpload.livePhotoVideoUrl,type:'image',kind:'livePhoto',mimeType:'image/jpeg',handoffUpload};
publish({...draft,selectedMedia:[still,remotePair]});
assert.equal(descriptor.uploaded[0],null);
assert.deepEqual(descriptor.uploaded[1],{type:'image',url:handoffUpload.url,livePhotoVideoUrl:handoffUpload.livePhotoVideoUrl,mimeType:'image/jpeg'});
descriptor=undefined;
assert.throws(()=>publish({...draft,selectedMedia:[{...remotePair,handoffUpload:{...handoffUpload,ownerId:'other'}}]}),/another account/);
assert.equal(descriptor,undefined);
console.log('PASS production publish hook: same-owner handoff pair reuses uploaded URLs; cross-account pair rejected before enqueue.');
