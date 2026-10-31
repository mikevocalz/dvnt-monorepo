# Post-event CTA correction — draft only

No release or email dispatch is authorized by this source change. The earlier
sample is immutable; attendee campaigns remain unenrolled pending explicit
operator authorization.

## Recipient-specific destination

- A current account holder gets one **Rate the party** button to
  `/public/events/{id}?section=reviews`: the existing event-details Ratings &
  Reviews section, not a separate review page or auto-opened modal.
- A public-ticket buyer without an account gets one **Join the platform** button
  to `/auth/signup?returnTo=<encoded /feed/events/{id}?section=reviews>`.
- Current ownership and normalized account-email matching determine membership.
  Buying publicly does not force an existing member into signup. Lookup failures
  stop delivery rather than guessing. Admission eligibility, opt-outs, and
  provider idempotency remain unchanged.
- `member_message` and `guest_message` are optional plain-text variants, with the
  original custom `message` as backwards-compatible fallback. For a campaign
  inviting guests to make a profile, supply explicit member copy without that
  imperative. `profile_cta_enabled` is retained for old settings compatibility
  but no longer enables a second CTA. The organizer UI only toggles enrollment;
  it does not edit copy. Generic settings-API message edits do not replace explicit
  member/guest overrides: update those variants through the scoped service path.
  Ordinary future campaigns have null variants and continue using generic copy.
- Membership is resolved just before payload preparation. Once a provider payload
  is frozen, retries keep its exact body/key. No account is created or enrolled.

## Explicit revised preview

Preview revision 1 preserves the earlier durable record and frozen payload.
A later authorized corrected sample must explicitly request `preview_revision: 2`
(or `p_preview_revision => 2` through the service-only dispatcher). Retrying that
revision reuses the same row/provider key; it never resets or edits revision 1.
Attendee uniqueness remains one event/address. Do not use preview revisions as a
bulk resend mechanism. For explicitly requested two-variant samples, the service-only preview scope can
persist `preview_audience: "member"` or `"guest"` (RPC `p_preview_audience`). Use
revision 2/member and revision 3/guest for the corrected pair. A conflicting
revision/audience request fails; retries preserve the same row/payload/key.
This override is forbidden for attendee delivery and never edits account/profile
membership. Without an override, previews classify actual account membership.
Offline no-account visual coverage continues using synthetic fixtures.

## Release gate

Companion event-details section/auth-return changes must be live before the
corrected worker. Apply only the new additive migration after explicit approval;
never rerun or edit the previous migration history. Keep all sends stopped until
new explicit authorization, and verify a newly authorized member sample before
any scoped catch-up. Older Android apps can still intercept the domain; the
readable copy-into-browser fallback remains, not a claim of a native-app fix.
