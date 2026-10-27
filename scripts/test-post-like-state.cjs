#!/usr/bin/env node
// Real centralized like hook + TanStack cache. Auth and network are offline
// fixtures: no live requests, data writes, or deployment are involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, {window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT:true});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-like-state-'));
  let app, f;
  const postsSource = fs.readFileSync(path.join(ROOT, 'packages/app/lib/hooks/use-posts.ts'), 'utf8');
  const syncSource = postsSource.split('export function useSyncLikedPosts()')[1].split('// Create post mutation')[0];
  const serverSyncSource = 'export async function withServerLikeSync<T>(' + postsSource.split('async function withServerLikeSync<T>(')[1].split('// Track in-flight like mutations')[0];
  const likedPostsMethod = fs.readFileSync(path.join(ROOT,'packages/app/lib/api/users.ts'),'utf8').split('  async getLikedPosts()')[1].split('\n  /**')[0];
  const fixture = {
    'real-liked-posts-api': `import {supabase} from '../supabase/client';import {requireBetterAuthToken} from '../auth/identity';export const realUsersApi={async getLikedPosts()${likedPostsMethod}};`,
    'real-sync-liked-posts': `import {useQuery,useQueryClient} from '@tanstack/react-query';import {useAuthStore} from '@dvnt/app/lib/stores/auth-store';import {captureServerLikeSync} from '${ROOT}/packages/app/lib/posts/like-state-sync';import {updatePostLikeEverywhere} from '${ROOT}/packages/app/lib/query/patch';const STALE_TIMES={likedPosts:0},GC_TIMES={standard:0};${serverSyncSource}export function useSyncLikedPosts()${syncSource}`,
    '@dvnt/app/lib/api/users': `export const syncRequests=[];export const usersApi={getLikedPosts:()=>new Promise((resolve,reject)=>syncRequests.push({resolve,reject}))};`,
    '@dvnt/app/lib/stores/post-store': `export const synced=[];export const usePostStore={getState:()=>({syncLikedPosts:value=>synced.push(value)})};`,
    '../auth/identity': `export const tokens=[];export const requireBetterAuthToken=()=>new Promise(resolve=>tokens.push(resolve));export const hasAuthenticatedUser=()=>true;`,
    '../supabase/client': `export const writes=[];let response={data:{ok:true,data:{liked:true,likesCount:8}}};export const setResponse=value=>response=value;export const supabase={functions:{invoke:async(name,options)=>{writes.push({name,options});return response;}}};`,
    '@dvnt/app/lib/stores/auth-store': `import {create} from 'zustand';export const useAuthStore=create(()=>({user:{id:'viewer-a'}}));`,
    '@dvnt/app/lib/stores/ui-store': `export const toasts=[];export const useUIStore={getState:()=>({showToast:(...v)=>toasts.push(v)})};`,
    '@dvnt/app/lib/stores/app-store': `export const useAppStore={getState:()=>({nsfwEnabled:false})};`,
    '@dvnt/app/lib/hooks/use-posts': `export {postKeys} from '${ROOT}/packages/app/lib/query-keys';`,
    '@dvnt/app/lib/hooks/use-activities-query': `export {activityKeys} from '${ROOT}/packages/app/lib/query-keys';`,
    '@dvnt/app/lib/api/likes': `export const requests=[];const request=(postId)=>new Promise((resolve,reject)=>requests.push({postId,resolve,reject}));export const likesApi={likePost:request,unlikePost:request};`,
  };
  try {
    await build({stdin:{contents:`
      import React,{act} from 'react';import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {usePostLikeState,seedLikeState} from './packages/app/lib/hooks/usePostLikeState';
      import {useAuthStore} from '@dvnt/app/lib/stores/auth-store';
      import {requests} from '@dvnt/app/lib/api/likes';
      import {toasts} from '@dvnt/app/lib/stores/ui-store';
      import {postKeys,likeStateKeys,activityKeys} from './packages/app/lib/query-keys';
      import {captureServerLikeSync,markPostLikeMutation} from './packages/app/lib/posts/like-state-sync';
      export {captureServerLikeSync,markPostLikeMutation};
      import {likesApi as realLikesApi} from './packages/app/lib/api/likes';
      import {tokens} from '../auth/identity';import {writes,setResponse} from '../supabase/client';
      import {realUsersApi} from 'real-liked-posts-api';export {realUsersApi,setResponse};
      import {useSyncLikedPosts,withServerLikeSync} from 'real-sync-liked-posts';export {withServerLikeSync};
      import {syncRequests} from '@dvnt/app/lib/api/users';import {synced} from '@dvnt/app/lib/stores/post-store';export {synced};
      export {realLikesApi,tokens,writes,syncRequests};
      function SyncProbe(){useSyncLikedPosts();return null;}
      export function mountSync(node){const root=createRoot(node);root.render(<QueryClientProvider client={client}><SyncProbe/></QueryClientProvider>);return ()=>root.unmount();}
      export {act,useAuthStore,requests,toasts,postKeys,likeStateKeys,activityKeys,seedLikeState};
      export const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false,gcTime:Infinity}}});
      export const states={};
      function Probe({name,postId,likes,liked}){states[name]=usePostLikeState(postId,likes,liked);return null;}
      export function mount(node){const root=createRoot(node);return {render:(likes=10,liked=false,postId='11')=>root.render(<React.StrictMode><QueryClientProvider client={client}><Probe name='feed' postId={postId} likes={likes} liked={liked}/><Probe name='detail' postId={postId} likes={likes} liked={liked}/></QueryClientProvider></React.StrictMode>),unmount:()=>root.unmount()};}
    `,resolveDir:ROOT,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',define:{__DEV__:'false'},tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},outfile:path.join(dir,'test.cjs'),nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),plugins:[{name:'offline',setup(b){b.onResolve({filter:/.*/},a=>{if(fixture[a.path])return {path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/')) {const stem=path.join(ROOT,'packages/app',a.path.slice(10));for(const suffix of ['.ts', '.tsx', ''])if(fs.existsSync(stem+suffix)&&fs.statSync(stem+suffix).isFile())return {path:stem+suffix};}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixture[a.path],loader:'tsx',resolveDir:ROOT}));}}]});
    f = require(path.join(dir,'test.cjs'));
    const node=document.createElement('div');document.body.append(node);app=f.mount(node);
    const flush=async(run)=>f.act(async()=>{await run?.();await new Promise(r=>setTimeout(r,20));});
    const p=(id='11')=>({id,likes:10,viewerHasLiked:false,comments:3,author:{id:'author',username:'author'},media:[]});
    const key=f.likeStateKeys.forPost('viewer-a','11');
    const otherKey=f.likeStateKeys.forPost('viewer-b','11');
    const sweet=f.postKeys.feedInfinite(false),spicy=f.postKeys.feedInfinite(true),detail=f.postKeys.detail('11'),profile=f.postKeys.profilePosts('author');
    const seed=()=>{f.client.setQueryData(sweet,{pages:[{data:[p(),p('12')]}],pageParams:[0]});f.client.setQueryData(spicy,{pages:[{posts:[p()]}],pageParams:[0]});f.client.setQueryData(detail,p());f.client.setQueryData(profile,[p()]);f.client.setQueryData(f.postKeys.feed(),[p()]);};
    seed();await flush(()=>app.render());
    await flush(()=>{f.states.feed.toggle();f.states.feed.toggle();f.states.detail.toggle();});
    assert.equal(f.requests.length,1,'rapid taps and separate mounted views send one non-idempotent toggle');
    assert.equal(f.states.feed.likes,11);assert.equal(f.states.detail.hasLiked,true);
    assert.equal(f.states.detail.isPending,true,'all views observe the same pending operation');
    assert.equal(f.client.getQueryData(sweet).pages[0].data[0].likes,11,'sweet infinite feed is patched');
    assert.equal(f.client.getQueryData(spicy).pages[0].posts[0].likes,11,'spicy posts-shaped feed is patched');
    assert.equal(f.client.getQueryData(profile)[0].likes,11);
    f.client.setQueryData(otherKey,{hasLiked:false,likes:10});
    const readDuringPending=f.captureServerLikeSync(f.client,'viewer-a');
    await flush(()=>f.requests[0].resolve({liked:true,likes:12}));
    assert.deepEqual(f.client.getQueryData(key),{hasLiked:true,likes:12});
    readDuringPending({id:'11',likes:10,viewerHasLiked:false});
    assert.deepEqual(f.client.getQueryData(key),{hasLiked:true,likes:12},'read started during pending cannot undo settled result');
    assert.equal(f.client.getQueryData(otherKey).hasLiked,false,'one viewer never supplies another viewer\'s heart state');
    await flush(()=>f.states.feed.unlike());
    assert.equal(f.requests.length,2,'lock is released after success');
    f.client.setQueryData(detail,old=>({...old,comments:9}));
    f.client.setQueryData(sweet,old=>({...old,pages:[{...old.pages[0],data:old.pages[0].data.map(v=>v.id==='12'?{...v,likes:50}:v)}]}));
    await flush(()=>f.requests[1].reject(new Error('network unavailable')));
    assert.deepEqual(f.client.getQueryData(key),{hasLiked:true,likes:12});
    assert.equal(f.client.getQueryData(detail).comments,9,'rollback does not overwrite newer comments');
    assert.equal(f.client.getQueryData(sweet).pages[0].data[1].likes,50,'rollback does not overwrite another post');
    assert.equal(f.client.getQueryData(profile)[0].likes,12,'profile rollback matches the like state');
    assert.equal(f.toasts.length,1);
    await flush(()=>{f.states.feed.unlike();f.seedLikeState(f.client,'viewer-a','11',true,99);});
    assert.equal(f.requests.length,3);assert.equal(f.states.feed.likes,11,'server seed cannot overwrite an in-flight optimistic unlike');
    await flush(()=>{f.useAuthStore.setState({user:{id:'viewer-b'}});f.client.setQueryData(detail,{...p(),likes:30});});
    await flush(()=>f.requests[2].resolve({liked:false,likes:11}));
    assert.equal(f.client.getQueryData(detail).likes,30,'late response from previous viewer cannot overwrite current cache');
    assert.equal(f.client.getQueryData(otherKey).hasLiked,false);
    await flush(()=>{f.useAuthStore.setState({user:{id:'viewer-a'}});f.client.clear();app.render(0,false,'13');});
    await flush(()=>{f.captureServerLikeSync(f.client,'viewer-a')({id:'13',likes:7,viewerHasLiked:true});app.render(7,true,'13');});await flush();
    assert.equal(f.states.feed.likes,7,'async detail data replaces the initial empty seed');
    assert.equal(f.states.feed.hasLiked,true);
    await flush(()=>{f.useAuthStore.setState({user:null});});
    const before=f.requests.length;await flush(()=>f.states.feed.toggle());
    assert.equal(f.requests.length,before,'signed-out viewers cannot dispatch likes');
    // Fresh server snapshots hydrate even before the next tile mounts.
    await flush(()=>f.useAuthStore.setState({user:{id:'viewer-a'}}));
    const firstMountKey=f.likeStateKeys.forPost('viewer-a','14');
    f.client.setQueryData(firstMountKey,{hasLiked:false,likes:0});
    await f.withServerLikeSync(f.client,async()=>[{id:'14',likes:7,viewerHasLiked:true}],posts=>posts);
    await flush(()=>app.render(7,true,'14'));
    assert.equal(f.states.feed.likes,7,'fresh server read replaces stale cache before tile mount');
    let resolveStale;const stale=f.withServerLikeSync(f.client,()=>new Promise(resolve=>{resolveStale=resolve;}),posts=>posts);
    f.markPostLikeMutation(f.client,'14');
    f.client.setQueryData(firstMountKey,{hasLiked:false,likes:6});
    f.markPostLikeMutation(f.client,'14');
    const stalePost={id:'14',likes:7,viewerHasLiked:true};resolveStale([stalePost]);await stale;
    assert.deepEqual(stalePost,{id:'14',likes:6,viewerHasLiked:false},'stale post payload cannot re-seed native parent with old likes');
    assert.equal(f.client.getQueryData(firstMountKey).likes,6,'read started before a completed toggle cannot undo it');
    // The actual liked-post sync function must not reapply an older read.
    await flush(()=>f.useAuthStore.setState({user:{id:'viewer-a'}}));
    f.client.setQueryData(key,{hasLiked:true,likes:12});
    const syncNode=document.createElement('div');document.body.append(syncNode);let unmountSync;
    await flush(()=>{unmountSync=f.mountSync(syncNode);});await flush();
    assert.equal(f.syncRequests.length,1);
    f.client.setQueryData(key,{hasLiked:false,likes:11});
    await flush(()=>f.syncRequests[0].resolve(['11']));
    assert.equal(f.client.getQueryData(key).hasLiked,false,'stale sync cannot re-light a newly unliked post');
    f.client.setQueryData(key,{hasLiked:true,likes:12});
    await flush(()=>{void f.client.invalidateQueries({queryKey:['likedPosts','viewer-a']});});
    assert.equal(f.syncRequests.length,2);
    await flush(()=>f.syncRequests[1].resolve([]));
    assert.equal(f.client.getQueryData(key).hasLiked,true,'empty/truncated ID list cannot prove an unlike');
    f.client.setQueryData(key,{hasLiked:false,likes:11});
    f.client.setQueryData(detail,{...p(),viewerHasLiked:false,likes:11});
    await flush(()=>{void f.client.invalidateQueries({queryKey:['likedPosts','viewer-a']});});
    await flush(()=>f.syncRequests[2].resolve(['11']));
    assert.equal(f.client.getQueryData(key).hasLiked,true,'fresh positive membership is applied');
    assert.equal(f.client.getQueryData(detail).viewerHasLiked,true,'fresh positive heart reaches cached post payloads');
    const syncedPost=f.client.getQueryData(detail);f.seedLikeState(f.client,'viewer-a','11',syncedPost.viewerHasLiked,syncedPost.likes);
    assert.equal(f.client.getQueryData(key).hasLiked,true,'native feed seed retains freshly synced heart');
    await flush(()=>{void f.client.invalidateQueries({queryKey:['likedPosts','viewer-a']});});
    const successfulSyncs=f.synced.length;
    await flush(()=>f.syncRequests[3].reject(new Error('network unavailable')));
    assert.equal(f.synced.length,successfulSyncs,'failed read never empties Zustand liked posts');
    assert.equal(f.client.getQueryData(key).hasLiked,true,'failed list read preserves existing hearts');
    await flush(()=>unmountSync());
    // Production API rechecks ownership after asynchronous token refresh.
    let current=true;const tokenRace=f.realLikesApi.likePost('11',()=>current);
    const rejected=assert.rejects(tokenRace,/Session changed/);
    current=false;f.tokens[0]('new-account-token');await rejected;
    assert.equal(f.writes.length,0,'old click never dispatches under the next account token');
    const allowed=f.realLikesApi.likePost('11',()=>true);f.tokens[1]('current-account-token');
    assert.deepEqual(await allowed,{liked:true,likes:8});
    assert.equal(f.writes.length,1);
    const readLiked=()=>{const promise=f.realUsersApi.getLikedPosts();f.tokens.at(-1)('test-token');return promise;};
    f.setResponse({error:{message:'network unavailable'}});await assert.rejects(readLiked(),/network/);
    f.setResponse({data:{error:'Session expired'}});await assert.rejects(readLiked(),/Session/);
    f.setResponse({data:{}});await assert.rejects(readLiked(),/Could not load/);
    f.setResponse({data:{postIds:[]}});assert.deepEqual(await readLiked(),[],'valid empty remains compatible without implying a complete list');
    console.log('Post like state: stale sync/token race, rapid taps, cross-view pending, cache parity, rollback, viewer isolation, async detail and signed-out guards passed.');
  } finally {if(app)await f.act(async()=>app.unmount());f?.client.clear();window.happyDOM.abort();fs.rmSync(dir,{recursive:true,force:true});}
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
