#!/usr/bin/env node
// Exercise the real story-message helper and messages API with offline edges.
// Run: NODE_PATH=/tmp/dvnt-social-test/node_modules node scripts/test-story-reply-identity.cjs
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

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "story-reply-identity-"));
  const originalLog = console.log;
  const originalError = console.error;
  let state;
  let passed = 0;
  try {
    await build({
      stdin: {
        contents: `
          export { sendStoryMessage } from './packages/app/lib/stories/story-message';
          export { messagesApi } from './packages/app/lib/api/messages-impl';
        `,
        resolveDir: root,
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      tsconfigRaw: {},
      outfile: path.join(directory, "fixture.cjs"),
      nodePaths: dependencyPaths,
      alias: { "@dvnt/app": path.join(root, "packages/app") },
      plugins: [{
        name: "offline-story-reply-boundaries",
        setup(builder) {
          builder.onResolve({
            filter: /(?:stores\/auth-store|auth\/identity|\.\/auth-helper|supabase\/client|hooks\/use-conversation-resolution)$/,
          }, (args) => ({ path: args.path, namespace: "story-reply-fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "story-reply-fixture" }, (args) => {
            const fixture = "globalThis.__storyReplyFixture";
            return {
              loader: "js",
              contents: args.path.endsWith("auth-store")
                ? `export const useAuthStore={getState:()=>({user:${fixture}.viewerId===null?null:{id:${fixture}.viewerId}})};`
                : args.path.endsWith("identity")
                  ? `export const requireBetterAuthToken=()=>${fixture}.token();export const getCurrentUserId=async()=>${fixture}.viewerId;`
                  : args.path.endsWith("auth-helper")
                    ? `export const getCurrentUserIdSync=()=>Number(${fixture}.viewerId);export const getCurrentUserAuthId=async()=>${fixture}.viewerId;export const resolveUserIdInt=async(value)=>Number(value);`
                    : args.path.endsWith("use-conversation-resolution")
                      ? `export const getOrCreateConversationCached=(...args)=>${fixture}.conversation(...args);`
                      : `export const supabase={functions:{invoke:(...args)=>${fixture}.invoke(...args)},from:()=>{throw new Error('Unexpected database access in offline test')}};`,
            };
          });
        },
      }],
    });
    const { sendStoryMessage, messagesApi } = require(path.join(directory, "fixture.cjs"));
    // The production API logs expected failures. Keep this runner's output concise.
    console.log = () => {};
    console.error = () => {};

    function reset() {
      state = {
        viewerId: "101",
        lifecycle: 0,
        conversationCalls: [],
        tokenCalls: 0,
        sourceCalls: 0,
        invocations: [],
        events: [],
        resolveConversation: async () => "456",
        acquireToken: async () => "fixture-token",
        checkSource: async () => {},
      };
      global.__storyReplyFixture = {
        get viewerId() { return state.viewerId; },
        conversation(...args) {
          state.conversationCalls.push(args);
          state.events.push("conversation");
          return state.resolveConversation(...args);
        },
        token() {
          state.tokenCalls++;
          state.events.push("token");
          return state.acquireToken();
        },
        async invoke(...args) {
          state.invocations.push(args);
          state.events.push("invoke");
          return { data: { ok: true, data: { message: { id: "message-1" } } }, error: null };
        },
      };
    }

    function options(overrides = {}) {
      const lifecycle = state.lifecycle;
      return {
        queryClient: { offlineFixture: true },
        recipientUserId: "303",
        story: {
          id: "active-segment-22",
          username: "story_owner",
          avatar: "https://fixture.invalid/avatar.jpg",
          items: [
            { type: "image", url: "https://fixture.invalid/previous-segment.jpg" },
            { type: "video", url: "https://fixture.invalid/active-segment.mp4", thumbnail: "https://fixture.invalid/active-poster.jpg" },
          ],
        },
        itemIndex: 1,
        kind: "story_reply",
        content: "A reply to this segment",
        expectedViewerId: "101",
        isCurrent: () => state.lifecycle === lifecycle,
        beforeSend: async () => {
          state.sourceCalls++;
          state.events.push("source");
          await state.checkSource();
        },
        ...overrides,
      };
    }

    async function test(name, run) {
      reset();
      let timeout;
      try {
        // Keep pending boundary expectations from making Node exit successfully
        // before a broken implementation reaches the expected suspension point.
        await Promise.race([
          run(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Timed out waiting for offline test boundary")), 5000);
          }),
        ]);
        passed++;
        originalLog(`PASS ${name}`);
      } catch (error) {
        error.message = `${name}: ${error.message}`;
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    const invalidations = [
      { name: "account switch", error: /Account changed/, apply: () => { state.viewerId = "202"; } },
      { name: "logout", error: /Account changed/, apply: () => { state.viewerId = null; } },
      { name: "viewer close", error: /Story viewer changed/, apply: () => { state.lifecycle++; } },
      {
        name: "ABA account/lifecycle change",
        error: /Story viewer changed/,
        apply: () => {
          state.viewerId = "202";
          state.lifecycle++;
          state.viewerId = "101";
          assert.equal(state.viewerId, "101", "same account ID cannot revive an old lifecycle");
        },
      },
    ];

    for (const api of ["story helper", "message API"]) {
      for (const change of [invalidations[0], invalidations[2]]) {
        await test(`${api} rejects ${change.name} before resolving or refreshing`, async () => {
          const input = options();
          change.apply();
          await assert.rejects(
            api === "story helper"
              ? sendStoryMessage(input)
              : messagesApi.sendMessage({ ...input, conversationId: "456" }),
            change.error,
          );
          assert.equal(state.conversationCalls.length, 0);
          assert.equal(state.tokenCalls, 0);
          assert.equal(state.sourceCalls, 0);
          assert.equal(state.invocations.length, 0);
        });
      }
    }

    for (const phase of ["conversation", "token", "source"]) {
      for (const change of invalidations) {
        await test(`${change.name} during ${phase} blocks transmission`, async () => {
          const entered = deferred();
          const gate = deferred();
          const handler = { conversation: "resolveConversation", token: "acquireToken", source: "checkSource" }[phase];
          state[handler] = () => {
            entered.resolve();
            return gate.promise;
          };
          const pending = sendStoryMessage(options());
          const rejected = assert.rejects(pending, change.error);
          await entered.promise;
          change.apply();
          gate.resolve(phase === "conversation" ? "456" : phase === "token" ? "fixture-token" : undefined);
          await rejected;
          assert.equal(state.conversationCalls.length, 1);
          assert.equal(state.tokenCalls, phase === "conversation" ? 0 : 1);
          assert.equal(state.sourceCalls, phase === "source" ? 1 : 0);
          assert.equal(state.invocations.length, 0, "stale work must not invoke send-message");
        });
      }
    }

    for (const delayed of [false, true]) {
      await test(`${delayed ? "late" : "immediate"} source denial blocks transmission`, async () => {
        const entered = deferred();
        const gate = deferred();
        state.checkSource = async () => {
          entered.resolve();
          if (delayed) await gate.promise;
          throw new Error("Source story is no longer visible");
        };
        const rejected = assert.rejects(sendStoryMessage(options()), /Source story is no longer visible/);
        await entered.promise;
        assert.equal(state.invocations.length, 0, "source check must finish before send-message");
        gate.resolve();
        await rejected;
        assert.equal(state.sourceCalls, 1);
        assert.equal(state.invocations.length, 0);
        assert.deepEqual(state.events, ["conversation", "token", "source"]);
      });
    }

    await test("missing conversation never starts token or source work", async () => {
      state.resolveConversation = async () => null;
      await assert.rejects(sendStoryMessage(options()), /Could not start conversation/);
      assert.equal(state.tokenCalls, 0);
      assert.equal(state.sourceCalls, 0);
      assert.equal(state.invocations.length, 0);
    });

    for (const kind of ["story_reply", "story_reaction"]) {
      await test(`${kind} sends active-segment metadata and only serializable identity`, async () => {
        const input = options({ kind, content: kind === "story_reaction" ? "🔥" : "A reply to this segment" });
        const startedAt = Date.now();
        const message = await sendStoryMessage(input);
        assert.deepEqual(message, { id: "message-1" });
        assert.deepEqual(state.conversationCalls, [[input.queryClient, "303"]]);
        assert.deepEqual(state.events, ["conversation", "token", "source", "invoke"]);
        assert.equal(state.invocations.length, 1);
        const [name, request] = state.invocations[0];
        assert.equal(name, "send-message");
        assert.deepEqual(request.headers, { Authorization: "Bearer fixture-token" });
        assert.deepEqual(Object.keys(request.body).sort(), ["content", "conversationId", "expectedViewerId", "metadata"]);
        assert.equal(request.body.conversationId, 456);
        assert.equal(request.body.content, input.content);
        assert.equal(request.body.expectedViewerId, "101", "the server receives the captured viewer identity");
        assert.equal(Object.hasOwn(request.body, "isCurrent"), false);
        assert.equal(Object.hasOwn(request.body, "beforeSend"), false);
        assert.deepEqual(JSON.parse(JSON.stringify(request.body)), request.body);
        const { storyExpiresAt, ...metadata } = request.body.metadata;
        assert.deepEqual(metadata, {
          type: kind,
          storyId: "active-segment-22",
          storyMediaUrl: "https://fixture.invalid/active-poster.jpg",
          storyUsername: "story_owner",
          storyAvatar: "https://fixture.invalid/avatar.jpg",
          ...(kind === "story_reaction" ? { reactionEmoji: "🔥" } : {}),
        });
        const expiresAt = Date.parse(storyExpiresAt);
        const lifetime = 24 * 60 * 60 * 1000;
        assert.ok(expiresAt >= startedAt + lifetime && expiresAt <= Date.now() + lifetime);
      });
    }

    await test("legacy message sends without identity or lifecycle options", async () => {
      state.viewerId = null;
      const media = [{ uri: "https://fixture.invalid/photo.jpg", type: "image" }];
      const result = await messagesApi.sendMessage({ conversationId: "456", content: "Legacy message", operationId: "legacy-op", media });
      assert.deepEqual(result, { id: "message-1" });
      assert.equal(state.sourceCalls, 0);
      assert.deepEqual(state.invocations[0][1].body, {
        conversationId: 456,
        content: "Legacy message",
        operationId: "legacy-op",
        mediaItems: media,
        mediaUrl: media[0].uri,
      });
    });

    await test("legacy story helper remains compatible with omitted guards", async () => {
      const { expectedViewerId, isCurrent, beforeSend, ...input } = options();
      const result = await sendStoryMessage({ ...input, itemIndex: 0, story: { ...input.story, id: 22 } });
      assert.deepEqual(result, { id: "message-1" });
      assert.equal(state.sourceCalls, 0);
      const body = state.invocations[0][1].body;
      assert.equal(Object.hasOwn(body, "expectedViewerId"), false);
      assert.equal(body.metadata.storyId, "22");
      assert.equal(body.metadata.storyMediaUrl, "https://fixture.invalid/previous-segment.jpg");
    });

    originalLog(`PASS story reply identity: ${passed} offline cases using actual production modules`);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    delete global.__storyReplyFixture;
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
