# DVNT Workstream 10 — Member proximity

## Goal
Ship the product decision to surface nearby DVNT members while keeping proximity approximate, consent-based, and privacy-preserving.

## Existing foundation
- city-level proximity is already calculated/displayed on web
- discovery visibility and event discovery are separate concepts
- raw member coordinates are not published to other users
- current visibility default is conservative/off

## Scope

### 1. Consent/default rollout
Do not silently turn on raw location sharing.
During onboarding or feature rollout:
- explain that DVNT can show approximate proximity to other members
- allow Enable / Not now
- record the choice
- provide Settings control later
- existing members get a one-time education prompt, not a surprise permission popup

### 2. Visibility grant
Reuse/extend the time-bounded visibility grant:
- enabled state
- city/metro
- expiration/refresh policy
- no public raw coordinates

If a precise device fix is used to calculate distance, keep it ephemeral or private to the minimum server/client boundary required.

### 3. Display policy
Suggested formatting:
- under 0.1 mile: "Nearby" unless product explicitly needs feet
- if feet are desired: use feet only below a conservative threshold, rounded coarsely
- otherwise one decimal mile
- same city with no reliable distance: "In [City]"
- different city/unknown: city only or hidden

Avoid false precision.

### 4. Settings
- Show my proximity
- clear explanation
- disable immediately
- optional visibility duration if temporary grants remain
- current permission state separate from DVNT visibility preference

### 5. Abuse/privacy protections
- blocked users never get proximity
- private/hidden profiles obey existing visibility rules
- rate-limit any nearby discovery endpoint
- no sort/API that enables triangulation through repeated high-precision reads
- no background location requirement for this feature

### 6. Web/native
Use shared formatter/decision logic so labels do not drift.

## Acceptance criteria
- [ ] New/existing member sees clear consent before proximity visibility is enabled.
- [ ] Disabling visibility removes proximity from other users quickly.
- [ ] Blocked users cannot see proximity.
- [ ] UI never exposes another member's coordinates.
- [ ] Distance is coarsely formatted consistently on web/native.
- [ ] Permission denial does not break the rest of profile/location UX.
- [ ] No background location permission is required.
- [ ] City fallback works when distance cannot be calculated.

## Tests
- same building / same neighborhood / same city / different city
- denied/expired location permission
- visibility on/off
- block/unblock
- account switch
- stale grant expiration
