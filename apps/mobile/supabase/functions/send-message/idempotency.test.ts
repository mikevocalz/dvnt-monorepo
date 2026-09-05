import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJSON } from "./idempotency.ts";

test("JSONB key reorder recovers retries without allowing changed attachment order or content", () => {
  const a = { mediaItems: [{uri: "https://example.com/a.jpg", type: "image"}], reply: { text: "yes", id: 7 } };
  const b = { reply: { id: 7, text: "yes" }, mediaItems: [{type: "image", uri: "https://example.com/a.jpg"}] };
  assert.equal(canonicalJSON(a), canonicalJSON(b));
  assert.notEqual(canonicalJSON(a), canonicalJSON({...b, reply: {id: 7, text: "no"}}));
  assert.notEqual(canonicalJSON(["a", "b"]), canonicalJSON(["b", "a"]));
  assert.notEqual(canonicalJSON(null), canonicalJSON({}));
});
