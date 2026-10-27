import test from "node:test";
import assert from "node:assert/strict";
import { getPostCommentCount } from "./engagement-counts.ts";
import type { Comment } from "../types";

test("counts include zero, numeric payloads and all replies", () => {
  assert.equal(getPostCommentCount(undefined), 0);
  assert.equal(getPostCommentCount(null), 0);
  assert.equal(getPostCommentCount(0), 0);
  assert.equal(getPostCommentCount(12), 12);
  assert.equal(getPostCommentCount([]), 0);
  assert.equal(getPostCommentCount([{ id: "1", replies: [{ id: "2", replies: [{ id: "3" }] }] }, { id: "4" }] as Comment[]), 4);
});

