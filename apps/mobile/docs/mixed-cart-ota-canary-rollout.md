# Mixed-Cart Checkout OTA / Release Gate

Date: 2026-05-16

## Decision

Do not publish the mixed-cart checkout OTA from the current workspace state.

The canary protocol is still the required release path, but the current gate is
blocked until the backend is deployed and the branch is proven native-compatible.

## Blockers Found

- `scripts/release/preflight-ota-safety.ts --channel=production` returned
  `NATIVE BUILD REQUIRED` because the branch diff includes `app.config.js`.
- `pnpm typecheck` is not clean under the project tsconfig. The new mixed-cart
  source files pass targeted checks, but CLAUDE.md sets zero tolerance for any
  TypeScript errors before OTA.
- `pnpm test:e2e:cart` cannot run locally because `maestro` is not installed.
- Mixed-cart requires Supabase migrations and Edge Functions to be deployed
  before any client rollout:
  - `20260516150000_mixed_cart_checkout.sql`
  - `20260516170000_cart_line_refund_rpc.sql`
  - `cart-create-hold`
  - `cart-release-hold`
  - `cart-checkout`
  - `get-cart-status`
  - `cart-line-refund`
  - `stripe-webhook`

## Preflight Results

Commands run:

```bash
npx tsx scripts/release/preflight-ota-safety.ts --channel=production
npx tsx scripts/check-ota-env.ts
pnpm test:regression
pnpm check:migrations
pnpm test:e2e:cart
```

Results:

- OTA safety preflight: blocked, native build required.
- OTA env check: passed with warnings for unresolved non-critical
  `EXPO_PUBLIC_*` placeholders.
- Regression tests: passed, 12 suites / 49 tests.
- Migration health: passed with 0 errors and 3 existing warnings.
- Maestro E2E: blocked locally, `maestro` command not installed.

## Required Order Before OTA

1. Deploy Supabase migrations.
2. Deploy Edge Functions with `--no-verify-jwt`.
3. Run `pnpm test:regression`.
4. Run `pnpm check:migrations`.
5. Make `pnpm typecheck` clean under the project config.
6. Install Maestro on the runner and run:

```bash
pnpm test:e2e:cart
```

7. Run the OTA eligibility gate again:

```bash
npx tsx scripts/release/preflight-ota-safety.ts --channel=production
npx tsx scripts/check-ota-env.ts
```

8. If and only if the gate reports OTA safe, publish the canary:

```bash
EAS_SKIP_AUTO_FINGERPRINT=1 eas update --branch production \
  --message "canary: OTA pipeline check" \
  --platform ios --environment production
```

9. Verify on physical TestFlight device:
   - Settings -> long-press `Version 1.0.0` for 1 second.
   - Confirm `updateId` changed to the canary update ID.
   - Confirm `isEmbeddedLaunch: false`.
   - Relaunch 3 times without crash.

10. Only after the canary is verified, publish the real OTA:

```bash
EAS_SKIP_AUTO_FINGERPRINT=1 eas update --branch production \
  --message "mixed-cart checkout: admission + coat-check single payment" \
  --platform ios --environment production
```

## Rollback

If the canary or real OTA causes a launch failure:

```bash
npx eas-cli update:roll-back-to-embedded \
  --branch production \
  --platform ios \
  --runtime-version 1.0.0 \
  --message "P0 ROLLBACK: mixed-cart checkout OTA"
```
