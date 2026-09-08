import test from "node:test";
import assert from "node:assert/strict";
import { promotedCandidatesForFeed } from "./boost-feed-bridge.ts";
import { ALL_OFF, parseKillSwitches } from "./ad-config.ts";
import type { BoostCampaign } from "./boost-selection.ts";
import { buildFeedSlots } from "../../components/feed/feed-slots.ts";

const NOW = Date.parse("2026-06-01T20:00:00.000Z");
type E = { id: string; title: string };

const campaign = (id: number, eventId = `e${id}`): BoostCampaign => ({
  campaignId: id,
  eventId,
  organizerId: `org${id}`,
  startsAt: NOW - 1000,
  endsAt: NOW + 1000,
  activatable: true,
  eligibleOpportunities: 0,
  servedImpressions: 0,
});

const OPEN = parseKillSwitches({ boost_delivery: true });
const base = {
  viewer: { sessionSeed: 1 },
  options: { now: NOW, sessionSlots: 4 },
  lookupEvent: (id: string): E | undefined => ({ id, title: `Event ${id}` }),
  issuePlacementToken: (c: BoostCampaign) => `tok-${c.campaignId}`,
};

test("the delivery kill switch stops impressions without touching what was sold", () => {
  const campaigns = [campaign(1), campaign(2)];
  assert.equal(
    promotedCandidatesForFeed({ ...base, campaigns, switches: ALL_OFF }).length,
    0,
  );
  assert.equal(
    promotedCandidatesForFeed({ ...base, campaigns, switches: OPEN }).length,
    2,
  );
});

test("a campaign whose event is gone resolves to nothing, not a broken slot", () => {
  const out = promotedCandidatesForFeed({
    ...base,
    campaigns: [campaign(1), campaign(2, "deleted")],
    switches: OPEN,
    lookupEvent: (id) => (id === "deleted" ? undefined : { id, title: id }),
  });
  assert.deepEqual(out.map((c) => c.campaignId), [1]);
});

test("each candidate carries the server-issued token impressions dedupe on", () => {
  const out = promotedCandidatesForFeed({
    ...base,
    campaigns: [campaign(1)],
    switches: OPEN,
  });
  assert.equal(out[0].placementToken, "tok-1");
  assert.equal(out[0].campaignId, 1);
});

test("end to end: selected boosts land in the feed's event slots", () => {
  const promoted = promotedCandidatesForFeed({
    ...base,
    campaigns: [campaign(1), campaign(2)],
    switches: OPEN,
  });

  const { slots } = buildFeedSlots<{ id: string }, E>({
    posts: Array.from({ length: 28 }, (_, i) => ({ id: `p${i}` })),
    events: [{ id: "organic", title: "Organic" }],
    promoted,
    googleSlotsAllowed: true,
    eventId: (e) => e.id,
  });

  const kinds = slots.map((s) => s.type);
  assert.equal(kinds.filter((k) => k === "promoted_event").length, 2);
  // Which campaign leads is seed-dependent by design — that IS the rotation.
  // What must hold is that the slot carries the token the bridge issued for
  // whichever campaign was selected, so impressions dedupe against it.
  const first = slots.find((s) => s.type === "promoted_event");
  assert.equal(first?.type, "promoted_event");
  const issued = new Set(promoted.map((p) => p.placementToken));
  assert.ok(
    first?.type === "promoted_event" && issued.has(first.placementToken),
    "slot carries a token the bridge issued",
  );
  assert.equal(
    first?.type === "promoted_event" &&
      first.placementToken === `tok-${first.campaignId}`,
    true,
    "and the token belongs to that slot's own campaign",
  );
});

test("with delivery closed the feed falls back to organic, never to a blank", () => {
  const promoted = promotedCandidatesForFeed({
    ...base,
    campaigns: [campaign(1), campaign(2)],
    switches: ALL_OFF,
  });
  const { slots } = buildFeedSlots<{ id: string }, E>({
    posts: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}` })),
    events: [{ id: "organic", title: "Organic" }],
    promoted,
    googleSlotsAllowed: false,
    eventId: (e) => e.id,
  });
  assert.equal(slots.some((s) => s.type === "promoted_event"), false);
  assert.equal(slots.some((s) => s.type === "organic_event"), true);
});
