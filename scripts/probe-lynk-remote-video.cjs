/** Independent browser documents, real MoQ catalog/container and WebCodecs.
 * Covers the SDK receiver canvas, not the production StageTile React DOM.
 * All input is generated pixels; no cameras, relay, accounts, or user media.
 * Set LYNK_REQUIRE_AVC=1 for a production-codec gate (fails if AVC unavailable).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const deps = path.resolve(process.env.LYNK_PROBE_DEPS || process.cwd());
const dep = name => require(require.resolve(name, {paths: [deps]}));
const {chromium} = dep('playwright');
const {build} = dep('esbuild');
const root = path.resolve(__dirname, '..');
// Verify the real resolved import graph and every patch postimage before bundling.
require('./lynk-orientation-build.cjs').checkInstalledPublisher(root, path.join(deps, 'package.json'));
(async () => {
  const bundle = (await build({entryPoints: [path.join(__dirname,'fixtures/lynk-remote-video-client.js')],
    bundle: true, minify: true, write: false, format: 'iife', platform: 'browser',
    plugins: [{name:'exact-sdk-dependencies',setup(b) {b.onResolve({filter:/^@moq\/(publish|watch|net)$/}, args => ({path:require.resolve(args.path,{paths:[deps]})}));}}]
  })).outputFiles[0].text;
  const emitted = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lynk-remote-emitted-'));
  fs.writeFileSync(path.join(emitted, 'client.js'), bundle);
  require('./lynk-orientation-build.cjs').checkBrowserBundle(emitted);
  const client = '<!doctype html><style>canvas,video{width:128px;height:128px;object-fit:contain}</style><canvas id="presentation"></canvas><video id="local" muted playsinline></video><canvas id="remote"></canvas><script src="/client.js"></script>';
  const host = '<!doctype html><iframe id="sender" src="/client"></iframe><iframe id="receiver" src="/client"></iframe><script>window.events=[];addEventListener("message",e=>events.push(e.data));</script>';
  const server = http.createServer((q,r) => {r.setHeader('Content-Type',q.url==='/client.js'?'application/javascript':'text/html');r.end(q.url==='/client.js'?bundle:q.url==='/client'?client:host);}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.on('listening',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(process.env.LYNK_CHROMIUM_PATH?{executablePath:process.env.LYNK_CHROMIUM_PATH}:{})});
    const page=await browser.newPage();
    page.on('pageerror',e=>console.error('browser error:',e));
    page.on('console',m=>{if(m.type()==='error')console.error('browser:',m.text())});
    const address=`http://127.0.0.1:${server.address().port}`;
    await page.goto(address);
    // Match all AVC profiles and both acceleration modes tried by the pinned
    // production encoder. The actual SDK still resolves and asserts the codec.
    const capability=await page.evaluate(async()=>{
      const candidates=[];
      for(const hardwareAcceleration of ['prefer-hardware','prefer-software'])
        for(const codec of ['avc1.640028','avc1.4D401F','avc1.42E01E','vp8']) {
          const config={codec,width:128,height:64,latencyMode:'realtime',hardwareAcceleration,...(codec.startsWith('avc1')?{avc:{format:'annexb'}}:{})};
          let supported=false;try {supported=!!(await VideoEncoder.isConfigSupported(config)).supported;}catch{}
          candidates.push({codec,hardwareAcceleration,supported});
        }
      return {avc:candidates.some(c=>c.codec.startsWith('avc1')&&c.supported),vp8:candidates.some(c=>c.codec==='vp8'&&c.supported),candidates};
    });
    console.log('Codec capabilities:',JSON.stringify(capability));
    if(process.env.LYNK_REQUIRE_AVC==='1')assert.ok(capability.avc,'AVC is unavailable: production-codec verification BLOCKED');
    const codecs=[...(capability.avc?['avc1']:[]),...(capability.vp8?['vp8']:[])];
    assert.ok(codecs.length>0,'No supported test codec: transport verification BLOCKED');
    const wireVersion=Number(process.env.LYNK_WIRE_VERSION||3);
    assert.ok([1,2,3].includes(wireVersion),'Supported diagnostic wire versions are 1, 2 and 3');
    const rows=[];
    const captureModes=process.env.LYNK_CAPTURE_MODES?.split(',')||['processor','worker','fallback'];
    for(const codec of codecs)for(const captureMode of captureModes)for(const {hiddenOrientation,missingOrientation} of
      captureMode==='fallback'?[{hiddenOrientation:false,missingOrientation:false}]:[
        {hiddenOrientation:false,missingOrientation:false},
        ...(process.env.LYNK_PROBE_HIDDEN_ORIENTATION!=='0'?[{hiddenOrientation:true,missingOrientation:false}]:[]),
        {hiddenOrientation:false,missingOrientation:true},
      ]) {
      await page.goto(address);
      await page.waitForFunction(()=>events.filter(e=>e.type==='ready').length===2);
      await page.evaluate(args=>{const pair=new MessageChannel();document.querySelector('#sender').contentWindow.postMessage({type:'start',role:'sender',...args},'*',[pair.port1]);document.querySelector('#receiver').contentWindow.postMessage({type:'start',role:'receiver',...args},'*',[pair.port2]);},{codec,captureMode,hiddenOrientation,missingOrientation,wireVersion});
      await page.waitForFunction(()=>events.some(e=>e.type==='error')||events.filter(e=>e.type==='started').length===2);
      const errors=await page.evaluate(()=>events.filter(e=>e.type==='error'));assert.deepEqual(errors,[]);
      const sender=page.frames().find(f=>f.name()==='sender')||page.frames()[1];
      const receiver=page.frames().find(f=>f.name()==='receiver')||page.frames()[2];
      for(const scenario of [
        {width:128,height:64,rotation:0,flip:false},
        {width:128,height:64,rotation:90,flip:false},
        {width:128,height:64,rotation:90,flip:true},
        {width:64,height:128,rotation:0,flip:false},
        {width:128,height:64,rotation:180,flip:true},
        {width:128,height:64,rotation:270,flip:false},
        {width:128,height:64,rotation:0,flip:false},
      ]) {
        const local=await sender.evaluate(s=>window.setScenario(s),scenario);
        await receiver.waitForFunction(expected=>{const r=window.readRemote();return r.decodedCount>0 && r.canvas.width===expected.width&&r.canvas.height===expected.height&&r.canvas.colors===expected.colors;},local.expected,{timeout:5000}).catch(()=>{});
        const remote=await receiver.evaluate(()=>window.readRemote());
        const row={codec,wireVersion,captureMode,hiddenOrientation,missingOrientation,scenario,local,remote};rows.push(row);console.log(JSON.stringify(row));
      }
      await sender.evaluate(()=>window.stopClient());
    }
    const output=process.env.LYNK_REMOTE_OUTPUT||'/tmp/lynk-remote-video-results.json';fs.writeFileSync(output,JSON.stringify({capability,rows},null,2));
    assert.ok(rows.length>0,'No transport scenarios executed');
    for(const row of rows) {
      if(row.missingOrientation) {
        assert.equal(row.local.nativeProcessors,0,'Missing orientation properties must bypass native processor capture');
        assert.equal(row.local.workerPulls,0,'Missing orientation properties must bypass worker capture');
        assert.ok(row.local.videoCaptures>0,'Missing orientation properties must use rendered HTMLVideoElement capture');
      } else if(row.captureMode==='worker')assert.ok(row.local.workerPulls>0,'Worker capture branch was not exercised');
      if(row.captureMode==='fallback')assert.ok(row.local.videoCaptures>0,'Video-element capture branch was not exercised');
    }
    const failures=rows.filter(row=>JSON.stringify(row.local.expected)!==JSON.stringify(row.remote.canvas)||JSON.stringify(row.local.expected)!==JSON.stringify(row.local.local));
    assert.equal(failures.length,0,`${failures.length} remote/local pixel mismatches; see ${output}`);
    console.log('PASS: independent clients, real MoQ serialization/catalog, SDK decoder and renderer, live dimension/orientation changes. StageTile DOM is outside this probe.');
    if(!capability.avc)console.log('LIMIT: AVC unavailable; VP8 transport coverage does not verify production AVC or physical iOS capture.');
  } finally {await browser?.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
