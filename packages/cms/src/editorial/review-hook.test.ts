import test from "node:test";
import assert from "node:assert/strict";
import { enforceEditorialReview } from "../collections/hooks/editorial-review.ts";

function subject(options: {
  previousStage?: string;
  nextStage?: string;
  channelEnabled?: boolean;
  sourcePolicy?: string;
  sourceUrl?: string | null;
  actorId?: string | null;
  approvedBy?: string | null;
} = {}) {
  const previousStage = options.previousStage ?? "review";
  return {
    data: {
      channel: "channel-42",
      body: "Draft editorial copy",
      stage: options.nextStage ?? "approved",
      sourceUrl: options.sourceUrl === undefined ? "https://archive.org/item" : options.sourceUrl,
      approvedBy: "forged-reviewer",
      publishOperationKey: "editorial:job:42",
      scheduledAt: "2026-11-01T13:00:00Z",
      publishedPostId: "forged-public-post",
    },
    originalDoc: {
      channel: "channel-42",
      stage: previousStage,
      approvedBy: options.approvedBy ?? null,
      publishedPostId: null,
    },
    req: {
      user: options.actorId === null ? null : { id: options.actorId ?? "real-admin" },
      payload: {
        async findByID() {
          return {
            enabled: options.channelEnabled ?? true,
            sourcePolicy: options.sourcePolicy ?? "verified-sources",
          };
        },
      },
    },
    operation: "update",
  };
}

test("actual Payload hook replaces forged approver and published post IDs", async () => {
  const got = await enforceEditorialReview(subject() as any);
  assert.equal(got?.approvedBy, "real-admin");
  assert.equal(got?.publishedPostId, null);
  assert.equal(got?.stage, "approved");
});

test("scheduled stage requires previous approval and an enabled channel", async () => {
  await assert.rejects(enforceEditorialReview(subject({
    previousStage: "draft", nextStage: "scheduled",
  }) as any), /invalid_transition/);
  await assert.rejects(enforceEditorialReview(subject({
    previousStage: "approved", nextStage: "scheduled", channelEnabled: false,
  }) as any), /channel_disabled/);
});

test("missing source and unsigned moderator cannot approve factual content", async () => {
  await assert.rejects(enforceEditorialReview(subject({
    sourceUrl: null,
  }) as any), /source_required/);
  await assert.rejects(enforceEditorialReview(subject({
    actorId: null,
  }) as any), /missing_reviewer/);
});

test("Payload admin cannot mark a queue item published by editing its JSON", async () => {
  await assert.rejects(enforceEditorialReview(subject({
    previousStage: "scheduled", nextStage: "published",
  }) as any), /invalid_transition|publisher_not_installed/);
});

test("approved by attribution stays immutable on scheduling", async () => {
  const got = await enforceEditorialReview(subject({
    previousStage: "approved", nextStage: "scheduled", approvedBy: "actual-approver",
  }) as any);
  assert.equal(got?.approvedBy, "actual-approver");
  assert.equal(got?.publishedPostId, null);
});
