# DVNT Workstream 14 — Follow-state UX

## Goal
Make mutual-follow state obvious and actionable without losing the useful "Follows you" signal introduced by the newer profile design.

## Desired behavior
For another member's profile:

| Relationship | Marker | Primary button |
|---|---|---|
| neither follows | none | Follow |
| they follow you, you do not | Follows you | **Follow Back** |
| you follow them, they do not | none | Following |
| mutual | Follows you | Following |

Pending labels:
- Following…
- Unfollowing…

Never announce success before the server mutation succeeds.

## Scope

### 1. Shared relationship model
One pure helper receives:
- viewerFollowsTarget
- targetFollowsViewer
- mutation state

Returns:
- marker
- button label
- action
- accessibility label

Web/native consume the same helper.

### 2. Optimistic mutation
- optimistic follow/unfollow
- rollback on failure
- reconcile with authoritative relationship query
- mutation lock prevents double taps from creating duplicate requests
- account switch clears relationship state

### 3. Lists/cards
Where relevant, use the same Follow Back semantics in followers lists/search/member cards rather than only profile detail.

### 4. Notifications
Do not generate a new follower notification on a failed/rolled-back optimistic mutation.
Mutual follow does not need a separate notification type unless product chooses one.

### 5. Accessibility
Button state should be understandable without relying only on color.
"Follows you" is descriptive text, not hidden exclusively inside the action button.

## Acceptance criteria
- [ ] Incoming-only relationship shows Follows you + Follow Back.
- [ ] Mutual relationship shows Follows you + Following.
- [ ] Neither shows Follow.
- [ ] Mutation failure restores prior state.
- [ ] No premature "Now Following" success text.
- [ ] Web/native use one relationship-state helper.
- [ ] Account switch cannot retain old relationship state.
- [ ] Followers/search cards do not contradict profile detail.

## Tests
- all four relationship states
- slow/failing network
- double tap
- block/unblock interaction
- account switch
