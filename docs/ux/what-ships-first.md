# What ships first — P1 vs P12 vs P13

Decision 2026-09-03. Ranked by `product-decisions` §6: (1) read path already
deployed, only the screen/fix missing; (2) pure reorganization of working code;
(3) new object with a clear schema; (4) blocked on a missing subsystem — strike
or defer, do not queue. Repo contract (`docs/engineering-contract.md`) wins over
this record on any conflict.

## Order

**1st — P13 (Web E2E Verification).** Rank 2: it creates no new object and
reorganizes nothing; it puts instrumentation over read paths that are already
deployed. It is also the only one of the three whose citations verified 100%
clean against HEAD (`event-form.ts` L190/194/197, `call.web.tsx` L155/291/551,
three edit routes, Fishjam 0.29.0, vitest-only). Its output — traces, breakpoint
screenshots, a bug table — is the precondition for P1's "before/after perf"
claims and P12's funnel. Neither of those can honestly report a delta with no
baseline.

**2nd — P1 (Seamless Creation).** Its WS-0 foundations are rank 2 work: the
outbox, the upload pipeline and the connectivity store are all deployed and
merely unconsumed. Start there, not at WS-1.

**3rd — P12 (One Loop).** Most new objects, and two of its workstreams are
blocked on decisions rather than code (below). Its §2 also carries drift D1.

## BUILD (unblocked, in order)

- P13 Phase 0 inventory + Playwright harness + WS-1 auth fixture.
- Inside P13 WS-1: load `/` under `next dev` and settle `reactStrictMode`.
  The cause is gone (reanimated 4.5.3 landed 0a267bf, 2026-08-07; the crash last
  fired 2026-08-05) but the workaround from 521c08c is still at
  `apps/web/next.config.ts:36`. Do NOT blind-revert — the E2E suite runs against
  `next dev`, so prove it on the rendered page first, then revert in the same PR.
- Resolve `DVNT-WEB-5` in Sentry once proven. P13 §4 law 1 asserts "Sentry-clean";
  leaving a stale issue open makes that gate measure a ghost.
- P1 WS-0.1 outbox executors — but see D2: two consumers already exist, so the
  registry is an extension, not a greenfield.

## DEFER (blocker named precisely, so nobody "fixes" it with the wrong query)

- **P12 WS-1 analytics** — blocked on a *decision*, not a subsystem: monthly cost
  ceiling and EU/US region. P12 §5.4 says to ask. Needs ADR-001 before install.
- **P12 WS-3 intent model** — `event_rsvps.status` has no CHECK constraint in any
  migration. Confirm the live constraint with `psql "$DATABASE_URL"` before
  writing the widening migration. Do not add a parallel status column.
- **P1 WS-1 Audience row / P12 WS-7** — schema decision, and D1 means the P12
  version starts from the wrong enum. Real baseline is
  `('public','private','link_only')`.
- **P1 WS-0.7 identity badges** — P1 itself gates this on "no column stores
  historical badges → stop and report." No such column found.
- **P12 WS-10 Lynk device QA** — the native matrix now exercises MoQ, not Fishjam
  (D3). Rewrite the matrix before booking device time.

## STRIKE

- **Video-flyer HLS path (P1 WS-1 `FlyerMedia`).** Precondition failed: Bunny
  Stream is not provisioned, and provisioning is an account action outside every
  one of these prompts. Progressive MP4 from Edge Storage + a client-generated
  `<canvas>` poster is what ships. Revisit when Stream is provisioned.

## Needs Mike before the relevant workstream starts

1. `apps/web/.env.e2e.local` — audit-account credentials (P13 §2).
2. Entitlement flip in Supabase for the audit user (P13 WS-5 gate).
3. Two-party call slots with `mikevocalz` (P13 WS-6) — no second credential set exists.
4. Analytics cost ceiling + region (P12 WS-1 / ADR-001).
5. `DATABASE_URL` access to confirm `event_rsvps.status` (P12 WS-3).
