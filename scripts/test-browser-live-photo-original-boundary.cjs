#!/usr/bin/env node
// Characterization, not a claim of working single-file Apple Live Photos.
// Runs production intake -> production upload hook -> actual pinned Expo web
// image encoder -> production server uploader -> real multipart HTTP capture.
// React/native lifecycle, auth, thumbnail generation and endpoint are adapters.
// All images/video are generated here; no personal media or external requests.
// --require-originals is an acceptance probe: it intentionally fails while the
// ordinary-image branch replaces an untouched File with its JPEG derivative.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const expoEntry = require.resolve('expo-image-manipulator');
const expoPackage = JSON.parse(fs.readFileSync(path.join(path.dirname(expoEntry), '../package.json'), 'utf8'));
const pinnedExpo = JSON.parse(fs.readFileSync(path.join(root, 'apps/mobile/package.json'), 'utf8')).dependencies['expo-image-manipulator'];
assert.equal(`~${expoPackage.version}`, pinnedExpo, 'exercise the encoder version actually pinned by this app');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-original-boundary-'));
  let browser, server;
  try {
    const stillPath = path.join(directory, 'still.jpg');
    const motionPath = path.join(directory, 'motion.mov');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=96x64:rate=1', '-frames:v', '1', '-threads', '1', stillPath]);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=96x64:rate=12', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', motionPath]);
    const still = fs.readFileSync(stillPath), motion = fs.readFileSync(motionPath);
    const sentinel = Buffer.from('SYNTHETIC-IDENTIFIER-ONLY-NOT-A-VERIFIED-APPLE-PAIR');
    // JPEG COM is deliberately just a sentinel, not asserted to be Apple's
    // MakerNote identifier format. An identifier without video is not motion.
    const comment = Buffer.alloc(4); comment.writeUInt16BE(0xfffe); comment.writeUInt16BE(sentinel.length + 2, 2);
    const metadataOnly = Buffer.concat([still.subarray(0, 2), comment, sentinel, still.subarray(2)]);
    // Arbitrary JPEG+MOV concatenation is NOT claimed to be an Apple export or
    // Android Motion Photo. It proves what happens to non-raster bytes only.
    const withTrailer = Buffer.concat([metadataOnly, motion]);
    const payloads = { still, metadataOnly, withTrailer, motion };
    const uploads = [];
    const adapters = {
      react: `export const useState = value => [value, () => {}]; export const useCallback = fn => fn;`,
      'react-native': `export const Platform = { OS: 'web' };`,
      expo: `export class SharedObject { release() {} } export class SharedRef extends SharedObject {} export class NativeModule {}`,
      'expo-modules-core': `export const registerWebModule = Module => new Module(); export const useReleasingSharedObject = create => create(); export class CodedError extends Error { constructor(code, message) { super(message); this.code = code; } }`,
      'expo-file-system/legacy': `export const cacheDirectory = null;`,
      '@dvnt/app/lib/auth-client': `export const getAuthToken = async () => 'fixture-token';`,
      '@dvnt/app/lib/media/upload-watchdog-store': `export const beginUpload = () => 'fixture'; export const settleUpload = () => {};`,
      '@dvnt/app/lib/supabase/client': `import { FunctionsClient } from '@supabase/functions-js'; export const supabase = { functions: new FunctionsClient(location.origin + '/functions/v1', { headers: { apikey: 'fixture-key' } }) };`,
      '@dvnt/app/lib/media/single-image-upload': `export const uploadSingleImage = () => { throw Error('Unrelated single upload'); };`,
      '@dvnt/app/lib/media/image-fit-deps': `export const imageFitDeps = {};`,
      '@dvnt/app/lib/media/getVideoThumbnail': `export const getVideoThumbnail = () => { throw Error('Unrelated thumbnail'); };`,
      '@dvnt/app/lib/media/image-processor': `export const generateBlurPlaceholder = async () => undefined;`,
      '@dvnt/app/lib/video-compression': `export const compressVideo = () => { throw Error('Unexpected standalone video'); }; export const validateVideo = compressVideo; export const cleanupCompressedVideo = compressVideo;`,
      '@dvnt/app/lib/video-thumbnail': `export const generateVideoThumbnail = () => { throw Error('Unexpected thumbnail'); }; export const cleanupThumbnail = generateVideoThumbnail;`,
      'expo-image-manipulator': `import { manipulateAsync as encode, SaveFormat } from 'actual-expo-image-manipulator'; export { SaveFormat }; export async function manipulateAsync(uri, actions, options) { const result = await encode(uri, actions, options); window.encoderCalls.push({uri, actions, options, result}); return result; }`,
    };
    await build({ stdin: { resolveDir: root, contents: `
      import { readBrowserMediaFiles, associateBrowserMedia, releaseUnselectedBrowserMedia } from './packages/app/features/create/browser-media-intake';
      import { useMediaUpload } from './packages/app/lib/hooks/use-media-upload';
      import { uploadToServer } from './packages/app/lib/server-upload';
      import { sizeLimitForKind } from './packages/app/lib/media/upload-policy';
      window.encoderCalls = [];
      const upload = useMediaUpload({folder:'posts'});
      const sha = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
      const file = async (name, type) => new File([await (await fetch('/fixture/' + name)).blob()], name + (type.startsWith('image/') ? '.jpg' : '.mov'), {type});
      window.fixture = { async ordinary(name) {
        const picked = await file(name, 'image/jpeg');
        const { assets, errors } = await readBrowserMediaFiles([picked]);
        if (errors.length || assets.length !== 1) throw Error(JSON.stringify(errors));
        const asset = assets[0];
        const intakeHash = await sha(await (await fetch(asset.uri)).blob());
        const results = await upload.uploadMultiple(assets);
        const calls = window.encoderCalls.splice(0);
        releaseUnselectedBrowserMedia(assets, []);
        return {asset, intakeHash, results, calls};
      }, async direct() {
        const {assets} = await readBrowserMediaFiles([await file('withTrailer', 'image/jpeg')]);
        const result = await uploadToServer(assets[0].uri, 'posts');
        releaseUnselectedBrowserMedia(assets, []); return result;
      }, async pair() {
        const {assets, errors} = await readBrowserMediaFiles([await file('metadataOnly', 'image/jpeg'), await file('motion', 'video/quicktime')]);
        if (errors.length) throw Error(JSON.stringify(errors));
        const pair = await associateBrowserMedia(assets, assets[0].id, assets[1].id);
        if (!pair.ok) throw Error(pair.message);
        const results = await upload.uploadMultiple(pair.media);
        const calls = window.encoderCalls.splice(0);
        releaseUnselectedBrowserMedia(pair.media, []); return {results, calls};
      }, async bounded() {
        const cap = sizeLimitForKind('post-image');
        const large = new File([new Uint8Array(cap + 1)], 'too-big.jpg', {type:'image/jpeg'});
        const empty = new File([], 'empty.jpg', {type:'image/jpeg'});
        const svg = new File(['<svg></svg>'], 'not-an-image.jpg', {type:'image/svg+xml'});
        const rejected = await readBrowserMediaFiles([large, empty, svg]);
        const uri = URL.createObjectURL(large);
        const direct = await uploadToServer(uri, 'posts'); URL.revokeObjectURL(uri);
        return {rejected, direct};
      }};
      window.fixture.runAll = async () => {
        const ordinary = [];
        for (const name of ['still', 'metadataOnly', 'withTrailer']) ordinary.push(await window.fixture.ordinary(name));
        return {ordinary, direct: await window.fixture.direct(), pair: await window.fixture.pair(), bounded: await window.fixture.bounded()};
      };
    ` }, bundle: true, platform: 'browser', outfile: path.join(directory, 'app.js'),
      alias: { '@dvnt/app': path.join(root, 'packages/app') },
      resolveExtensions: ['.web.ts', '.web.tsx', '.ts', '.tsx', '.mjs', '.js', '.json'],
      nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
      define: { 'process.env': '{}' },
      plugins: [{ name: 'explicit-isolation', setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          if (args.path === 'actual-expo-image-manipulator') return {path: expoEntry};
          if (Object.hasOwn(adapters, args.path)) return {path: args.path, namespace: 'adapter'};
        });
        build.onLoad({filter: /.*/, namespace: 'adapter'}, args => ({contents: adapters[args.path], loader:'js', resolveDir:root}));
      }}],
    });
    if (process.argv.includes('--build-only')) {
      console.log('PASS original-byte boundary fixture bundles with actual pinned Expo web encoder (browser assertions not run).'); return;
    }
    const routeErrors = [];
    server = http.createServer(async (req, res) => {
      try {
        if (req.url === '/') {
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Content-Security-Policy', "default-src 'self' blob: data:; script-src 'self'; connect-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob:");
          res.end('<title>Synthetic browser byte boundary</title><script src="/app.js"></script>'); return;
        }
        if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(directory, 'app.js'))); return; }
        if (req.url === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
        if (req.url.startsWith('/fixture/')) { const bytes = payloads[req.url.slice('/fixture/'.length)]; assert.ok(bytes); res.end(bytes); return; }
        assert.equal(req.url, '/functions/v1/media-upload'); assert.equal(req.method, 'POST');
        assert.equal(req.headers.authorization, 'Bearer fixture-token');
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const request = new Request('http://127.0.0.1' + req.url, {method:'POST', headers:req.headers, body:Buffer.concat(chunks)});
        const form = await request.formData(); const uploaded = form.get('file');
        const bytes = Buffer.from(await uploaded.arrayBuffer());
        const record = { bytes, hash: digest(bytes), mime: form.get('mime'), kind: form.get('kind') }; uploads.push(record);
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({ok:true,media:{url:'https://fixture.invalid/media/' + uploads.length, key:String(uploads.length)}}));
      } catch (error) { routeErrors.push(error.message); res.statusCode = 500; res.end('Fixture failed'); }
    });
    await new Promise((resolve, reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const errors = [];
    const choice = process.env.FEED_BROWSER_CHANNEL ? {channel:process.env.FEED_BROWSER_CHANNEL} : fs.existsSync('/usr/bin/chromium') ? {executablePath:'/usr/bin/chromium'} : {};
    browser = await chromium.launch({headless:true, ...choice, args:['--no-sandbox']});
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort('blockedbyclient'));
    await page.goto(origin); await page.waitForFunction(() => !!window.fixture);
    const observed = await page.evaluate(() => window.fixture.runAll());
    for (const name of ['still', 'metadataOnly', 'withTrailer']) {
      const index = ['still', 'metadataOnly', 'withTrailer'].indexOf(name);
      const result = observed.ordinary[index];
      assert.equal(result.asset.kind, 'image'); assert.equal(result.asset.pairedVideoUri, undefined);
      assert.equal(result.intakeHash, digest(payloads[name]), `${name}: intake keeps every byte`);
      assert.equal(result.results[0].success, true); assert.equal(result.results[0].kind, 'image');
      assert.equal(result.results[0].livePhotoVideoUrl, undefined, 'a marker/trailer does not invent a playable pair');
      assert.equal(result.calls.length, 1, `${name}: untouched image enters the real encoder`);
      assert.deepEqual(result.calls[0].actions, [{rotate:0}, {resize:{width:1440}}]);
      assert.deepEqual(result.calls[0].options, {compress:0.85, format:'jpeg'});
      assert.equal(result.calls[0].result.width, 1440, 'even a 96px input is resized to 1440px');
      assert.notEqual(uploads[index].hash, digest(payloads[name]), 'POST receives reencoded bytes, not selected bytes');
      assert.equal(uploads[index].mime, 'image/jpeg'); assert.equal(uploads[index].kind, 'post-image');
      assert.equal(uploads[index].bytes.includes(sentinel), false, 'metadata sentinel is gone before POST');
      assert.equal(uploads[index].bytes.includes(motion), false, 'full appended clip is absent from POST');
    }
    assert.equal(observed.direct.success, true);
    assert.equal(uploads[3].hash, digest(withTrailer), 'server uploader alone preserves the blob; loss is earlier');
    const pair = observed.pair;
    assert.equal(pair.calls.length, 0, 'explicit original pair bypasses image reencoding');
    assert.equal(pair.results[0].success, true); assert.equal(pair.results[0].kind, 'livePhoto');
    assert.ok(pair.results[0].livePhotoVideoUrl);
    assert.equal(uploads.at(-2).hash, digest(metadataOnly)); assert.equal(uploads.at(-1).hash, digest(motion));
    const bounded = observed.bounded;
    assert.equal(bounded.rejected.assets.length, 0); assert.equal(bounded.rejected.errors.length, 3);
    assert.equal(bounded.direct.success, false); assert.match(bounded.direct.error, /limit/);
    assert.equal(uploads.length, 6, 'over-cap or unsupported sources cannot reach POST');
    assert.deepEqual(routeErrors, []); assert.deepEqual(errors, []);
    console.log(`PASS characterization on actual Expo ${expoPackage.version} + Chromium: intake is byte-exact; untouched image branch encodes JPEG1440/85% before multipart POST; sentinel/trailer is lost; no single-file motion classification; direct uploader and explicit original pair preserve bytes; size/type gates remain enforced. This does not establish the contents of any user file or successful Apple single-file import.`);
    if (process.argv.includes('--require-originals')) assert.equal(uploads[0].hash, digest(still), 'KNOWN REGRESSION: untouched ordinary-image File must reach POST byte-identically');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, {recursive:true, force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
