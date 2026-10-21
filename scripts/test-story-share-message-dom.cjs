#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const paths = (process.env.NODE_PATH || "")
  .split(path.delimiter)
  .filter(Boolean);
const resolve = (name) =>
  require.resolve(name, { paths: paths.length ? paths : undefined });
const { buildSync } = require(resolve("esbuild"));
const root = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-share-message-"));
try {
  buildSync({
    stdin: {
      contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {StoryShareBubble} from './packages/app/components/chat/story-share-bubble.web';export function render(share, own){return renderToStaticMarkup(<StoryShareBubble share={share} isOwnMessage={own}/>);}`,
      resolveDir: root,
      loader: "tsx",
    },
    outfile: path.join(dir, "fixture.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    tsconfigRaw: {},
    nodePaths: paths,
    alias: {
      "@dvnt/app": path.join(root, "packages/app"),
      ...Object.fromEntries(
        ["react", "react-dom"].map((name) => [
          name,
          path.dirname(resolve(name + "/package.json")),
        ]),
      ),
    },
  });
  const { render } = require(path.join(dir, "fixture.cjs"));
  const post = {
    storyId: "42",
    sourceId: "7",
    sourceType: "post",
    sourceTitle: "<script>danger</script>",
  };
  const incoming = render(post, false);
  assert.match(incoming, /Shared your post to their story\./);
  assert.match(incoming, /href="\/feed\/post\/7"/);
  assert.match(incoming, /View post/);
  assert.ok(
    !incoming.includes("<script>"),
    "titles are escaped, not interpreted as HTML",
  );
  assert.match(
    render({ ...post, sourceType: "event" }, true),
    /You shared this event to your story\./,
  );
  assert.match(
    render({ ...post, sourceType: "event" }, true),
    /href="\/feed\/events\/7"/,
  );
  assert.ok(
    !render({ ...post, sourceId: "javascript:alert(1)" }, false).includes(
      "href=",
    ),
  );
  const chat = fs.readFileSync(
    path.join(root, "packages/app/features/messages/chat.web.tsx"),
    "utf8",
  );
  const store = fs.readFileSync(
    path.join(root, "packages/app/lib/stores/chat-store.ts"),
    "utf8",
  );
  assert.match(
    chat,
    /storyShare: parseStoryShareContext\(meta\)/,
    "realtime notices use validated parser",
  );
  assert.match(
    store,
    /storyShare: parseStoryShareContext\(meta\)/,
    "reloaded notices use same validated parser",
  );
  console.log(
    "PASS story share DM: incoming/outgoing copy, source links, escaped titles, reload/realtime wiring",
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
