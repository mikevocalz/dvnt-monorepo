/**
 * node --test packages/ui/src/video/ConnectionBanner.phase.test.ts
 *
 * The whole point of this mapping is one case: Fishjam has no `reconnecting`,
 * so "connecting" means two different things and only the session's history
 * tells them apart. Both room legs got this wrong in different directions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { connectionPhaseFromPeerStatus } from "./ConnectionBanner.phase.ts";

test("a first join reads as connecting, not reconnecting", () => {
  assert.equal(connectionPhaseFromPeerStatus("connecting", false), "connecting");
});

test("the same status mid-session reads as reconnecting", () => {
  assert.equal(connectionPhaseFromPeerStatus("connecting", true), "reconnecting");
});

test("connected is connected regardless of history", () => {
  assert.equal(connectionPhaseFromPeerStatus("connected", false), "connected");
  assert.equal(connectionPhaseFromPeerStatus("connected", true), "connected");
});

test("idle is not a problem and so not a banner", () => {
  assert.equal(connectionPhaseFromPeerStatus("idle", false), "idle");
  // Even after a connection: idle is the transport at rest, not a failure.
  assert.equal(connectionPhaseFromPeerStatus("idle", true), "idle");
});

test("error is the destructive case, whether or not we ever connected", () => {
  assert.equal(connectionPhaseFromPeerStatus("error", false), "disconnected");
  assert.equal(connectionPhaseFromPeerStatus("error", true), "disconnected");
});

test("the mapping is total over PeerStatus", () => {
  const all = ["connecting", "connected", "error", "idle"] as const;
  for (const s of all) {
    for (const ever of [true, false]) {
      const phase = connectionPhaseFromPeerStatus(s, ever);
      assert.ok(
        ["idle", "connecting", "connected", "degraded", "reconnecting", "disconnected"].includes(phase),
        `${s}/${ever} produced ${phase}`,
      );
    }
  }
});
