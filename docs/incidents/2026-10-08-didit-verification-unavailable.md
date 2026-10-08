# Incident: DVNT signup blocked at adult identity verification — 2026-10-08

**Priority:** P0 / active customer-facing onboarding failure  
**Affected site:** https://dvntapp.live, including Instagram iOS in-app browser  
**Backend:** Supabase `npfjanxturvmjyevoyfo` / `create-verification-session`  
**Status:** Fix PR pending; production secrets and deploy require operational follow-through.

## Reproduction and confirmed root cause

A customer creating an account reaches **User Info → Terms → Identity** and taps **Start secure ID verification**. The app shows **Verification unavailable — Verification isn't available right now**, blocking account completion.

The production Supabase log for 2026-10-08 near 20:30 UTC shows repeated
`[create-verification-session] not_configured` entries (four in the checked
19:45–20:43 UTC window). The deployed function emits that **exact** string
only when `DIDIT_API_KEY` or `DIDIT_WORKFLOW_ID` is unavailable to the
Edge Function runtime. The request was authenticated; it got past session
validation and reached the provider configuration guard. The HTTP transport
previously returned 200 even for `ok: false`, concealing the outage from
HTTP-based monitoring. No customer ID, email, DOB or document images are
included here.

A separate log also shows `permission denied for table identity_verifications`
during a customer-side status read. Better Auth sessions are not Supabase
Auth JWTs. Do **not** address this by granting SELECT on identity data to
`anon`; use the new authenticated self-only `verification-status`
endpoint instead.

### User experience contributing issue

On the signup page, `window.open(url, '_blank')` was called only **after**
an async session request. In-app browsers (notably Instagram on iOS) may
block that popup. The fix navigates the existing tab and uses sessionStorage
to restore the signup step after the hosted verification callback.

## P0 live restoration — operator checklist

1. In the **live Didit application** at https://business.didit.me, find:
   - `DIDIT_API_KEY` in **API & Webhooks**.
   - `DIDIT_WORKFLOW_ID` on the **published adult-ID verification workflow**
     under **Workflows**. Both must belong to the SAME live application.
   - Check that the webhook destination and signing secret are configured
     for DVNT's webhook receiver. Do not use a sandbox key on live.
2. In **Supabase** project `npfjanxturvmjyevoyfo`, open
   https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo then
   **Edge Functions → Secrets**, and set those two variables there.
   Verify both names are present and non-empty; never copy their values
   into GitHub, chat, screenshots or logs.
   **Supabase Edge secrets apply without redeploying.**
3. Reproduce a *new* identity-verification session with a controlled adult
   test account, including the Instagram iOS in-app browser. Check a valid
   Didit hosted URL is returned, the camera flow opens, webhook status updates
   the same user, and the DVNT client reads `approved` after successful ID/DOB.
4. Confirm there are no fresh `not_configured`, `provider_unavailable`, or
   `status_read_failed` events. Separately check webhook signature validation
   and that under-18 and duplicate-ID responses remain denied.

**Do not disable the 18+ gate, fake an approval, or mark every existing
account verified to make signups pass.** Ticket purchase must remain
available under DVNT's existing independent checkout policy.

## Code changes in this PR

- Didit **v3** `POST /v3/session/`, x-api-key, 10 s timeout, allowlisted
  callback destination, server-derived `vendor_data`, response URL validation.
- Missing config returns HTTP 503 with `not_configured` instead of HTTP 200;
  provider, database and authentication errors use appropriate statuses.
- Approved adults continue even when the provider is temporarily unavailable.
- Persist the verification correlation row before returning the hosted URL.
- Better Auth authenticated `verification-status` function reads the
  caller's record using service credentials; no anonymous table grants.
- Web/mobile hooks route status through the new endpoint.
- Signup preserves the account on provider outage, shows a durable retryable
  explanation, and uses same-tab redirects for Instagram/in-app browsers.
- Regression tests cover missing secrets, already-approved users,
  v3 request shape, persistence and blocked external callbacks.

## Safe deploy order

1. Restore the **live Supabase** secrets first and smoke test the existing
   session-start route. This step can restore existing users *before* a
   frontend deployment; it depends on the live provider API contract.
2. Deploy the new **verification-status** Edge Function with Better Auth JWT
   verification handled inside the function (`verify_jwt = false` on gateway,
   same as other Better Auth authenticated endpoints). Confirm unauthenticated
   calls are rejected and cross-account results cannot be read.
3. Deploy the new **create-verification-session** function. Confirm Didit v3
   session creation, provider callback, DB persistence and webhook success.
4. Release frontend hooks and signup web (then native as applicable).
   Do **not** ship the frontend before the status endpoint is live.
5. Exercise on actual iPhone Instagram, iPhone Safari, Android Chrome and
   standard desktop; return to signup and check ID-approved + email step.
6. Monitor verification attempts, success, 401/403/502/503 rates and
   time-to-complete for 24 hours. Alert if `not_configured` occurs even once
   in production, or verification session starts drop to zero under traffic.

## Rollback

Revert the client to the earlier status path ONLY if necessary to mitigate
an unanticipated regression, without granting access to `anon`; preserve
`verification-status` until the clients no longer call it. Restore the
previous function version if v3 creation unexpectedly fails, but keep secrets
in the backend. Never relax server-side adult admission.

## Verification gates

- [ ] Production secrets restored; confirmed by a successful controlled test.
- [ ] Edge Function v3 returns hosted URL and persists matching session.
- [ ] Webhook delivers approved/declined decision safely.
- [ ] `verification-status` returns only the caller's status, not another user.
- [ ] iOS Instagram callback restores the identity step.
- [ ] Existing adult, minor, retry and duplicate-ID regressions pass.
- [ ] CI green and live browser/device smoke tests recorded.

Links:
- https://supabase.com/docs/guides/functions/secrets
- https://help.didit.me/account-organization/api-keys
- https://help.didit.me/workflows/build-a-verification-workflow
- https://verification.didit.me/v3/session/
