#!/usr/bin/env node
// Actual shared composer + threaded comment rows; auth/mutation are offline fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {build} = require('esbuild');
const {compile} = require('tailwindcss');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const dir = process.env.COMMENT_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-comments-'));
fs.mkdirSync(dir,{recursive:true});
const mocks = {
 '@dvnt/app/lib/hooks/use-comments': `import {useMutation} from '@tanstack/react-query'; export const useCreateComment=()=>useMutation({mutationFn:async data=>{window.calls.push(data);await new Promise(resolve=>window.release=resolve);if(window.fail)throw Error('offline fixture failure');return {id:'created'};}});`,
 '@dvnt/app/lib/hooks/use-verified-gate': `export const useVerifiedGate=()=> (_action,run)=>{if(window.deferGate)window.finishGate=run;else if(!window.blocked)run()};`,
 '@dvnt/app/lib/stores/auth-store': `export const useAuthStore=s=>s({user:{id:'fixture-author',username:'viewer'}});`,
 '@dvnt/app/lib/hooks/use-comment-like-state': `export const useCommentLikeState=()=>({likesCount:1,hasLiked:false,toggle(){},isPending:false});`,
 '@dvnt/app/components/ui/avatar': `export const UserAvatar=()=> <div style={{width:36,height:36,background:'#222',borderRadius:8}}/>;`,
 './delete-comment-action': `export const DeleteCommentAction=()=>null;`,
};
(async()=>{
 let browser,server;
 try {
 await build({bundle:true,jsx:'automatic',tsconfigRaw:{},platform:'browser',format:'iife',outfile:path.join(dir,'app.js'),
 nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),
 alias:{'@dvnt/app':path.join(root,'packages/app'),'react-native':'react-native-web','lucide-react-native':'lucide-react'},
 plugins:[{name:'offline-boundaries',setup(b){b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}));}}],
 stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
 import {WebCommentComposer} from './packages/app/features/comments/ui/comment-composer.web';
 import {ThreadedComment} from './packages/app/features/comments/ui/threaded-comment';
 import {useCommentDraftStore} from './packages/app/lib/stores/comment-draft-store';
 const client=new QueryClient({defaultOptions:{mutations:{retry:false}}}); const root=createRoot(document.getElementById('root'));
 window.calls=[];window.draft=useCommentDraftStore;
 const comment={id:'17',username:'deviantevents',text:'🔥🔥🔥',timeAgo:'12h',replies:[]};
 window.mount=(parentCommentId,hideWhenClosed=false)=>root.render(<React.StrictMode><QueryClientProvider client={client}><main style={{maxWidth:600,margin:'auto'}}><div style={{height:380,background:'#12141d'}}>Post media fixture</div><button id="comment-trigger" onClick={()=>useCommentDraftStore.getState().openComposer()}>Comment</button><div id="comment-card"><ThreadedComment comment={comment} postId="fixture-post" onReply={(username,commentId)=>useCommentDraftStore.getState().setReplyTo({username,commentId})} onProfilePress={()=>{}}/></div><WebCommentComposer key={parentCommentId||'post'} postId="fixture-post" parentCommentId={parentCommentId} hideWhenClosed={hideWhenClosed}/></main></QueryClientProvider></React.StrictMode>);
 window.mount(undefined,true);`}});
 const tw=path.dirname(require.resolve('tailwindcss/package.json'));
 const source=fs.readFileSync(path.join(root,'packages/app/features/comments/ui/comment-composer.web.tsx'),'utf8');
 const compiler=await compile(fs.readFileSync(path.join(tw,'theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(tw,'preflight.css'),'utf8')+'\n@tailwind utilities;');
 fs.writeFileSync(path.join(dir,'style.css'),compiler.build(source.match(/[a-zA-Z0-9_!@#%./:[\](),+*=&<>-]+/g)||[])+'body{background:#02030a;color:white;font-family:Arial;margin:0}');

 if(process.argv.includes('--dom')) {
  const {Window}=await import('happy-dom');const w=new Window({url:'https://fixture.invalid'});w.document.body.innerHTML='<div id="root"></div>';
  w.HTMLElement.prototype.scrollIntoView=function(){};
  const wait=async check=>{for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('DOM did not settle: '+w.document.body.textContent);};
  const button=text=>[...w.document.querySelectorAll('button')].find(el=>el.textContent===text);
  try {
   Object.assign(global,{window:w,document:w.document,HTMLElement:w.HTMLElement,ShadowRoot:w.ShadowRoot,requestAnimationFrame:w.requestAnimationFrame.bind(w)});require('node:vm').runInThisContext(fs.readFileSync(path.join(dir,'app.js'),'utf8'));await wait(()=>button('Comment'));button('Comment').click();await wait(()=>w.document.querySelector('textarea'));
   w.draft.getState().setText('Offline draft');await wait(()=>w.document.querySelector('textarea')?.value==='Offline draft');
   w.deferGate=true;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.finishGate);button('Close').click();await wait(()=>!w.document.querySelector('textarea'));w.finishGate();assert.equal(w.calls.length,0,'closed deferred draft must not send');
   w.deferGate=false;button('Comment').click();await wait(()=>w.document.querySelector('textarea'));w.draft.getState().setText('Retry me');await wait(()=>w.document.querySelector('textarea').value==='Retry me');w.fail=true;
   w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.calls.length===1&&w.release);w.release();await wait(()=>w.document.querySelector('[role=alert]'));assert.equal(w.draft.getState().text,'Retry me');
   w.fail=false;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.calls.length===2);w.release();await wait(()=>!w.document.querySelector('textarea'));assert.equal(w.draft.getState().text,'');
   // Binding the same context is idempotent, including StrictMode effect replay.
   w.draft.getState().openComposer({commentId:'17',username:'deviantevents'});w.draft.getState().setText('Keep across remount');const revision=w.draft.getState().revision;w.draft.getState().bindContext('fixture-post:comments');assert.equal(w.draft.getState().revision,revision);assert.equal(w.draft.getState().text,'Keep across remount');
   w.draft.getState().bindContext('another-post:comments');assert.equal(w.draft.getState().text,'');assert.equal(w.draft.getState().replyTo,null);
   console.log('PASS DOM: actual composer, deferred close guard, duplicate submission, failure/retry, context isolation and StrictMode-safe binding');
  } finally {w.happyDOM.abort();w.close();}
  return;
 }
 server=http.createServer((req,res)=>{const file=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;if(file){res.setHeader('Content-Type',file.endsWith('js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(dir,file)));}else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox']});
 for (const width of [360,393,1440]) {
  const page=await browser.newPage({viewport:{width,height:852}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#comment-trigger').click();const input=page.getByRole('textbox',{name:'Add a comment',exact:true});await input.waitFor();
  assert.equal(await input.evaluate(el=>el===document.activeElement),true,'composer receives focus');
  const geometry=await page.evaluate(()=>({card:document.querySelector('#comment-card').getBoundingClientRect().bottom,composer:document.querySelector('[aria-label="Comment composer"]').getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert(geometry.composer>=geometry.card,'composer never overlaps existing comment actions');assert(!geometry.overflow,'no horizontal overflow');
  assert.equal(await page.getByRole('button',{name:'Post comment',exact:true}).isDisabled(),true);
  await input.fill('   ');assert.equal(await page.getByRole('button',{name:'Post comment',exact:true}).isDisabled(),true);
  await input.fill('First line');await input.press('Shift+Enter');await input.type('Second line');assert.equal(await input.inputValue(),'First line\nSecond line');
  await input.press('Escape');await input.waitFor({state:'detached'});assert.equal(await page.locator('#comment-trigger').evaluate(el=>el===document.activeElement),true);
  await page.getByText('Reply',{exact:true}).click();const reply=page.getByRole('textbox',{name:'Reply to deviantevents',exact:true});await reply.waitFor();
  await page.screenshot({path:path.join(dir,`reply-${width}.png`),fullPage:true});
  await reply.fill('Keep my draft');await page.getByRole('button',{name:'Cancel reply',exact:true}).click();await input.waitFor();assert.equal(await input.inputValue(),'Keep my draft');
  await input.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,isComposing:true})));assert.equal(await page.evaluate(()=>calls.length),0,'IME does not send');
  await page.evaluate(()=>window.blocked=true);await input.press('Enter');assert.equal(await page.evaluate(()=>calls.length),0);assert.equal(await input.inputValue(),'Keep my draft');await page.evaluate(()=>window.blocked=false);
  await page.getByText('Reply',{exact:true}).click();await reply.waitFor();await page.evaluate(()=>window.fail=true);await reply.press('Enter');
  await page.getByRole('status').waitFor();assert.equal(await page.getByRole('button',{name:'Post reply',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>calls.length),1);
  await page.evaluate(()=>release());await page.getByRole('alert').waitFor();assert.equal(await reply.inputValue(),'Keep my draft');
  await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Post reply',exact:true}).click();await page.waitForFunction(()=>calls.length===2);await page.evaluate(()=>release());await reply.waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>calls[1]),{post:'fixture-post',text:'Keep my draft',parent:'17',replyToCommentId:'17',authorUsername:'viewer',authorId:'fixture-author'});
  await page.evaluate(()=>mount('root-thread'));await page.getByRole('button',{name:'Add a reply…',exact:true}).click();const threadInput=page.getByRole('textbox',{name:'Add a reply',exact:true});await threadInput.fill('Thread reply');await threadInput.press('Enter');await page.waitForFunction(()=>calls.length===3);assert.equal(await page.evaluate(()=>calls[2].parent),'root-thread');assert.equal(await page.evaluate(()=>calls[2].replyToCommentId),'root-thread');await page.evaluate(()=>release());await threadInput.waitFor({state:'detached'});
  // Narrow viewport + keyboard-sized available height + tab-bar clearance.
  await page.evaluate(()=>document.documentElement.style.setProperty('--dvnt-tabbar-clearance','80px'));await page.setViewportSize({width,height:400});await page.getByRole('button',{name:'Add a reply…',exact:true}).click();await threadInput.waitFor();await threadInput.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(dir,`keyboard-${width}.png`),fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: actual composer/rows at 360, 393 and 1440px; non-overlap, focus/close, cancel reply, whitespace, multiline, IME, admission, pending, failure/retry, thread payloads and keyboard-sized viewport. Evidence: '+dir);
 } finally {if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
