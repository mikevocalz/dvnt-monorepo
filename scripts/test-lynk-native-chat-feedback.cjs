/** Actual ChatSheet + composer with native/data adapters; no device/server test. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const paths = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = (name) => require.resolve(name, { paths });
(async () => {
  const { Window } = await import(pathToFileURL(resolve("happy-dom")).href);
  const window = new Window();
  Object.assign(global, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = require(resolve("react"));
  const { createRoot } = require(resolve("react-dom/client"));
  const rootDir = path.join(__dirname, "..");
  global.__chatTest = {
    calls: [],
    resolve: null,
    comments: [
      {
        id: 1,
        authorId: "guest",
        body: "Hello room",
        createdAt: new Date().toISOString(),
        mentions: [],
        author: {
          id: "guest",
          username: "guest",
          displayName: "Guest",
          avatar: "",
        },
        depth: 0,
      },
    ],
  };
  const adapters = {
    "react-native": `import React from 'react';
    export const View=({children})=><div>{children}</div>;export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
    export const Pressable=({children,onPress,onLongPress,disabled,accessibilityLabel,accessibilityState})=>{const Tag=onLongPress?"div":"button";return <Tag data-native-longpress={onLongPress?true:undefined} onClick={onPress} onContextMenu={e=>{e.preventDefault();onLongPress?.()}} disabled={disabled} aria-label={accessibilityLabel} aria-busy={accessibilityState?.busy}>{children}</Tag>};
    export const TextInput=React.forwardRef(({value,onChangeText,onSelectionChange,editable,accessibilityLabel},ref)=><input ref={ref} value={value} onInput={e=>{onChangeText(e.target.value);onSelectionChange?.({nativeEvent:{selection:{end:e.target.value.length}}})}} readOnly={!editable} aria-label={accessibilityLabel}/>);
    export const ActivityIndicator=()=> <span role="progressbar"/>;`,
    "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({bottom:0});`,
    "expo-image": `export const Image=()=>null;`,
    "lucide-react-native": `export const Send=()=>null,X=()=>null,Reply=()=>null,MessageCircleMore=()=>null,ArrowDown=()=>null;`,
    "expo-haptics": `export const impactAsync=()=>{},ImpactFeedbackStyle={Light:'light',Medium:'medium'};`,
    "react-native-reanimated": `import {View} from 'react-native';export default {View};export const useSharedValue=x=>({value:x}),useAnimatedStyle=()=>({}),withTiming=x=>x,withRepeat=x=>x,withDelay=(_,x)=>x;export const Easing={linear:x=>x};`,
    "@lodev09/react-native-true-sheet": `import React,{useImperativeHandle} from 'react';export const TrueSheet=React.forwardRef(({header,children,footer},ref)=>{useImperativeHandle(ref,()=>({present(){},dismiss(){}}));return <div>{header}{children}{footer}</div>});`,
    "@dvnt/app/components/ui/avatar": `export const Avatar=()=>null;`,
    "@dvnt/app/components/ui/sheet-header": `export const SheetHeader=()=>null;`,
    "@dvnt/app/components/list": `import React from 'react';export const LegendList=React.forwardRef(({data,renderItem},ref)=><div>{data.map(item=><div key={item.id}>{renderItem({item})}</div>)}</div>);`,
    "@dvnt/app/lib/supabase/client": `const channel={on(){return this},subscribe(){return this},send:async()=>{}};export const supabase={channel:()=>channel,removeChannel:()=>{}};`,
    "../api/comments": `
      export const buildCommentThreads=x=>x;
      export function subscribeToRoomComments(roomId,onComment,{onSync}){onSync(globalThis.__chatTest.comments);return ()=>{}}
      export function postRoomComment(args){const state=globalThis.__chatTest;state.calls.push(args);return new Promise((resolve,reject)=>{state.reject=reject;state.resolve=ok=>resolve(ok?{...args,id:100+state.calls.length,createdAt:new Date().toISOString()}:null)})}
    `,
  };
  const bundle = await require(resolve("esbuild")).build({
    stdin: {
      resolveDir: rootDir,
      loader: "tsx",
      contents: `export {ChatSheet} from './packages/app/features/sneaky-lynk/ui/ChatSheet';export {CommentComposerFooter} from './packages/app/features/comments/ui/comment-composer-footer';`,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
    plugins: [
      {
        name: "native-chat-adapters",
        setup(build) {
          build.onResolve(
            { filter: /^(react|react\/jsx-runtime)$/ },
            ({ path: name }) => ({ path: resolve(name), external: true }),
          );
          build.onResolve({ filter: /.*/ }, (args) => {
            if (adapters[args.path])
              return { path: args.path, namespace: "adapter" };
            if (args.path === "@dvnt/app/features/comments")
              return {
                path: path.join(
                  rootDir,
                  "packages/app/features/comments/ui/comment-composer-footer.tsx",
                ),
              };
            if (args.path.startsWith("@dvnt/app/"))
              return build.resolve(
                path.join(
                  rootDir,
                  "packages/app",
                  args.path.slice("@dvnt/app/".length),
                ),
                { resolveDir: rootDir, kind: args.kind },
              );
          });
          build.onLoad({ filter: /.*/, namespace: "adapter" }, (args) => ({
            loader: "tsx",
            contents: adapters[args.path],
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(
    require,
    module,
    module.exports,
  );
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const currentUser = {
    id: "host",
    username: "host",
    displayName: "Host",
    avatar: "",
    isVerified: true,
  };
  const render = async (enabled) =>
    React.act(async () =>
      root.render(
        React.createElement(module.exports.ChatSheet, {
          isOpen: true,
          onClose() {},
          roomId: "room-1",
          currentUser,
          enabled,
        }),
      ),
    );
  const input = () => node.querySelector("input");
  const sendButton = () =>
    node.querySelector(
      '[aria-label="Send message"],[aria-label="Sending message"]',
    ) || input().parentElement.querySelector("button");
  const type = async (text) =>
    React.act(async () => {
      input().value = text;
      input().dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  await render(true);
  await type("Hello everyone");
  assert.equal(sendButton().disabled, false);
  await React.act(async () => sendButton().click());
  assert.equal(global.__chatTest.calls.length, 1);
  assert.equal(
    sendButton().disabled,
    true,
    "send is visibly disabled while pending",
  );
  assert.equal(
    sendButton().getAttribute("aria-busy"),
    "true",
    "pending state is accessible",
  );
  assert.equal(
    input().readOnly,
    true,
    "pending draft cannot be silently changed",
  );
  assert.ok(
    node.querySelector('[role="progressbar"]'),
    "pending send shows progress",
  );
  await React.act(async () => sendButton().click());
  assert.equal(
    global.__chatTest.calls.length,
    1,
    "repeated click cannot send twice",
  );
  await React.act(async () => global.__chatTest.resolve(false));
  assert.equal(input().value, "Hello everyone", "failed send preserves draft");
  assert.equal(sendButton().disabled, false);
  assert.equal(node.querySelector('[role="progressbar"]'), null);
  await React.act(async () => sendButton().click());
  await React.act(async () =>
    global.__chatTest.reject(new Error("network down")),
  );
  assert.equal(
    input().value,
    "Hello everyone",
    "real useRoomChat catches rejected posts and preserves draft",
  );
  assert.equal(sendButton().disabled, false);
  assert.ok(
    node.textContent.includes("Message wasn't sent. Please try again."),
  );
  await React.act(async () => sendButton().click());
  await React.act(async () => global.__chatTest.resolve(true));
  assert.equal(input().value, "", "successful retry clears draft");
  assert.equal(global.__chatTest.calls.length, 3);
  await type("Waiting");
  await render(false);
  assert.equal(sendButton().disabled, true);
  assert.equal(input().readOnly, true);
  assert.equal(
    node.querySelector('[role="progressbar"]'),
    null,
    "not admitted is disabled, not falsely sending",
  );
  await render(true);
  const bubble = node.querySelector("[data-native-longpress]");
  await React.act(async () =>
    bubble.dispatchEvent(
      new window.MouseEvent("contextmenu", { bubbles: true }),
    ),
  );
  assert.ok(
    node.textContent.includes(
      "Only you can see these reactions. They aren’t saved.",
    ),
  );
  const reaction = [...node.querySelectorAll("button")].find(
    (el) => el.textContent === "😂",
  );
  await React.act(async () => reaction.click());
  assert.ok(
    node.textContent.includes(
      "Your reactions · only visible to you · not saved",
    ),
    "selected reaction does not imply room-wide synchronization",
  );
  // Ordinary comment callers omit disabled: the backward-compatible default
  // must retain their normal editable/sendable state.
  let ordinarySends = 0;
  await React.act(async () =>
    root.render(
      React.createElement(module.exports.CommentComposerFooter, {
        value: "Ordinary comment",
        placeholder: "Comment",
        isSubmitting: false,
        onChangeText() {},
        onSelectionChange() {},
        onInsertMention() {},
        onCancelReply() {},
        onSubmit() {
          ordinarySends++;
        },
      }),
    ),
  );
  assert.equal(
    input().readOnly,
    false,
    "shared composer default remains editable",
  );
  assert.equal(
    sendButton().disabled,
    false,
    "shared composer default remains sendable",
  );
  await React.act(async () => sendButton().click());
  assert.equal(ordinarySends, 1);
  await React.act(async () => root.unmount());
  await window.happyDOM.close();
  console.log(
    "PASS actual native ChatSheet/composer: pending feedback, duplicate guard, failure draft, retry, disabled admission, personal-only reaction disclosure. Native/data adapters only.",
  );
})().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
