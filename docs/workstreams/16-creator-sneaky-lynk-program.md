# DVNT Workstream 16 — Creator-hosted Sneaky Lynk growth program

## Goal
Support paid/approved creators hosting recurring Sneaky Lynk groups as a real operational product rather than an ad-hoc marketing process.

## Dependency
Builds on Workstream 12's reliable scheduled/ticketed Sneaky Lynk lifecycle. Do not scale creator operations before room/access lifecycle is dependable.

## Scope

### 1. Creator profile/status
Model:
- invited / applied
- under review
- approved
- paused
- rejected
- suspended

Link to a real DVNT member account; creator status is not a separate fake identity.

### 2. Program onboarding
- invitation/application
- terms/host agreement acceptance
- payout onboarding
- content/safety rules
- technical readiness check
- first-session checklist

### 3. Creator dashboard
- upcoming sessions
- create/schedule from approved templates
- attendee/ticket summary
- promoter/referral link
- payout estimate/status
- post-session metrics
- moderation/incidents
- rebook/duplicate session

### 4. Compensation models
Design for versioned plans:
- flat host fee
- revenue share
- attendance milestone bonus
- campaign-specific bonuses

Snapshot compensation policy per session so later plan changes do not rewrite history.

### 5. Payouts
Reuse existing Stripe/organizer/promoter payout infrastructure where appropriate.
- payout account status
- eligible earnings ledger
- hold/review states
- refunds/chargeback adjustments
- payout release audit

### 6. Moderation/safety
- host can remove/ban participants
- report/escalation
- moderator/admin join capability
- session rules acknowledgement
- verification/18+ eligibility integration
- incident audit
- creator suspension kills future hosting ability without deleting financial history

### 7. Growth tools
- creator referral/promoter links
- shareable session card
- scheduled reminders
- follower notification policy
- audience targeting that respects privacy/consent

### 8. Analytics
Per session and creator:
- invites
- views
- ticket conversions
- joins
- peak concurrency
- retention/duration
- revenue/refunds
- repeat attendance
- reports/moderation incidents

Do not create hidden "engagement scores" that creators cannot understand if they affect payouts/eligibility.

## Acceptance criteria
- [ ] Approved creator can schedule a compliant Lynk session.
- [ ] Unapproved/suspended creator cannot host through direct API.
- [ ] Compensation policy is snapshotted per session.
- [ ] Earnings/payout history survives creator suspension.
- [ ] Creator has a clear upcoming/past session dashboard.
- [ ] Safety/report/ban paths are available during live session.
- [ ] 18+/verification policy is enforced server-side.
- [ ] Referral link attribution is measurable.
- [ ] Core analytics are computed from authoritative session/ticket data.

## Rollout
Pilot with a very small approved cohort and manual payout review before automation.
