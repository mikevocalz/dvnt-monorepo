# Exact room links and event-linked rooms

This increment shipped in PR #250 (merge `0cec75d3dcc3179b0afab86a8547ffa143dedde4`), with its backend migrations and functions deployed before the web release. It does not add public or signed-out Lynk participation. Follow-up event UX and waiting-response privacy work is documented separately in [event experience polish](event-experience-polish.md).

## Shared links and sign-in

- Sharing emits one canonical HTTPS room URL. URL flags never grant media consent, membership, a ticket, or host authority. Local practice rooms cannot be shared as if other members could join.
- Canonical, feed, short and legacy aliases resolve to the same validated room identifier on web and native. Invalid identifiers and malformed URLs fail before room lookup or media setup.
- Signed-out users go to sign-in, retaining that exact room through password/OAuth login, email verification, password recovery and required account setup. The room still performs the existing access, verification, ban, expiry and capacity checks.
- Web entry validates the current cookie session rather than trusting a cached profile. A bounded sign-in check has a clear retry state. Native waits for hydrated, authenticated state before replaying a pending link.
- New links supersede old pending destinations. Back, cancelled navigation, sign-out, account changes and late auth callbacks cannot revive a previous room or start capture. Camera and microphone stay off until media review and explicit entry.
- Source iOS association paths now include the shared room aliases while excluding web-only create/billing/checkout paths. Deploying that file and testing installed-app opening remain separate steps.

## Event-linked lifecycle and participation

- Prepared rooms use the scheduled event window and purchased room duration instead of expiring at their original preparation-time deadline. The stored original room duration is retained. Ordinary non-event expiry is unchanged.
- Host start is transactional. It rechecks the expected event-room link and accepted owner/admin/editor authority while holding the event, room and lifecycle locks. Pending staff invites, scanner roles and ordinary room cohosts do not become event hosts.
- An ended or cancelled lifecycle cannot be revived by editing dates or starting the same room. Recovery requires a newly prepared owned private room and an explicit relink/start. Duplicate links and missing schedules fail closed.
- Start, waiting and direct room entry retain current identity/verification and creator-standing gates. An ordinary invited room cohost still needs event ticket/invite eligibility and the host to have started. A refusal leaves the invitation pending.
- Waiting handles cancelled/ended events and lost session/access as terminal states. Transient failures remain retryable, and late room/account responses cannot navigate or update a newer wait.
- Scheduled cohost invitation cards use the event-adjusted availability window. Guest participation still goes through authoritative ban, access and atomic capacity checks.

## PR #250 rollout order (completed)

The approved rollout applied these migrations and deployed the updated functions before the web client:

1. Confirm the existing lifecycle rollout prerequisite: `20261029145200_event_lynk_lifecycle_guards.sql`, then the updated lifecycle sweep verified, then `20261029145300_event_lynk_scheduled_expiry.sql`.
2. Apply `20261107150000_event_lynk_atomic_admission_window.sql`.
3. Apply `20261107151000_event_lynk_terminal_start.sql`.
4. Deploy the updated `event-lynk-room`, `video_join_room` and `lynk-cohost-invite` functions, followed by the corresponding application release.

A missing atomic-start RPC fails closed; there is no unsafe direct-write fallback. Already-terminal records are deliberately not repaired or reopened. Production changes require separate approval.

## Validation and remaining limits

The regression workflow includes actual routing configuration, mounted auth screens, native link processing, current-room entry/capture guards, event handler fixtures, real SQL functions in isolated PGlite, and production entry/waiting hooks with service boundaries adapted. Focused Chromium coverage includes exact shared/clipboard URLs, signed-out/loading/invalid entry, cancellation and status-only auth revocation. Existing review links, live-photo handoff and signup entry are retained as compatibility checks. Final counts and exact-head CI results are recorded on the pull request.

PGlite uses a single connection, so true multi-session PostgreSQL lock contention has not been stress-tested. Full native typecheck passed in PR #250 CI; the local environment lacks the complete Expo dependencies. Focused native fixtures are not an installed-app build. Physical Safari behavior remains unverified. Physical iOS/Android universal links, Safari, OAuth provider interaction, Bluetooth, live audible calls, real multi-device reconnects and concurrent 10–30-person performance remain unverified/deferred.

The live Android association file still contains a placeholder signing fingerprint. A verified release signing fingerprint and approved deployment are required before claiming Android app-link verification. The released web aliases and iOS association paths were verified; installed iOS opening remains unverified. No production parity or superiority claim is made.
