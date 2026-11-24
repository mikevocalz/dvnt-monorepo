import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./posts.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source)
  .replace(/^import\s+[^;]+;\r?\n/gm, "")
  .replace(/^export\s+/gm, "");

type Invoke = (name: string, options: {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  timeout?: number;
}) => Promise<unknown>;

function loadPosts(invoke: Invoke) {
  // React Native 0.86's global is a real abort signal, but has no static
  // timeout. Keep the module's actual createPost implementation intact.
  class LegacyAbortSignal {}
  assert.equal("timeout" in LegacyAbortSignal, false);
  return runInNewContext(compiled + "\npostsApi", {
    AbortSignal: LegacyAbortSignal,
    console: { log() {}, error() {} },
    supabase: { functions: { invoke } },
    requireBetterAuthToken: async () => "fixture-token",
    validatePostCaption: () => ({ valid: true }),
    resolveTextPostPresentation: () => ({ textSlides: [], caption: "fixture" }),
    normalizeTextPostTheme: () => "default",
    describeFunctionError: async (value: unknown) => value,
  });
}

for (const input of [
  { kind: "text", isNSFW: false, slides: ["fixture"] },
  { kind: "media", isNSFW: false, media: [{ type: "image", url: "https://example.invalid/still.jpg" }] },
  { kind: "media", isNSFW: true, media: [{ type: "image", url: "https://example.invalid/still.jpg" }] },
] as const) {
  test(`${input.kind} (${input.isNSFW ? "Spicy" : "Sweet"}) reaches create-post without AbortSignal.timeout`, async () => {
    let requests = 0;
    const posts = loadPosts(async (name, options) => {
      requests++;
      assert.equal(name, "create-post");
      assert.equal(options.timeout, 60_000);
      assert.equal(options.headers.Authorization, "Bearer fixture-token");
      assert.equal(options.body.operationId, "fixture-operation");
      assert.equal(options.body.expectedAuthorId, "fixture-owner");
      assert.equal(options.body.firstPostEventId, 12);
      assert.equal(options.body.kind, input.kind);
      assert.equal(options.body.isNSFW, input.isNSFW);
      return { data: { ok: true, data: { post: { id: "fixture-post" } } } };
    });
    const result = await posts.createPost({ ...input, content: "fixture", operationId: "fixture-operation", expectedAuthorId: "fixture-owner", firstPostEventId: 12 });
    assert.equal(result.id, "fixture-post");
    assert.equal(requests, 1);
  });
}

test("the same native-compatible request preserves a server refusal", async () => {
  const posts = loadPosts(async () => ({
    error: { status: 403, message: "Verify your ID to continue." },
  }));
  await assert.rejects(posts.createPost({ kind: "text", content: "fixture" }), /Verify your ID to continue/);
});
