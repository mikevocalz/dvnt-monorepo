# Truthful discovery and uninterrupted live rooms

Branch publication and a possible Vercel preview are authorized. This change has not been deployed to production.

## Discovery contract

A database room with `status = open` is not necessarily live. Abandoned rooms can remain open indefinitely, and a null `ends_at` is valid for an unlimited room. This change does not end or delete those rows.

`video_list_rooms` derives presence from the newest membership row for each user. A live room requires an active host or co-host with no leave timestamp and a non-future `last_seen_at` younger than 90 seconds. Neither a stored participant count nor a recent `joined_at` establishes presence. Public candidate selection applies the heartbeat condition before the 50-room bound, then checks complete membership reads to reject superseded rows.

The response supplies an explicit availability, observation time, live-presence expiry and effective deadline. Only numeric `discoveryVersion: 2` opts into non-live owner/invitation management entries. Legacy requests receive verified live rooms and recent persisted-ended history, never raw-open inactive owner rooms.

Events are checked in both directions: `events.lynk_room_id` and `event_lynk_lifecycle.room_uuid`. Missing, duplicate, contradictory and orphan bindings fail closed. Lifecycle pagination uses its actual `event_id` key. Event admission preserves existing organizer, ticket and invitation policy; a public room flag or room invitation does not bypass a paid event ticket. Scheduled/ready rooms are not live. An explicitly started event may be live before its clock start, subject to presence and the same deadline rules used by admission.

All required scans must complete. A failed later page returns an availability error, not a partially trusted list. Discovery is still bounded: eligibility filtering of the newest 50 public candidates can produce fewer results without refilling from older candidates. This is a completeness limit, not permission to label stale rooms live.

## Client behavior

Web and native discovery request v2 and no longer fall back to direct SQL on endpoint failure. The list separates Live now, Your rooms & invitations, and Recently ended. An inactive invitation waits for its host. Only a fresh authenticated ownership proof offers Resume; a full live room offers Check room. Search filters immediately as the user types.

Live and owner proofs expire locally even when offline. Request-start wall and monotonic clocks charge network latency against the lease and tolerate server/device clock offsets. Expired proofs cannot revive after a device clock rollback. Proofs are runtime-only and tied to the account, authentication lifecycle and hook lifetime. Profile/session identity mismatches, logout, account swaps, same-account session replacement and persisted cache cannot keep old room actions available. A successful newer response immediately revokes older callbacks, while cancelled/out-of-order requests cannot replace the accepted response. Legacy numeric-only profiles are safely resolved against the current account before querying; unresolved identity shows loading or a retryable error rather than a false empty list. Local history is not evidence of live presence or ownership.

## Live-call Enter prompt and privacy recovery

The third-party `react-anticapture` wrapper initially required Enter before continuing, including on touch-only devices. The package stylesheet was not imported, so that finding alone does not prove the user's reported scrolling geometry. This change removes the redundant wrapper and its obsolete viewport selectors, retaining DVNT's scoped privacy guard, capture attribution and overlays. The live-room caller still explicitly disables watermarks; the boundary's default watermark behavior is preserved elsewhere.

Tab/focus loss remains a local privacy event, not a claim that a recording occurred. Hidden/unfocused rooms stay protected, including first mount and protection enablement while hidden. Returning safely restores the call without remounting media. A keyboard-accessible Return to room action handles prevented print shortcuts that do not produce a browser focus-return event. Its dialog stays outside the room panel's inert subtree and scrolls on short viewports. Chat has a visible Send action; ordinary Enter remains optional and IME composition does not submit accidentally. The chat log supports keyboard focus and scrolling.

## Room header

The released base excludes global app and marketing headers from the canonical and MoQ room routes, but the reachable legacy `/video/room/:id` surface still retained the logo/header and navigation. This change adds only that room prefix to the shared immersive-route rule. `/video/rooms` remains a normal listing; its transport and authentication behavior are unchanged. This is a verified legacy-route defect, not proof that it was the user's exact URL.

The native protected and Sneaky Lynk stacks already hide global headers. A new integrated production-shell fixture checks canonical routes and the actual frontend-only legacy composition, authentication/hydration states, responsive transitions, stable room content and normal chrome restoration on exit. It also checks alias outputs and native stack configuration. The room's own Leave, Share, People and device/host controls are retained.

A read-only deployed-browser check of canonical room entry while signed out showed no site header before the sign-in redirect. Authenticated and mobile deployed room rendering remain unverified. The legacy route was not opened because it automatically requests admission and media; it was exercised only with a local sentinel, without live admission.

## Rollout and verification

Release order, once explicitly approved:

1. Deploy `video_list_rooms` with its updated shared dependencies.
2. Release the web client.
3. Release the native app separately when authorized. Previously installed clients can retain their old fallback/history behavior until updated.

No database migration is required. The user approved publication of this branch and a possible automatic Vercel preview. No merge, production release or native distribution is approved.

Fresh verification results belong in the final handoff after reconstruction. Previous lost-worktree test results do not apply. Relevant automated coverage includes the actual endpoint with capped pages/errors, policy arithmetic, actual web hook/API and native callbacks, privacy/IME DOM behavior, full app-shell integration, and existing room/event regressions. Physical devices, real multi-person calls, Safari/Bluetooth behavior and browser screenshot/geometry acceptance remain unverified and deferred. No production room was created or altered for these fixtures.

### Fresh reconstruction checks

- Repository app/UI Node suite: 1,948 passed, 0 failed.
- Backend discovery/event/admission sweep: 116 passed, including 18 actual-handler discovery scenarios and five pagination cases.
- Complete room regression workflow passed locally with Node test groups run serially. Final changed discovery DOM/API/native fixtures were rerun successfully after review fixes.
- Non-browser layout/privacy/native fixtures passed. The real shell fixture and five route-boundary tests passed after the legacy route fix.
- Capture guard arithmetic: 23 passed. Production capture/recovery and room panel DOM fixtures passed, including preserved media, real panel isolation, Send and IME behavior.
- Focused semantic TypeScript checks and React hook lint passed. Workflow YAML, fixture syntax, parity, Edge function consistency, Lynk architecture and whitespace checks passed.
- Independent review findings (superseded responses, cancelled request completion and numeric-only persisted profiles) were fixed and rechecked with no remaining release-impact findings in the reviewed scope.

The final expiry fixture initially failed because a disabled Refresh click could retain its previous long-lease sample. The fixture now reproduces that case, waits for a real request, asserts the short proof was accepted, and drives only the production-scheduled timer: visible at 199ms and removed at 200ms during an error. No production timer change was needed for that fixture issue.

Full package TypeScript was blocked by the partial test environment's missing `expo/tsconfig.base`. Focused checks isolate unrelated app/service declarations; they do not replace the full application check. Browser layout automation was updated and syntax-checked but not run here. These were local pre-publication checks; exact-head cloud CI and the authorized preview must be checked separately after publication. No production deployment, database migration or native distribution was started for this branch.
