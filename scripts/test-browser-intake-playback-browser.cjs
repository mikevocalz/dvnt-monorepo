#!/usr/bin/env node
// Actual Chrome decode of generated synthetic media. No Photos identity claim.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'diagnostic-playback-'));let browser,server;
 try{
  const clip=path.join(dir,'PRIVATE-synthetic.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x120:rate=12','-t','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart',clip]);
  const html=fs.readFileSync(path.join(__dirname,'diagnostics/browser-live-photo-intake.html'));
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const choice=process.env.FEED_BROWSER_CHANNEL?{channel:process.env.FEED_BROWSER_CHANNEL}:fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{};
  browser=await chromium.launch({headless:true,...choice,args:['--no-sandbox']});const page=await browser.newPage();
  const requests=[],errors=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  const origin=`http://127.0.0.1:${server.address().port}`;await page.goto(origin);
  await page.evaluate(()=>{window.revoked=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=u=>{window.revoked.push(u);revoke(u);};});
  const picker=page.locator('input[data-mode="video-only"]');await picker.setInputFiles(clip);
  const play=page.getByRole('button',{name:'Play file 1 locally'});await play.waitFor();assert.equal(await page.locator('video').count(),0);
  await play.click();await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.videoWidth===160&&v.currentTime>.3;});
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#output').textContent).reports.at(-1).files[0].localPlayback.timeAdvanced);
  const report=JSON.parse(await page.locator('#output').textContent()).reports.at(-1).files[0];assert.equal(report.localPlayback.height,120);assert.ok(report.localPlayback.durationSeconds>1.5);assert.equal(report.localPlayback.errorCode,null);
  await page.locator('video').evaluate(v=>v.pause());await page.waitForFunction(()=>JSON.parse(document.querySelector('#output').textContent).reports.at(-1).files[0].localPlayback.state==='Paused');
  await play.click();assert.equal(await page.evaluate(()=>revoked.length),1);
  await page.getByRole('button',{name:'Clear results',exact:true}).click();assert.equal(await page.locator('video').count(),0);assert.equal(await page.evaluate(()=>revoked.length),2);assert.equal(await page.locator('#output').textContent(),'Results cleared.');
  await picker.setInputFiles(clip);await play.click();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await page.locator('video').count(),0);assert.equal(await page.evaluate(()=>revoked.length),3);
  assert.ok(!(await page.locator('#output').textContent()).includes('PRIVATE-synthetic'));assert.deepEqual(errors,[]);assert.ok(requests.every(u=>u===origin+'/'||u.startsWith('blob:')),'No media uploads or external requests');
  console.log('PASS actual Chrome synthetic diagnostic decode, explicit tap, evidence, pause, replacement, clear, pagehide and no-network checks');
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
