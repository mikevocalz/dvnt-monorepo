import test from "node:test";
import { URL } from "node:url";
import assert from "node:assert/strict";
import { canDeleteComment, removeComment } from "./deletion.ts";

test("only a signed-in matching author sees deletion for persisted comments", () => {
  const comment = { id: "17", username: "owner" };
  assert.equal(canDeleteComment(true, "owner", comment), true);
  assert.equal(canDeleteComment(false, "owner", comment), false);
  assert.equal(canDeleteComment(true, "other", comment), false);
  assert.equal(canDeleteComment(true, undefined, comment), false);
  assert.equal(canDeleteComment(true, "unknown", { ...comment, username: "unknown" }), false);
  for (const id of ["temp-1", "17oops", "", "0", "-1"]) {
    assert.equal(canDeleteComment(true, "owner", { ...comment, id }), false);
  }
});

test("reply removal preserves siblings and does not mutate cached input", () => {
  const input = [{ id: "1", replies: [{ id: "2" }, { id: "3" }] }, { id: "4" }];
  assert.deepEqual(removeComment(input, "2"), [{ id: "1", replies: [{ id: "3" }] }, { id: "4" }]);
  assert.equal(input[0].replies?.length, 2);
  assert.deepEqual(removeComment(input, "1"), [{ id: "4" }]);
});

test("shared rows expose the platform delete action on all web comment surfaces", async () => {
  const { readFile } = await import("node:fs/promises");
  const row = await readFile(new URL("../../features/comments/ui/threaded-comment.tsx", import.meta.url), "utf8");
  assert.match(row, /import \{ DeleteCommentAction \} from "\.\/delete-comment-action"/);
  assert.match(row, /<DeleteCommentAction comment=\{comment\} postId=\{postId\} \/>/);
  const config = await readFile(new URL("../../../../apps/web/next.config.ts", import.meta.url), "utf8");
  // Web resolution is also exercised by the application's existing resolver.
  assert.match(config, /'\.web.tsx'/);
});
