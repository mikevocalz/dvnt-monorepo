/** Real browser MP4 compression. No production account, network or upload is used.
 * Dependencies: esbuild, playwright, mediabunny (resolved from NODE_PATH too).
 * Requires ffmpeg/ffprobe. Set CHROME_EXECUTABLE_PATH to use installed Chrome.
 * FLYER_TEST_OUTPUT_DIR keeps the generated source/output and JSON evidence.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const DIR = process.env.FLYER_TEST_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-flyer-codec-'));
fs.mkdirSync(DIR, { recursive: true });
const source = path.join(DIR, 'source.mp4');
const small = path.join(DIR, 'small.mp4');
const output = path.join(DIR, 'prepared.mp4');
const MB = 1024 * 1024;

function probe(filename) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], { encoding: 'utf8' }));
}

(async () => {
  // CBR with filler deliberately produces a real ~111 MiB MP4, not a tiny
  // fixture whose File.size property lies. The conversion must really execute.
  if (!fs.existsSync(source)) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '31M', '-minrate', '31M', '-maxrate', '31M',
    '-bufsize', '62M', '-x264-params', 'nal-hrd=cbr:force-cfr=1', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', source]);
  assert.ok(fs.statSync(source).size > 100 * MB && fs.statSync(source).size < 120 * MB, 'real input around 111MiB');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', source, '-t', '1', '-c', 'copy', '-y', small]);
  await build({ stdin: { contents: `import {prepareEventVideoFile} from './packages/app/lib/media/prepare-event-video.web.ts';
    window.prepareEventVideoFile=prepareEventVideoFile;`, resolveDir: ROOT, sourcefile: 'flyer-test.ts' },
    bundle: true, format: 'esm', platform: 'browser', outfile: path.join(DIR, 'app.js'),
    alias: { mediabunny: path.resolve(path.dirname(require.resolve('mediabunny')), '../modules/src/index.js') }, tsconfigRaw: { compilerOptions: { target: 'ES2022' } } });
  const server = http.createServer((req, res) => {
    if (req.url === '/output' && req.method === 'POST') {
      const file = fs.createWriteStream(output); req.pipe(file); file.on('finish', () => res.end('ok')); return;
    }
    const filename = req.url === '/source.mp4' ? source : req.url === '/small.mp4' ? small : req.url === '/app.js' ? path.join(DIR, 'app.js') : null;
    if (filename) {
      res.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript' : 'video/mp4');
      res.setHeader('Content-Length', fs.statSync(filename).size);
      fs.createReadStream(filename).pipe(res); return;
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Flyer encode test</title><script type="module" src="/app.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.error('browser:', m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof window.prepareEventVideoFile === 'function');
    const result = await page.evaluate(async () => {
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const load = async (url) => new File([await (await fetch(url)).blob()], url.slice(1), { type: 'video/mp4' });
      const original = await load('/source.mp4'); const small = await load('/small.mp4');
      assert(await window.prepareEventVideoFile(small) === small, 'under-limit input passes through byte-identically');
      const originalSize = original.size;
      const encoder = window.VideoEncoder;
      Object.defineProperty(window, 'VideoEncoder', { configurable: true, writable: true, value: undefined });
      try { await window.prepareEventVideoFile(original); throw new Error('unsupported browser accepted'); }
      catch (error) { assert(error.message.includes("browser can't prepare"), 'actionable unsupported-browser fallback'); }
      finally { Object.defineProperty(window, 'VideoEncoder', { configurable: true, writable: true, value: encoder }); }
      const cancelled = new AbortController(); cancelled.abort();
      try { await window.prepareEventVideoFile(original, { signal: cancelled.signal }); throw new Error('cancelled encode accepted'); }
      catch (error) { assert(error.name === 'AbortError', 'cancel before encode rejects'); }
      const progress = [];
      const started = performance.now();
      const prepared = await window.prepareEventVideoFile(original, { onProgress: (p) => progress.push(p) });
      assert(prepared !== original && prepared.type === 'video/mp4', 'real separate MP4 copy');
      assert(prepared.size > 0 && prepared.size <= 50 * 1024 * 1024, 'output fits 50MiB');
      assert(original.size === originalSize, 'original remains untouched');
      assert(progress[0] === 0 && progress.at(-1) === 100 && progress.some(p => p > 0 && p < 100), 'real progress and verified completion');
      await fetch('/output', { method: 'POST', body: prepared });
      const mid = new AbortController();
      try {
        await window.prepareEventVideoFile(original, { signal: mid.signal, onProgress: (p) => { if (p > 0) mid.abort(); } });
        throw new Error('mid-encode cancellation accepted');
      } catch (error) { assert(error.name === 'AbortError', 'cancel during encode rejects instead of returning a partial copy'); }
      return { originalBytes: original.size, outputBytes: prepared.size, elapsedMs: Math.round(performance.now()-started), checks: 8 };
    });
    const inputProbe = probe(source), outputProbe = probe(output);
    const srcVideo = inputProbe.streams.find(s => s.codec_type === 'video');
    const outVideo = outputProbe.streams.find(s => s.codec_type === 'video');
    const srcAudio = inputProbe.streams.find(s => s.codec_type === 'audio');
    const outAudio = outputProbe.streams.find(s => s.codec_type === 'audio');
    assert.equal(outVideo.width, srcVideo.width); assert.equal(outVideo.height, srcVideo.height);
    assert.equal(outVideo.nb_frames, srcVideo.nb_frames); assert.equal(outVideo.r_frame_rate, srcVideo.r_frame_rate);
    assert.equal(outVideo.codec_name, 'h264'); assert.equal(outAudio.codec_name, 'aac');
    assert.equal(outAudio.sample_rate, srcAudio.sample_rate); assert.equal(outAudio.channels, srcAudio.channels);
    // The AAC path should be a packet copy, with no extra audio generation loss.
    for (const [input, filename] of [[source, 'source.aac'], [output, 'prepared.aac']]) {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-c:a', 'copy', '-f', 'adts', '-y', path.join(DIR, filename)]);
    }
    assert.deepEqual(fs.readFileSync(path.join(DIR, 'source.aac')), fs.readFileSync(path.join(DIR, 'prepared.aac')));
    const evidence = { ...result, width: outVideo.width, height: outVideo.height, frameRate: outVideo.r_frame_rate,
      frames: outVideo.nb_frames, audioPreserved: true };
    fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(evidence, null, 2));
    console.log('PASS real browser event video compression:', JSON.stringify(evidence));
  } finally { await browser?.close(); server.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
