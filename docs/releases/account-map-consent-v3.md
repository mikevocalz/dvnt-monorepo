# Account map consent v3 rollout

This change is not a data backfill. It never broadens v1/v2 grants. Users explicitly accept the account-wide disclosure once. Existing grants retain their original session/expiry limits.

## Compatibility

- Existing v1/v2 update/publish RPCs remain intact and fail closed against a v3 grant. Old clients do not treat null `shareUntil` as valid sharing.
- Old clients send the same `revoke(scope=overall)` request for sign-out and an explicit privacy opt-out. The server cannot safely distinguish these intentions. Do not ignore or reinterpret legacy revokes: doing so could defeat an explicit Stop sharing request.
- Consequently, signing out through an old cached web build or old native build can still turn account sharing off. This is conservative (no exposure) but defeats persistence. A fully consistent cross-device promise requires refreshed web clients and compatible native clients. Never automatically restore a grant after a legacy revoke.
- New clients stop local writers before detaching their publisher session. They must not accept the still-enabled detach response into the writer state before authentication completes sign-out.

## Ordered release (requires separate approval)

1. Confirm PR checks, particularly SQL, edge, consent/controls browser tests and session/signout tests.
2. Apply `20261114162937_member_map_account_consent.sql` through the controlled migration workflow. It adds service-only RPCs and a publisher-session foreign key. No existing consent rows change. Old edge and clients continue legacy behavior at this point.
3. Deploy the matching `member-map` edge function. Verify settings, legacy requests, v3 explicit consent, publish and detach in an isolated approved test account. Deploying clients before edge/schema would fail closed but make consent unusable.
4. Release matching web and native clients. Require refresh/update before promising cross-device persistence. If native rollout cannot be coordinated, keep this feature unreleased or explicitly communicate the old-client logout limitation; do not weaken the revoke endpoint to hide it.
5. On separate approved synthetic accounts, validate: browser A explicit opt-in; browser B restored preference without duplicate invitation; B OS denial without global revoke; A fresh self avatar; signout detaches its point; global Stop sharing removes presence and rejects stale publishers; no expired-session visibility. Never change a real user's location/consent as a test.
6. Observe error logs and fresh presence only under authorized read access. Confirm no existing account was silently converted.

## Recovery

- Prefer forward fixes. Old web clients cannot publish v3 grants, which is safe but degrades sharing. Do not down-migrate after v3 grants exist without a separately reviewed plan that explicitly revokes affected grants and removes dependent functions/column in order.
- If release is interrupted after schema or edge, leave compatible additive infrastructure installed; do not run rollback data changes automatically.
- No financial, location, consent, migration or deployment action is authorized by this document.
