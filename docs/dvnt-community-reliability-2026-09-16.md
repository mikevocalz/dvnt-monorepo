# DVNT community, event and retention work

Repository inspected at `8fbb569e90a5071133ebaafa3cb24f4f559efbf5` on 16 September 2026. This branch is a proposed implementation, not a production deployment. Unit checks do not establish that deployed database functions, device uploads, payment providers or room providers work end to end.

## What is implemented versus still open

Implemented in code: a foreground post queue above the feed; retry-safe post/event creation; account-switch token protection; upload timeout/progress/size handling; video type/poster fixes; confirmed event deletion and cache cleanup; private event and scheduled room permission checks; atomic comps for existing accounts; story profile links; Follow Back; device-local layout persistence; DOB admission and stricter document-age verification; revised welcome email copy.

Still open: SMS comp delivery; pre-registration document verification; OS-level background upload transfer (app-kill resume now works, transfer while the process is dead does not); a complete live-room countdown/deep-link experience; and live advertising playback validation. A second implementation pass on 17 September 2026 closed guest email comp delivery, branded welcome DM/broadcast automation, the first-ticket draft UI, opt-in city discovery, verified-only admission for the existing membership, and resume-after-app-kill for post uploads. Those six ship disabled or inert by default where they touch live members: brand sending fails closed without its canonical sender configuration, and verified-only admission ships `enforce = false`.

Media limits remain explicit: post video 25 MiB and event video 50 MiB after native compression. Browser video is validated and passed through, not transcoded. A larger supported upload architecture needs resumable storage/provider integration; removing a fake progress percentage does not remove the server byte limit. Event uploads now use inline progress but remain owned by the form; post jobs survive navigation only while the app's JavaScript process stays alive.

## Findings and intended behavior

| Request | Finding / implementation direction | Release acceptance |
| --- | --- | --- |
| Comp tickets by email/phone | Existing comp UI resolves registered usernames/emails. Guest delivery and phone-only claiming are separate capabilities; never treat an unverified phone number as account ownership. | Single and bulk comps, duplicate email/username for one person, capacity races, delivery retries, guest claim, invalid contact, revoke/reissue. |
| Upload above feed | Move publishing into a bounded job queue; show a compact status row above the feed and return immediately. Keep immutable snapshots so finishing post A cannot clear draft B. | Scroll, navigate, compose a second post during upload; show retry on failure; reconcile only the created post. App-process termination/resumable background transfer remains separate work. |
| Second post stuck | Both successful-submit locks and failed upload state need cleanup. | Create at least three consecutive posts without restarting; fail one upload then post again. |
| Large video / 10% | Native transport used synthetic 10%; client and edge size limits disagree; browser path called native compression; video mapping can classify video as image. | Real device and browser, supported codecs, small/large files at each actual limit, interruption, timeout, processing failure, poster/playback, event create and edit. |
| Delete/edit/duplicates | Client cascades and an unconfirmed DELETE can report success with zero deleted rows; caches use several different keys. | Confirmation names the event; successful delete disappears from lists, profile, search and detail; failed delete is truthful. Preserve paid commerce/audit records through cancellation rather than cascading them away. |
| Wrong account hosts event | Server uses the session identity; a stale cached session can disagree with the shown account. | Sign in A, switch to B, create event: host B; stale/in-flight A session must be rejected. Explain the active host in composer. |
| Private events | Private visibility must be enforced by database/edge checks, including checkout and room admission. An invite URL alone is not membership. | Owner/invitee allowed; stranger, anonymous viewer and spoofed viewer ID denied across feed, search, detail, checkout and live-room tokens. |
| Scheduled ticketed Sneaky Lynk | Linked rooms must check current event eligibility and schedule on every token issuance, including returning room members. | Waiting room before opening; invited ticket holder can join when live; refunded/transferred/revoked guest cannot; cancelled/ended state never mints a new token. |
| Micah → Deviant DC transfer | Event identities, tiers and commerce records must be reconciled before mutation. A per-user ticket transfer is not an event consolidation. | Dry-run counts and rollback plan; migrate registered and guest holders, admission/add-ons, orders and related records; confirm wallet/QR/scan behavior without duplicate charges. |
| Stories → profiles | Web header is not clickable; native modal navigation must leave the viewer. | Tap avatar/username; correct profile appears; story timer/media stops and Back returns predictably. |
| Follow Back | Existing profile state tracks outgoing follow only. | Not following + follows you → Follow Back; following → Following; neither → Follow. Refresh and account switch do not inherit someone else's relation. |
| Layout persists | Initializer discards saved classic mode; web does not consume the setting; Android lacks the settings control. | Select classic/grid, navigate, restart, and confirm preference on that device. Cross-device sync is not implemented by device storage. |
| Welcome / broadcast identity | A server signup hook already sends welcome email. Current event broadcasts use a null actor. A canonical Deviant sender must be selected by immutable account ID. | One welcome per eligible activation; retries do not duplicate; correct branded sender; blocks/mutes and channel consent respected. DM and broadcast activation remains separate from email copy. |
| Ticket → first post | Use the existing DVNT text-post design with a generated editable draft. Publishing reveals attendance, so make it a member choice. | One draft per eligible first admission purchase; no private event exposure, payment data, QR, ticket ID or invite token. |
| Strict 18+ | Native signup now sends DOB; web collects it; the server validates it before user creation. New Google/Apple accounts must register through email + DOB first; existing social sign-in/link remains supported. Provider approval now requires adult document DOB. | Test exact birthday and malformed inputs, forged admission headers and every account-creation route. Coordinate the older-client cutoff. Declared age is not identity proof; pre-registration document verification and platform-wide existing-account admission are not implemented. |

“Video ads” needs one operational distinction during live reproduction: an uploaded event video flyer, a first-party promoted-event creative, and a Google video ad have different rendering/delivery paths. Shared media fixes do not prove all three. Paid subscriptions must continue to suppress Google ad requests; they do not suppress first-party promoted events.

## Comp-ticket experience

Host dashboard → Guest list → Send comps. Select a ticket tier and quantity, enter contacts, preview the recipient and ticket count, then issue. Show separate delivery and ticket states: issued does not mean email/SMS delivered. Include an organizer note and an expiry for unclaimed invitations if the event policy supports it.

For existing members, resolve the exact account before issuing. For guests, issue a unique claim credential tied to the intended verified delivery channel; do not publicly expose ticket identifiers. Normalize emails and E.164 phone numbers, deduplicate after resolving identities, apply capacity atomically, record issuer/audit metadata and use an idempotency key for the batch. Retries must resend the existing ticket rather than mint another.

Phone-only comps need a verified SMS provider, explicit ticket-delivery consent, delivery receipts, rate limits and an OTP/claim flow. Do not copy a ticket-purchase phone number into a marketing list.

## Welcome and first-post copy

Proposed DM from the verified Deviant account, marked as an automated welcome:

> Welcome to the cookout! The Black Queer cookout. DVNT is an 18+ community for Black, Brown and Queer people to connect through culture, expression and events — online and in person.
>
> Start with a photo and a little about yourself, then make your first post when you're ready. Bought a ticket? You can turn that moment into your first DVNT post.
>
> Be kind. Be considerate. No hate, harassment, transphobia, homophobia, biphobia, racism, anti-Blackness, xenophobia or sexism. No body-shaming or slut-shaming. Leave your hangups at home. Read our Community Standards, and report anything that makes this space unsafe.

Short broadcast from the same canonical account:

> Welcome to the cookout 🖤 Your first DVNT post can be a hello, a look, or your next event. Add a photo, tell us a little about yourself, and let your people find you. Ready? Create your first post.

First-ticket draft:

> Hey, I just punched my ticket for “[Event name]” 🎟️
>
> #[EventName] #[City] #DVNT #DeviantEvents

The actual event name and city must come from confirmed event data; `EVENT DC` is not a global hardcoded title. A private/unlisted event must not generate a public attendance post or identifying hashtags. Do not infer city from GPS or expose a venue address. Keep the existing post draft if the member is already composing something.

Recommended flow: purchase confirmed → tickets immediately available → optional **Make this my first post** → editable DVNT text card → clear audience and **Post** action → optimistic feed entry reconciled to its server ID. **Skip** keeps the ticket accessible. Recheck event visibility at publication for any automated event-linked draft. Do not post from a Stripe webhook.

## Branded automation implementation contract

The existing welcome email template is updated in this branch. DM/broadcast sending is not enabled merely by changing email copy.

Before enabling branded automation, resolve the real `@DeviantEvents` app account and store its immutable app-user ID and auth ID in server-only configuration. Do not resolve a mutable username at each send, share a personal session, or impersonate an arbitrary host. Preserve the originating host on event operational notices; clearly label brand announcements as Deviant announcements.

Use an outbox with a unique key `(campaign_version, recipient_id, channel)` and explicit `queued/sending/sent/failed/suppressed` states. Enqueue once after eligible activation. Workers retry with a stable provider idempotency key, honor block/mute/unsubscribe state and record delivery receipts. DM content uses the application's actual conversation security protocol; if E2EE is introduced, use an enrolled service device rather than plaintext database injection. First-post reminders stop after a post exists, a member opts out, or the campaign's frequency cap is reached.

Keep ticket delivery separate from growth messages. SMS requires appropriate channel/topic consent and STOP handling. Commercial email requires accurate identification and an unsubscribe path; adding promotional copy may change the primary purpose of a transactional message. Do not send a blanket campaign until its audience and canonical sender are resolved.

## Retention recommendation

Build a reason to return around the event they already care about:

1. At purchase: show the ticket immediately and offer the first-post draft.
2. Before the event: invite them to an opt-in event conversation or attendee introduction; reveal attendance only to the chosen audience.
3. During the event: use voluntary check-in and practical event updates. Existing event-presence storage intentionally stores arrival states without coordinates; preserve that design.
4. After the event: offer photos, connections and the next relevant event, with consent and a frequency cap.

Start with manual city selection and optional city/neighborhood discovery. Separate location use for finding events from visibility to other people. Visibility defaults off, can expire, and can be revoked immediately. Avoid exact home pins, exact distances or a location map that exposes attendance. A truthful aggregate count can show community activity; do not fabricate growth or imply everyone is currently nearby.

Measure the funnel by purchaser cohort: completed profile, voluntary first post, first meaningful connection/reply, participation in an event conversation, and day-7/day-30 return. Instrument these as aggregate events without sending private event names, sexuality or message content to ad providers.

Creator-hosted rooms can be stylish, flirtatious and culturally specific while retaining consent, moderation, age checks, host controls and a clear distinction between an in-person event ticket and paid digital room access. An 18+ label does not override native-store restrictions on explicit sexual content.

## Age and authentication release gates

The auth edge checks the original email-signup DOB and rechecks the signup path, email and DOB in Better Auth's `user.create.before` hook. Better Auth 1.6.26 keeps custom DOB in the hook context without persisting it in the user row; no caller-supplied age-approved flag or header is trusted. New Google/Apple user creation is deliberately disabled; `requestSignUp` cannot bypass the before-create hook. Both provider signup flags are set because 1.6.26 copies `disableImplicitSignUp` but does not forward `disableSignUp` onto its resolved provider object. Existing sign-in and account linking remain supported. Magic links remain login-only; phone authentication is not configured. DOB declaration is not document or identity verification, and is not persisted as a verified claim.

Release the updated signup clients before enforcing the edge gate, or establish a minimum supported app version: older native builds do not send DOB and will receive a registration error. The separate `20260916150000_verified_adult_age_gate.sql` migration makes missing/underage document DOB ineligible for verified access, including historical approvals, without deleting accounts. Didit/Persona callbacks and the verification-session/cache paths enforce the same adult check. Didit now requires a signature covering the whole body; its deprecated envelope-only signature cannot authenticate DOB or user binding. No migration or provider configuration was applied here.

Both token caches now invalidate on account mutations and identity changes; stale async results cannot refill them. Web OAuth/magic-link callbacks reject provider-error returns before explicitly adopting a fresh session and synchronizing the profile. The pre-existing generic native OAuth callback still needs device validation; native Apple uses its ID-token sign-in path.

Required staging matrix, using test users and the deployed client/edge/schema combination:

| Flow | Required result |
| --- | --- |
| New email account, web and native | Valid adult succeeds; missing/invalid/future DOB and day before 18th birthday fail without a user row; exact birthday succeeds. |
| Direct email API and forged headers | Only validated DOB admits creation; aliases, direct server creation and spoofed admission headers fail closed. |
| New Google/Apple account | Registration is refused with email-first guidance, including `requestSignUp: true`; no auth/profile orphan or welcome email. |
| Existing Google/Apple account | Sign-in succeeds; linking an existing eligible account preserves its ID and tickets. Test Apple private-relay email separately. |
| Magic-link account recovery | Existing account resumes; unknown email cannot create an account; provider-error callback does not adopt an older session. |
| Active-account changes | Email A → email B, email A → Google B, Apple A → email B and A → B → A; pause an old session response during each switch. New posts/events always use the displayed account. |
| Failed signout and recovery | Surviving old cookie cannot authorize writes; a newly issued authenticated session can recover without restarting. |
| Existing/provider verification | Missing/underage DOB cannot authorize verified access; valid adult approval succeeds; retries and account switches do not inherit another user's status. |

Local evidence: six age/admission behavioral tests, twelve token-race tests and three real Better Auth 1.6.26 memory-adapter integration tests pass. Integration checks exercise the actual client signup payload, hook context, direct-server rejection, and new versus existing Google/Apple users with mocked provider identity transport; no real provider account is contacted. The token helper passed a targeted strict TypeScript check. These checks do not replace the staging auth/provider/database flows above.

## Second implementation pass, 17 September 2026

Six items from the "still open" list were implemented. Every one that can reach a live member is inert until an operator turns it on. Unit checks rose from 144 to 189; `@dvnt/app` and `@dvnt/ui` type checks, `verify-edge-functions` (149 functions, 0 unpinned, 0 floating) and `verify-web-routes` (135 routes) pass. No migration was applied and no function was deployed.

| Item | What shipped | Default state |
| --- | --- | --- |
| Guest comp delivery | `issue_guest_comp_tickets_atomic` takes the same event advisory lock and capacity math as the member RPC. An email with no account gets a guest ticket and the existing `/public/tickets/guest/<token>` claim link. `qr_token` never leaves the function. | Active once the migration is applied. |
| Welcome DM / broadcast | Outbox keyed `(campaign_version, recipient_id, channel)` as a database `UNIQUE` constraint. Canonical sender resolved by immutable `(users.id, users.auth_id)` from server-only config. DMs use the real conversation path. | Sends nothing. Three brand env vars plus `CRON_SECRET`, and no cron schedule exists. |
| First-ticket draft | Pure eligibility module: only `visibility = 'public'` qualifies, only the first admission line, no ticket/order/QR/address field can reach the draft. Visibility is rechecked at publication. | Active. Offer only; publishing needs an explicit tap. |
| City discovery | Finding events and being visible to others are now separate settings. A visibility grant carries a city and an end time, nothing else, and expiry is enforced on read. | Visibility off. Grant is device-local; nothing publishes it yet. |
| Verified-only admission | `verified_admission_policy` drives one server-owned verdict (`allowed` / `grace` / `blocked`), enforced in eight edge functions before any write, with RESTRICTIVE RLS as defence in depth. | `enforce = false`. Turning it on is one `UPDATE` with a cohort cutoff and grace deadline. |
| Resumable uploads | The publish queue persists a serializable descriptor, durable media paths and banked upload results, so a resume replays the same `operationId` and reconciles instead of double-posting. `ownerId` is checked before upload and again before publish. | Active on native. |

Two pre-existing defects surfaced while auditing the discovery path and were fixed:

- `getEventById` fetched `get_event_attendee_avatars` for every event. That RPC takes no viewer id, so a leaked link to a `private` or `link_only` event also handed over the attendee faces. Now gated to public events through `normalizeVisibility`, which catches the legacy `unlisted` value.
- `useBootLocation` called `requestForegroundPermissionsAsync()` at launch, putting the OS dialog on screen with no explanation next to it and contradicting its own docblock. It is read-only now; the ask stays in the welcome step and the Near Me filter.

`normalizeVisibility` treats a NULL `events.visibility` as public, which is the existing convention throughout that file. Confirm `select count(*) from events where visibility is null` before release: any legacy private event carrying NULL rather than `'private'` still lists attendees.

### Operator prerequisites

Brand automation needs `DVNT_BRAND_USER_ID`, `DVNT_BRAND_AUTH_ID` and `DVNT_BRAND_OUTBOX_ENABLED=true`, all three together, plus `CRON_SECRET`; the email channel additionally needs `DVNT_BRAND_UNSUBSCRIBE_URL` or its rows are suppressed rather than sent. There is deliberately no cron entry, so the worker runs only when invoked.

The canonical sender has been resolved against production: `deviantevents` is `public.users.id = 613`, Better Auth `user.id = ZcInhog357kU8uGba7ziQ4DX75WkamyW`, `devianteventsdc@gmail.com`, created 12 September 2026, and it hosts events 79, 80, 82, 83, 84, 85, 86 and 88. Set `DVNT_BRAND_USER_ID=613` and `DVNT_BRAND_AUTH_ID=ZcInhog357kU8uGba7ziQ4DX75WkamyW` in server-only configuration. They are deliberately not committed: the sender is configuration, not code, so a clone of this repository cannot send as the brand.

Two things to settle before enabling it. The account has `verified = false`, while the proposed DM copy describes itself as coming from the verified Deviant account — either verify the account or drop that claim. And the account was created on 12 September 2026, after most of the membership, so an unbounded first send would reach people who predate it; scope the first campaign's audience deliberately rather than letting it default to everyone.

Verified-only admission stays off until `verified_admission_policy` is updated. Set `cohort_created_after` and `grace_deadline` together: a NULL deadline means grace never ends and the member sees a prompt rather than a refusal. Rollback is `enforce = false`. The runbook, including a count of who the next stage would refuse, is in the migration footer.

### Known ceilings

Guest comps issue members and guests through two serialized RPC calls. Both take the same event lock so a tier cannot oversell, but a guest half that hits the cap leaves the member half issued. Delivery state is one `guest_email_sent_at` timestamp with no retry queue or bounce tracking.

DM idempotency rides in `messages.metadata` rather than a unique index, so a crash between the message insert and `complete_brand_message` re-sends one DM. Unsubscribe is a single static URL, not a per-recipient token; the in-app `growthMessages` setting is the opt-out that exists today. `first_post_reminder` has copy and a stop condition but no enqueue path.

"First admission purchase" is device-local, so a reinstall or a second device can offer the draft once more. No endpoint exposes whether a member has ever bought admission.

Upload resume covers app termination and relaunch, not transfer while the process is dead; that needs iOS URLSession background configuration and Android WorkManager. Web skips persistence entirely, because a restored job would hold dead `blob:` URLs.

## Live operations still needed

- Exact source event link/ID for Micah's event and destination Deviant DC event link/ID, plus the ticket-tier mapping. Read-only reconciliation comes first; no transfer was performed in this work.
- Canonical Deviant app profile link/ID for sender attribution and correct event ownership. A display name is insufficient.
- Named internal test accounts/recipients and a staging event. No invitations, broadcasts, SMS or live ticket purchases were sent in this work.
- Device/browser reproduction files for the failing video and clarification of which ad/flyer surface fails.
- Apply reviewed migrations in staging, deploy the corresponding edge functions, then verify the mobile/web clients against that same schema before production release.

## Deployment order and reproducible verification

Apply these migrations to staging in timestamp order, inspect the actual deployed schema and grants, and run the documented permission/concurrency tests before production:

1. `20260916091500_idempotent_post_publish.sql`
2. `20260916121000_private_event_access_boundary.sql`
3. `20260916122000_atomic_comp_ticket_issuance.sql`
4. `20260916123000_event_lifecycle_integrity.sql`
5. `20260916150000_verified_adult_age_gate.sql`
6. `20260916160000_guest_comp_ticket_issuance.sql`
7. `20260916170000_verified_only_admission.sql`
8. `20260916180000_brand_message_outbox.sql`

The corresponding changed edge functions are `auth`, `bootstrap-events`, `bulk-comp-tickets`, `cart-checkout`, `cart-create-hold`, `create-event`, `create-payment-intent`, `create-post`, `create-verification-session`, `delete-event`, `didit-webhook`, `lynk-livestream-token`, `lynk-moq-token`, `media-upload`, `persona-webhook`, `rsvp-issue-ticket`, `ticket-checkout`, `video_join_room`, and `video_refresh_token`. The new delete function's gateway configuration is included in `supabase/config.toml` and verifies the Better Auth session itself.

Do not release new publishing clients before their RPCs and edge functions exist. Coordinate the auth gate and the revoked direct-event-delete permission with supported client versions. The age gate will reject older signup clients that omit DOB. Check existing verification records before turning on stricter adult-document eligibility. None of these rollout steps was executed here.

Run with the repository's pinned pnpm and Node 24:

```sh
corepack pnpm run test:community
corepack pnpm --filter @dvnt/app typecheck
corepack pnpm --filter @dvnt/ui typecheck
node scripts/verify-edge-functions.mjs
git diff --check
```

The combined regression suite passed 144 checks, including real Better Auth handler/memory-adapter tests with mocked provider transport. App and UI package type checks passed. The static edge manifest check passed for 148 shipped functions, and `git diff --check` passed. Actual PostgreSQL execution, RLS/concurrency behavior, provider delivery, device/browser uploads and media sessions remain staging gates. The preflight and detailed scenario matrix are in `docs/event-ticket-transfer-and-private-live-validation.md`.

## Primary policy references

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — UGC moderation, explicit-content restrictions, physical versus digital access payments.
- [Apple age assurance](https://developer.apple.com/support/age-assurance/) and [Google Play Age Signals](https://developer.android.com/google/play/age-signals/overview).
- [Google UGC requirements](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en), [incidental sexual UGC](https://support.google.com/googleplay/android-developer/answer/12923286?hl=en), [child safety standards](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en).
- [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en) — location is sensitive data.
- [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy) and [FCC consumer guidance](https://www.fcc.gov/consumers/guides/stop-unwanted-robocalls-and-texts).
- [FTC CAN-SPAM guidance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).

The retention choices above are product recommendations informed by these requirements, not evidence that legal or app-store review has been completed.
