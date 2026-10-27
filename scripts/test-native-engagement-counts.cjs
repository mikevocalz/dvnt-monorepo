#!/usr/bin/env node
// Production native engagement controls rendered through a small RN host shim.
// No network, credentials or native runtime required; this is not device QA.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");
const ROOT = path.resolve(__dirname, "..");

(async () => {
  const { Window } = await import(require.resolve("happy-dom"));
  const window = new Window();
  Object.assign(global, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-engagement-"));
  let app;
  let fixture;
  try {
    await build({
      stdin: {
        contents: `import React,{act} from 'react';
          import {createRoot} from 'react-dom/client';
          import {PostEngagementCounts} from './packages/ui/src/social/PostEngagementCounts.native.tsx';
          export {act};
          export const calls={like:0,comments:0,likes:0,prefetchLikes:0,prefetchComments:0,card:0};
          export function mount(node){ const root=createRoot(node); return {
            render:(props={})=>root.render(<div onClick={()=>calls.card++}><PostEngagementCounts
              likes={0} hasLiked={false} comments={0}
              onLike={()=>calls.like++} onComments={()=>calls.comments++}
              onPrefetchComments={()=>calls.prefetchComments++} {...props}/></div>),
            unmount:()=>root.unmount()
          }; }`,
        resolveDir: ROOT, loader: "tsx",
      },
      tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
      bundle: true, platform: "node", format: "cjs", jsx: "automatic",
      outfile: path.join(dir, "fixture.cjs"),
      nodePaths: (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
      alias: { "@dvnt/app": path.join(ROOT, "packages/app") },
      plugins: [{ name: "native-host", setup(b) {
        b.onResolve({ filter: /^(react-native|lucide-react-native)$/ }, a => ({ path: a.path, namespace: "native-host" }));
        b.onLoad({ filter: /.*/, namespace: "native-host" }, a => ({
          loader: "tsx", resolveDir: ROOT,
          contents: a.path === "react-native" ? `
            import React from 'react';
            export const StyleSheet={create:x=>x};
            export const View=({children})=><div>{children}</div>;
            export const Text=({children})=><span>{children}</span>;
            export const Pressable=({children,onPress,onPressIn,disabled,accessibilityRole,accessibilityLabel,accessibilityState})=>
              <button type="button" onClick={onPress} onMouseDown={onPressIn} disabled={disabled}
                role={accessibilityRole} aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected}>{children}</button>;
          ` : `import React from 'react';export const Heart=()=> <i data-icon="heart"/>;export const MessageCircle=()=> <i data-icon="comments"/>;`,
        }));
      } }],
    });
    fixture = require(path.join(dir, "fixture.cjs"));
    const node = document.createElement("div"); document.body.append(node);
    app = fixture.mount(node);
    const flush = action => fixture.act(async () => { action(); });
    const button = label => node.querySelector(`button[aria-label="${label}"]`);
    await flush(() => app.render());
    const like = button("Like, 0 likes");
    const comments = button("View 0 comments");
    assert.equal(like.textContent, "0", "zero likes remain visible beside the heart");
    assert.equal(comments.textContent, "0", "zero comments remain visible beside the comment icon");
    assert.ok(like.querySelector('[data-icon="heart"]'));
    assert.ok(comments.querySelector('[data-icon="comments"]'));
    await flush(() => like.click());
    await flush(() => comments.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })));
    await flush(() => comments.click());
    assert.equal(fixture.calls.like, 1);
    assert.equal(fixture.calls.comments, 1);
    assert.equal(fixture.calls.prefetchComments, 1);
    assert.equal(fixture.calls.card, 0, "actions must not navigate the enclosing zoom card");

    await flush(() => app.render({ likes: 1, comments: 1, hasLiked: true }));
    assert.equal(button("Unlike, 1 like").textContent, "1");
    assert.equal(button("Unlike, 1 like").getAttribute("aria-pressed"), "true");
    assert.equal(button("View 1 comment").textContent, "1");
    await flush(() => app.render({ likes: 2, comments: 3, disabled: true }));
    await flush(() => button("Like, 2 likes").click());
    assert.equal(fixture.calls.like, 1, "pending likes cannot double-submit");
    assert.equal(button("View 3 comments").textContent, "3", "comment count updates without remounting");
    await flush(() => button("View 3 comments").click());
    assert.equal(fixture.calls.comments, 2, "comments stay available while a like is pending");

    await flush(() => app.render({
      likes: 12, comments: 4, compact: true,
      onViewLikes: () => fixture.calls.likes++,
      onPrefetchLikes: () => fixture.calls.prefetchLikes++,
    }));
    const count = button("View 12 likes");
    assert.equal(count.textContent, "12");
    assert.equal(count.parentElement, button("Like, 12 likes").parentElement, "separate likes-sheet trigger stays grouped with the heart");
    await flush(() => count.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })));
    await flush(() => count.click());
    assert.equal(fixture.calls.likes, 1);
    assert.equal(fixture.calls.prefetchLikes, 1);
    assert.equal(fixture.calls.like, 1, "viewing likes must not toggle the like");
    assert.equal(fixture.calls.card, 0);
    await flush(() => app.render({ likes: 0, comments: 0 }));
    assert.equal(button("View 0 comments").textContent, "0", "rollback/deletion restores the zero state");
    console.log("PASS native engagement controls: adjacency, zero/singular/live counts, pending likes, prefetch, independent likes sheet, and no card propagation");
  } finally {
    if (app) await fixture.act(async () => app.unmount());
    window.happyDOM.abort();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
