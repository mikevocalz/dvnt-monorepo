# DVNT adult access and repeat-expulsion review (A01/A02/A03/A05/A06)

**Current code change:** operator denylist now outranks a previously passed ID, allowlist and enforcement grace. This closes a direct participation bypass in `decideVerifiedAdmission`. No production policy or denylist row was changed. Ticket purchase and ticket claim stay blocked for an operator-denied account, and a missing policy row blocks them too: both fail closed on purpose. Baseline adult-checkout/protected-surface personas remain in `apps/mobile/supabase/functions/_shared/adult-gate-personas.test.cjs`.

## Still required before closing IDs

1. **A01/A02/A03/A05:** verify web/native route gate AND direct API for unverified ticket buyer, verified under-18, pre-existing unverified account, verified adult, guest checkout restricted profile, operator-denied adult. Checkout remains available without forced username/phone/ID, and ticket wallet is separate from protected posting, commenting, DMs, Spicy and Lynk.
2. **A06:** current `identity_verifications.identity_hash` exists, but is NOT evidence that a verified banned identity can no longer create a new account. Define an appealable, privacy-preserving revocation table keyed by a provider-supplied irreversible identity token, review allowed retention and legal basis, and enforce the decision at verified onboarding without exposing hashes to clients. Do not equate name, device, IP or document image with reliable identity; do not query other people's identity hashes from the client.
3. Disallow browser-controlled `user_metadata` from authorization. Role/age state must come from verified server tables. Fail closed if policy, identity or restrict lookup fails.
4. Before touching production enforcement settings, record how legacy Spicy access is handled. The 2026-10-14 review said it is intentionally preserved, which conflicts with the old blanket verified-only wording. Escalate that product-policy difference; no silent change to users' access.
5. Badged/paid membership never bypasses an underage or operator-denied account.

## Specialist review
Distinguished Identity & Integrity lead: Didit webhook + auth session; Staff AppSec: JWT/IDOR/allowlists; Postgres security engineer: verified identity hash access + RLS; QA: independent personae and web/native replay; UX: privacy-safe denial/appeal. Skills: Supabase, Postgres best practices, expo/skills, Matt Pocock TS, agent-device, Impeccable for denial UI, no-ai-slop for human-facing copy.

## Evidence
Link CI, staging account matrix, production policy read-only snapshot, and reviewer signature. Do not mark A06 complete on this PR: identity-linked repeat expulsion needs the separate product-approved design and device/provider acceptance.
