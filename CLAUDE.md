# CLAUDE.md

Read [AGENTS.md](./AGENTS.md). Everything that governs this build-out lives there:
engineering bar, fixed stack, two-rail architecture, the six invariants, the four
constraints, deliverables D0–D7, and the gate sequence G1–G6.

Operating rules summarised:
- TS clean (`npx tsc --noEmit`) is the floor.
- Verified APIs only. Read source/docs before generating. If a webhook field cannot be
  confirmed against the current published API version, STOP and flag it by name.
- Zustand only for app/business state. `useState` is for local UI ephemera only.
- Web rail is Stripe. Mobile rail is RevenueCat. The join is Supabase. Never let the
  client read entitlement from a processor SDK directly (I3).
- Webhooks: idempotent, signature-verified, fail-closed, ordered. (I2, I4, I5)
- No secret material in any client bundle. (I6)
