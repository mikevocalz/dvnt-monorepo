# DVNT Workstream 15 — AI/editorial profiles

## Goal
Create one controlled DVNT editorial automation platform that powers ten distinct content profiles without pretending those profiles are ordinary human members.

## Editorial profile set
1. Hot Guys — athletes, firefighters, professions/lifestyle
2. Hot Girls — parallel lifestyle/editorial lane
3. Black Queer Art / Artistic Nudes
4. Astrology — daily readings
5. Supernatural Nature — ethereal plants/animals
6. Comics & Gaming
7. Black Queer History — historical figures/art/quotes
8. Black Queer Media — contemporary culture portraits/news
9. Headline News
10. Cars / Architecture / Travel

## Identity and transparency
Each profile must be visibly labeled as DVNT Editorial / AI-assisted where appropriate.
Do not fabricate a real-person biography, workplace, location, DMs, relationships, or life events to make the profile look like an unsuspecting human member.

## Architecture

### 1. Editorial profile config
Per profile:
- canonical account/profile ID
- category
- display identity/branding
- disclosure label
- voice/style prompt version
- allowed content types
- cadence windows
- source policy
- moderation policy
- engagement budget
- enabled/paused state

### 2. Content pipeline
Stages:
1. idea/source intake
2. factual/source validation where needed
3. generation
4. moderation/safety
5. optional human approval
6. scheduled publish
7. post-publish audit/metrics

Every generation gets an immutable generation/content-job ID.

### 3. Scheduling
Use jittered windows rather than robotic exact repeats.
Support:
- daily/weekly slots
- profile-specific quiet hours
- event/campaign inserts
- pause all
- per-profile rate limits

### 4. Media
Support text/image/video pipeline with provenance.
For generated depictions of public figures/historical figures, require appropriate labeling and sourcing rules.
Do not generate or post deceptive real-event imagery as if documentary evidence.

### 5. News profile
News must use current source retrieval and store citations/source URLs internally.
No unsourced generated "breaking news."
Corrections/unpublish flow required.

### 6. Engagement automation
Allowed controlled actions:
- like selected posts
- follow accounts
- optionally comment only under strict templates/review

Hard limits:
- per-hour/day budgets
- no mass following
- no engagement loops between editorial bots to fake organic popularity
- exclude blocked/private/ineligible users
- record automated action reason/job ID

### 7. Admin/editorial console
- queue
- calendar
- preview
- approve/reject/edit
- pause profile
- prompt/version history
- source list
- moderation failures
- publish history
- engagement audit
- performance metrics

### 8. Content-specific guardrails
- artistic nudity lane obeys app age/content controls
- historical quotes must be source-checked; do not invent quotes
- astrology clearly presented as entertainment/editorial
- public-figure media never implies endorsement/participation
- headline content distinguishes reporting from opinion/editorial

## Acceptance criteria
- [ ] Ten profiles run from one reusable system.
- [ ] Every profile is transparently editorial/AI-operated.
- [ ] No profile needs a fake human lifecycle/account story.
- [ ] Scheduled jobs are idempotent and restart-safe.
- [ ] News/historical content retains source provenance.
- [ ] Automated engagement is budgeted, auditable, and pausable.
- [ ] Generated media passes moderation before publish.
- [ ] Admin can preview/approve/pause any profile.
- [ ] Failed jobs never duplicate-post on retry.
- [ ] Account credentials/secrets remain server-side.

## Rollout
Start with 2 low-risk profiles (Astrology + Cars/Architecture/Travel), prove scheduler/moderation/audit, then enable the remaining lanes.
