# DVNT release closeout — specialized agent roster

These are **execution briefs**, not claims that autonomous agents have already run. A local Claude Code, Codex, Devin, or other compatible worker can take one brief, create a separate feature branch and report evidence in its draft PR. Humans or the coordinating assistant review all results.

Use: `docs/release/dvnt-65-closeout-2026-10-15.md`, `docs/engineering-contract.md`, `docs/code-standards.md`, the relevant old merged/closed PRs, and this roster. Never push to the default branch, merge, deploy, turn on messaging or operate Stripe in live mode.

## Parallel work assignments

### 1 — Distinguished identity + platform security lead
**IDs:** A01 A02 A03 A05 A06. Audit Didit verification, DOB trust, existing-account legacy access, protected-route and direct-edge server checks, permanent-identity ban semantics. Use `supabase`, `supabase-postgres-best-practices`, `mattpocock/skills`. Produce personas for unverified adult, under-18, legacy, verified adult, banned, duplicate-identity; test each web/native/API boundary. Fail closed. Do not expose identity_hash, PII or auth identifiers.

### 2 — Distinguished geospatial privacy engineer + UX reviewer
**IDs:** P04 P05 S09. Recover transferable work from closed #31 but do not merge old branches indiscriminately. Distances require consent, expiry, block/private checks and geographic minimization. Browser denied-location shows an explanation with *no fake miles*. Room avatar anonymity never resolves auth identity. Use `supabase`, `impeccable`, `Mobbin` and `expo/skills`.

### 3 — Distinguished real-time media and cross-device specialist
**IDs:** S06, S05, S08, S10, S12. Honor current MoQ/TypeScript runtime. Do not substitute Fishjam for Lynk or break personal Fishjam calls. Separate local pin vs **host-authoritative spotlight**; screen share requires actual capture/publish/subscribe and revoke path; Web screen-capture restrictions and native consent must be displayed correctly. Skills: `expo/skills`, `Argent/agent-device`, `vercel/react-best-practices`, `impeccable`.

### 4 — Distinguished payments + settlement/reconciliation specialist
**IDs:** S07 D02 plus ticket/payout release gates. Extend existing Stripe Connect billing only after provider compliance and creator agreement are resolved. Use test-mode, never create live charges. No client-supplied split amounts, fee overrides or unverified payout destinations. Replayed webhooks cannot double-credit a tip or issue a ticket. Use `supabase-postgres-best-practices`, `Stripe` documentation, `mattpocock/skills`.

### 5 — Principal outbound communications engineer
**IDs:** T01 T03 T07 T09 R01 R05 R06 W01. Separate transactional ticket/claim mail from marketing; require idempotency, suppression, unsubscribe, delivery webhooks and receipt correlation. Before enabling the queued brand outbox, obtain sender/recipient approval. Do not send SMS without explicit opt-in, STOP/HELP and sender setup. Skills: `Resend email-best-practices`, `supabase`, `coreyhaines31/marketingskills`, `no-ai-slop`.

### 6 — Principal Payload CMS/editorial systems designer
**IDs:** C01 C02 C03 C04. Editorial channels must be labeled as editorial/automation, never misrepresented as verified people; drafts require review, approval, content provenance and scheduling. Separate moderation rules from auto-engagement suggestions; no fake organic follows/likes. Use existing Payload/admin schema; skills `impeccable`, `coreyhaines31/marketingskills`, `mattpocock/skills`, `no-ai-slop`.

### 7 — Staff test automation + device acceptance specialist
**IDs:** P06 P10 E07 E10 T10 S01 S03 S12. Build deterministic fixtures, Playwright browser profiles and two-user room scaffolds. Record device/browser, build SHA, persona and evidence. Verify real camera/mic, Safari iOS, Chrome Android, desktop, offline/resume, host-end, private forwarded links, comp/paid tickets; never claim real-device success from synthetic DOM tests. Skills: `vercel/verification`, `Argent/agent-device`, `expo/skills`.

### 8 — Principal SRE/production observability reviewer
**Scope:** ticket-page viewport rejection, edge alert trends, payout setup completion, rollback. Separate 200 HTTP responses from actual email and payment success. Read Sentry with read-only token/scopes; never print PII or mutate production. Use `sentry`, `vercel/deployments-cicd`, `vercel/verification`.

### 9 — Creative director + product owner representative
**IDs:** D01 D02 D03 and editorial publication approvals. Produce concrete decisions/alternatives and a single approval checklist. Do not invent contract terms, no silent incentive giveaways, no automatic engagement. Use `impeccable`, `marketingskills`, `no-ai-slop`.

## Required handoff format
For each workstream, return:
- Owned IDs and one-line user story per ID
- Changed file list and exact commit SHA
- Security threat model and denied persona test results
- Test command + result URL + failure logs
- Web/tablet/foldable/mobile UI evidence where relevant
- Required environment / staging-provider config
- Migration order and rollback plan
- Any discrepancy from original instructions (explicitly preserve later overrides)
- State: CODE READY / STAGING NEEDED / DEVICE NEEDED / PROVIDER NEEDED / POLICY DECISION NEEDED
- Draft PR URL and dependencies. Never mark DONE before acceptance

Common skills: https://github.com/expo/skills · https://github.com/mattpocock/skills · https://github.com/Argent/agent-device · https://github.com/coreyhaines31/marketingskills · https://github.com/pbakaus/impeccable · https://github.com/petergyang/no-ai-slop. Platform skills installed in this ChatGPT environment are reusable but are not automatically installed in a developer's external runner.
