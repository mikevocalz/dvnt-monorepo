#!/usr/bin/env node
// Real web picker, Drawer, avatar and send store. Auth and network are offline.
// --build-only never loads or launches Playwright; Chromium runs in CI only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const paths = (process.env.NODE_PATH || "")
  .split(path.delimiter)
  .filter(Boolean);
const resolve = (name) =>
  require.resolve(name, { paths: paths.length ? paths : undefined });
const load = (name) => require(resolve(name));

async function buildFixture(dir) {
  const mocks = {
    "picker-fixture": `import {create} from 'zustand';
      export const state={sent:[],toasts:[]};
      export const auth=create(()=>({user:{id:'viewer',username:'viewer'}}));
      const alice={id:'alice',name:'Alice',username:'alice',avatar:''};
      const bob={id:'bob',username:'bob',avatar:''};
      export const conversations=[
        {id:'direct-alice',user:alice},
        {id:'group-crew',isGroup:true,groupName:'Weekend crew',user:alice,members:[alice,bob]},
        {id:'group-empty',isGroup:true,groupName:'',user:alice,members:[]},
        {id:'group-long',isGroup:true,groupName:'A very long and distinctive group name that must never look like Alice',user:alice,members:[alice,bob]}
      ];`,
    "@dvnt/app/lib/hooks/use-messages": `import {conversations} from 'picker-fixture';export const useConversations=()=>({data:conversations,isPending:false,isError:false,refetch(){}});`,
    "@dvnt/app/lib/hooks/use-verified-gate": `export const useVerifiedGate=()=> (_action,run)=>run();`,
    "@dvnt/app/lib/stores/auth-store": `export {auth as useAuthStore} from 'picker-fixture';`,
    "@dvnt/app/lib/stores/ui-store": `import {state} from 'picker-fixture';const value={showToast:(...args)=>state.toasts.push(args)};export const useUIStore=s=>s(value);useUIStore.getState=()=>value;`,
    "@dvnt/app/lib/api/messages-impl": `import {state} from 'picker-fixture';export const messagesApi={sendMessage:async input=>{state.sent.push(input);return {id:'synthetic-message'}}};`,
    "@dvnt/app/lib/server-upload": `export const uploadToServer=()=>{throw new Error('unexpected upload')};`,
    "@dvnt/app/lib/auth/auth-logger": `export const logChat=()=>{};`,
    "@dvnt/app/lib/auth-client": `export const invalidateTokenCache=()=>{};export const getQueryClient=()=>null;`,
    "@dvnt/app/lib/connectivity/guard": `export const ensureOnlineOrToast=()=>true;`,
    "@dvnt/ui": `export {Drawer} from '${ROOT}/packages/ui/src/form/Drawer.web.tsx';`,
  };
  await load("esbuild").build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {ShareToInboxSheet} from './packages/app/components/share-to-inbox-sheet.web';
      import {useWebPostShareStore} from './packages/app/lib/stores/web-post-share-store';
      import {state} from 'picker-fixture';
      const post={postId:'synthetic-post',authorUsername:'author',authorAvatar:'',mediaUrl:'',mediaType:'image'};
      window.picker={state,open:()=>useWebPostShareStore.getState().open(post)};
      createRoot(document.getElementById('root')).render(<ShareToInboxSheet/>);window.picker.open();`,
      resolveDir: ROOT,
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    outfile: path.join(dir, "fixture.js"),
    nodePaths: paths,
    tsconfigRaw: {},
    define: { __DEV__: "false", "process.env.NODE_ENV": '"production"' },
    alias: {
      "@dvnt/app/components/ui/avatar": path.join(
        ROOT,
        "packages/app/components/ui/avatar.web.tsx",
      ),
      "@dvnt/app": path.join(ROOT, "packages/app"),
      "react-native": "react-native-web",
      ...Object.fromEntries(
        ["react", "react-dom", "zustand"].map((name) => [
          name,
          path.dirname(resolve(name + "/package.json")),
        ]),
      ),
    },
    plugins: [
      {
        name: "offline-picker",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            mocks[a.path] ? { path: a.path, namespace: "mock" } : null,
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: mocks[a.path],
            loader: "tsx",
            resolveDir: ROOT,
          }));
        },
      },
    ],
  });
  const tw = path.dirname(resolve("tailwindcss/package.json"));
  const input =
    `@import "${tw}/theme.css" layer(theme);@import "${tw}/preflight.css" layer(base);@import "${tw}/utilities.css" important;` +
    [
      "packages/app/components/share-to-inbox-sheet.web.tsx",
      "packages/ui/src/form/Drawer.web.tsx",
    ]
      .map((s) => `@source "${path.join(ROOT, s)}";`)
      .join("\n");
  const css = (
    await load("postcss")([
      load("@tailwindcss/postcss")({ base: ROOT }),
    ]).process(input, { from: path.join(ROOT, "picker-fixture.css") })
  ).css;
  assert.match(css, /\.h-11/);
  fs.writeFileSync(path.join(dir, "fixture.css"), css);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dvnt-share-picker-"));
  let browser;
  try {
    await buildFixture(dir);
    if (process.argv.includes("--build-only")) {
      console.log(
        "PASS picker browser fixture + production Tailwind build (no browser launched)",
      );
      return;
    }
    browser = await load("playwright").chromium.launch({ headless: true });
    const screenshots = process.env.SHARE_PICKER_SCREENSHOT_DIR;
    if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (r) => r.abort());
      await page.setContent(
        '<html><body style="background:#080808;color:white"><div id="root"></div></body></html>',
      );
      await page.addStyleTag({ path: path.join(dir, "fixture.css") });
      await page.addScriptTag({ path: path.join(dir, "fixture.js") });
      const direct = page.getByRole("button", {
        name: "Share post with @alice",
        exact: true,
      });
      const group = page.getByRole("button", {
        name: "Share post with group Weekend crew",
        exact: true,
      });
      await group.waitFor();
      assert.match(
        await group.innerText(),
        /Weekend crew\s+Group · alice, bob/,
      );
      assert.match(await direct.innerText(), /@alice\s+Direct message/);
      const descriptionId = await group.getAttribute("aria-describedby");
      assert.ok(descriptionId);
      assert.equal(
        await page.evaluate(
          (id) => document.getElementById(id)?.textContent,
          descriptionId,
        ),
        "Group · alice, bob",
      );
      assert.equal(await group.locator("svg.lucide-users").count(), 1);
      assert.equal(
        await page
          .getByRole("button", { name: "Share post with group Unnamed group" })
          .locator("svg.lucide-users")
          .count(),
        1,
      );
      for (const row of await page
        .getByRole("button", { name: /Share post with/ })
        .all()) {
        const box = await row.boundingBox();
        assert.ok(
          box &&
            box.x >= 0 &&
            box.x + box.width <= width + 1 &&
            box.height >= 44,
          "recipient fits viewport with usable touch target",
        );
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      if (screenshots)
        await page.screenshot({
          path: path.join(screenshots, `share-picker-${width}.png`),
        });
      await page
        .getByRole("textbox", { name: "Search conversations" })
        .fill(" WEEKEND ");
      assert.equal(
        await page.getByRole("button", { name: /Share post with/ }).count(),
        1,
      );
      await group.click();
      await page.waitForFunction(() => window.picker.state.sent.length === 1);
      assert.equal(
        await page.evaluate(() => window.picker.state.sent[0].conversationId),
        "group-crew",
      );
      assert.equal(
        await page.evaluate(() => window.picker.state.sent[0].metadata.type),
        "shared_post",
      );
      assert.match(
        await page.evaluate(() => window.picker.state.toasts.at(-1)[2]),
        /group Weekend crew/,
      );
      await group.waitFor({ state: "hidden" });
      await page.evaluate(() => window.picker.open());
      await direct.click();
      await page.waitForFunction(() => window.picker.state.sent.length === 2);
      assert.equal(
        await page.evaluate(() => window.picker.state.sent[1].conversationId),
        "direct-alice",
      );
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `PASS ${width}px: group identity/avatar/search and real selected-recipient payloads`,
      );
    }
  } finally {
    await browser?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
