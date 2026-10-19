// Mount the real composer/editor, draft stores, publication hook and queue.
// Only auth, upload/network, navigation and unrelated presentation boundaries are
// fixtures. Default is Chromium; --dom is an offline ReactDOM/jsdom fallback.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const fixture = {
  'caption-fixture': `export const state={post:{id:'7',kind:'media',caption:'Old #caption',author:{id:'1'},media:[]},published:[],updated:[],navigations:[],uploads:[],people:[]};
    export const router={push:p=>state.navigations.push(p),replace:p=>state.navigations.push(p),back:()=>state.navigations.push('back')};
    export const createPost=async input=>{state.published.push(input);return {id:77}};
    export const uploadMultiple=async files=>{state.uploads.push(files);return files.map(file=>({success:true,type:file.type,url:'https://fixture.invalid/image.jpg'}))};`,
  // App-assisted import has separate React/IndexedDB contracts; keep this caption harness offline.
  './native-live-photo-handoff.web': `export const NativeLivePhotoHandoff=()=>null;`,
  'next/dynamic': `export default ()=>()=>null;`,
  'solito/navigation': `export {router as unused} from 'caption-fixture';import {router} from 'caption-fixture';export const useRouter=()=>router;export const useParams=()=>({id:'7'});`,
  'react-native': `export const Platform={OS:'web'};`,
  'lucide-react': ['Hash','X','ImagePlus','MapPin','Trash2','Plus','Type','Image','CalendarPlus','ArrowUp','ArrowDown','AlertCircle','Flame','ImageIcon','Play'].map(n=>`export const ${n}=()=>null;`).join('\n'),
  'react-native-mmkv': `export const createMMKV=()=>{throw new Error('native-only fixture')};`,
  '@dvnt/app/lib/hooks/use-verified-gate': `export const useVerifiedGate=()=> (_action,run)=>run();`,
  '@dvnt/app/lib/hooks/use-posts': `import {state,createPost} from 'caption-fixture';export const useCreatePost=()=>({mutateAsync:createPost});export const usePost=()=>({data:state.post,isLoading:false,isError:false});export const postKeys={detail:id=>['post',id],feedInfiniteAll:()=>['feed'],feedInfinite:()=>['feed'],profilePosts:()=>['profile']};`,
  '@dvnt/app/lib/hooks/use-media-upload': `import {uploadMultiple} from 'caption-fixture';export const useMediaUpload=()=>({uploadMultiple});`,
  '@dvnt/app/lib/stores/auth-store': `const state={user:{id:'1',authId:'owner',username:'member'}};export const useAuthStore=select=>select(state);useAuthStore.getState=()=>state;`,
  '@dvnt/app/lib/api/post-tags': `import {state} from 'caption-fixture';export const postTagsApi={addTags:async(id,tags)=>{state.people.push({id,tags})},getTagsForPost:async()=>[]};`,
  '@dvnt/app/lib/api/posts': `import {state} from 'caption-fixture';export const postsApi={updatePost:async(id,input)=>{state.updated.push({id,input});return {id}}};`,
  '@dvnt/app/lib/media/persist-local-selection': `export const POST_MEDIA_SCOPE='fixture';export const persistLocalMediaSelection=async uri=>uri;export const deletePersistedMediaSelection=async()=>{};`,
  '@dvnt/app/lib/posts/first-post-event': `export const assertFirstPostPublishable=async()=>{};`,
  '@dvnt/app/lib/profile/new-member-progress': `export const fetchNewMemberProgress=async()=>({step:'complete',hasPost:true});`,
  '@dvnt/app/lib/stores/first-post-offer-store': `export const useFirstPostOfferStore={getState:()=>({pendingEventId:null,clearPending(){}})};`,
  '@dvnt/app/lib/stores/ui-store': `export const useUIStore=select=>select({showToast:(_kind,_title,message)=>{throw new Error(message)}});`,
  '@dvnt/app/lib/stores/camera-result-store': `export const useCameraResultStore=select=>select({result:null});`,
  '@dvnt/app/lib/hooks/use-responsive-grid': `export const useResponsiveGrid=()=>({columns:2});`,
  '@dvnt/app/lib/stores/app-store': `export const useAppStore={getState:()=>({nsfwEnabled:false})};`,
  '@dvnt/ui': `export const FormField=({children,label})=><label>{label}{children}</label>;export const StickySaveBar=()=>null;export const useDirtyGuard=()=>{};`,
  '@tanstack/react-query': `export const useQuery=()=>({data:[]});export const useQueryClient=()=>({cancelQueries:async()=>{},getQueryData:()=>undefined,setQueryData(){},invalidateQueries(){}});export const useMutation=options=>({isPending:false,mutate:async(input,handlers)=>{await options.mutationFn(input);handlers?.onSuccess?.()}});`,
};
const scenario = `import React,{act} from 'react';import {createRoot} from 'react-dom/client';
import {CreatePostScreen} from './packages/app/features/create/create-post.web';
import {EditPostScreen} from './packages/app/features/post/edit-post.web';
import {useCreatePostStore} from '@dvnt/app/lib/stores/create-post-store';
import {useEditPostStore} from './packages/app/features/post/edit-post-store';
import {state} from 'caption-fixture';
import {clearUserDataFromStorage,registerUserDataReset} from '@dvnt/app/lib/utils/storage';
window.IS_REACT_ACT_ENVIRONMENT=true;
const check=(value,message)=>{if(!value)throw new Error(message)};
const root=createRoot(document.getElementById('root'));
const store=useCreatePostStore;
const media=[{id:'image',uri:'https://fixture.invalid/local.jpg',type:'image'}];
const button=name=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===name);
const flush=async run=>{await act(async()=>{await run?.();await new Promise(resolve=>setTimeout(resolve,0))})};
const setInput=async value=>{await flush(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})};
const restore=async(version,draft)=>{await flush(async()=>{store.getState().reset();localStorage.setItem('create-post-storage',JSON.stringify({version,state:draft}));await store.persist.rehydrate()})};
window.runCaptionScenarios=async()=>{
  await restore(0,null);
  check(store.getState().caption==='', 'malformed legacy draft does not break hydration');
  await restore(0,{caption:27,tags:{bad:true}});
  check(store.getState().caption==='', 'malformed caption and tags do not break migration');
  await restore(1,{caption:null,tags:null});
  check(store.getState().caption===''&&store.getState().tags.length===0,'malformed current draft is sanitized');
  await restore(0,{caption:'Hello #Café',tags:['CAFÉ','東京']});
  check(store.getState().caption==='Hello #Café\\n#東京','legacy media tags migrate once, case-insensitively');
  check(store.getState().tags.length===0,'migrated media tags clear');
  await flush(()=>store.getState().setCaption('Hello'));
  await flush(()=>store.persist.rehydrate());
  check(store.getState().caption==='Hello','deleted migrated tags do not return after reload');
  await restore(0,{postKind:'text',tags:['music'],textSlides:[{id:'1',order:0,content:'Text card'}]});
  check(store.getState().tags[0]==='music','legacy text-card tags are preserved');
  await flush(()=>root.render(<CreatePostScreen/>));
  check(!!document.querySelector('input[placeholder="Add tag"]'),'text-card tag input stays available');
  await flush(()=>store.getState().setPostKind('media'));
  await flush(()=>store.persist.rehydrate());
  await flush(()=>store.getState().setPostKind('text'));
  check(store.getState().tags[0]==='music','text tags survive mode round trip and reload');
  await flush(()=>{store.getState().setPostKind('media');store.getState().setSelectedMedia(media)});
  check(!document.querySelector('input[placeholder="Add tag"]'),'media only has inline caption tags');
  check(document.querySelector('textarea').maxLength===8000,'hashtags can exceed the prose input ceiling');
  const caption='x'.repeat(2200)+'\\n#Café #東京';
  await setInput(caption);
  check(store.getState().caption===caption,'pasted caption reaches real draft store intact');
  check(document.body.textContent.includes('2200/2200'),'prose-only counter at boundary');
  check(!button('Share').disabled,'valid caption plus hashtags can share');
  await setInput('x'+caption);
  check(button('Share').disabled,'overlong prose disables Share');
  check(!!document.querySelector('[role="alert"]'),'overlong caption shows explanation');
  await setInput(Array(31).fill('#same').join(' '));
  check(button('Share').disabled,'hashtag abuse bound disables Share');
  await setInput(caption);
  await flush(()=>{button('Share').click();button('Share')?.click()});
  check(state.published.length===1,'repeated Share only publishes once');
  check(state.published[0].content===caption,'actual publish hook keeps inline caption without text-card tags');
  check(state.uploads.length===1,'real queue still uploads the selected media once');
  check(store.getState().caption==='','successful publication resets draft');
  await flush(()=>{useEditPostStore.getState().reset();root.render(<EditPostScreen/>)});
  check(document.querySelector('textarea').value==='Old #caption','edit reopens stored inline hashtags');
  await setInput(caption);
  check(!button('Save').disabled,'editor accepts boundary prose plus hashtags');
  await setInput('x'+caption);
  check(button('Save').disabled,'editor refuses overlong prose');
  await setInput(caption);
  await flush(()=>button('Save').click());
  check(state.updated.length===1&&state.updated[0].input.content===caption,'editor submits exact inline caption');
  let resetAfterFailure=false;
  const unregisterThrow=registerUserDataReset(()=>{throw new Error('Expected reset failure fixture')});
  const unregisterLater=registerUserDataReset(()=>{resetAfterFailure=true});
  await flush(()=>{store.getState().setCaption('Private draft');clearUserDataFromStorage()});
  check(resetAfterFailure,'one failed store reset does not block later callbacks');
  unregisterThrow();unregisterLater();
  check(store.getState().caption==='', 'sign-out clears in-memory caption');
  check(localStorage.getItem('create-post-storage')===null,'sign-out removes persisted draft');
  await flush(()=>root.unmount());
  return 'PASS: mounted composer/editor, real publish queue, legacy migration and reload assertions';
};`;
(async () => {
  const result = await esbuild.build({stdin:{contents:scenario,resolveDir:ROOT,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_ENABLE_NATIVE_LIVE_PHOTO_HANDOFF':'"false"'},plugins:[{name:'caption-boundaries',setup(build){
    build.onResolve({filter:/.*/},args=>{
      if(Object.hasOwn(fixture,args.path))return {path:args.path,namespace:'fixture'};
      if(args.path.endsWith('create-post-location.web'))return {path:'next/dynamic',namespace:'fixture'};
      if(args.path.startsWith('@dvnt/app/')){const stem=path.join(ROOT,'packages/app',args.path.slice('@dvnt/app/'.length));for(const suffix of ['','.ts','.tsx'])if(fs.existsSync(stem+suffix))return {path:stem+suffix};}
    });
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixture[args.path],loader:'tsx',resolveDir:ROOT}));
  }}]});
  const bundle=result.outputFiles[0].text;
  if(process.argv.includes('--dom')){
    const {JSDOM}=require('jsdom');
    const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true});
    dom.window.MessageChannel=class {constructor(){this.port1={onmessage:null};this.port2={postMessage:()=>setTimeout(()=>this.port1.onmessage?.(),0)}}};
    dom.window.eval(bundle);
    try{console.log(await dom.window.runCaptionScenarios())}finally{dom.window.close()}
    return;
  }
  let chromium;try{({chromium}=require('playwright'))}catch{({chromium}=require('@playwright/test'))}
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.addScriptTag({content:bundle});
    console.log(await page.evaluate(()=>window.runCaptionScenarios()));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
