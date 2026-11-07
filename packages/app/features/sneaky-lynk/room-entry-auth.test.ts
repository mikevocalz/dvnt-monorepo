import assert from "node:assert/strict";
import test from "node:test";
import { authenticatedLynkAccount } from "./room-entry-auth.ts";

test("room entry requires settled signed-in state, not a restored profile alone", () => {
  const ready = { _hasHydrated: true, isAuthenticated: true, authStatus: "authenticated", user: { id: "profile", authId: "account" } };
  assert.equal(authenticatedLynkAccount(ready), "account");
  assert.equal(authenticatedLynkAccount({ ...ready, user: { id: "profile" } }), "profile");
  for (const state of [{}, { user: ready.user }, { ...ready, _hasHydrated: false },
    { ...ready, isAuthenticated: false }, { ...ready, authStatus: "loading" },
    { ...ready, authStatus: "unauthenticated" }, { ...ready, user: null }, { ...ready, user: {} }]) {
    assert.equal(authenticatedLynkAccount(state), null);
  }
});
