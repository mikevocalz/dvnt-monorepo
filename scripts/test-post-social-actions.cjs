#!/usr/bin/env node
// Real feed tile, detail, inbox sheet, story-share hook and chat send store.
// Media, auth/admission and network edges are offline fixtures; no live writes.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const dependencyPaths = (process.env.NODE_PATH || "")
  .split(path.delimiter)
  .filter(Boolean);
const { build } = require(
  require.resolve("esbuild", {
    paths: dependencyPaths.length ? dependencyPaths : undefined,
  }),
);
const ROOT = path.resolve(__dirname, "..");
const fixture = {
  // Comment GIF search is a network boundary; keep the real composer mounted.
  "@dvnt/app/features/stickers/api/klipy": `export const klipySearch=async()=>({results:[],source:"klipy"});`,
  "social-fixture": `import {create} from 'zustand';
    export const state={navigations:[],sent:[],stories:[],toasts:[],failSend:false,failStory:false,blocked:false,deferGate:false,gate:null,releaseSend:null,releaseStory:null};
    export const post={id:'11',kind:'media',caption:'A post',author:{id:'8',username:'author',avatar:'avatar.jpg'},likes:0,viewerHasLiked:false,media:[{type:'video',url:'video.mp4',thumbnail:'poster.jpg'}],comments:0};
    export const auth=create(()=>({user:{id:'1',authId:'auth1',username:'viewer'}}));
    export const likes=create(set=>({likes:0,hasLiked:false,toggle:()=>set(s=>({likes:s.hasLiked?0:1,hasLiked:!s.hasLiked}))}));
    export const router={push:p=>state.navigations.push(p),back:()=>state.navigations.push('back')};
    export const conversations=[{id:'c1',user:{id:'2',username:'alice',avatar:'alice.jpg'}},{id:'c2',user:{id:'3',username:'bob',avatar:'bob.jpg'}}];
    export const conversationData=create(()=>({data:conversations,isPending:false,isError:false,refetch(){}}));
    export const messagesApi={sendMessage:async input=>{state.sent.push(input);if(state.releaseSend)await new Promise(resolve=>{state.resolveSend=resolve});if(state.failSend)throw new Error('send refused');return {id:'m1'}}};`,
  "solito/navigation": `import {router} from 'social-fixture';export const useRouter=()=>router;export const useParams=()=>({id:'11'});`,
  "react-native": `export const useWindowDimensions=()=>({width:375,height:812});`,
  "@dvnt/app/components/ui/card-link.web": `export const CardLink=({href,children,className,ariaLabel})=><a href={href} className={className} aria-label={ariaLabel}>{children}</a>;`,
  "@dvnt/app/components/ui/avatar": `export const UserAvatar=({uri,username})=><img src={uri} alt={username}/>;`,
  "@dvnt/app/lib/hooks/use-scroll-restoration.web": `export const useScrollRestoration=()=>{};`,
  "@dvnt/app/lib/hooks/use-posts": `import {post} from 'social-fixture';export const usePost=()=>({data:post,isLoading:false});export const useDeletePost=()=>({mutate(){}});export const useInfiniteFeedPosts=()=>({data:{pages:[{data:[post]}]}});export const useSyncLikedPosts=()=>{};`,
  "@dvnt/app/lib/hooks/use-events": `export const useEvents=()=>({data:[]});`,
  "@dvnt/app/lib/hooks/use-feed-realtime": `export const useFeedRealtime=()=>{};`,
  "@dvnt/app/lib/hooks/usePostLikeState": `import {likes} from 'social-fixture';export const usePostLikeState=()=>likes();`,
  "@dvnt/app/lib/hooks/use-bookmarks": `export const useBookmarks=()=>({data:[]});export const useToggleBookmark=()=>({mutate(){}});`,
  "@dvnt/app/lib/stores/bookmark-store": `const value={bookmarkedPosts:[]};export const useBookmarkStore=s=>s(value);`,
  "@dvnt/app/lib/hooks/use-stories": `import {state} from 'social-fixture';export const useStories=()=>({data:[]});export const useCreateStory=()=>({isPending:false,mutateAsync:async data=>{state.stories.push(data);if(state.releaseStory)await new Promise(resolve=>{state.resolveStory=resolve});if(state.failStory)throw new Error('story refused');return {id:'s1'}}});`,
  "@dvnt/app/lib/stores/app-store": `export const useAppStore=s=>s({feedMode:'all',nsfwEnabled:false,setNsfwEnabled(){}});`,
  "@dvnt/app/lib/hooks/use-verified-gate": `import {state} from 'social-fixture';export const useVerifiedGate=()=> (action,run)=>{if(state.deferGate)state.gate=run;else if(!state.blocked)run()};`,
  "@dvnt/app/lib/stores/auth-store": `export {auth as useAuthStore} from 'social-fixture';`,
  "@dvnt/app/lib/stores/ui-store": `import {state} from 'social-fixture';const value={showToast:(...args)=>state.toasts.push(args)};export const useUIStore=s=>s(value);useUIStore.getState=()=>value;`,
  "@dvnt/app/lib/hooks/use-messages": `import {conversationData} from 'social-fixture';export const useConversations=()=>conversationData();`,
  "@dvnt/app/lib/api/messages-impl": `export {messagesApi} from 'social-fixture';`,
  "@dvnt/app/lib/server-upload": `export const uploadToServer=()=>{throw new Error('unexpected upload')};`,
  "@dvnt/app/lib/auth/auth-logger": `export const logChat=()=>{};`,
  "@dvnt/app/lib/auth-client": `export const invalidateTokenCache=()=>{};export const getQueryClient=()=>null;`,
  "@dvnt/app/lib/connectivity/guard": `export const ensureOnlineOrToast=()=>true;`,
  "@dvnt/app/lib/hooks/use-comments": `export const useComments=()=>({data:[]});export const useCreateComment=()=>({mutate(){}});`,
  "@dvnt/app/lib/hooks/use-post-tags": `export const usePostTags=()=>({data:[]});`,
  "@dvnt/app/lib/hooks/use-post-likers": `export const usePrefetchPostLikers=()=>()=>{};`,
  "@dvnt/app/lib/stores/translation-store": `export const useContentTranslation=()=>({displayText:'',isTranslated:false,translate(){},showOriginal(){}});`,
  "@dvnt/app/lib/utils/language-detection": `export const shouldShowTranslateButton=()=>false;`,
  "@dvnt/app/lib/stores/report-sheet-store": `export const useReportSheetStore=s=>s({openReportSheet(){}});`,
  "@dvnt/app/features/comments": `export const ThreadedComment=()=>null;`,
  "@dvnt/app/components/lightbox.web": `export const Lightbox=()=>null;`,
  "@dvnt/app/lib/api/posts": `export const postsApi={getPostById:async()=>null};`,
  "@dvnt/app/features/post/ui/TextPostSurface": `export const TextPostSurface=({text})=><p>{text}</p>;`,
  "./ui/TextPostSurface": `export const TextPostSurface=({text})=><p>{text}</p>;`,
  "@dvnt/app/components/feed/post-media-carousel.web": `export const PostMediaCarousel=()=> <div data-media/>;`,
  "@dvnt/app/features/posts/likes/LikesSheet.web": `export const LikesSheet=({postId,onClose})=>postId?<div role="dialog" aria-label="Likes"><button onClick={onClose}>Close likes</button></div>:null;`,
  "@dvnt/app/components/feed/use-feed-video.web": `export const useFeedVideo=()=>({ref:null,muted:true,blocked:false});`,
  "@dvnt/app/components/feed/live-photo-player.web": `export const useLivePhoto=()=>({});export const LivePhotoBadge=()=>null;export const LivePhotoMedia=({children})=>children;`,
  "@dvnt/app/components/feed/post-upload-status.web": `export const PostUploadStatus=()=>null;`,
  "@dvnt/app/components/verified-admission-banner.web": `export const VerifiedAdmissionBanner=()=>null;`,
  "@dvnt/app/components/event/FeedEventCard.web": `export const FeedEventCard=()=>null;`,
  "@dvnt/app/components/story-viewer-overlay.web": `export const StoryViewerOverlay=()=>null;`,
  "@tanstack/react-query": `export const useQuery=()=>({data:null});`,
  "@dvnt/ui": `export {Drawer} from '${ROOT}/packages/ui/src/form/Drawer.web.tsx';export const Dialog=()=>null;`,
};
const source = `import React,{act} from 'react';import {createRoot} from 'react-dom/client';
import {MasonryCell} from './packages/app/features/home/screen.web';
import {PostDetailScreen} from './packages/app/features/post/post-detail.web';
import {ShareToInboxSheet} from './packages/app/components/share-to-inbox-sheet.web';
import {useWebPostShareStore} from './packages/app/lib/stores/web-post-share-store';
import {usePostDetailUIStore} from './packages/app/lib/stores/post-detail-ui-store';
import {useChatStore} from './packages/app/lib/stores/chat-store';
import {useShareSheetStore} from './packages/app/lib/stores/share-sheet-store';
import {postStoryItem} from './packages/app/lib/posts/share-post';
import {state,post,auth,likes,conversationData} from 'social-fixture';
export {act,state,post,auth,likes,conversationData,postStoryItem,useChatStore,useWebPostShareStore,useShareSheetStore,usePostDetailUIStore};
export function mount(node){const root=createRoot(node);return {render:(detail=false,showSheet=true)=>root.render(<React.StrictMode>{detail?<PostDetailScreen/>:<><MasonryCell post={post} fallbackHeight={220}/>{showSheet&&<ShareToInboxSheet/>}</>}</React.StrictMode>),unmount:()=>root.unmount()};}`;
(async () => {
  const { Window } = await import(
    require.resolve("happy-dom", {
      paths: dependencyPaths.length ? dependencyPaths : undefined,
    })
  );
  const window = new Window({ url: "https://fixture.invalid" });
  Object.assign(global, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "post-social-"));
  try {
    await build({
      stdin: { contents: source, resolveDir: ROOT, loader: "tsx" },
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      outfile: path.join(dir, "test.cjs"),
      nodePaths: (process.env.NODE_PATH || "")
        .split(path.delimiter)
        .filter(Boolean),
      alias: Object.fromEntries(
        ["react", "react-dom", "zustand"].map((name) => [
          name,
          path.dirname(
            require.resolve(name + "/package.json", {
              paths: (process.env.NODE_PATH || "")
                .split(path.delimiter)
                .filter(Boolean),
            }),
          ),
        ]),
      ),
      define: { __DEV__: "false" },
      tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
      plugins: [
        {
          name: "offline-social",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) => {
              if (Object.hasOwn(fixture, a.path))
                return { path: a.path, namespace: "fixture" };
              if (a.path.startsWith(".")) {
                const resolved = path.resolve(a.resolveDir, a.path);
                const relative = path
                  .relative(path.join(ROOT, "packages/app"), resolved)
                  .replace(/\\/g, "/");
                const alias = "@dvnt/app/" + relative;
                if (Object.hasOwn(fixture, alias))
                  return { path: alias, namespace: "fixture" };
              }
              if (a.path.startsWith("@dvnt/app/")) {
                const stem = path.join(ROOT, "packages/app", a.path.slice(10));
                for (const suffix of ["", ".ts", ".tsx"])
                  if (fs.existsSync(stem + suffix))
                    return { path: stem + suffix };
              }
            });
            b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
              contents: fixture[a.path],
              loader: "tsx",
              resolveDir: ROOT,
            }));
            b.onLoad({ filter: /features\/home\/screen\.web\.tsx$/ }, (a) => ({
              contents:
                fs.readFileSync(a.path, "utf8") + "\nexport {MasonryCell};",
              loader: "tsx",
              resolveDir: path.dirname(a.path),
            }));
          },
        },
      ],
    });
    const f = require(path.join(dir, "test.cjs"));
    const node = document.createElement("div");
    document.body.append(node);
    const app = f.mount(node);
    const flush = async (run) =>
      f.act(async () => {
        await run?.();
        await new Promise((r) => setTimeout(r, 0));
      });
    const button = (label) =>
      document.querySelector('button[aria-label="' + label + '"]');
    await flush(() => app.render());
    assert.equal(button("View 0 likes").textContent, "0");
    assert.ok(
      !button("View 0 likes").closest("a"),
      "count is not inside navigation link",
    );
    assert.ok(
      !button("View 0 likes").parentElement.parentElement.className.includes(
        "opacity-0",
      ),
      "count visible without hover",
    );
    await flush(() => button("Like").click());
    assert.equal(button("View 1 like").textContent, "1");
    await flush(() => button("View 1 like").click());
    assert.equal(f.usePostDetailUIStore.getState().likesSheetPostId, "11");
    assert.equal(f.likes.getState().likes, 1);
    await flush(() => button("Reshare post").click());
    assert.equal(f.useWebPostShareStore.getState().post.mediaUrl, "video.mp4");
    assert.equal(
      document.querySelectorAll('[aria-label^="Share post with"]').length,
      2,
    );
    f.state.releaseSend = true;
    await flush(() => {
      button("Share post with @alice").click();
      button("Share post with @alice").click();
    });
    assert.equal(f.state.sent.length, 1, "repeated click is single-flight");
    assert.equal(f.state.sent[0].metadata.type, "shared_post");
    assert.equal(f.state.sent[0].metadata.postId, "11");
    assert.equal(f.state.sent[0].conversationId, "c1");
    assert.equal(f.state.sent[0].expectedViewerId, "1");
    await flush(() => f.state.resolveSend());
    assert.equal(f.useWebPostShareStore.getState().post, null);
    f.state.releaseSend = false;
    f.state.failSend = true;
    await flush(() => button("Reshare post").click());
    await flush(() => button("Share post with @bob").click());
    assert.ok(f.useWebPostShareStore.getState().post, "failed send stays open");
    assert.equal(
      f.useChatStore.getState().messages.c2.length,
      0,
      "failed optimistic message rolls back",
    );
    assert.equal(
      f.state.toasts.at(-1)[0],
      "error",
      "network failure is not reported as sent",
    );
    f.state.failSend = false;
    await flush(() => button("Share post with @bob").click());
    assert.equal(
      f.useWebPostShareStore.getState().post,
      null,
      "retry succeeds",
    );
    await flush(() => button("Reshare post").click());
    await flush(() =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape" }),
      ),
    );
    assert.equal(
      f.useWebPostShareStore.getState().post,
      null,
      "Escape closes inbox",
    );
    // Deferred admission callback must not send after the sheet closes.
    f.state.deferGate = true;
    await flush(() => button("Reshare post").click());
    await flush(() => button("Share post with @alice").click());
    const sentBeforeCancel = f.state.sent.length;
    await flush(() =>
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape" }),
      ),
    );
    await flush(() => f.state.gate());
    assert.equal(
      f.state.sent.length,
      sentBeforeCancel,
      "closed share cancels deferred send",
    );
    f.state.deferGate = false;

    // Groups retain their own identity, even when their legacy user field is
    // the same creator as a direct chat or another identically named group.
    const directConversations = f.conversationData.getState().data;
    const creator = directConversations[0].user;
    const members = [
      {
        id: "member-41",
        authId: "member-auth-41",
        username: "charlie",
        avatar: "charlie.jpg",
      },
      {
        id: "member-42",
        authId: "member-auth-42",
        username: "delta",
        avatar: "delta.jpg",
      },
    ];
    const groupConversations = [
      {
        id: "group-lantern-a",
        isGroup: true,
        groupName: "Lantern Studio",
        user: creator,
        members,
      },
      {
        id: "group-lantern-b",
        isGroup: true,
        groupName: "Lantern Studio",
        user: creator,
        members: [...members].reverse(),
      },
      {
        id: "group-hiking",
        isGroup: true,
        groupName: "Hiking Plans",
        user: creator,
        members: [members[1]],
      },
      { id: "group-unnamed", isGroup: true, groupName: "   ", user: creator },
      {
        id: "group-incomplete",
        isGroup: true,
        groupName: "Incomplete Profiles",
        user: creator,
        members: [
          {
            id: "member-43",
            authId: "member-auth-43",
            username: "",
            avatar: "",
          },
        ],
      },
    ];
    const allConversations = [...directConversations, ...groupConversations];
    const setConversations = (data) =>
      flush(() => f.conversationData.setState({ data }));
    const recipientButtons = () =>
      Array.from(
        document.querySelectorAll('button[aria-label^="Share post with"]'),
      );
    const groupButtons = (name) =>
      recipientButtons().filter(
        (b) => b.getAttribute("aria-label") === `Share post with group ${name}`,
      );
    const setSearch = (value) =>
      flush(() => f.useShareSheetStore.getState().setSearchQuery(value));
    const closeShare = () =>
      flush(() => f.useWebPostShareStore.getState().close());
    const openShare = () => flush(() => button("Reshare post").click());
    await setConversations(allConversations);
    await openShare();
    assert.equal(recipientButtons().length, allConversations.length);
    assert.equal(
      groupButtons("Lantern Studio").length,
      2,
      "same-named groups remain distinct rows",
    );
    assert.equal(
      recipientButtons().filter(
        (b) => b.getAttribute("aria-label") === "Share post with @alice",
      ).length,
      1,
      "creator has exactly one direct-chat row, not one per group",
    );
    for (const group of groupConversations) {
      const name = group.groupName.trim() || "Unnamed group";
      const row = groupButtons(name)[0];
      assert.ok(row, `group is identified as ${name}`);
      assert.ok(
        Array.from(row.querySelectorAll("span")).some(
          (el) => el.textContent === name,
        ),
        "visible group name matches exactly",
      );
      assert.ok(
        Array.from(row.querySelectorAll("span")).some((el) =>
          /^Group(?:\s|$)/.test(el.textContent),
        ),
        "visible Group marker distinguishes group from person",
      );
      assert.ok(
        !row.textContent.includes("@alice"),
        "group never presents creator as the destination",
      );
      assert.ok(
        !row.querySelector('img[src="alice.jpg"]'),
        "group never uses creator's lone avatar",
      );
    }
    const compositeImages =
      groupButtons("Lantern Studio")[0].querySelectorAll("img");
    assert.equal(
      compositeImages.length,
      2,
      "populated group has composite member avatars",
    );
    assert.deepEqual(
      Array.from(compositeImages, (img) => img.getAttribute("src")).sort(),
      ["charlie.jpg", "delta.jpg"],
    );
    for (const name of [
      "Hiking Plans",
      "Unnamed group",
      "Incomplete Profiles",
    ]) {
      const row = groupButtons(name)[0];
      assert.equal(
        row.querySelectorAll("img").length,
        0,
        "insufficient member data does not imply a single recipient",
      );
      assert.ok(
        row.querySelector("svg.lucide-users"),
        "insufficient member data uses a group icon",
      );
    }
    assert.equal(
      button("Share post with @alice").querySelector("img").getAttribute("src"),
      "alice.jpg",
      "direct avatar remains unchanged",
    );

    await setSearch("  lAnTeRn StUdIo  ");
    assert.equal(
      recipientButtons().length,
      2,
      "group-name search is trimmed and case-insensitive",
    );
    await setSearch("CHARLIE");
    assert.equal(
      groupButtons("Lantern Studio").length,
      2,
      "member username finds the group without relabeling it",
    );
    assert.equal(recipientButtons().length, 2);
    await setSearch("delta");
    assert.equal(
      recipientButtons().length,
      3,
      "member search works for sparse group membership too",
    );
    await setSearch("alice");
    assert.equal(
      recipientButtons().length,
      1,
      "group creator proxy is not searched as a direct recipient",
    );
    assert.ok(button("Share post with @alice"));
    await setSearch("unnamed");
    assert.equal(
      groupButtons("Unnamed group").length,
      1,
      "blank group names remain searchable by their displayed fallback",
    );
    await setSearch("nobody-matches-this");
    assert.equal(recipientButtons().length, 0);
    assert.ok(document.body.textContent.includes("No matching conversations."));
    await setSearch("");

    const beforeGroupSends = f.state.sent.length;
    f.state.releaseSend = true;
    await flush(() => {
      groupButtons("Lantern Studio")[0].click();
      groupButtons("Lantern Studio")[0].click();
      groupButtons("Lantern Studio")[1].click();
    });
    assert.equal(
      f.state.sent.length,
      beforeGroupSends + 1,
      "group send is single-flight across duplicate-named rows",
    );
    assert.equal(f.state.sent.at(-1).conversationId, "group-lantern-a");
    assert.equal(f.state.sent.at(-1).expectedViewerId, "1");
    assert.equal(f.state.sent.at(-1).metadata.type, "shared_post");
    assert.equal(f.state.sent.at(-1).metadata.postId, "11");
    assert.equal(f.useShareSheetStore.getState().sendingTo, "group-lantern-a");
    assert.equal(
      groupButtons("Lantern Studio")[0].querySelector('[role="status"]')
        .textContent,
      "Sending…",
    );
    assert.equal(
      groupButtons("Lantern Studio")[1].querySelector('[role="status"]'),
      null,
      "sending feedback tracks ID, not duplicate name",
    );
    assert.ok(recipientButtons().every((b) => b.disabled));
    await flush(() => f.state.resolveSend());
    f.state.releaseSend = false;
    assert.equal(
      f.state.toasts.at(-1)[2],
      "Post shared with group Lantern Studio",
      "success names the displayed group, never its creator",
    );
    assert.equal(f.useWebPostShareStore.getState().post, null);
    await openShare();
    await flush(() => groupButtons("Lantern Studio")[1].click());
    assert.equal(
      f.state.sent.at(-1).conversationId,
      "group-lantern-b",
      "same-named second group keeps its own destination ID",
    );
    await openShare();
    await flush(() => button("Share post with @alice").click());
    assert.equal(
      f.state.sent.at(-1).conversationId,
      "c1",
      "creator direct chat remains independently selectable",
    );
    await openShare();
    await flush(() => groupButtons("Unnamed group")[0].click());
    assert.equal(f.state.sent.at(-1).conversationId, "group-unnamed");
    assert.equal(
      f.state.toasts.at(-1)[2],
      "Post shared with group Unnamed group",
      "success uses the same fallback name as the row",
    );

    // The verified-action callback may resolve after a query refresh. Compare
    // destination identity, not object reference, and reject stale selections.
    f.state.deferGate = true;
    const expectStaleSelectionBlocked = async (label, replace, reason) => {
      await setConversations(allConversations);
      await openShare();
      await flush(() => button(label).click());
      const gate = f.state.gate;
      assert.equal(typeof gate, "function");
      const sentBefore = f.state.sent.length;
      const toastsBefore = f.state.toasts.length;
      await setConversations(replace(allConversations));
      await flush(() => gate());
      assert.equal(f.state.sent.length, sentBefore, reason);
      assert.ok(
        f.state.toasts
          .slice(toastsBefore)
          .every((toast) => toast[0] !== "success"),
        "cancelled selection never reports success",
      );
      assert.equal(
        f.useShareSheetStore.getState().sendingTo,
        null,
        "cancelled selection does not lock the picker",
      );
      await closeShare();
    };
    await expectStaleSelectionBlocked(
      "Share post with group Lantern Studio",
      (rows) => rows.filter((c) => c.id !== "group-lantern-a"),
      "removed group cancels deferred send even when same-named group remains",
    );
    await expectStaleSelectionBlocked(
      "Share post with group Lantern Studio",
      (rows) =>
        rows.map((c) =>
          c.id === "group-lantern-a"
            ? { ...c, groupName: "Renamed Studio" }
            : c,
        ),
      "renamed group must be selected again before sending",
    );
    await expectStaleSelectionBlocked(
      "Share post with group Lantern Studio",
      (rows) =>
        rows.map((c) =>
          c.id === "group-lantern-a" ? { ...c, isGroup: false } : c,
        ),
      "group becoming direct cancels deferred send",
    );
    await expectStaleSelectionBlocked(
      "Share post with @alice",
      (rows) =>
        rows.map((c) =>
          c.id === "c1"
            ? { ...c, isGroup: true, groupName: "Unexpected Group", members }
            : c,
        ),
      "direct becoming group cancels deferred send",
    );
    await expectStaleSelectionBlocked(
      "Share post with @alice",
      (rows) =>
        rows.map((c) =>
          c.id === "c1"
            ? { ...c, user: { ...c.user, id: "replacement-person" } }
            : c,
        ),
      "changed direct-user identity cancels deferred send",
    );
    await expectStaleSelectionBlocked(
      "Share post with @alice",
      (rows) =>
        rows.map((c) =>
          c.id === "c1"
            ? { ...c, user: { ...c.user, username: "renamed-alice" } }
            : c,
        ),
      "changed displayed direct username cancels deferred send",
    );
    await setConversations(allConversations);
    for (const label of [
      "Share post with group Lantern Studio",
      "Share post with @alice",
    ]) {
      await openShare();
      await flush(() => button(label).click());
      const gate = f.state.gate;
      const before = f.state.sent.length;
      await setConversations(
        allConversations.map((c) => ({
          ...c,
          user: { ...c.user },
          members: c.members?.map((m) => ({ ...m })),
        })),
      );
      await flush(() => gate());
      assert.equal(
        f.state.sent.length,
        before + 1,
        "ordinary data refetch with same identity is allowed",
      );
      assert.equal(
        f.state.sent.at(-1).conversationId,
        label.includes("group") ? "group-lantern-a" : "c1",
      );
    }

    for (const unmountOnly of [false, true]) {
      await openShare();
      const samePost = f.useWebPostShareStore.getState().post;
      await flush(() => button("Share post with group Lantern Studio").click());
      const staleGate = f.state.gate;
      const before = f.state.sent.length;
      if (unmountOnly) {
        await flush(() => app.render(false, false));
        assert.equal(
          f.useWebPostShareStore.getState().post,
          samePost,
          "unmount test retains the exact post object",
        );
        await flush(() => app.render(false, true));
      } else {
        await closeShare();
        await flush(() => f.useWebPostShareStore.getState().open(samePost));
      }
      await flush(() => staleGate());
      assert.equal(
        f.state.sent.length,
        before,
        unmountOnly
          ? "unmounted sheet callback cannot send after remount"
          : "close/reopen with same post object cancels old selection",
      );
      assert.ok(
        button("Share post with group Lantern Studio"),
        "newly opened picker remains usable",
      );
      await flush(() => button("Share post with group Lantern Studio").click());
      await flush(() => f.state.gate());
      assert.equal(
        f.state.sent.length,
        before + 1,
        "fresh selection after reopen sends normally",
      );
    }
    await openShare();
    await flush(() => button("Share post with group Lantern Studio").click());
    const gateBeforeAccountChange = f.state.gate;
    const sentBeforeAccountChange = f.state.sent.length;
    await flush(() =>
      f.auth.setState({
        user: { id: "9", authId: "auth9", username: "other" },
      }),
    );
    await flush(() => gateBeforeAccountChange());
    assert.equal(
      f.state.sent.length,
      sentBeforeAccountChange,
      "deferred group send cannot cross accounts",
    );
    assert.equal(
      f.useWebPostShareStore.getState().post,
      null,
      "account switch dismisses group picker",
    );
    await flush(() =>
      f.auth.setState({
        user: { id: "1", authId: "auth1", username: "viewer" },
      }),
    );
    f.state.deferGate = false;
    await setConversations(directConversations);
    await flush(() => app.render(true));
    assert.ok(button("View 1 like"));
    assert.ok(button("Reshare post"));
    await flush(() => button("More options").click());
    const storyButton = () =>
      Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent.includes("Share to Story"),
      );
    assert.ok(storyButton(), "detail More has story action");
    f.state.releaseStory = true;
    await flush(() => {
      storyButton().click();
      storyButton().click();
    });
    assert.equal(f.state.stories.length, 1);
    assert.deepEqual(f.state.stories[0].sharedSource, {
      type: "post",
      id: "11",
    });
    assert.equal(f.state.stories[0].expectedViewerId, "1");
    assert.match(f.state.stories[0].operationId, /^[0-9a-f-]{36}$/);
    assert.equal(typeof f.state.stories[0].isCurrent, "function");
    assert.equal(
      f.state.stories[0].items,
      undefined,
      "source media and author are resolved on the server",
    );
    await flush(() => f.state.resolveStory());
    assert.equal(f.usePostDetailUIStore.getState().showMenu, false);
    f.state.releaseStory = false;
    f.state.failStory = true;
    await flush(() => button("More options").click());
    await flush(() => storyButton().click());
    assert.equal(f.state.toasts.at(-1)[0], "error");
    assert.ok(storyButton(), "story error keeps retry available");
    f.state.failStory = false;
    f.state.blocked = true;
    const previous = f.state.stories.length;
    await flush(() => storyButton().click());
    assert.equal(
      f.state.stories.length,
      previous,
      "admission denial does not publish",
    );
    f.state.blocked = false;
    f.state.deferGate = true;
    await flush(() => storyButton().click());
    await flush(() =>
      f.auth.setState({
        user: { id: "9", authId: "auth9", username: "other" },
      }),
    );
    await flush(() => f.state.gate());
    assert.equal(
      f.state.stories.length,
      previous,
      "deferred story cannot cross accounts",
    );
    f.state.deferGate = false;
    await flush(() =>
      f.auth.setState({
        user: { id: "1", authId: "auth1", username: "viewer" },
      }),
    );
    for (const kind of ["video", "animated_video"])
      assert.equal(
        f.postStoryItem({ media: [{ type: kind, url: "clip.mp4" }] }).type,
        "video",
      );
    for (const kind of ["image", "gif", "livePhoto"])
      assert.equal(
        f.postStoryItem({ media: [{ type: kind, url: "still.jpg" }] }).type,
        "image",
      );
    f.post.media = [];
    await flush(() => app.render(true));
    await flush(() => storyButton().click());
    assert.equal(
      f.state.stories.length,
      previous + 1,
      "text/no-media post shares its canonical source for a branded story card",
    );
    assert.equal(f.state.toasts.at(-1)[1], "Added to your story");
    await flush(() => button("Reshare post").click());
    await flush(() => f.auth.setState({ user: null }));
    assert.equal(
      f.useWebPostShareStore.getState().post,
      null,
      "signout dismisses account-scoped share",
    );
    await assert.rejects(
      () => f.useChatStore.getState().sendSharedPost("c1", { postId: "11" }),
      /Sign in/,
    );
    assert.deepEqual(
      f.state.navigations,
      [],
      "social actions do not navigate away",
    );
    await flush(() => app.unmount());
    console.log(
      "PASS production social actions: counts, isolated likes tap, inbox metadata, group identity/search/avatars/distinct IDs, stale-selection/unmount/account guards, repeat click, rollback/retry, Escape/signout, story publish/error/gate/no-media",
    );
  } finally {
    window.happyDOM.abort();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
