/**
 * node --test packages/app/lib/user-label.test.ts
 *
 * These assertions exist because the web room did not use this function. It
 * resolved labels as `anonLabel || displayName || username`, with no
 * isAnonymous check — so an anonymous participant whose anonLabel was missing
 * had their real name rendered to the host, in a feature whose entire premise
 * is that they are not identifiable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getSneakyUserLabel,
  getSneakyUserHandle,
  normalizeSneakyAnonLabel,
} from "./user-label.ts";

test("an anonymous user never leaks a real name, even with no anon label", () => {
  const leaky = {
    isAnonymous: true,
    anonLabel: null,
    displayName: "Dana Reyes",
    username: "danareyes",
  };
  const label = getSneakyUserLabel(leaky);
  assert.equal(label, "Anonymous");
  assert.ok(!label.includes("Dana"), "real name reached the label");
  assert.ok(!label.includes("danareyes"), "username reached the label");
});

test("an empty-string anon label is treated as absent, not rendered blank", () => {
  assert.equal(
    getSneakyUserLabel({ isAnonymous: true, anonLabel: "", displayName: "Dana" }),
    "Anonymous",
  );
});

test("the handle is withheld for anonymous users too", () => {
  assert.equal(
    getSneakyUserHandle({ isAnonymous: true, anonLabel: null, username: "danareyes" }),
    null,
  );
});

test("a supplied anon label is normalised to Anon N", () => {
  assert.equal(normalizeSneakyAnonLabel("anon lynk 42"), "Anon 42");
  assert.equal(normalizeSneakyAnonLabel("ANON 7"), "Anon 7");
  assert.equal(getSneakyUserLabel({ isAnonymous: true, anonLabel: "anon 3" }), "Anon 3");
});

test("named users still prefer display name, then username", () => {
  assert.equal(getSneakyUserLabel({ displayName: "Dana Reyes", username: "dr" }), "Dana Reyes");
  assert.equal(getSneakyUserLabel({ username: "dr" }), "dr");
  assert.equal(getSneakyUserLabel({}), "Guest");
  assert.equal(getSneakyUserLabel(null), "Guest");
});
