import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { resolveLynkSubscription, readLynkSubscription, LYNK_PLAN_LIMITS } from "../../../../apps/mobile/supabase/functions/_shared/lynk-subscription.ts";
import { PLANS } from "./plans.ts";
import { resolveEntitlementsForUser } from "./entitlements.ts";
import type { SubscriptionRecord } from "./types.ts";

const NOW = new Date("2026-10-13T12:00:00Z");
const future = "2026-10-14T12:00:00Z";
const past = "2026-10-12T12:00:00Z";

test("every server plan mirrors canonical room capacities and durations", () => {
  assert.deepEqual(Object.keys(LYNK_PLAN_LIMITS), Object.keys(PLANS));
  for (const plan of Object.values(PLANS)) {
    assert.equal(LYNK_PLAN_LIMITS[plan.key].maxParticipants, plan.entitlements.maxParticipants);
    assert.equal(LYNK_PLAN_LIMITS[plan.key].sessionMinutes, plan.entitlements.sessionMinutes);
    assert.equal(LYNK_PLAN_LIMITS[plan.key].family, plan.family);
  }
});

for (const plan of Object.values(PLANS)) {
  test(`${plan.key}: client/server agree across status, paid-through and grace boundaries`, () => {
    for (const status of ["active", "trialing", "past_due", "canceled", "inactive", "incomplete"] as const) {
      for (const end of [null, future, past, NOW.toISOString(), "invalid"]) {
        for (const cancel of [true, false]) {
          const record: SubscriptionRecord = { productFamily: plan.family, planKey: plan.key, status, currentPeriodEnd: end, gracePeriodEndsAt: end, cancelAtPeriodEnd: cancel };
          const client = resolveEntitlementsForUser([record], NOW);
          const server = resolveLynkSubscription([{ product_family: plan.family, plan_key: plan.key, status, current_period_end: end, grace_period_ends_at: end, cancel_at_period_end: cancel }], [], NOW.getTime());
          assert.equal(server.planKey, client.planKey, JSON.stringify(record));
          assert.equal(server.maxParticipants, client.maxParticipants);
          assert.equal(server.sessionMinutes, client.sessionMinutes);
        }
      }
    }
  });
}

test("membership precedence, legacy grace, and free membership rows reconcile correctly", () => {
  const paid = { plan_id: "host_50", status: "past_due", grace_period_ends_at: future };
  assert.equal(resolveLynkSubscription([], [paid], NOW.getTime()).planKey, "sneaky_tier_2");
  assert.equal(resolveLynkSubscription([{ plan_key: "free", product_family: "dvnt_membership", status: "active" }], [paid], NOW.getTime()).planKey, "sneaky_tier_2");
  assert.equal(resolveLynkSubscription([{ plan_key: "dvnt_core", product_family: "dvnt_membership", status: "active" }], [paid], NOW.getTime()).planKey, "dvnt_core");
  assert.equal(resolveLynkSubscription([], [{ ...paid, grace_period_ends_at: null }], NOW.getTime()).planKey, "free");
  assert.equal(resolveLynkSubscription([{ plan_key: "free", product_family: "dvnt_membership", status: "active" }], [], NOW.getTime()).sessionMinutes, 5);
  assert.equal(resolveLynkSubscription([{ plan_key: "constructor", status: "active" }], [], NOW.getTime()).planKey, "free");
});

for (const failed of ["membership_subscriptions", "sneaky_subscriptions"]) {
  test(`${failed}: creation cannot proceed with a partial/unverified subscription read`, async () => {
    const reads: string[] = [];
    const client = { from(table: string) { return { select() {
      const read = async (key: string, value: string | string[]) => {
        reads.push(table);
        if (table === "users") return { data: value === "auth-fixture" ? [{ id: 123, auth_id: "auth-fixture" }] : [], error: null };
        if (table === "membership_subscriptions") assert.deepEqual(value, ["auth-fixture", "123"]);
        else assert.equal(value, "auth-fixture");
        return { data: [], error: failed === table ? { message: "fixture failure" } : null };
      };
      return { eq: read, in: read };
    } }; } };
    await assert.rejects(readLynkSubscription(client, "auth-fixture"), /Could not verify subscription/);
    assert.equal(reads.length, 4);
  });
}

test("create-room enforces subscription lookup before room writes and preserves other gates", () => {
  const source = readFileSync(new URL("../../../../apps/mobile/supabase/functions/video_create_room/index.ts", import.meta.url), "utf8");
  const lookup = source.indexOf("await readLynkSubscription(supabase, userId)");
  assert.ok(lookup > source.indexOf("resolveVerifiedAdmission(supabase, userId)"));
  assert.ok(lookup < source.indexOf('.from("video_rooms").insert('));
  assert.match(source, /subscription.sessionMinutes === null/);
  assert.match(source, /Math\.min\(maxParticipants, subscription.maxParticipants\)/);
  assert.match(source, /Could not verify your subscription/);
});
