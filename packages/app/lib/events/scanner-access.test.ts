import { test } from "node:test";
import assert from "node:assert/strict";
import { scannerAccessGate } from "./scanner-access.ts";

const base = { hasHydrated: true, isAuthenticated: true, loading: false, role: null, roleError: false } as const;
test("every assigned staff role can open scanner; ordinary members cannot", () => {
  for (const role of ["owner", "admin", "editor", "scanner"] as const) assert.equal(scannerAccessGate({ ...base, role }), "open");
  assert.equal(scannerAccessGate(base), "not_staff");
});
test("role lookup failure shows retry, and retry can resolve access or refusal", () => {
  assert.equal(scannerAccessGate({ ...base, roleError: true }), "cannot_verify");
  assert.equal(scannerAccessGate({ ...base, loading: true, roleError: true }), "loading");
  assert.equal(scannerAccessGate({ ...base, role: "scanner" }), "open");
  assert.equal(scannerAccessGate(base), "not_staff");
});
test("loading and signed-out states never masquerade as staff refusal", () => {
  assert.equal(scannerAccessGate({ ...base, hasHydrated: false }), "loading");
  assert.equal(scannerAccessGate({ ...base, loading: true }), "loading");
  assert.equal(scannerAccessGate({ ...base, isAuthenticated: false, role: "owner" }), "signed_out");
});
test("cached confirmed role survives a failed refetch, not account sign-out", () => {
  assert.equal(scannerAccessGate({ ...base, role: "scanner", roleError: true }), "open");
  assert.equal(scannerAccessGate({ ...base, role: "scanner", roleError: true, isAuthenticated: false }), "signed_out");
});

test("server 401/403 outrank cached roles and offline credentials", () => {
  for (const role of [null, "scanner"] as const) {
    assert.equal(scannerAccessGate({ ...base, role, roleError: true, errorStatus: 401, canOpenOffline: true }), "signed_out");
    assert.equal(scannerAccessGate({ ...base, role, roleError: true, errorStatus: 403, canOpenOffline: true }), "not_staff");
  }
});
test("only transient verification failure may use previously confirmed offline access", () => {
  assert.equal(scannerAccessGate({ ...base, roleError: true, errorStatus: 503, canOpenOffline: true }), "open");
  assert.equal(scannerAccessGate({ ...base, roleError: true, errorStatus: 503, canOpenOffline: false }), "cannot_verify");
  assert.equal(scannerAccessGate({ ...base, canOpenOffline: true }), "not_staff");
});

test("initial paused offline query is not a refusal and may use account-scoped proof", () => {
  assert.equal(scannerAccessGate({ ...base, rolePending: true, rolePaused: true, canOpenOffline: true }), "open");
  assert.equal(scannerAccessGate({ ...base, rolePending: true, rolePaused: true }), "cannot_verify");
  assert.equal(scannerAccessGate({ ...base, rolePending: true, rolePaused: false }), "loading");
});
