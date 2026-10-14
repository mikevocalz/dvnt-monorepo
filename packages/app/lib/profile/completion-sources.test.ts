import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { completionFromSources } from "./completion-sources.ts";

const user = { id: "7", avatar: "https://example.test/a.jpg", bio: "Hello", location: "City", website: "https://example.test" };
const present = { hasIdentity: true, hasEventAudience: true };

test("a sparse login snapshot is 100 only after confirming its saved private fields", () => {
  assert.equal(completionFromSources(user, user, null), null);
  assert.equal(completionFromSources(user, user, undefined), null);
  assert.equal(completionFromSources(user, user, present)?.percent, 100);
});
test("genuinely missing private fields still leave the profile at 70", () => {
  const result = completionFromSources(user, user, { hasIdentity: false, hasEventAudience: false });
  assert.equal(result?.percent, 70);
  assert.deepEqual(result?.missing.map(item => item.key), ["identity", "audience"]);
});
test("fresh public fields and explicit clears override stale auth fields", () => {
  assert.equal(completionFromSources({ ...user, bio: "" }, user, present)?.percent, 100);
  assert.equal(completionFromSources(user, { ...user, bio: "", website: "", links: [] }, present)?.percent, 70);
});
test("a public refresh cannot erase confirmed private presence", () => {
  assert.equal(completionFromSources(user, { ...user, sexuality: [], eventAudience: "" }, present)?.percent, 100);
});
test("logout or another account's public profile cannot inherit completeness", () => {
  assert.equal(completionFromSources(null, user, present), null);
  assert.equal(completionFromSources({ id: "8" }, user, present)?.percent, 30);
});

test("canonical profile transform preserves explicit public clears", () => {
  const source = readFileSync(new URL("../hooks/use-profile.ts", import.meta.url), "utf8");
  for (const field of ["website", "location"]) {
    assert.ok(source.includes(`${field}: profile.${field} || ""`));
    assert.ok(source.includes(`${field}: user.${field} || ""`));
  }
  assert.ok(source.includes('avatar: resolvedAvatar || ""'));
  assert.ok(source.includes('avatar: user.avatar || ""'));
});
