-- ============================================================
-- DVNT Monetization V1 — Verify
-- Run after 002_apply.sql to confirm all changes landed correctly
-- ============================================================

-- 1. events.event_type column exists
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'event_type'
  ) THEN 'PASS: events.event_type exists' ELSE 'FAIL: events.event_type missing' END AS check_1;

-- 2. orders fee columns
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'buyer_fee_cents'
  ) THEN 'PASS: orders.buyer_fee_cents exists' ELSE 'FAIL: orders.buyer_fee_cents missing' END AS check_2a,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'dvnt_total_fee_cents'
  ) THEN 'PASS: orders.dvnt_total_fee_cents exists' ELSE 'FAIL: orders.dvnt_total_fee_cents missing' END AS check_2b,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'fee_policy_version'
  ) THEN 'PASS: orders.fee_policy_version exists' ELSE 'FAIL: orders.fee_policy_version missing' END AS check_2c,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'quantity'
  ) THEN 'PASS: orders.quantity exists' ELSE 'FAIL: orders.quantity missing' END AS check_2d;

-- 3. promo_codes table exists + has RLS
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'promo_codes'
  ) THEN 'PASS: promo_codes exists' ELSE 'FAIL: promo_codes missing' END AS check_3a,
  CASE WHEN (
    SELECT relrowsecurity FROM pg_class WHERE relname = 'promo_codes'
  ) THEN 'PASS: promo_codes RLS on' ELSE 'FAIL: promo_codes RLS off' END AS check_3b;

-- 4. sneaky_subscription_plans seeded
SELECT
  CASE WHEN (SELECT COUNT(*) FROM sneaky_subscription_plans) = 3
    THEN 'PASS: 3 subscription plans seeded'
    ELSE 'FAIL: wrong plan count = ' || (SELECT COUNT(*)::text FROM sneaky_subscription_plans)
  END AS check_4;

-- 5. sneaky_subscriptions table exists + has RLS
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'sneaky_subscriptions'
  ) THEN 'PASS: sneaky_subscriptions exists' ELSE 'FAIL: sneaky_subscriptions missing' END AS check_5a,
  CASE WHEN (
    SELECT relrowsecurity FROM pg_class WHERE relname = 'sneaky_subscriptions'
  ) THEN 'PASS: sneaky_subscriptions RLS on' ELSE 'FAIL: sneaky_subscriptions RLS off' END AS check_5b;

-- 6. orders.type check allows sneaky_subscription
-- Try inserting invalid type — should fail; 'sneaky_subscription' should succeed
DO $$
BEGIN
  BEGIN
    -- This insert must succeed (will be rolled back)
    INSERT INTO orders (user_id, type, status, subtotal_cents, total_cents)
    VALUES ('test_verify_user', 'sneaky_subscription', 'created', 0, 0);
    RAISE NOTICE 'PASS: sneaky_subscription accepted by orders.type check';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'FAIL: sneaky_subscription rejected by orders.type check';
  END;
  ROLLBACK;
END $$;

-- 7. All new tables have service_role grants
SELECT
  grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('promo_codes', 'sneaky_subscription_plans', 'sneaky_subscriptions')
  AND grantee = 'service_role'
ORDER BY table_name, privilege_type;
