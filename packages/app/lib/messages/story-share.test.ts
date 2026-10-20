import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStoryShareContext, storyShareSourcePath } from "./story-share.ts";

test("server share notices preserve source identity and choose canonical local routes", () => {
  for (const sourceType of ["post", "event"] as const) {
    const context = parseStoryShareContext({
      type: "story_share",
      storyId: 42,
      sourceId: "7",
      sourceType,
      sourceTitle: "The original",
    });
    assert.deepEqual(context, {
      storyId: "42",
      sourceId: "7",
      sourceType,
      sourceTitle: "The original",
    });
    assert.equal(
      storyShareSourcePath(context!),
      sourceType === "post" ? "/feed/post/7" : "/feed/events/7",
    );
  }
});

test("malformed, forged links and unsupported notice types do not produce navigation", () => {
  for (const malformed of [
    null,
    [],
    "story_share",
    {},
    { type: "shared_post" },
    {
      type: "story_share",
      storyId: "42",
      sourceType: "profile",
      sourceId: "7",
    },
    ...[
      "0",
      "-1",
      "../9",
      "javascript:alert(1)",
      "https://evil.invalid",
      "9007199254740992",
      {},
      [],
    ].map((sourceId) => ({
      type: "story_share",
      storyId: "42",
      sourceId,
      sourceType: "post",
    })),
    { type: "story_share", storyId: "bad", sourceId: "7", sourceType: "post" },
  ])
    assert.equal(parseStoryShareContext(malformed), undefined);
  assert.equal(
    storyShareSourcePath({
      storyId: "42",
      sourceId: "../9",
      sourceType: "post",
    }),
    undefined,
  );
});

test("source title is bounded and not required for existing messages", () => {
  const context = parseStoryShareContext({
    type: "story_share",
    storyId: "42",
    sourceId: "7",
    sourceType: "post",
    sourceTitle: "a".repeat(300),
  });
  assert.equal(context?.sourceTitle?.length, 280);
  assert.equal(
    parseStoryShareContext({
      type: "story_share",
      storyId: "42",
      sourceId: "7",
      sourceType: "event",
    })?.sourceTitle,
    undefined,
  );
});
