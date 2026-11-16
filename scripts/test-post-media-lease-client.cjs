const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const React=require('react');
const {createRoot}=require('react-dom/client');
const {JSDOM}=require('jsdom');
const {act}=React;
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function load(file,imports={}){
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',code)(name=>{if(name in imports)return imports[name];if(name==='react'||name==='react/jsx-runtime')return require(name);throw Error('Missing '+name);},exports);return exports;
}
const signedUrls=load('packages/app/lib/media/signed-media-lease-url.ts');
const core=load('packages/app/lib/media/post-media-lease.ts',{'./signed-media-lease-url':signedUrls});
function fixture(){let now=1000000;let next=0;const timers=new Map();const requests=[];
 const cache=core.createPostMediaLeaseCache(id=>{const d=deferred();requests.push({...d,id});return d.promise;},{now:()=>now,schedule:(fn,ms)=>{const id=++next;timers.set(id,{fn,at:now+ms});return id;},cancel:id=>timers.delete(id)});
 return{cache,requests,now:()=>now,advance:async ms=>{now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await tick();},lease:(id=1,overrides={})=>({postId:id,expiresAt:Math.floor(now/1000)+120,media:[{order:0,type:'image',url:`https://fixture.invalid/post-image/a.jpg?token=HS256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&expires=${Math.floor(now/1000)+120}`,thumbnail:`https://fixture.invalid/post-image/t.jpg?token=HS256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&expires=${Math.floor(now/1000)+120}`,livePhotoVideoUrl:`https://fixture.invalid/post-video/a.mov?token=HS256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&expires=${Math.floor(now/1000)+120}`}],...overrides})};
}
test('lease blocks raw fallback, renews before expiry, retires stale responses',async()=>{
 const f=fixture();const release=f.cache.retain('1');await tick();assert.deepEqual(f.cache.snapshot('1'),[]);
 f.requests[0].resolve(f.lease());await tick();assert.equal(f.cache.snapshot('1')[0].type,'livePhoto');
 await f.advance(100000);assert.equal(f.requests.length,2);
 f.cache.retire();await tick();assert.deepEqual(f.cache.snapshot('1'),[]);
 f.requests[1].resolve(f.lease());await tick();assert.deepEqual(f.cache.snapshot('1'),[]);
 f.requests[2].reject(Error('access denied'));await tick();assert.deepEqual(f.cache.snapshot('1'),[]);release();
});
test('stalled renewal cannot retain expired sources',async()=>{
 const f=fixture();const release=f.cache.retain('1');await tick();f.requests[0].resolve(f.lease());await tick();
 await f.advance(120001);assert.deepEqual(f.cache.snapshot('1'),[]);release();
});
for(const kind of ['raw','wrong-post','duplicate-order','negative-order','empty','oversize','too-long','expired'])test(`invalid lease fails closed: ${kind}`,async()=>{
 const f=fixture();const release=f.cache.retain('1');await tick();const lease=f.lease();
 if(kind==='negative-order')lease.media[0].order=-1;
 if(kind==='empty')lease.media=[];
 if(kind==='oversize')lease.media=Array.from({length:21},(_,order)=>({...lease.media[0],order}));
 if(kind==='raw')lease.media[0].url='https://fixture.invalid/post-image/raw.jpg';
 if(kind==='wrong-post')lease.postId=2;
 if(kind==='duplicate-order')lease.media.push({...lease.media[0]});
 if(kind==='too-long')lease.expiresAt+=300;
 if(kind==='expired')lease.expiresAt-=121;
 f.requests[0].resolve(lease);await tick();assert.deepEqual(f.cache.snapshot('1'),[]);release();
});
test('last viewer release retires pending capability and reacquire reauthorizes',async()=>{
 const f=fixture();const a=f.cache.retain('1');await tick();a();const b=f.cache.retain('1');await tick();
 f.requests[0].resolve(f.lease());await tick();assert.deepEqual(f.cache.snapshot('1'),[]);
 f.requests[1].resolve(f.lease());await tick();assert.equal(f.cache.snapshot('1').length,1);b();
});
test('mounted hook never renders raw source and removes media after expiry/denial',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const f=fixture();let enabled=true;
 const hook=load('packages/app/lib/media/use-post-media-lease.ts',{'react-native':{AppState:{addEventListener:()=>({remove(){}})}},'./post-media-delivery':{protectedPostMediaEnabled:()=>enabled},'./post-media-lease-runtime':{postMediaLeases:f.cache},'./post-media-lease':core});
 function Surface(){const media=hook.usePostMediaLease('1',[{url:'https://fixture.invalid/RAW'}]);return React.createElement('div',null,...media.flatMap(m=>[React.createElement('img',{key:'still',src:m.url}),m.thumbnail&&React.createElement('img',{key:'thumb',src:m.thumbnail}),m.livePhotoVideoUrl&&React.createElement('video',{key:'motion',src:m.livePhotoVideoUrl})]));}
 const mount=createRoot(document.getElementById('root'));
 await act(async()=>{mount.render(React.createElement(Surface));await tick();});assert.equal(document.querySelectorAll('img,video').length,0);
 await act(async()=>{f.requests[0].resolve(f.lease());await tick();});assert.equal(document.querySelectorAll('img,video').length,3);assert.doesNotMatch(document.body.innerHTML,/RAW/);
 await act(async()=>{await f.advance(120001);});assert.equal(document.querySelectorAll('img,video').length,0);
 await act(async()=>{f.requests[1].reject(Error('revoked'));await tick();});assert.equal(document.querySelectorAll('img,video').length,0);
 await act(async()=>{mount.unmount();});dom.window.close();delete global.window;delete global.document;
});
test('disabled hook preserves legacy media without contacting lease endpoint',async()=>{
 const dom=new JSDOM('<div id="root"></div>');global.window=dom.window;global.document=dom.window.document;
 const f=fixture();const hook=load('packages/app/lib/media/use-post-media-lease.ts',{'react-native':{AppState:{}},'./post-media-delivery':{protectedPostMediaEnabled:()=>false},'./post-media-lease-runtime':{postMediaLeases:f.cache},'./post-media-lease':core});
 function Surface(){return React.createElement('img',{src:hook.usePostMediaLease('1',[{url:'https://fixture.invalid/legacy'}])[0].url});}
 const mount=createRoot(document.getElementById('root'));await act(async()=>{mount.render(React.createElement(Surface));});assert.match(document.body.innerHTML,/legacy/);assert.equal(f.requests.length,0);await act(async()=>mount.unmount());dom.window.close();delete global.window;delete global.document;
});
test('actual runtime retires capabilities across account roundtrips, session and follow reset',async()=>{
 const f=fixture();const requests=[];const subscribers=[];let state={isAuthenticated:true,user:{id:'1',authId:'A'}};
 const auth={getState:()=>state,subscribe:fn=>subscribers.push(fn)};let session;
 const events=load('packages/app/lib/media/post-media-lease-events.ts');
 const runtime=load('packages/app/lib/media/post-media-lease-runtime.ts',{
  'react-native':{AppState:{addEventListener(){}}},
  './post-media-lease-events':events,
  '@dvnt/app/lib/api/invoke-edge':{invokeEdge:()=>{const d=deferred();requests.push(d);return d.promise;}},
  '@dvnt/app/lib/stores/auth-store':{useAuthStore:auth},
  '@dvnt/app/lib/stores/app-store':{useAppStore:{subscribe(){}}},
  '@dvnt/app/lib/auth/session-lifecycle':{subscribeSessionLifecycle:fn=>{session=fn;}},
  './post-media-lease':{createPostMediaLeaseCache:fetch=>core.createPostMediaLeaseCache(fetch,{now:f.now,schedule:()=>0,cancel(){}})},
 });
 const cache=runtime.postMediaLeases;const release=cache.retain('1');await tick();
 for(const id of ['B','A']){const old=state;state={...state,user:{id,authId:id}};subscribers.forEach(fn=>fn(state,old));}
 await tick();requests[0].resolve({data:f.lease()});await tick();assert.deepEqual(cache.snapshot('1'),[]);
 requests.at(-1).resolve({data:f.lease()});await tick();assert.equal(cache.snapshot('1').length,1);
 session();assert.deepEqual(cache.snapshot('1'),[]);await tick();requests.at(-1).resolve({data:f.lease()});await tick();
 events.retirePostMediaLeases();assert.deepEqual(cache.snapshot('1'),[]);release();
});
test('mounted production media renderer receives only leased still/GIF/video/motion/poster sources',async()=>{
 const dom=new JSDOM('<div id="root"></div>');global.window=dom.window;global.document=dom.window.document;
 const f=fixture();const hook=load('packages/app/lib/media/use-post-media-lease.ts',{'./post-media-delivery':{protectedPostMediaEnabled:()=>true},'./post-media-lease-runtime':{postMediaLeases:f.cache},'./post-media-lease':core});
 const image=({source})=>React.createElement('img',{src:source?.uri});
 const moving=({uri})=>React.createElement('video',{src:uri});
 const ui=load('packages/app/components/media/DVNTMediaRenderer.tsx',{
  'react-native':{View:({children})=>React.createElement('div',null,children)},'expo-image':{Image:image},
  './DVNTGifView':{DVNTGifView:({uri})=>React.createElement('img',{src:uri})},
  './DVNTAnimatedVideoView':{DVNTAnimatedVideoView:moving},'./DVNTMediaBadge':{DVNTMediaBadge:()=>null},
  './DVNTLivePhotoView':{DVNTLivePhotoView:({photoUri,videoUri})=>React.createElement('div',null,React.createElement('img',{src:photoUri}),React.createElement('video',{src:videoUri}))},
 });
 function Surface(){return React.createElement('div',null,...hook.usePostMediaLease('1',[{url:'RAW'}]).map(m=>React.createElement(ui.DVNTMediaRenderer,{key:m.order,item:{...m,updatedAt:123},width:100,height:100})));}
 const mount=createRoot(document.getElementById('root'));await act(async()=>{mount.render(React.createElement(Surface));await tick();});assert.equal(document.querySelectorAll('img,video').length,0);
 const lease=f.lease();const seed=lease.media[0];lease.media=['image','gif','video','animated_video','livePhoto'].map((type,order)=>({...seed,order,type,mimeType:undefined,livePhotoVideoUrl:type==='livePhoto'?seed.livePhotoVideoUrl:undefined}));
 await act(async()=>{f.requests[0].resolve(lease);await tick();});
 const sources=[...document.querySelectorAll('img,video')].map(x=>x.getAttribute('src'));assert.equal(sources.length,6);for(const src of sources){assert.match(src,/token=HS256-/);assert.doesNotMatch(src,/RAW|[?&]v=/);}
 await act(async()=>{f.cache.retire();await tick();});assert.equal(document.querySelectorAll('img,video').length,0);
 await act(async()=>mount.unmount());dom.window.close();delete global.window;delete global.document;
});
test('legacy poster rows and MP4 animated MIME keep correct renderer kind and order',async()=>{
 const f=fixture();const release=f.cache.retain('1');await tick();const lease=f.lease();const url=lease.media[0].url;
 lease.media=[{order:3,type:'thumbnail',url},{order:1,type:'video',mimeType:'video/mp4+animated',url}];
 f.requests[0].resolve(lease);await tick();const media=f.cache.snapshot('1');assert.equal(media.length,1);assert.equal(media[0].order,1);assert.equal(media[0].type,'animated_video');assert.equal(media[0].thumbnail,url);release();
});

test('default browser clock preserves native timer receiver during lease retirement', async()=>{
 const vm=require('node:vm');
 const code=ts.transpileModule(fs.readFileSync(path.join(root,'packages/app/lib/media/post-media-lease.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=vm.createContext({exports:{},require:()=>signedUrls,Date});
 vm.runInContext(`let schedules=0,cancels=0; function setTimeout(){ if(this!==globalThis)throw Error('Illegal invocation'); return ++schedules; } function clearTimeout(){ if(this!==globalThis)throw Error('Illegal invocation'); cancels++; }`,context);
 vm.runInContext(code,context);
 const expiresAt=Math.floor(Date.now()/1000)+120;
 const cache=context.exports.createPostMediaLeaseCache(async()=>({postId:1,expiresAt,media:[{order:0,type:'image',url:`https://fixture.invalid/post-image/a.jpg?token=HS256-${'a'.repeat(43)}&expires=${expiresAt}`}]}));
 const release=cache.retain('1');await tick();assert.equal(cache.snapshot('1').length,1);
 cache.retire();await tick();release();
 assert.ok(vm.runInContext('schedules>=2 && cancels>=4',context));
});
