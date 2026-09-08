import test from "node:test";
import assert from "node:assert/strict";
import {
  deliveryDeficit,
  hasCapacityForAnotherCampaign,
  ineligibleReason,
  rankEligibleBoosts,
  selectSessionBoosts,
  type BoostCampaign,
  type BoostViewer,
} from "./boost-selection.ts";

const NOW = Date.parse("2026-06-01T20:00:00.000Z");
const OPTS = { now: NOW, sessionSlots: 4 };

function campaign(over: Partial<BoostCampaign> & { campaignId: number }): BoostCampaign {
  return {
    eventId: `e${over.campaignId}`,
    organizerId: `org${over.campaignId}`,
    startsAt: NOW - 3_600_000,
    endsAt: NOW + 3_600_000,
    activatable: true,
    eligibleOpportunities: 0,
    servedImpressions: 0,
    ...over,
  };
}

const viewer = (over: Partial<BoostViewer> = {}): BoostViewer => ({
  sessionSeed: 1,
  city: "NYC",
  ...over,
});

test("every ineligibility has a nameable reason", () => {
  const base = campaign({ campaignId: 1 });
  assert.equal(ineligibleReason(base, viewer(), OPTS), null);
  assert.equal(
    ineligibleReason({ ...base, activatable: false }, viewer(), OPTS),
    "not-activatable",
  );
  assert.equal(
    ineligibleReason({ ...base, startsAt: NOW + 1000 }, viewer(), OPTS),
    "outside-window",
  );
  assert.equal(
    ineligibleReason({ ...base, endsAt: NOW - 1000 }, viewer(), OPTS),
    "outside-window",
  );
  assert.equal(
    ineligibleReason({ ...base, targetCities: ["LA"] }, viewer(), OPTS),
    "city-mismatch",
  );
  assert.equal(
    ineligibleReason(base, viewer({ ticketedEventIds: ["e1"] }), OPTS),
    "viewer-has-ticket",
  );
  assert.equal(
    ineligibleReason(base, viewer({ suppressedOrganizerIds: ["org1"] }), OPTS),
    "organizer-suppressed",
  );
  assert.equal(
    ineligibleReason(base, viewer({ seenEventIdsThisSession: ["e1"] }), OPTS),
    "seen-this-session",
  );
  assert.equal(
    ineligibleReason(
      base,
      viewer({ servedCampaignIdsToday: [1, 1, 1] }),
      OPTS,
    ),
    "daily-cap",
  );
});

test("a campaign served less is favoured — time bought, not weight", () => {
  const behind = campaign({
    campaignId: 1,
    eligibleOpportunities: 100,
    servedImpressions: 10,
  });
  const ahead = campaign({
    campaignId: 2,
    eligibleOpportunities: 100,
    servedImpressions: 90,
  });
  const ranked = rankEligibleBoosts([ahead, behind], viewer(), OPTS);
  assert.equal(ranked[0].campaign.campaignId, 1, "the one behind goes first");
  assert.ok(deliveryDeficit(behind) > deliveryDeficit(ahead));
});

test("the worked example: A, B, C rotate and no one is pinned", () => {
  const all = [1, 2, 3].map((id) => campaign({ campaignId: id }));
  const winners = new Set<number>();
  for (let seed = 0; seed < 40; seed++) {
    const [first] = selectSessionBoosts(all, viewer({ sessionSeed: seed }), {
      ...OPTS,
      sessionSlots: 1,
    });
    winners.add(first.campaignId);
  }
  assert.equal(winners.size, 3, "every campaign leads some session");
});

test("one session is stable — re-running it does not reshuffle the feed", () => {
  const all = [1, 2, 3, 4, 5].map((id) => campaign({ campaignId: id }));
  const a = selectSessionBoosts(all, viewer({ sessionSeed: 7 }), OPTS);
  const b = selectSessionBoosts(all, viewer({ sessionSeed: 7 }), OPTS);
  assert.deepEqual(
    a.map((c) => c.campaignId),
    b.map((c) => c.campaignId),
  );
});

test("an organizer with five events cannot take five consecutive slots", () => {
  const greedy = [1, 2, 3, 4, 5].map((id) =>
    campaign({ campaignId: id, organizerId: "greedy", eventId: `g${id}` }),
  );
  const others = [10, 11].map((id) =>
    campaign({ campaignId: id, organizerId: `org${id}` }),
  );
  const chosen = selectSessionBoosts([...greedy, ...others], viewer(), OPTS);
  const greedyCount = chosen.filter((c) => c.organizerId === "greedy").length;
  assert.ok(greedyCount <= 2, `greedy took ${greedyCount} of 4 slots`);
  assert.equal(chosen.length, 4, "slots still filled");
});

test("the diversity cap yields rather than leave a slot empty", () => {
  // Only one organizer qualifies at all — capping to 2 would waste two slots.
  const only = [1, 2, 3, 4].map((id) =>
    campaign({ campaignId: id, organizerId: "solo", eventId: `s${id}` }),
  );
  const chosen = selectSessionBoosts(only, viewer(), OPTS);
  assert.equal(chosen.length, 4);
});

test("an expired campaign stops being served, and the rest still rotate", () => {
  const a = campaign({ campaignId: 1 });
  const b = campaign({ campaignId: 2, endsAt: NOW - 1 });
  const c = campaign({ campaignId: 3 });
  for (let seed = 0; seed < 20; seed++) {
    const chosen = selectSessionBoosts([a, b, c], viewer({ sessionSeed: seed }), OPTS);
    assert.equal(
      chosen.some((x) => x.campaignId === 2),
      false,
      "expired campaign served",
    );
  }
});

test("the same event is never served twice in one session", () => {
  // Two campaigns pointing at one event — a re-buy, or an overlap slipping past.
  const dupes = [
    campaign({ campaignId: 1, eventId: "same", organizerId: "a" }),
    campaign({ campaignId: 2, eventId: "same", organizerId: "b" }),
    campaign({ campaignId: 3 }),
  ];
  const chosen = selectSessionBoosts(dupes, viewer(), OPTS);
  const ids = chosen.map((c) => c.eventId);
  assert.equal(new Set(ids).size, ids.length);
});

test("simulation: 1, 3, 30 and 300 campaigns all stay within fairness bounds", () => {
  for (const n of [1, 3, 30, 300]) {
    const all = Array.from({ length: n }, (_, i) =>
      campaign({ campaignId: i + 1, organizerId: `org${i % 7}` }),
    );
    const served = new Map<number, number>();
    const SESSIONS = 400;

    for (let seed = 0; seed < SESSIONS; seed++) {
      const chosen = selectSessionBoosts(all, viewer({ sessionSeed: seed }), OPTS);
      for (const c of chosen) {
        served.set(c.campaignId, (served.get(c.campaignId) ?? 0) + 1);
        // Feed the deficit back, the way real counters would.
        const live = all.find((x) => x.campaignId === c.campaignId)!;
        live.servedImpressions += 1;
      }
      for (const c of all) {
        if (ineligibleReason(c, viewer({ sessionSeed: seed }), OPTS) === null) {
          c.eligibleOpportunities += 1;
        }
      }
    }

    const counts = all.map((c) => served.get(c.campaignId) ?? 0);
    const total = counts.reduce((a, b) => a + b, 0);
    assert.ok(total > 0, `n=${n}: nothing served`);

    if (n > 1) {
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      // Deficit feedback should keep everyone within a small factor of each
      // other. Permanent pinning — the rule this replaces — would give
      // min = 0 and max = SESSIONS * slots.
      assert.ok(min > 0, `n=${n}: a campaign was never served (min=${min})`);
      assert.ok(
        max <= min * 3 + 5,
        `n=${n}: unfair spread min=${min} max=${max}`,
      );
    }
  }
});

test("a tiny audience refuses the sale instead of overselling", () => {
  const tiny = {
    estimatedOpportunities: 100,
    opportunitiesPerCampaign: 50,
    activeCampaigns: 1,
  };
  // 100 * 0.8 / 50 = 1 supportable; one is already active.
  assert.equal(hasCapacityForAnotherCampaign(tiny), false);
  assert.equal(
    hasCapacityForAnotherCampaign({ ...tiny, estimatedOpportunities: 1000 }),
    true,
  );
  assert.equal(
    hasCapacityForAnotherCampaign({ ...tiny, opportunitiesPerCampaign: 0 }),
    false,
    "a nonsense expectation is not capacity",
  );
});

test("price and recency are not inputs to the order", () => {
  // Nothing in BoostCampaign carries a price or a priority — the type itself
  // is the guarantee. This asserts the shape stays that way.
  const c = campaign({ campaignId: 1 });
  assert.equal("priceCents" in c, false);
  assert.equal("priority" in c, false);
});
