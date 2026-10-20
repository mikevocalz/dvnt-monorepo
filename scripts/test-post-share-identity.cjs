#!/usr/bin/env node
// Actual story API + mutation/cache, with auth-token and network edges offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dependencyPaths = (process.env.NODE_PATH || "")
  .split(path.delimiter)
  .filter(Boolean);
const { build } = require(
  require.resolve("esbuild", {
    paths: dependencyPaths.length ? dependencyPaths : undefined,
  }),
);
(async () => {
  const { Window } = await import(
    require.resolve("happy-dom", {
      paths: dependencyPaths.length ? dependencyPaths : undefined,
    })
  );
  const window = new Window();
  Object.assign(global, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "post-share-identity-"));
  const paths = (process.env.NODE_PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  let mounted, client;
  try {
    await build({
      stdin: {
        contents: `
      import React,{act} from 'react';import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {useCreateStory,storyKeys} from './packages/app/lib/hooks/use-stories';
      import {storiesApi} from './packages/app/lib/api/stories';
      import {useAuthStore} from '@dvnt/app/lib/stores/auth-store';
      export {act,storiesApi,useAuthStore,storyKeys};
      export const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
      export let mutation;
      function Probe(){mutation=useCreateStory();return null}
      export function mount(node){const app=createRoot(node);return {render:()=>app.render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>),unmount:()=>app.unmount()}}
    `,
        resolveDir: root,
        loader: "tsx",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      tsconfigRaw: {},
      outfile: path.join(dir, "fixture.cjs"),
      nodePaths: paths,
      alias: {
        "@dvnt/app": path.join(root, "packages/app"),
        ...Object.fromEntries(
          [
            "react",
            "react-dom",
            "zustand",
            "@tanstack/react-query",
            "@tanstack/query-core",
          ].map((name) => [
            name,
            path.dirname(require.resolve(name + "/package.json", { paths })),
          ]),
        ),
      },
      plugins: [
        {
          name: "offline-auth-story",
          setup(b) {
            b.onResolve(
              {
                filter:
                  /(?:stores\/auth-store|auth\/identity|api\/auth-helper|\.\/auth-helper|supabase\/client)$/,
              },
              (a) => ({ path: a.path, namespace: "fixture" }),
            );
            b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
              loader: "js",
              resolveDir: root,
              contents: a.path.endsWith("auth-store")
                ? `import {create} from 'zustand';export const useAuthStore=create(()=>({user:{id:'1',username:'one'}}));`
                : a.path.endsWith("identity")
                  ? `export const requireBetterAuthToken=()=>globalThis.__token();export const getCurrentUserId=()=>globalThis.__viewer();`
                  : a.path.endsWith("auth-helper")
                    ? `export const getCurrentUserId=()=>globalThis.__viewer();export const getCurrentUserIdSync=()=>Number(globalThis.__viewer());export const getCurrentUserAuthId=async()=>globalThis.__viewer();`
                    : `export const supabase={functions:{invoke:(...args)=>globalThis.__storyInvoke(...args)}};`,
            }));
          },
        },
      ],
    });
    const f = require(path.join(dir, "fixture.cjs"));
    client = f.client;
    global.__viewer = () => f.useAuthStore.getState().user?.id ?? null;
    let calls = [],
      tokenCalls = 0;
    global.__token = async () => {
      tokenCalls++;
      return "token";
    };
    global.__storyInvoke = async (...args) => {
      calls.push(args);
      return {
        data: {
          ok: true,
          data: {
            story: { id: "s1", authorId: "1", author: { username: "one" } },
          },
        },
        error: null,
      };
    };
    const input = {
      items: [{ type: "video", url: "https://fixture.invalid/a.mp4" }],
      expectedViewerId: "1",
    };
    await assert.rejects(
      () => f.storiesApi.createStory({ ...input, expectedViewerId: "other" }),
      /Account changed/,
    );
    assert.equal(tokenCalls, 0);
    assert.equal(calls.length, 0);
    let resolveToken;
    global.__token = () =>
      new Promise((resolve) => {
        resolveToken = resolve;
      });
    const request = f.storiesApi.createStory(input);
    const rejected = assert.rejects(request, /Account changed/);
    f.useAuthStore.setState({ user: { id: "2", username: "two" } });
    resolveToken("token2");
    await rejected;
    assert.equal(
      calls.length,
      0,
      "account switch during token refresh cannot submit",
    );

    const node = document.createElement("div");
    document.body.append(node);
    mounted = f.mount(node);
    const flush = async (run) =>
      f.act(async () => {
        await run?.();
        await new Promise((r) => setTimeout(r, 0));
      });
    await flush(() => mounted.render());
    const old = [{ id: "old-1", username: "one" }],
      next = [{ id: "new-2", username: "two" }];
    await flush(() => {
      f.useAuthStore.setState({ user: { id: "1", username: "one" } });
      client.setQueryData(f.storyKeys.list(), old);
    });
    let pending;
    await flush(() => {
      pending = f.mutation.mutateAsync(input).catch((e) => e);
    });
    assert.equal(
      client.getQueryData(f.storyKeys.list()).length,
      2,
      "optimistic share appears",
    );
    await flush(() => {
      f.useAuthStore.setState({ user: { id: "2", username: "two" } });
      client.setQueryData(f.storyKeys.list(), next);
      resolveToken("token2");
    });
    assert.match((await pending).message, /Account changed/);
    assert.deepEqual(
      client.getQueryData(f.storyKeys.list()),
      next,
      "failed old share never rolls old cache into new viewer",
    );

    global.__token = async () => "token";
    let resolveStory;
    global.__storyInvoke = (...args) => {
      calls.push(args);
      return new Promise((resolve) => {
        resolveStory = resolve;
      });
    };
    await flush(() => {
      f.useAuthStore.setState({ user: { id: "1", username: "one" } });
      client.setQueryData(f.storyKeys.list(), old);
      pending = f.mutation.mutateAsync(input).catch((e) => e);
    });
    await flush(() => {
      f.useAuthStore.setState({ user: { id: "2", username: "two" } });
      client.setQueryData(f.storyKeys.list(), next);
      resolveStory({
        data: {
          ok: true,
          data: {
            story: { id: "s1", authorId: "1", author: { username: "one" } },
          },
        },
        error: null,
      });
    });
    await pending;
    assert.deepEqual(
      client.getQueryData(f.storyKeys.list()),
      next,
      "late success cannot relabel old story as new viewer",
    );

    global.__storyInvoke = async () => ({
      data: null,
      error: new Error("offline"),
    });
    await flush(() => {
      f.useAuthStore.setState({ user: { id: "1", username: "one" } });
      client.removeQueries({ queryKey: f.storyKeys.list() });
      pending = f.mutation.mutateAsync(input).catch((e) => e);
    });
    await pending;
    assert.deepEqual(
      client.getQueryData(f.storyKeys.list()),
      [],
      "first-story failure removes ghost optimistic card",
    );
    console.log(
      "PASS story identity: before/after token gate, account-switch rollback/success isolation, failed-first-story cleanup",
    );
  } finally {
    if (mounted)
      await require(path.join(dir, "fixture.cjs")).act(async () =>
        mounted.unmount(),
      );
    client?.clear();
    window.happyDOM.abort();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
