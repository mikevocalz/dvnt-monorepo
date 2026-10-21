// Offline boundaries for the story attribution DOM and real-browser suites.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const paths = [
  ...(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
  ROOT,
  path.join(ROOT, "apps/web"),
];
const resolve = (name) => require.resolve(name, { paths });
const load = (name) => require(resolve(name));
async function buildFixture({ outfile, browser = false }) {
  const reactionArray = fs.readFileSync(path.join(ROOT, "packages/app/lib/stories/story-message.ts"), "utf8").match(/export const STORY_REACTION_EMOJIS = (\[[^;]+\]);/)[1];
  const boundaries = {
    "solito/navigation": `export const useRouter=()=>({push:path=>globalThis.__routes.push(path)});`,
    "@dvnt/app/lib/stores/auth-store": `import {create} from 'zustand';export const useAuthStore=create(()=>({user:{id:'1',authId:'auth1',username:'publisher',avatar:'publisher.jpg'}}));`,
    "@dvnt/app/lib/stores/ui-store": `const state={showToast:(...args)=>globalThis.__toasts.push(args)};export const useUIStore=selector=>selector(state);`,
    "@dvnt/app/lib/hooks/use-verified-gate": `export const useVerifiedGate=()=> (_action,run)=>{if(globalThis.__deferGate)globalThis.__gate=run;else if(!globalThis.__blocked)run();};`,
    "@dvnt/app/lib/auth/identity": `export const requireBetterAuthToken=()=>globalThis.__token();export const getCurrentUserId=()=>globalThis.__viewer();`,
    "@dvnt/app/lib/api/auth-helper": `export const getCurrentUserId=()=>globalThis.__viewer();export const getCurrentUserIdSync=()=>Number(globalThis.__viewer());export const getCurrentUserAuthId=async()=> 'auth'+globalThis.__viewer();`,
    "@dvnt/app/lib/supabase/client": `export const supabase={rpc:(...args)=>globalThis.__storyRpc(...args),functions:{invoke:(...args)=>globalThis.__storyInvoke(...args)},from:table=>{
      const filters={eq:[],in:[],gt:[],single:false};
      const q={then:(resolve,reject)=>Promise.resolve(globalThis.__storyDb(table,filters)).then(result=>{
        if(!filters.single||!Array.isArray(result.data))return result;
        const data=result.data.filter(row=>filters.eq.every(([key,value])=>String(row[key])===String(value)));
        return {...result,data:data[0]||null};
      }).then(resolve,reject)};
      for(const method of ['select','eq','in','gt','order','limit'])q[method]=(...args)=>{if(Array.isArray(filters[method]))filters[method].push(args);return q};
      q.maybeSingle=()=>{filters.single=true;return q};return q;
    }};`,
    "@dvnt/app/components/story-viewers-sheet.web": `export const StoryViewersSheetWeb=props=>{globalThis.__viewersSheet=props;(globalThis.__viewersSheetRenders??=[]).push({open:props.open,viewerId:globalThis.__viewer?.()});return props.open?<div role="dialog" aria-label="Story viewers" style={{position:"absolute",inset:0,zIndex:100001,background:"black"}}><button onClick={props.onClose}>Close viewers</button></div>:null};`,
    "@dvnt/app/components/story-overlays-layer.web": `export const StoryOverlaysLayer=()=>null;`,
    "@dvnt/app/lib/stories/story-message": `export const STORY_REACTION_EMOJIS=${reactionArray};export const sendStoryMessage=args=>{if(globalThis.__sendStoryMessage)return globalThis.__sendStoryMessage(args);throw new Error('unexpected client DM')};`,
    "@dvnt/ui": browser
      ? `export {StoryViewer} from '${ROOT}/packages/ui/src/media/StoryViewer.web.tsx';`
      : `export const StoryViewer=props=>{globalThis.__player=props;return <div className="dvnt-story-viewer" onClick={()=>globalThis.__advances++}>Player</div>};`,
  };
  await load("esbuild").build({
    stdin: {
      resolveDir: ROOT,
      loader: "tsx",
      contents: `
      import React,{act} from 'react';import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {useSharePostToStory} from './packages/app/lib/hooks/use-share-post-to-story';
      import {ShareEventToStoryMenuItem} from './packages/app/features/events/ui/share-event-to-story.web';
      import {StoryViewerOverlay} from './packages/app/components/story-viewer-overlay.web';
      import {useStoryViewerStore,toStoryViewerGroup} from './packages/app/lib/stores/story-viewer-store';
      import {useAuthStore} from '@dvnt/app/lib/stores/auth-store';
      import {storiesApi} from './packages/app/lib/api/stories';
      import {storyKeys} from './packages/app/lib/hooks/use-stories';
      import {parseStorySharedSource,SHARED_STORY_BACKDROP} from './packages/app/lib/stories/shared-source';
      const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
      let share;function Probe(){share=useSharePostToStory();return null}
      const f={act,client,useAuthStore,storiesApi,storyKeys,useStoryViewerStore,toStoryViewerGroup,parseStorySharedSource,SHARED_STORY_BACKDROP,
        share:(source,cb)=>source.type==='event'?share.shareEvent(source,cb):share.share(source,cb),
        open:groups=>useStoryViewerStore.getState().openAt(groups.map(toStoryViewerGroup),0),
        close:()=>useStoryViewerStore.getState().close(),
        mount:node=>{const app=createRoot(node);return {render:(event={id:'22',visibility:'public',status:'active'})=>app.render(<React.StrictMode><QueryClientProvider client={client}><Probe/><ShareEventToStoryMenuItem event={event} onShared={()=>globalThis.__shared++}/><StoryViewerOverlay/></QueryClientProvider></React.StrictMode>),unmount:()=>app.unmount()}}
      };
      globalThis.__fixture=f;
      globalThis.__viewer=()=>useAuthStore.getState().user?.id??null;
      globalThis.__routes=[];globalThis.__toasts=[];globalThis.__shared=0;globalThis.__advances=0;
      globalThis.__token=async()=> 'token';globalThis.__storyDb=()=>({data:[],error:null});
      globalThis.__storyRpc=async(name,args)=>{
        if(name!=="get_story_share_for_playback")throw new Error("unexpected RPC");
        if(String(globalThis.__rpcActor??globalThis.__viewer())!==String(args.p_expected_viewer_id))return {data:null,error:null};
        const response=await globalThis.__storyDb("stories",{single:true,eq:[["id",args.p_story_id]]});
        if(response.error)return response;
        const row=Array.isArray(response.data)?response.data.find(row=>String(row.id)===String(args.p_story_id)):response.data;
        if(!row)return {data:null,error:null};
        const authors=await globalThis.__storyDb("users",{single:true,eq:[["id",row.shared_source.author.id]]});
        const author=Array.isArray(authors.data)?authors.data.find(author=>String(author.id)===String(row.shared_source.author.id)):authors.data;
        if(authors.error||!author?.username)return {data:null,error:authors.error||null};
        return {error:null,data:{...row,shared_source:{...row.shared_source,author:{
          id:String(author.id),username:author.username,name:[author.first_name,author.last_name].filter(Boolean).join(" ")||author.username,avatar:author.avatar?.url||""
        }}}};
      };
      export {f};
    `,
    },
    bundle: true,
    platform: browser ? "browser" : "node",
    format: browser ? "iife" : "cjs",
    jsx: "automatic",
    tsconfigRaw: {},
    outfile,
    nodePaths: paths,
    alias: Object.fromEntries(
      [
        "react",
        "react-dom",
        "zustand",
        "@tanstack/react-query",
        "@tanstack/query-core",
        "lucide-react",
      ].map((name) => [name, path.dirname(resolve(name + "/package.json"))]),
    ),
    plugins: [
      {
        name: "offline-story-boundaries",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            let key = args.path;
            if (args.path.startsWith(".")) {
              const relative = path
                .relative(
                  path.join(ROOT, "packages/app"),
                  path.resolve(args.resolveDir, args.path),
                )
                .replace(/\\/g, "/");
              if (!relative.startsWith("..")) key = "@dvnt/app/" + relative;
            }
            if (boundaries[key]) return { path: key, namespace: "fixture" };
            if (args.path.startsWith("@dvnt/app/"))
              return b.resolve(
                path.join(
                  ROOT,
                  "packages/app",
                  args.path.slice("@dvnt/app/".length),
                ),
                { resolveDir: ROOT, kind: args.kind },
              );
          });
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: boundaries[args.path],
            loader: "tsx",
            resolveDir: ROOT,
          }));
        },
      },
    ],
  });
}
async function buildStyles() {
  const twRoot = path.dirname(resolve("tailwindcss/package.json"));
  const sources = [
    "packages/app/components/story-shared-source.web.tsx",
    "packages/app/components/story-viewer-overlay.web.tsx",
    "packages/ui/src/media/StoryViewer.web.tsx",
    "packages/app/features/events/ui/share-event-to-story.web.tsx",
  ];
  const input =
    `@import "${twRoot}/theme.css" layer(theme);\n@import "${twRoot}/preflight.css" layer(base);\n@import "${twRoot}/utilities.css" important;\n` +
    sources.map((source) => `@source "${path.join(ROOT, source)}";`).join("\n");
  return (
    await load("postcss")([
      load("@tailwindcss/postcss")({ base: ROOT }),
    ]).process(input, { from: path.join(ROOT, "story-share-fixture.css") })
  ).css;
}
module.exports = { buildFixture, buildStyles, load, resolve, ROOT };
