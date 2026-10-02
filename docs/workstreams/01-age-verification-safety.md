# DVNT Workstream 01 — 18+ onboarding, identity verification, and safety gates

## Goal
Make age eligibility and identity verification a server-authoritative prerequisite where DVNT requires it, instead of a collection of UI prompts that can be bypassed or that accidentally block existing adults.

## Existing foundation
- DOB-based admission logic already exists.
- The verified-admission verdict and `verified_admission_policy` exist.
- Under-18 document verdicts already fail closed.
- Enforcement is currently staged/off and pre-registration document verification is incomplete.

## Scope

### 1. Signup age gate
- Collect canonical date of birth before account activation.
- Reject a DOB that resolves to under 18 at the server boundary.
- Do not create an active DVNT member/profile when the applicant is under 18.
- Return a stable reason code so web/native can show the correct birthday eligibility message.
- Never derive age from a client-supplied boolean.

### 2. Verification state machine
Use one server-owned state consumed everywhere:
- `not_started`
- `pending`
- `approved`
- `retry_required`
- `rejected`
- `expired` / `reverification_required` if the provider supports expiry

Persist provider references and minimal audit metadata; do not persist raw document payloads.

### 3. Onboarding verification
- Complete ID/document verification during onboarding for cohorts/policies where it is required.
- Resume interrupted verification safely.
- Make callback/webhook processing idempotent.
- Do not let a browser refresh, app restart, or duplicate provider callback create conflicting verdicts.
- Make verified state account-scoped so switching profiles cannot inherit another account's result.

### 4. Participation gates
Centralize the server check and apply it to all relevant write/action boundaries:
- SPICY posting
- restricted media publishing
- restricted event admission
- ticket/room participation where policy requires verification
- Sneaky Lynk participation where policy requires verification
- any future adult-only surface

Client UI is explanatory only; edge functions/RLS/API authorization are the enforcement layer.

### 5. Existing-member rollout
- Do not mass-lock the legacy membership.
- Use `verified_admission_policy` for cohort cutoff + grace period.
- Add explicit rollout telemetry: eligible, prompted, pending, approved, blocked.
- Provide a safe admin rollback/kill switch that disables enforcement without destroying verification records.

## UX
Web and native must share the same states/copy:
- age ineligible
- verification required
- checking verification
- verification pending
- retry verification
- verified
- unable to verify

No dead-end modal that asks for ID when verification cannot actually be launched.

## Security / privacy
- Never trust client DOB-derived age flags.
- Never expose raw document images through normal user/profile APIs.
- Audit logs record verdict/reason/provider event ID, not document contents.
- Explicit tests for account switching, replayed callbacks, direct API calls, and tampered clients.

## Acceptance criteria
- [ ] A 17-year-old cannot create/activate a DVNT account by web, native, or direct API.
- [ ] A user who turns 18 can proceed without support intervention.
- [ ] A required verification can complete, resume, retry, and survive app restart.
- [ ] Approved status is identical on web/native and server.
- [ ] SPICY/restricted writes fail server-side for a member who does not satisfy policy.
- [ ] Existing members outside the rollout cohort remain usable.
- [ ] Raw identity-document payloads are absent from application-readable audit tables.
- [ ] Every denial returns a structured reason code.
- [ ] Verification rollout can be disabled without schema rollback.

## Test matrix
- DOB boundary: today-18y, one day too young, leap-day birthday.
- New signup / legacy user / account switch.
- Provider success / reject / retry / duplicate webhook / late webhook.
- Web + iOS + Android.
- UI path and direct edge-function/API path.
- SPICY post and event/Lynk participation gates.

## Out of scope
- Replacing the identity provider solely for this PR.
- Broader moderation policy changes unrelated to age/verification.
