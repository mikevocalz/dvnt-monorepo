# DVNT 2026-10-10 hotfix: promoter Connect onboarding and promo deletion

## Incident reports
- Promoter payout setup ("Connect bank account") fails with Stripe: `Your platform needs approval for accounts to have requested the 'transfers' capability without the 'card_payments' capability`.
- Organizer's Delete Promo Code confirm fails with a generic toast.
- These are separate paths; do not conflate promoter codes with `promo_codes` discounts.

## Cause and code changes
1. `promoter-connect` requested transfers only, while `organizer-connect` already requests card payments + transfers. The platform is currently not approved for transfers-only creation. Request both capabilities at creation and request missing `card_payments` on an existing linked account before returning its Stripe onboarding link. Do **not** create another account for existing promoters.
2. Web/native clients deleted `promo_codes` directly, even though authorization/RLS and `orders.promo_code_id` references can prevent DELETE. The client now calls `manage-promo-code` with Better Auth session credentials. Only event hosts or accepted admin co-organizers may revoke. Server sets `deleted_at` and a past `valid_until`, preserving all historic purchase/accounting references. The past expiry makes older deployed checkout versions reject the discount during a staggered rollout; the new public validator and shared helper also explicitly ignore revoked rows.
3. A new Edge Function requires `verify_jwt = false` in Supabase config to allow DVNT Better Auth sessions. Authentication is still enforced in the function via `verifySession`—never expose service-role keys to a client.

## Verification (before production deployment)
- `node scripts/verify-edge-functions.mjs` (catches missing function registration/verify_jwt drift).
- `node --test apps/mobile/supabase/functions/promoter-connect/index.test.cjs apps/mobile/supabase/functions/manage-promo-code/index.test.cjs`.
- `pnpm --filter mobile typecheck` and `pnpm --filter web typecheck` where supported by the workspace.
- Run the checkout/commission regression suite, including the existing `cart-checkout` and `door-sell` tests.
- Test new **Express** account onboarding in isolated Stripe test mode; request both capabilities and complete banking setup with Stripe-hosted onboarding.
- Test existing transfer-only Express mapping: request card payments on the same `acct_` identifier and recover, or surface a specific Stripe restriction requiring support. Never delete live connected accounts to bypass onboarding.
- Test promo owner, accepted co-organizer admin, non-admin/stranger, unknown ID, repeat deletion, code with existing paid order, and attempted checkout using a revoked code; historic orders must retain `promo_code_id`.
- Watch logs and Sentry for `promoter-connect`, `manage-promo-code`, and checkout paths. No production outcome can be assumed from compilation alone.

## Production deployment order (review with release owner)
1. Confirm production Stripe mode/platform and current connected-account capabilities. These changes request an **additional** capability, which can add Stripe onboarding requirements. If policy prohibits requesting card payments, obtain Stripe approval for transfers-only instead; code alone cannot override account eligibility.
2. Apply and verify **only** the reviewed `20261010160000_promo_codes_soft_delete.sql` migration, after inspecting the remote migration ledger and SQL diff. Do **not** run an unchecked bulk migration push.
3. Deploy `manage-promo-code` with `--no-verify-jwt`; deploy `validate-promo-code`, `cart-checkout`, and `door-sell` after the migration (the latter two import the changed shared promo helper). While those checkout redeployments are pending, the revoke function sets a past `valid_until` as a backwards-compatible checkout guard. Confirm deployed config pins Better Auth.
4. Deploy `promoter-connect` with `--no-verify-jwt`. Verify new and linked Express account onboarding from web/mobile.
5. Ship the web client and any relevant native OTA updates after the function and migration are live, following existing release procedures. Keep rollout scoped; monitor 4xx/5xx and checkout-discount redemption.
6. Smoke test the actual reported flows on `dvntapp.live` with accounts authorized for testing. Never perform real charges or payouts as part of a smoke test.

## Rollback
- For promo UI failures, revert the web/native invocation and pause removal; **do not** drop the new column while checkout functions still filter by it. Revoke changes are intentionally non-destructive and historical orders remain unchanged.
- For Stripe issues, restore the previous code only if the platform is approved for transfers-only and regression-tested. Leave linked connected-account IDs intact and escalate any incompatible recipient-service-agreement accounts to Stripe support rather than creating duplicates.
