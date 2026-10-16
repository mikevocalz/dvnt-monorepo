// Test client: generated pixels only. No camera, microphone, relay or accounts.
import * as Publish from '@moq/publish';
import * as Watch from '@moq/watch';
import * as Moq from '@moq/net';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label, timeout = 12000) => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await sleep(20);
  }
};
// Only the WebTransport boundary is replaced. Real MoQ connections serialize
// control/catalog/media bytes into transferable streams between independent
// browser documents. No SDK objects or VideoFrames cross the client boundary.
class StreamTransport {
  protocol = 'moq-lite-03';
  ready = Promise.resolve();
  constructor(port, protocol = 'moq-lite-03') {
    this.protocol = protocol;
    this.port = port;
    this.closed = new Promise(resolve => { this.resolveClose = resolve; });
    this.incomingBidirectionalStreams = new ReadableStream({ start: c => { this.bidi = c; } });
    this.incomingUnidirectionalStreams = new ReadableStream({ start: c => { this.uni = c; } });
    this.datagrams = { readable: new ReadableStream(), writable: new WritableStream() };
    port.onmessage = ({ data }) => {
      if (data.kind === 'bidi') this.bidi.enqueue({ readable: data.readable, writable: data.writable });
      if (data.kind === 'uni') this.uni.enqueue(data.readable);
      if (data.kind === 'closed') this.resolveClose(data.info);
    };
    port.start();
  }
  stream() {
    return new TransformStream({ transform(chunk, c) { c.enqueue(new Uint8Array(chunk)); } }, { highWaterMark: 256 }, { highWaterMark: 256 });
  }
  async createBidirectionalStream() {
    const outgoing = this.stream(), incoming = this.stream();
    this.port.postMessage({ kind: 'bidi', readable: outgoing.readable, writable: incoming.writable }, [outgoing.readable, incoming.writable]);
    return { readable: incoming.readable, writable: outgoing.writable };
  }
  async createUnidirectionalStream() {
    const outgoing = this.stream();
    this.port.postMessage({ kind: 'uni', readable: outgoing.readable }, [outgoing.readable]);
    return outgoing.writable;
  }
  close(info = { closeCode: 0, reason: 'test finished' }) {
    this.port.postMessage({ kind: 'closed', info });
    this.resolveClose(info);
  }
  async getStats() { return {}; }
}
function colors(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return [[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y]) => {
    const [r,g,b] = context.getImageData(Math.floor(x*canvas.width), Math.floor(y*canvas.height), 1, 1).data;
    if (r > 128 && g > 128) return 'Y';
    return r > g && r > b ? 'R' : g > b ? 'G' : 'B';
  }).join('');
}
function paint(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width / 2, h = canvas.height / 2;
  for (const [color,x,y] of [['red',0,0],['lime',w,0],['blue',0,h],['yellow',w,h]]) {
    ctx.fillStyle = color; ctx.fillRect(x,y,w,h);
  }
}
function dimensions(frame) {
  return frame && { codedWidth: frame.codedWidth, codedHeight: frame.codedHeight,
    displayWidth: frame.displayWidth, displayHeight: frame.displayHeight,
    rotation: frame.rotation ?? null, flip: frame.flip ?? null };
}
window.addEventListener('message', async ({ data, ports }) => {
  if (data.type !== 'start') return;
  const { role, codec, captureMode, hiddenOrientation, missingOrientation, wireVersion = 3 } = data;
  let publication, backend, connection, timer, inputStream, capture, encoder, frameObserver, latestFrame, origin;
  try {
    const endpoint = new URL('https://loopback.invalid/generated-video-only');
    const transport = new StreamTransport(ports[0], wireVersion === 3 ? 'moq-lite-03' : 'moql');
    origin = new Moq.Origin.Producer();
    connection = role === 'sender'
      ? await Moq.Connection.accept({ transport, url: endpoint, publish: origin.consume(), ...(wireVersion < 3 ? {version: 0xff0dad00 + wireVersion} : {}) })
      : await Moq.Connection.connect({ transport, url: endpoint, consume: origin });
    if (connection.version !== `moq-lite-0${wireVersion}`) throw new Error(`Wrong wire version: ${connection.version}`);
    const name = Moq.Path.from('generated-orientation.hang');
    if (role === 'receiver') {
      const canvas = document.querySelector('#remote');
      backend = new Watch.Player({ origin, probe: connection.probe, name, enabled: true, canvas,
        delay: Moq.Time.Milli.zero, visible: 'always', paused: false, muted: true });
      window.readRemote = () => ({ wireVersion: connection.version, canvas: { width: canvas.width, height: canvas.height, colors: colors(canvas) },
        catalog: backend.broadcast.out.catalog.peek(), decodedCount: backend.video.out.stats.peek()?.frameCount ?? 0,
        decodedFrame: dimensions(backend.video.out.frame.peek()), display: backend.video.out.display.peek(),
        timestamp: backend.video.out.timestamp.peek(), stalled: backend.video.out.stalled.peek() });
      parent.postMessage({ type: 'started', role }, '*');
      return;
    }
    const sensor = document.createElement('canvas');
    const presentation = document.querySelector('#presentation');
    const local = document.querySelector('#local');
    let sequence = 0;
    let current = { width: 128, height: 64, rotation: 0, flip: false };
    let processorController;
    let workerPulls = 0, nativeProcessors = 0, videoCaptures = 0;
    const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
      if (source instanceof HTMLVideoElement && source !== local) videoCaptures++;
      return nativeDrawImage.call(this, source, ...args);
    };
    const NativeProcessor = window.MediaStreamTrackProcessor;
    const NativeWorker = window.Worker;
    if (captureMode === 'fallback') {
      delete window.MediaStreamTrackProcessor;
      window.Worker = class { constructor() { throw new Error('Force tested video-element fallback'); } };
    }
    else if (captureMode === 'worker') {
      delete window.MediaStreamTrackProcessor;
      // Generate sensor pixels in a real Worker and transfer native VideoFrames.
      // Only its camera processor is simulated. The SDK's worker bridge,
      // clock stamping, orientation normalizer, encoder and wire stay real.
      const workerCode = `const paint = ${paint.toString()};
        self.onmessage = async ({data}) => {
          if (data.type !== 'pull') return;
          await new Promise(resolve => setTimeout(resolve, 32));
          const s = data.scenario, canvas = new OffscreenCanvas(s.width, s.height);
          paint(canvas);
          const frame = new VideoFrame(canvas, { timestamp: data.timestamp, rotation: s.rotation, flip: s.flip });
          self.postMessage({type:'frame',frame,at:performance.timeOrigin+performance.now()}, [frame]);
        };
        self.postMessage({type:'ready',supported:true});`;
      const workerUrl = URL.createObjectURL(new Blob([workerCode], {type:'text/javascript'}));
      window.Worker = class extends NativeWorker {
        constructor() { super(workerUrl); }
        postMessage(message) {
          // Track transferability is a camera-source concern, not under test.
          // The clone remains owned by this simulated processor and is stopped.
          if (message.type === 'start') { message.track.stop(); return; }
          if (message.type === 'pull') workerPulls++;
          super.postMessage({...message, scenario:current, timestamp:++sequence*33333});
        }
      };
    }
    else window.MediaStreamTrackProcessor = class {
      constructor() { nativeProcessors++; this.readable = new ReadableStream({ start(c) { processorController = c; }, cancel() { processorController = undefined; } }); }
    };
    // Simulate an older implementation with hidden internal orientation, without
    // replacing the browser encoder, VideoFrame, pixels, or watcher decoder.
    if (hiddenOrientation) for (const key of ['rotation', 'flip']) Object.defineProperty(VideoFrame.prototype, key, { configurable: true, get() { return undefined; } });
    if (missingOrientation) for (const key of ['rotation', 'flip']) delete VideoFrame.prototype[key];
    function tick() {
      sensor.width = current.width; sensor.height = current.height; paint(sensor);
      const raw = new VideoFrame(sensor, { timestamp: ++sequence * 33333, rotation: current.rotation, flip: current.flip });
      const width = raw.displayWidth, height = raw.displayHeight;
      if (presentation.width !== width) presentation.width = width;
      if (presentation.height !== height) presentation.height = height;
      presentation.getContext('2d').drawImage(raw, 0, 0, width, height);
      // Local preview receives the correctly presented pixels. The raw
      // processor fixture retains the sensor transform before SDK capture.
      if (processorController) processorController.enqueue(raw); else raw.close();
    }
    tick();
    inputStream = presentation.captureStream(30);
    local.srcObject = inputStream; local.muted = true; local.playsInline = true;
    await local.play();
    capture = new Publish.Video.Capture({ source: inputStream.getVideoTracks()[0] });
    publication = new Publish.Broadcast({ origin, enabled: true, name, display: capture.out.display });
    encoder = new Publish.Video.Encoder('video/hd', { broadcast: publication, capture, enabled: true,
      config: { codec, keyframeInterval: 100 } });
    frameObserver = new Publish.Signals.Effect();
    frameObserver.run(effect => {
      const frames = effect.get(capture.out.frames); if (!frames) return;
      const reader = frames.subscribe(effect, 1).getReader();
      effect.cleanup(() => reader.cancel().catch(() => {}));
      effect.spawn(async () => {
        for (;;) { const { value } = await reader.read(); if (!value) return;
          latestFrame?.close(); latestFrame = value; }
      });
    });
    timer = setInterval(tick, 34);
    await until(() => encoder.out.resolved.peek(), 'publisher codec');
    const resolved = encoder.out.resolved.peek();
    if (!resolved.codec.startsWith(codec)) throw new Error(`Wrong codec: ${resolved.codec}`);
    window.setScenario = async scenario => {
      current = scenario; tick();
      await until(() => local.readyState >= 2 && local.videoWidth === presentation.width && local.videoHeight === presentation.height, 'local preview dimensions');
      await sleep(150);
      const preview = document.createElement('canvas'); preview.width = local.videoWidth; preview.height = local.videoHeight;
      preview.getContext('2d').drawImage(local, 0, 0);
      return { workerPulls, nativeProcessors, videoCaptures, wireVersion: connection.version, expected: { width: presentation.width, height: presentation.height, colors: colors(presentation) },
        local: { width: preview.width, height: preview.height, colors: colors(preview) },
        frame: dimensions(latestFrame), display: capture.out.display.peek(), catalog: encoder.out.catalog.peek(), resolved: encoder.out.resolved.peek() };
    };
    parent.postMessage({ type: 'started', role, resolved }, '*');
    window.stopClient = () => { clearInterval(timer); frameObserver.close(); latestFrame?.close(); latestFrame = undefined; encoder.close(); publication.close(); capture.close(); inputStream.getTracks().forEach(t => t.stop()); connection.close(); origin.close(); window.MediaStreamTrackProcessor = NativeProcessor; window.Worker = NativeWorker; };
  } catch (error) { parent.postMessage({ type: 'error', role, error: error.stack || String(error) }, '*'); }
});
parent.postMessage({ type: 'ready' }, '*');
