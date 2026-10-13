import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { readLynkSubscription } from "../../../../apps/mobile/supabase/functions/_shared/lynk-subscription.ts";
import {
  fetchSubscriptionRecords, subscriptionAuthId, entitlementReadSnapshot, nextEntitlementBoundary,
} from "./subscription-records.ts";

const NOW = new Date("2026-10-13T12:00:00Z");
const FUTURE = "2026-10-14T12:00:00Z";
const rows = {
  membership_grant_records: [],
  membership_subscriptions: [{ user_id: "auth-fixture", product_family: "dvnt_membership", plan_key: "dvnt_core", status: "active", current_period_end: FUTURE, rail: "ios_iap" }],
  sneaky_subscriptions: [{ host_id: "auth-fixture", plan_id: "host_50", status: "past_due", grace_period_ends_at: FUTURE }],
};
function fixture(errorTable?: string, overrides: Record<string, any[]> = {}) {
  const reads: { table: string; columns: string; key: string; value: string | string[] }[] = [];
  const data: Record<string, any[]> = {
    users: [{ id: 123, auth_id: "auth-fixture" }, { id: 456, auth_id: "other-auth" }],
    ...rows, ...overrides,
  };
  const client = { from(table: string) { return { select(columns: string) {
    const read = async (key: string, value: string | string[]) => {
      reads.push({ table, columns, key, value });
      const values = Array.isArray(value) ? value : [value];
      return { data: data[table].filter((r) => values.includes(String(r[key]))), error: table === errorTable ? { message: "fixture denied" } : null };
    };
    return { eq: read, in: read };
  } }; } };
  return { client, reads };
}

test("subscription owners use auth IDs, never numeric profile IDs", () => {
  assert.equal(subscriptionAuthId({ id: "123", authId: "auth-fixture" }), "auth-fixture");
  assert.equal(subscriptionAuthId({ id: "auth-fixture" }), "auth-fixture");
  assert.equal(subscriptionAuthId({ id: "123" }), null);
  assert.equal(subscriptionAuthId(null), null);
});

test("both rails reconcile with the same owner and preserve legacy grace", async () => {
  const f = fixture();
  const records = await fetchSubscriptionRecords(f.client, "auth-fixture");
  assert.equal(records[0].rail, "ios_iap");
  assert.equal(records[1].rail, "web_stripe");
  assert.equal(records[1].planKey, "sneaky_tier_2");
  assert.equal(records[1].gracePeriodEndsAt, FUTURE);
  assert.deepEqual(f.reads.find((r) => r.table === "membership_subscriptions")?.value, ["auth-fixture", "123"]);
  assert.equal(f.reads.find((r) => r.table === "sneaky_subscriptions")?.value, "auth-fixture");
  assert.ok(f.reads.filter((r) => r.table !== "users").every((r) => r.columns.includes("grace_period_ends_at")));
  assert.equal(entitlementReadSnapshot(records, "ready", NOW).entitlements.planKey, "dvnt_core");
  assert.equal(entitlementReadSnapshot([records[1]], "ready", NOW).entitlements.planKey, "sneaky_tier_2");
  assert.equal((await fetchSubscriptionRecords(f.client, "other-auth")).length, 0);
});

for (const table of Object.keys(rows)) {
  test(`${table}: database failure rejects the entire entitlement snapshot`, async () => {
    const f = fixture(table);
    await assert.rejects(fetchSubscriptionRecords(f.client, "auth-fixture"), /Could not verify subscription/);
  });
}

for (const state of ["loading", "error", "signed_out"] as const) {
  test(`${state}: cached paid data does not grant paid capabilities`, async () => {
    const records = await fetchSubscriptionRecords(fixture().client, "auth-fixture");
    const snapshot = entitlementReadSnapshot(records, state, NOW);
    assert.equal(snapshot.entitlements.planKey, "free");
    assert.equal(snapshot.entitlements.sessionMinutes, 5);
    assert.deepEqual(snapshot.records, []);
  });
}

test("a verified empty result defaults to free and expiry schedules recomputation", async () => {
  assert.equal(entitlementReadSnapshot([], "ready", NOW).entitlements.planKey, "free");
  const records = await fetchSubscriptionRecords(fixture().client, "auth-fixture");
  const boundary = new Date(FUTURE).getTime();
  assert.equal(nextEntitlementBoundary(records, NOW.getTime()), boundary);
  assert.equal(nextEntitlementBoundary(records, boundary), null);
  assert.equal(entitlementReadSnapshot(records, "ready", new Date(boundary)).entitlements.planKey, "free");
});

test("the mounted read path reconciles changes and exposes errors", () => {
  const source = readFileSync(new URL("./use-entitlements.ts", import.meta.url), "utf8");
  assert.match(source, /refetchInterval: 30_000/);
  assert.match(source, /refetchOnMount: "always"/);
  assert.match(source, /subscriptionAuthId\(s.user\)/);
  assert.match(source, /nextEntitlementBoundary/);
  assert.match(source, /query\.isError/);
});


test("numeric-profile membership records preserve paid access alongside canonical records", async () => {
  const f = fixture(undefined, { membership_subscriptions: [{ ...rows.membership_subscriptions[0], user_id: "123", rail: "web_stripe" }] });
  const records = await fetchSubscriptionRecords(f.client, "auth-fixture");
  assert.equal(entitlementReadSnapshot(records, "ready", NOW).entitlements.planKey, "dvnt_core");
  assert.equal(records[0].rail, "web_stripe");
  assert.equal((await readLynkSubscription(f.client, "auth-fixture", NOW.getTime())).planKey, "dvnt_core");
});

test("canonical auth-id collision never exposes another member's subscription", async () => {
  const f = fixture(undefined, {
    users: [{ id: 123, auth_id: "auth-fixture" }, { id: 789, auth_id: "123" }],
    membership_subscriptions: [{ ...rows.membership_subscriptions[0], user_id: "123", plan_key: "dvnt_vip" }],
    sneaky_subscriptions: [],
  });
  assert.equal((await fetchSubscriptionRecords(f.client, "auth-fixture")).length, 0);
  assert.equal((await fetchSubscriptionRecords(f.client, "123"))[0].planKey, "dvnt_vip");
  assert.equal((await readLynkSubscription(f.client, "auth-fixture", NOW.getTime())).planKey, "free");
  assert.equal((await readLynkSubscription(f.client, "123", NOW.getTime())).planKey, "dvnt_vip");
});

test("failed or missing verified profile mapping fails closed before subscription lookup", async () => {
  for (const f of [fixture("users"), fixture(undefined, { users: [] })]) {
    await assert.rejects(fetchSubscriptionRecords(f.client, "auth-fixture"), /verify subscription identity/);
    assert.ok(f.reads.every((r) => r.table === "users"));
  }
});
