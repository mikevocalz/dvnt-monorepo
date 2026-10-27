#!/usr/bin/env node
// Real comment mutations and TanStack caches; only auth/network/native image
// boundaries are offline fixtures. No live comments are created or deleted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-comment-counts-'));
  let app, f;
  const fixture = {
    '@dvnt/app/lib/stores/auth-store': `import {create} from 'zustand';export const useAuthStore=create(()=>({user:{id:'viewer',username:'viewer'}}));`,
    '@dvnt/app/lib/stores/post-store': `import {create} from 'zustand';export const usePostStore=create((set,get)=>({postCommentCounts:{},getCommentCount:(id,fallback)=>get().postCommentCounts[id]??fallback,setCommentCount:(id,count)=>set(s=>({postCommentCounts:{...s.postCommentCounts,[id]:count}}))}));`,
    '@dvnt/app/lib/api/comments': `export const requests=[];const request=(kind,input)=>new Promise((resolve,reject)=>requests.push({kind,input,resolve,reject}));export const commentsApi={createComment:input=>request('create',input),deleteComment:(commentId,postId)=>request('delete',{commentId,postId})};`,
    '@dvnt/app/lib/hooks/use-posts': `export {postKeys} from '${ROOT}/packages/app/lib/query-keys';`,
    'expo-image': `export const Image={prefetch:async()=>{}};`,
  };
  try {
    await build({stdin:{contents:`
      import React,{act} from 'react';import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {useCreateComment} from './packages/app/lib/hooks/use-comments';
      import {useDeleteComment} from './packages/app/lib/hooks/use-delete-comment';
      import {getPostCommentCount} from './packages/app/lib/posts/engagement-counts';
      import {commentsApi,requests} from '@dvnt/app/lib/api/comments';
      import {usePostStore} from '@dvnt/app/lib/stores/post-store';
      import {postKeys,commentKeys} from './packages/app/lib/query-keys';
      export {act,requests,postKeys,commentKeys,getPostCommentCount,usePostStore};
      export const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false,gcTime:Infinity}}});
      export const hooks={};
      function Probe(){hooks.create=useCreateComment();hooks.delete=useDeleteComment();return null;}
      export function mount(node){const root=createRoot(node);return {render:()=>root.render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>),unmount:()=>root.unmount()};}
    `,resolveDir:ROOT,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',define:{__DEV__:'false'},tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},outfile:path.join(dir,'test.cjs'),nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),plugins:[{name:'offline-comments',setup(b){
      b.onResolve({filter:/.*/},a=>{
        let alias=a.path;
        if(a.path.startsWith('.'))alias='@dvnt/app/'+path.relative(path.join(ROOT,'packages/app'),path.resolve(a.resolveDir,a.path)).replace(/\\/g,'/');
        if(fixture[alias])return {path:alias,namespace:'fixture'};
        if(fixture[a.path])return {path:a.path,namespace:'fixture'};
        if(a.path.startsWith('@dvnt/app/')){const stem=path.join(ROOT,'packages/app',a.path.slice(10));for(const suffix of ['.ts','.tsx',''])if(fs.existsSync(stem+suffix)&&fs.statSync(stem+suffix).isFile())return {path:stem+suffix};}
      });
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixture[a.path],loader:'tsx',resolveDir:ROOT}));
    }}]});
    f=require(path.join(dir,'test.cjs'));
    const node=document.createElement('div');document.body.append(node);app=f.mount(node);
    const flush=run=>f.act(async()=>{await run?.();await new Promise(r=>setTimeout(r,10));});
    await flush(()=>app.render());
    const root={id:'21',username:'viewer',text:'root',replies:[{id:'22',username:'viewer',text:'reply',parentId:'21',replies:[]}]};
    const post=comments=>({id:'11',comments,likes:7,author:{id:'author',username:'author'},media:[]});
    const detail=f.postKeys.detail('11'),legacy=f.postKeys.feed(),sweet=f.postKeys.feedInfinite(false),spicy=f.postKeys.feedInfinite(true),profile=f.postKeys.profilePosts('author'),comments=[...f.commentKeys.byPost('11'),'all'];
    const seed=()=>{
      f.client.setQueryData(detail,post(2));
      f.client.setQueryData(legacy,[post([root])]);
      f.client.setQueryData(sweet,{pages:[{data:[post(2),{...post(8),id:'other'}]}],pageParams:[0]});
      f.client.setQueryData(spicy,{pages:[{posts:[post([root])]}],pageParams:[0]});
      f.client.setQueryData(profile,[post(2)]);
      f.client.setQueryData(comments,[root]);
      f.usePostStore.getState().setCommentCount('11',2);
    };
    const posts=()=>[f.client.getQueryData(detail),f.client.getQueryData(legacy)[0],f.client.getQueryData(sweet).pages[0].data[0],f.client.getQueryData(spicy).pages[0].posts[0],f.client.getQueryData(profile)[0]];
    const expectCounts=count=>assert.deepEqual(posts().map(p=>f.getPostCommentCount(p.comments)),Array(5).fill(count),'numeric/tree post counts agree across detail, legacy, sweet/spicy and profile');
    seed();
    const input={post:'11',text:'new comment',authorId:'viewer',authorUsername:'viewer'};
    await flush(()=>f.hooks.create.mutate(input));
    assert.equal(f.requests.length,1);expectCounts(3);
    assert.equal(f.client.getQueryData(sweet).pages[0].data[1].comments,8,'unrelated post remains unchanged');
    await flush(()=>f.requests[0].reject(new Error('offline')));expectCounts(2);
    assert.equal(f.client.getQueryData(comments).length,1,'failed create restores comment tree');
    assert.equal(f.usePostStore.getState().postCommentCounts['11'],2);
    seed();await flush(()=>f.hooks.create.mutate({...input,parent:'21'}));expectCounts(3);
    assert.equal(f.client.getQueryData(comments)[0].replies.length,2,'new reply remains inside its thread');
    await flush(()=>f.requests[1].reject(new Error('reply refused')));expectCounts(2);
    seed();await flush(()=>f.hooks.create.mutate(input));expectCounts(3);
    await flush(()=>f.requests[2].resolve({id:'23'}));expectCounts(3);
    for(const key of [detail,legacy,sweet,spicy])assert.equal(f.client.getQueryState(key).isInvalidated,true,'create schedules authoritative post-count refresh');
    // Deletion is deliberately server-confirmed, not optimistic. On success it
    // removes the whole thread and invalidates each cached post shape for counts.
    seed();await flush(()=>f.hooks.delete.mutate({commentId:'21',postId:'11'}));expectCounts(2);
    await flush(()=>f.requests[3].reject(new Error('delete refused')));expectCounts(2);
    assert.equal(f.client.getQueryData(comments).length,1,'failed delete never removes comments');
    await flush(()=>f.hooks.delete.mutate({commentId:'21',postId:'11'}));
    await flush(()=>f.requests[4].resolve({success:true}));
    assert.deepEqual(f.client.getQueryData(comments),[],'confirmed root deletion removes replies');
    for(const key of [detail,legacy,sweet,spicy,profile])assert.equal(f.client.getQueryState(key).isInvalidated,true,'confirmed delete requests authoritative count refresh');
    console.log('PASS comment counts: actual create/reply optimistic updates and rollback across numeric/tree caches; confirmed deletion and count invalidation');
  } finally {if(app)await f.act(async()=>app.unmount());f?.client.clear();window.happyDOM.abort();fs.rmSync(dir,{recursive:true,force:true});}
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
