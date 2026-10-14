/** Exercise the real web action, mutation and API; only authentication/network use fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');

const auth = `export const useAuthStore=(selector)=>selector(globalThis.fixtureAuth);
useAuthStore.getState=()=>globalThis.fixtureAuth;`;
const network = `export const supabase={functions:{async invoke(name,options){
 globalThis.calls.push({name,options});
 await new Promise(resolve=>globalThis.releaseRequest=resolve);
 return globalThis.rejectRequest?{data:{ok:false,error:{message:'Server rejected deletion'}},error:null}:{data:{ok:true,data:{success:true}},error:null};
}}};`;

(async () => {
 const build = await esbuild.build({stdin:{contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {DeleteCommentAction} from './packages/app/features/comments/ui/delete-comment-action.web';
import {commentKeys} from './packages/app/lib/query-keys';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const root=createRoot(document.getElementById('root'));
globalThis.fixtureAuth={isAuthenticated:true,user:{id:'fixture-owner',username:'owner'}};
globalThis.calls=[];globalThis.rejectRequest=false;
const parent={id:'17',username:'owner',replies:[{id:'18',username:'owner',parentId:'17'},{id:'19',username:'other',parentId:'17'}]};
const listKey=[...commentKeys.byPost('fixture-post'),50];
const previewKey=[...commentKeys.byPost('fixture-post'),3];
const threadKey=commentKeys.thread('fixture-post','17');
const seed=()=>{client.setQueryData(listKey,[parent]);client.setQueryData(previewKey,[parent]);client.setQueryData(threadKey,{parentComment:parent,replies:parent.replies});};
const render=(comment=parent)=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(DeleteCommentAction,{key:comment.id,comment,postId:'fixture-post'})));
const wait=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('UI failed to settle: '+document.body.textContent);};
const button=(label)=>[...document.querySelectorAll('button')].find(el=>el.textContent===label);
const check=(condition,message)=>{if(!condition)throw new Error(message);};
window.result=(async()=>{
 seed();render();await wait(()=>button('Delete'));
 button('Delete').click();await wait(()=>button('Keep'));check(calls.length===0,'opening confirmation must not delete');
 button('Keep').click();await wait(()=>button('Delete'));check(calls.length===0,'cancel must not delete');
 button('Delete').click();await wait(()=>button('Delete for good'));
 globalThis.rejectRequest=true;button('Delete for good').click();button('Delete for good')?.click();
 await wait(()=>calls.length===1&&button('Deleting…'));check(button('Deleting…').disabled,'pending button must disable');
 check(calls[0].name==='delete-comment','use existing gateway');
 check(calls[0].options.body.commentId===17,'gateway receives numeric ID');
 check(calls[0].options.headers.Authorization==='Bearer fixture-session','authenticated request');
 check(client.getQueryData(listKey).length===1,'do not delete before success');
 releaseRequest();await wait(()=>document.querySelector('[role=alert]'));
 check(client.getQueryData(listKey).length===1,'failed deletion must preserve comments');
 globalThis.rejectRequest=false;button('Delete for good').click();await wait(()=>calls.length===2);releaseRequest();
 await wait(()=>client.getQueryData(listKey).length===0);
 check(client.getQueryData(previewKey).length===0,'preview cache updated');
 check(client.getQueryData(threadKey)===null,'deleted root makes thread unavailable');
 seed();render(parent.replies[0]);await wait(()=>document.querySelector('[data-comment-id="18"]')&&button('Delete'));button('Delete').click();await wait(()=>button('Delete for good'));
 button('Delete for good').click();await wait(()=>calls.length===3);releaseRequest();
 await wait(()=>client.getQueryData(threadKey).replies.length===1);
 check(client.getQueryData(listKey)[0].replies[0].id==='19','reply deletion preserves sibling');
 render({id:'20',username:'other'});await wait(()=>!button('Delete'));
 fixtureAuth={isAuthenticated:false,user:null};render({id:'21',username:'owner'});await new Promise(r=>setTimeout(r,30));
 check(!button('Delete'),'guest has no delete');
 fixtureAuth={isAuthenticated:true,user:{id:'fixture-owner',username:'owner'}};render({id:'temp-1',username:'owner'});await new Promise(r=>setTimeout(r,30));
 check(!button('Delete'),'optimistic IDs have no delete');
 check(calls.length===3,'no unauthorized extra requests');
 root.unmount();client.clear();return 'PASS';
})();
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixture-boundaries',setup(build){
 build.onResolve({filter:/auth-store$|supabase\/client$|auth\/identity$/},args=>({path:args.path,namespace:'fixtures'}));
 build.onLoad({filter:/.*/,namespace:'fixtures'},args=>({contents:args.path.includes('auth-store')?auth:args.path.includes('identity')?`export async function requireBetterAuthToken(){return 'fixture-session'}; export const getBetterAuthToken=requireBetterAuthToken;`:network,loader:'js'}));
 build.onResolve({filter:/^@dvnt\/app\//},args=>({path:path.join(process.cwd(),'packages/app',args.path.slice('@dvnt/app/'.length))+'.ts'}));
 build.onResolve({filter:/^(react|react\/jsx-runtime|react-dom\/client|@tanstack\/react-query|zustand)$/},args=>({path:require.resolve(args.path)}));
 }}]});
 const html='<html><body><div id="root"></div></body></html>';
 if(process.argv.includes('--dom')) {
   const {JSDOM}=require('jsdom');
   const dom=new JSDOM(html,{url:'https://example.test',runScripts:'dangerously'});
   try{dom.window.eval(build.outputFiles[0].text);assert.equal(await dom.window.result,'PASS');}finally{dom.window.close();}
 } else {
   const {chromium}=require('playwright');
   const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(build.outputFiles[0].contents);}else{res.end(html+'<script src="/bundle.js"></script>');}});
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   let browser;
   try{
     browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox']});
     const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
     assert.equal(await page.evaluate(()=>window.result),'PASS');
   }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
 }
 console.log('PASS: own-comment confirmation, cancel, pending, authenticated deletion, failure/retry, root/reply caches, other-user and guest boundaries');
})().catch(error=>{console.error(error);process.exitCode=1;});
