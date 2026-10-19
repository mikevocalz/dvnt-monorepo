#!/usr/bin/env node
// Local component fixture: real Payload form/block contexts, editor preview and
// public RichText. The surrounding drawer and YouTube player are fixtures; this
// does not log in, save a post, call a database or claim live playback coverage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.BLOG_YOUTUBE_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'blog-youtube-'));
const resolve = name => require.resolve(name, { paths: [ROOT, path.join(ROOT, 'apps/web')] });
const load = name => require(resolve(name));
const uiContext = path.resolve(path.dirname(resolve('@payloadcms/ui')), '../../forms/Form/context.js');
const blockContent = path.resolve(path.dirname(resolve('@payloadcms/richtext-lexical/client')), '../../features/blocks/client/component/BlockContent.js');
const blockCollapsible = path.join(path.dirname(blockContent), 'components/BlockCollapsible.js');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const entry = `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {LexicalComposer} from '@lexical/react/LexicalComposer';
    import {FormFieldsContext} from ${JSON.stringify(uiContext)};
    import {BlockContent} from ${JSON.stringify(blockContent)};
    import Preview from './packages/cms/src/components/YouTubeBlockPreview';
    import {RichText} from './apps/web/src/components/RichText';
    import {validateYouTubeURL} from './packages/cms/src/posts/youtube';
    const noop=()=>{};
    const Empty=()=>null;
    const Collapsible=({children})=><section className="preview"><header>YouTube video <span>Edit · Remove</span></header>{children}</section>;
    const p=text=>({type:'paragraph',version:1,format:'',direction:null,indent:0,children:[{type:'text',version:1,format:0,detail:0,mode:'normal',style:'',text}]});
    function Fixture(){
      const [url,setURL]=useState('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      const [title,setTitle]=useState('Community interview');
      const [caption,setCaption]=useState('A conversation with the people shaping the culture.');
      const validation=validateYouTubeURL(url);
      const fields={url:{value:url},title:{value:title},caption:{value:caption}};
      const data={root:{type:'root',version:1,format:'',direction:null,indent:0,children:[p('The story continues with a conversation.'),{type:'block',version:2,format:'',fields:{id:'video-fixture',blockType:'youtube',url,title,caption}},p('More of the story follows the video.')]}};
      return <main><h1>YouTube in the blog</h1><p className="note">Local component fixture. Player and drawer shell are test doubles.</p>
        <section><h2>Editor preview</h2><p>Type /youtube in the article to add a video.</p>
          <label>YouTube URL<input aria-invalid={validation!==true} value={url} onChange={e=>setURL(e.target.value)} /></label>
          {validation!==true&&<p role="alert">{validation}</p>}
          <label>Video title<input value={title} onChange={e=>setTitle(e.target.value)} /></label>
          <label>Caption<input value={caption} onChange={e=>setCaption(e.target.value)} /></label>
          <LexicalComposer initialConfig={{namespace:'youtube-preview-fixture',onError:error=>{throw error}}}>
            <FormFieldsContext.Provider value={[fields,noop]}>
              <BlockContent Collapsible={Collapsible} CustomBlock={<Preview/>} CustomLabel={null} BlockDrawer={Empty} EditButton={Empty} RemoveButton={Empty} formSchema={[]} errorCount={0} nodeKey="fixture" baseClass="fixture" initialState={false}/>
            </FormFieldsContext.Provider>
          </LexicalComposer>
        </section>
        <section className="article"><h2>Reader view</h2><RichText data={data}/></section>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `;
  await load('esbuild').build({ stdin: { contents: entry, loader: 'tsx', resolveDir: ROOT }, outfile: path.join(OUT,'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfigRaw: {compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}}, loader: {'.css':'empty','.scss':'empty'}, plugins: [{name:'one-payload-block-context', setup(build){
    // The published client barrel bundles a private BlockContent context. The
    // fixture uses the unbundled provider, so use its real matching primitive.
    // Production preview/editor both use the public bundle and need no alias.
    build.onResolve({filter:/^@payloadcms\/richtext-lexical\/client$/}, args =>
      args.importer.endsWith('/YouTubeBlockPreview.tsx') ? {path:blockCollapsible} : undefined);
  }}], define: {'process.env.NODE_ENV':'"production"'}, logLevel:'warning' });
  if (process.argv.includes('--build-only')) { console.log('PASS: actual editor preview and public renderer bundle'); return; }
  const css='*{box-sizing:border-box}body{margin:0;background:#0c1118;color:#f3f4f6;font:16px/1.5 system-ui}main{width:min(100%,760px);margin:auto;padding:20px}h1{font-size:30px}h2{font-size:21px}label{display:block;margin:12px 0;font-size:14px}input{display:block;width:100%;min-width:0;margin:5px 0;padding:11px;border:1px solid #536171;border-radius:6px;background:#18212d;color:#fff;font:inherit}.note{color:#a8b2c0;font-size:13px}section{margin-top:26px}.preview{padding:16px;border:1px solid #526170;border-radius:10px}.preview header{font-weight:700;display:flex;justify-content:space-between}.preview header span{font-size:12px;color:#c7b1eb}.preview p{font-size:13px}.article{padding-top:22px;border-top:1px solid #536171}figure{margin:1.5em 0}figcaption{color:#b7bfcc}[role=alert]{color:#ffb3b3}';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube block component fixture</title><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'application/javascript':'text/html');res.end(req.url==='/fixture.js'?fs.readFileSync(path.join(OUT,'fixture.js')):html)});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  let browser, page;
  const errors=[];
  try {
    const {chromium}=load('playwright');
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE_PATH?{executablePath:process.env.CHROME_EXECUTABLE_PATH}:{}),args:['--no-sandbox']});
    page=await browser.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='127.0.0.1')return route.continue();
      if(url.hostname==='www.youtube-nocookie.com')return route.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#080b11;color:#ddd;display:grid;place-items:center;height:100vh;font:16px system-ui"><div>▶ YouTube player fixture</div></body>'});
      return route.abort();
    });
    const results=[];
    for(const width of [320,375,768,1280]){
      await page.setViewportSize({width,height:1000});
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('.article iframe').waitFor();
      assert.equal(await page.locator('iframe').count(),2,'Editor and reader each render one iframe');
      const metrics=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,frames:[...document.querySelectorAll('iframe')].map(frame=>{const box=frame.getBoundingClientRect();return {x:box.x,width:box.width,height:box.height,src:frame.src,title:frame.title,loading:frame.loading,allow:frame.allow}})}));
      assert.ok(metrics.document<=width,JSON.stringify(metrics));
      for(const frame of metrics.frames){assert.ok(frame.x>=0&&frame.x+frame.width<=width);assert.ok(Math.abs(frame.width/frame.height-16/9)<0.02);assert.equal(frame.title,'Community interview');assert.equal(frame.loading,'lazy');assert.doesNotMatch(frame.allow,/autoplay/)}
      await page.screenshot({path:path.join(OUT,`youtube-${width}.png`),fullPage:true});
      results.push(metrics);
    }
    await page.getByLabel('YouTube URL',{exact:true}).fill('https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('iframe').count(),0,'Invalid editor state never loads an iframe');
    await page.getByLabel('YouTube URL',{exact:true}).fill('https://youtube.com/shorts/dQw4w9WgXcQ?autoplay=1');
    await page.locator('.article iframe').waitFor();
    assert.equal(await page.locator('.article iframe').getAttribute('src'),'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    await page.getByLabel('Video title',{exact:true}).fill('Updated interview title');
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].every(frame=>frame.title==='Updated interview title'));
    await page.getByLabel('Caption',{exact:true}).fill('x'.repeat(350));
    await page.setViewportSize({width:320,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long caption must wrap');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({scope:'Local editor-preview/public-render fixture; no live admin save or real player playback.',results,invalidURL:true,shortsURL:true,livePreviewUpdate:true,longCaption:true,errors},null,2));
    console.log(`PASS: editor and reader at 320/375/768/1280px, URL validation, reactive preview, long caption. Evidence: ${OUT}`);
  } catch(error) {
    if(page){
      await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true}).catch(()=>{});
      fs.writeFileSync(path.join(OUT,'failure.html'),await page.content().catch(()=>''));
      fs.writeFileSync(path.join(OUT,'failure.json'),JSON.stringify({message:String(error),errors},null,2));
    }
    throw error;
  } finally {await browser?.close();await new Promise(done=>server.close(done));}
}
main().catch(error=>{console.error(error);process.exitCode=1});
