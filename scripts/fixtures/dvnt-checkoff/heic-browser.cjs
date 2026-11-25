const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const exact = fs.readFileSync('packages/app/features/create/crop-preview.web.tsx','utf8');
const decoder = exact.match(/async function getHeicCropBlob\(source: string\) \{[\s\S]*?\n\}/)?.[0];
assert(decoder, 'deployed crop decoder not found');
(async () => {
  const js = (await build({stdin:{contents:decoder+'\nwindow.decodeCropSource = getHeicCropBlob;',loader:'ts',resolveDir:process.cwd()},nodePaths:process.env.NODE_PATH.split(path.delimiter),bundle:true,write:false,platform:'browser'})).outputFiles[0].text;
  const still=fs.readFileSync(process.argv[2]);
  assert(still.includes(Buffer.from('ftypheic')) || still.includes(Buffer.from('ftypmif1')));
  const server=http.createServer((req,res)=>{
    if(req.url==='/decode.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(js);return;}
    if(req.url==='/synthetic.heic'){res.writeHead(200,{'Content-Type':'image/heic'});res.end(still);return;}
    res.writeHead(200,{'Content-Type':'text/html'});res.end('<script src="/decode.js"></script>');
  });
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await page.goto('http://127.0.0.1:'+server.address().port);
    const out=await page.evaluate(async()=>{
      const original = await (await fetch('/synthetic.heic')).blob();
      const png=await window.decodeCropSource(URL.createObjectURL(original));
      const bitmap=await createImageBitmap(png);
      const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
      const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);
      return {type:png.type,w:c.width,h:c.height,a:[...ctx.getImageData(18,20,1,1).data],b:[...ctx.getImageData(76,20,1,1).data]};
    });
    assert.equal(out.type,'image/png');assert.deepEqual([out.w,out.h],[96,72]);
    assert(out.a[0]>160&&out.a[1]<100&&out.a[2]<100,JSON.stringify(out));
    assert(out.b[2]>160&&out.b[0]<100&&out.b[1]<120,JSON.stringify(out));
    console.log('PASS real HEIC bytes decoded by the deployed crop helper in a phone-size browser; dimensions and red/blue pixels preserved.');
  } finally {await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
