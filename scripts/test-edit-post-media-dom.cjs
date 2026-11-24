#!/usr/bin/env node
// Mount the actual production web editor. Auth and server transport are isolated.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");
(async () => {
  const { Window } = await import(require.resolve("happy-dom"));
  const window = new Window({ width: 320, height: 375 });
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const root = path.resolve(__dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dvnt-edit-post-"));
  const mocks = {
    "solito/navigation": "import {f} from 'edit-fixture'; export const useParams=()=>({id:'7'}); export const useRouter=()=>({back:()=>f.back++});",
    "@dvnt/ui": "export const FormField=({children})=>children; export const StickySaveBar=()=>null; export const useDirtyGuard=()=>{};",
    "@dvnt/app/lib/media/use-post-media-lease": "export const usePostMediaLease=(_id,media)=>media;",
    "@dvnt/app/lib/api/posts": "export {api as postsApi} from 'edit-fixture';",
    "@dvnt/app/lib/api/post-tags": "export const postTagsApi={getTagsForPost:async()=>[]};",
    "@dvnt/app/lib/stores/auth-store": "export const useAuthStore=f=>f({user:{id:1, username:'new-handle'}});",
    "@dvnt/app/lib/stores/ui-store": "import {f} from 'edit-fixture'; export const useUIStore=fn=>fn({showToast:(...args)=>f.toasts.push(args)});",
    "@dvnt/app/lib/hooks/use-posts": "export {usePost} from 'edit-fixture'; export {postKeys} from '@dvnt/app/lib/query-keys';",
  };
  const source = `
    import {create} from 'zustand';
    export const f={back:0,toasts:[],edits:[],invalidations:[],fail:false};
    export const original={id:'7',kind:'media',caption:'full caption #keep',isNSFW:true,author:{id:'1',username:'old-handle'},media:[
      {mediaId:'a',order:0,url:'data:image/jpeg;base64,AA==',type:'image'},
      {mediaId:'b',order:1,url:'data:image/jpeg;base64,AA==',type:'livePhoto'},
      {mediaId:'c',order:3,url:'data:image/jpeg;base64,AAA=',type:'image'}]};
    export const data=create(()=>({data:{...original,caption:'truncated'},isPlaceholderData:true}));
    export const usePost=()=>data();
    export const api={updatePost:async(id, update)=>{
      f.edits.push({id,update});
      if (f.fail) throw Error('write denied');
      const post=data.getState().data;
      data.setState({data:{...post,caption:update.content ?? post.caption,media:post.media.filter(m=>!update.removeMedia?.ids.includes(m.mediaId))}});
      return {id};
    }};
  `;
  try {
    const outfile = path.join(temp, "bundle.cjs");
    await build({
      stdin: { contents:`
        import React,{act} from 'react'; import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import {EditPostScreen} from './packages/app/features/post/edit-post.web';
        import {f} from 'edit-fixture';
        export {act}; export {data,f,original} from 'edit-fixture';
        export {useEditPostStore} from './packages/app/features/post/edit-post-store';
        export function mount(node){
          const client=new QueryClient({defaultOptions:{queries:{gcTime:0},mutations:{gcTime:0}}});
          client.invalidateQueries=async ({queryKey})=>{f.invalidations.push(queryKey);};
          const root=createRoot(node);root.render(<QueryClientProvider client={client}><EditPostScreen/></QueryClientProvider>);
          return ()=>{root.unmount();client.clear();};
        }
      `,resolveDir:root,loader:"tsx" },
      bundle:true, platform:"node", format:"cjs", jsx:"automatic", outfile,
      alias:{"@dvnt/app":path.join(root,"packages/app")},
      nodePaths:(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
      plugins:[{ name:"fixture", setup(b) {
        b.onResolve({filter:/.*/},args=>args.path==="edit-fixture"||mocks[args.path]?{path:args.path,namespace:"fixture"}:undefined);
        b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:mocks[args.path]??source,loader:"js",resolveDir:root}));
      }}],
    });
    const { act, mount, data, f, original, useEditPostStore } = require(outfile);
    const node=document.createElement("div"); document.body.append(node);
    let unmount; await act(async()=>{unmount=mount(node);});
    const button = (text) => [...node.querySelectorAll("button")].find(el=>el.textContent.trim()===text);
    const labelled = (label) => node.querySelector('[aria-label="'+label+'"]');
    assert.match(node.textContent,/Loading post/); assert.equal(node.querySelector("textarea"),null);
    await act(async()=>data.setState({data:original,isPlaceholderData:false}));
    assert.equal(node.querySelector("textarea").value,original.caption);
    await act(async()=>labelled("Remove media item 2").click());
    assert.ok(labelled("Restore media item 2"));
    await act(async()=>labelled("Remove media item 1").click());
    assert.equal(labelled("Remove media item 3").disabled,true);
    await act(async()=>labelled("Restore media item 1").click());
    await act(async()=>useEditPostStore.getState().setCaption("edited #kept"));
    await act(async()=>data.setState({data:{...original,location:"background refresh"}}));
    assert.equal(node.querySelector("textarea").value,"edited #kept");
    const waitFor = async (predicate) => {
      for (let i = 0; i < 100 && !predicate(); i++) await new Promise(r=>setTimeout(r,10));
      assert.ok(predicate(), "edit mutation did not reach its expected state");
    };
    f.fail=true;
    await act(async()=>{button("Save").click(); await waitFor(()=>f.toasts.length>0);});
    assert.equal(f.back,0); assert.ok(labelled("Restore media item 2"));
    assert.match(f.toasts.at(-1)[2],/write denied/);
    f.fail=false;
    await act(async()=>{button("Save").click(); await waitFor(()=>f.back===1);});
    assert.deepEqual(f.edits[1],{id:"7",update:{content:"edited #kept",removeMedia:{expectedIds:["a","b","c"],ids:["b"],expectedCaption:"full caption #keep"}}});
    assert.equal(f.back,1); assert.ok(f.invalidations.some(k=>k[0]==="profilePosts"));
    await act(async()=>unmount());
    await act(async()=>{unmount=mount(node);});
    assert.equal(node.querySelector("textarea").value,"edited #kept");
    assert.ok(labelled("Remove media item 1")); assert.ok(labelled("Remove media item 2")); assert.equal(labelled("Remove media item 3"),null);
    await act(async()=>unmount());
    console.log("PASS actual Edit Post: stale placeholder, exact Remove/Restore, last item, caption, failed Save preserves draft, confirmed Save, reopen.");
  } finally { fs.rmSync(temp,{force:true,recursive:true}); await window.happyDOM.close(); }
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
