# Coordinated non-Stripe release: 11 November 2026

## Status and scope

This is the integrated candidate and rollout checklist, not evidence of a deployment.
The integration combines #269–274, #279 and #282 against `master` at
`776cb122d105605c4996edc48673e45bd4aabbaa`. Do not merge the component PRs independently.
Payout/onboarding/settlement work #275–278 and #280–281 is excluded. The event-cancel
change only narrows authorization around its existing operation; this release does
not run a cancellation or issue a refund.

Protected-media delivery remains dormant. Both public build flags must be off or
absent, and the endpoint must retain its disabled default. Shipping its source is
not a claim that known permanent CDN URLs are protected.

## Production read-only preflight

Verified against the connected `dvnt-social` production project on 11 November:

- The catalogue migration is already recorded as
  `20261111023347_protected_post_media_catalogue`, while this source branch names it
  `20261111040000_protected_post_media_catalogue.sql`. The restrictive
  `media_requires_post_access` policy is present. Compare definitions and reconcile
  the version mapping through the release process; **do not blindly reapply it**.
- No other migration from this candidate is recorded. The profile privacy RPC,
  media-parent helper, `can_edit_event` and new cohost guard functions are absent.
- `ticket_types` currently has a public SELECT policy plus restrictive
  `event_private_boundary` using `can_view_event(event_id)`.
- `ticket_types_public` is owned by postgres with `security_invoker=true`. Its
  frozen projection excludes `unlock_code`. Any switch to a definer view must
  retain an explicit event-visibility predicate. Otherwise the table's restrictive
  policy is bypassed and private event tiers become public.

No production writes were made by this integration. These reads are a point-in-time
snapshot and must be repeated immediately before execution.

## Integration invariants and tests

The shared relationship reset must synchronously do all of the following before
waiting for cancellation: advance the post access generation, retire media leases,
close detached overlays, clear protected payloads and `postLikers`, and tombstone
both `likeState` and `commentLikeState` with null without refetching either cache-only
family. The combined regression in `scripts/test-follow-hook.cjs` proves the union.

`npm run test:privacy-release` executes the privacy integration, original handler/
SQL/client suites, profile and Spicy gates, and mounted social regressions. It runs
on every PR and release-branch push in `post-privacy-release.yml`.
`npm run test:cohost-editing` covers event permissions and partial saves.
The manifest now includes the privacy aggregate and union boundary. Its file
reachability verifier matches actual file targets/globs, not arbitrary sibling
files in the same directory.

Do not substitute component-head results for the final integrated commit. Before
release require passing integrated privacy/cohost/scanner suites, actual Edge type
checks, release verifiers, full app typecheck/build, and relevant browser suites.
Native DOM adapters and PostgreSQL-WASM fixtures do not replace real-device or
production-account acceptance. Record any infrastructure-blocked check as blocked,
not green.

## Rollout ordering

Do not run a blanket `db push`: the catalogue version differs, the media helper is
older than the already-applied migration, and the restrictive ticket-read boundary
must wait for compatible buyers. Execute only reviewed migrations at the intended
phase, with bounded lock/statement timeouts and schema/history verification.

1. **Freeze the exact integrated commit and passing checks.** Resolve the private
   event-view predicate and all remaining base-table buyer/scanner joins. Verify
   no payout/settlement changes are present. Verify rollback targets and prior
   deployed function/client versions.
2. **Apply prerequisite schema before its consumers.**
   - `20261111020731_profile_effective_privacy.sql`: required before
     `bootstrap-profile` and updated profile readers. A missing RPC intentionally
     makes profiles unavailable instead of guessing Public.
   - `20261111042000_protected_post_engagement.sql`: restrictive raw engagement
     access/ownership. Verify own unlike cleanup after relationship revocation.
   - `20261111120000_accepted_cohost_event_editing.sql`, then
     `20261111140000_guard_cohost_addon_catalog.sql`: content/catalog permissions
     and counter/reparenting guards. Apply both before enabling cohost edits.
   - `20261111024044_post_media_delivery_parents.sql` is optional while media
     delivery stays disabled. If staged now, review its three expression-index
     builds and service-only helper grants. Never enable leases without it.
   - Skip the already-applied catalogue migration after definition reconciliation.
3. **Deploy reviewed Edge bundles.** Required: `bootstrap-profile`,
   `get-post-likers`, `post-like`, `post-unlike`, `toggle-like`,
   `toggle-comment-like`, `notify-event-change`, `manage-promo-code`, `event-cancel`.
   If staging dormant media code, also deploy `post-media-lease` and
   `protected-photo-preview`, with signing/delivery disabled and no new secrets.
   Verify each deployed version/hash and default-deny behavior.
4. **Release compatible buyer and manager clients.** The buyer path must read
   the safe `ticket_types_public` projection; authorized manager editing still
   reads `ticket_types`. Cover native event pricing, watch waitlists, scanner/live
   attendee tier names and transfer history, including inactive purchased tiers.
   Release web and distribute native separately. Refresh long-lived web sessions.
   Establish an explicit minimum-native-version/update policy before the read
   cutover; web deployment alone does not update installed native apps.
5. **Only then restrict ticket base reads.** Apply
   `20261111121000_ticket_catalog_private_management.sql` after its corrected view
   predicate and client-compatibility gates pass. This depends on `can_edit_event`
   from step 2. Verify private/hidden/future event tiers are denied to outsiders,
   public buyers retain the frozen safe fields, manager reads retain unlock codes,
   and scanner/attendee/history displays still work. Do not reopen the secret-bearing
   base table to keep an old client working.
6. **Smoke and observe the coordinated release.** Use synthetic owner/admin/editor,
   scanner/pending/removed/unrelated and public buyer accounts. Verify content,
   flyer, ticket/add-on persistence after reload; partial-save retry without duplicate
   rows; account switching and role revocation; promo permissions; owner-only
   destructive/financial actions; private-profile presentation and engagement
   access. Verify native image selection, cancellation and upload interruption.
   Record deployed commit, function versions, migration versions, client versions
   and each smoke result before calling this release live.

## Separate protected-media activation gate

A single source release cannot safely activate unverified provider enforcement.
The actual Bunny account settings, token support, all aliases/paths, raw origins,
optimizer bypasses and trusted anonymous gateway remain unverified. Follow
`docs/security/protected-post-media-delivery.md` for the separate cutover. Require
synthetic staging HS256 acceptance, token checks before cached delivery on every
protected host/path, legacy cache handling, verified non-forgeable guest-IP header,
real-device media/Range/expiry acceptance and an old-client policy.

Provider security settings and credential provisioning need their concrete
confirmation before execution. No signing key is included in this branch. Enabling
flags or setting a key alone does not protect old raw URLs. Existing issued bearer
URLs remain usable for up to 120 seconds plus provider tolerance; downloaded bytes
cannot be revoked.

## Rollback

Keep additive RPCs/helpers while any client uses them. Roll back client/function
versions only when their schema compatibility has been verified. Preserve restrictive
privacy policies; do not restore public base-table access or raw CDN fallback.
After token enforcement, prefer unavailable media or a forward fix over disabling
protection. Never roll back data, refunds, counters or existing relationships as a
side effect of this release.
