# DVNT Workstream 09 — Post composer cleanup and location parity

## Goal
Remove redundant media actions and make post location work consistently across web/native without forcing location permission.

## Existing foundation
- web post composer now has event-style places autocomplete
- web supports current-location quick pick
- camera capture → composer route has been fixed
- post publishing queue is already non-blocking/resumable

## Scope

### 1. Media action cleanup
Audit Create Post actions and remove the redundant standalone camera affordance when it duplicates the Add Photos/media picker flow.

One clear media entry should support:
- take photo
- choose photo
- choose video where allowed
- multi-select where product supports it

Do not remove the dedicated full-screen camera route if other product surfaces still use it; remove only duplicate composer affordances.

### 2. Native location parity
Bring native post composer to the same behavior as web:
- place search/autocomplete
- current-location shortcut
- manually selected venue/place
- removable location chip
- location is optional
- permission denial does not block posting

### 3. Shared location value
Use one post-location representation across platforms:
- display label
- normalized place/city identifiers where available
- lat/lng only when required for post behavior and subject to privacy policy
- source: search/current/manual

Avoid platform-specific shapes leaking into the API.

### 4. Permission behavior
- never prompt for location just because Create Post opened
- request only after tapping current location
- explain why before/with the OS prompt
- graceful denied/restricted state
- place search remains available after denial

### 5. Publishing integration
Location must survive:
- queued media uploads
- publish retry
- app/browser restart
- account switch protections

## Acceptance criteria
- [ ] Create Post has one coherent media entry instead of duplicate camera controls.
- [ ] Native place search matches web capability.
- [ ] Current location is opt-in and never blocks posting.
- [ ] Denied location still allows searched/manual place selection.
- [ ] Chosen location persists through queued/resumed publishing.
- [ ] Account switch cannot publish the previous account's draft/location.
- [ ] Web/native render the same saved location.

## Tests
- no permission / denied / granted
- search without geolocation
- camera capture + location + queued publish
- browser refresh / native relaunch
- account switch
