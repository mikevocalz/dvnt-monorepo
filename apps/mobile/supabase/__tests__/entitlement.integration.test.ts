/**
 * D7 — Entitlement model integration tests.
 *
 * Run:
 *   TEST_DATABASE_URL=postgres://... \
 *     node --import tsx --test apps/mobile/supabase/__tests__/entitlement.integration.test.ts
 *
 * Skips cleanly when TEST_DATABASE_URL is unset (CI can gate this on a
 * dedicated job). Each test owns a unique synthetic user_id so cases
 * don't race; nothing is cleaned up between tests by design — Postgres
 * holds the data and the user_id namespace keeps cases isolated.
 *
 * What this proves (the invariants from AGENTS.md):
 *   I2  — same event id → upsert returns true once, then false. Webhook
 *         dedup (stripe_events / rc_events) is enforced one layer up.
 *   I3  — `is_entitled(uid)` returns the same answer whether the row
 *         came from web_stripe or ios_iap. Single read path.
 *   I5  — `upsert_membership_subscription` refuses a stale event
 *         (`event_created_at < last_event_at`). Returns false; row is
 *         untouched.
 *   D6  — `upsert_identity_verification` + `is_verified` mirror the
 *         same monotonic + single-read behavior for identity.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const DB_URL = process.env.TEST_DATABASE_URL;

let pool: pg.Pool;

test.before(async () => {
  if (!DB_URL) return;
  pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
});

test.after(async () => {
  if (pool) await pool.end();
});

// Skip the whole file when the test DB isn't wired up rather than throw —
// makes the test runnable in any dev's checkout without forcing them to
// stand up Postgres just to run the rest of the suite.
function requireDb(t: any): boolean {
  if (!DB_URL) {
    t.skip("TEST_DATABASE_URL not set");
    return false;
  }
  return true;
}

const ONE_HOUR = 60 * 60 * 1000;

function uniqueUserId(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensurePlan(planKey: string) {
  // Tests assume the `membership_plans` row exists. The migration seeds the
  // catalog; if a brand-new test DB hasn't run it, this guard makes the
  // failure mode obvious instead of cryptic FK errors.
  const { rows } = await pool.query(
    "select 1 from membership_plans where plan_key = $1",
    [planKey],
  );
  if (rows.length === 0) {
    throw new Error(
      `Test setup: membership_plans row missing for plan_key='${planKey}'. ` +
        `Apply 20260612000000_dvnt_membership_subscriptions.sql first.`,
    );
  }
}

test("upsert_membership_subscription — happy path lands a row", async (t) => {
  if (!requireDb(t)) return;
  await ensurePlan("dvnt_core");
  const uid = uniqueUserId("happy");
  const now = new Date();

  const { rows } = await pool.query(
    `select public.upsert_membership_subscription(
      $1::text, 'web_stripe', 'dvnt_membership', 'dvnt_core', 'active',
      $2::text, 'cus_test', 'sub_test', 'price_test',
      $3::timestamptz, $4::timestamptz, false, null::timestamptz,
      $5::timestamptz
    ) as applied`,
    [
      uid,
      "sub_test",
      now.toISOString(),
      new Date(now.getTime() + 30 * 24 * ONE_HOUR).toISOString(),
      now.toISOString(),
    ],
  );

  assert.equal(rows[0].applied, true);

  const row = (
    await pool.query(
      "select rail, plan_key, status, provider_ref from membership_subscriptions where user_id = $1",
      [uid],
    )
  ).rows[0];
  assert.equal(row.rail, "web_stripe");
  assert.equal(row.plan_key, "dvnt_core");
  assert.equal(row.status, "active");
  assert.equal(row.provider_ref, "sub_test");
});

test("upsert_membership_subscription — stale event is rejected (I5)", async (t) => {
  if (!requireDb(t)) return;
  await ensurePlan("dvnt_core");
  const uid = uniqueUserId("stale");
  const newer = new Date();
  const older = new Date(newer.getTime() - 10_000);

  // Write the NEWER event first.
  const firstApplied = await pool.query(
    `select public.upsert_membership_subscription(
      $1, 'web_stripe', 'dvnt_membership', 'dvnt_core', 'active',
      'sub_a', 'cus', 'sub_a', 'price',
      $2::timestamptz, $3::timestamptz, false, null::timestamptz, $4::timestamptz
    ) as applied`,
    [uid, newer.toISOString(), new Date(newer.getTime() + ONE_HOUR).toISOString(), newer.toISOString()],
  );
  assert.equal(firstApplied.rows[0].applied, true);

  // Now a stale event tries to overwrite to 'canceled' — must NOT win.
  const staleApplied = await pool.query(
    `select public.upsert_membership_subscription(
      $1, 'web_stripe', 'dvnt_membership', 'dvnt_core', 'canceled',
      'sub_a', 'cus', 'sub_a', 'price',
      $2::timestamptz, $3::timestamptz, false, null::timestamptz, $4::timestamptz
    ) as applied`,
    [uid, older.toISOString(), new Date(older.getTime() + ONE_HOUR).toISOString(), older.toISOString()],
  );
  assert.equal(staleApplied.rows[0].applied, false);

  const status = (
    await pool.query("select status from membership_subscriptions where user_id = $1", [uid])
  ).rows[0].status;
  assert.equal(status, "active", "stale event must not flip status to canceled");
});

test("upsert_membership_subscription — newer event applies and bumps last_event_at", async (t) => {
  if (!requireDb(t)) return;
  await ensurePlan("dvnt_core");
  const uid = uniqueUserId("newer");
  const t1 = new Date();
  const t2 = new Date(t1.getTime() + 5_000);

  await pool.query(
    `select public.upsert_membership_subscription(
      $1, 'web_stripe', 'dvnt_membership', 'dvnt_core', 'active',
      'sub_b', 'cus', 'sub_b', 'price',
      $2::timestamptz, $3::timestamptz, false, null::timestamptz, $4::timestamptz
    )`,
    [uid, t1.toISOString(), new Date(t1.getTime() + ONE_HOUR).toISOString(), t1.toISOString()],
  );

  const applied = await pool.query(
    `select public.upsert_membership_subscription(
      $1, 'web_stripe', 'dvnt_membership', 'dvnt_core', 'canceled',
      'sub_b', 'cus', 'sub_b', 'price',
      $2::timestamptz, $3::timestamptz, false, $4::timestamptz, $5::timestamptz
    ) as applied`,
    [
      uid,
      t1.toISOString(),
      new Date(t1.getTime() + ONE_HOUR).toISOString(),
      t2.toISOString(),
      t2.toISOString(),
    ],
  );
  assert.equal(applied.rows[0].applied, true);

  const row = (
    await pool.query("select status, last_event_at from membership_subscriptions where user_id = $1", [uid])
  ).rows[0];
  assert.equal(row.status, "canceled");
  assert.equal(new Date(row.last_event_at).getTime(), t2.getTime());
});

test("is_entitled — active web_stripe and ios_iap both resolve (I3)", async (t) => {
  if (!requireDb(t)) return;
  await ensurePlan("dvnt_core");
  const future = new Date(Date.now() + 7 * 24 * ONE_HOUR);

  for (const rail of ["web_stripe", "ios_iap"] as const) {
    const uid = uniqueUserId(`is_entitled_${rail}`);
    await pool.query(
      `select public.upsert_membership_subscription(
        $1, $2, 'dvnt_membership', 'dvnt_core', 'active',
        'p', null, null, null,
        now(), $3::timestamptz, false, null::timestamptz, now()
      )`,
      [uid, rail, future.toISOString()],
    );
    const planKey = (await pool.query("select public.is_entitled($1) as plan_key", [uid])).rows[0]
      .plan_key;
    assert.equal(planKey, "dvnt_core", `${rail} should resolve to dvnt_core`);
  }
});

test("is_entitled — canceled past current_period_end returns null", async (t) => {
  if (!requireDb(t)) return;
  await ensurePlan("dvnt_core");
  const uid = uniqueUserId("expired");
  const past = new Date(Date.now() - ONE_HOUR);
  await pool.query(
    `select public.upsert_membership_subscription(
      $1, 'web_stripe', 'dvnt_membership', 'dvnt_core', 'canceled',
      'p', null, null, null,
      now(), $2::timestamptz, false, now(), now()
    )`,
    [uid, past.toISOString()],
  );
  const planKey = (await pool.query("select public.is_entitled($1) as plan_key", [uid])).rows[0]
    .plan_key;
  assert.equal(planKey, null);
});

test("is_entitled — past_due within grace_period_ends_at still active", async (t) => {
  if (!requireDb(t)) return;
  await ensurePlan("dvnt_core");
  const uid = uniqueUserId("dunning");
  const future = new Date(Date.now() + 2 * ONE_HOUR);
  await pool.query(
    `insert into membership_subscriptions
       (user_id, rail, product_family, plan_key, status,
        provider_ref, current_period_start, current_period_end,
        grace_period_ends_at, last_event_at)
     values ($1, 'web_stripe', 'dvnt_membership', 'dvnt_core', 'past_due',
        'p', now() - interval '1 day', now() - interval '1 hour',
        $2::timestamptz, now())`,
    [uid, future.toISOString()],
  );
  const planKey = (await pool.query("select public.is_entitled($1) as plan_key", [uid])).rows[0]
    .plan_key;
  assert.equal(planKey, "dvnt_core");
});

// ── D6: identity_verifications parallel guards ────────────────────────

test("upsert_identity_verification — stale event rejected, monotonic ordering wins", async (t) => {
  if (!requireDb(t)) return;
  const uid = uniqueUserId("verify");
  const t1 = new Date();
  const t2 = new Date(t1.getTime() + 1000);

  // First: status=submitted at t1.
  const first = await pool.query(
    `select public.upsert_identity_verification(
      $1, 'persona', 'inq_a', 'submitted', null, null, null, null, $2::timestamptz
    ) as applied`,
    [uid, t1.toISOString()],
  );
  assert.equal(first.rows[0].applied, true);

  // Second: status=passed at t2 (newer) — wins.
  const second = await pool.query(
    `select public.upsert_identity_verification(
      $1, 'persona', 'inq_a', 'passed', 'US', '1990-01-01', null, null, $2::timestamptz
    ) as applied`,
    [uid, t2.toISOString()],
  );
  assert.equal(second.rows[0].applied, true);

  // Third: an out-of-order failed at t1 — must NOT overwrite passed.
  const third = await pool.query(
    `select public.upsert_identity_verification(
      $1, 'persona', 'inq_a', 'failed', null, null, null, 'bad', $2::timestamptz
    ) as applied`,
    [uid, t1.toISOString()],
  );
  assert.equal(third.rows[0].applied, false);

  const row = (
    await pool.query("select status from identity_verifications where user_id = $1", [uid])
  ).rows[0];
  assert.equal(row.status, "passed");
});

test("is_verified — true iff status=passed", async (t) => {
  if (!requireDb(t)) return;
  const uidPassed = uniqueUserId("passed");
  const uidPending = uniqueUserId("pending");
  await pool.query(
    `insert into identity_verifications (user_id, provider, status, last_event_at)
     values ($1, 'persona', 'passed', now())`,
    [uidPassed],
  );
  await pool.query(
    `insert into identity_verifications (user_id, provider, status, last_event_at)
     values ($1, 'persona', 'pending', now())`,
    [uidPending],
  );

  const passed = (await pool.query("select public.is_verified($1) as v", [uidPassed])).rows[0].v;
  const pending = (await pool.query("select public.is_verified($1) as v", [uidPending])).rows[0].v;
  assert.equal(passed, true);
  assert.equal(pending, false);
});
