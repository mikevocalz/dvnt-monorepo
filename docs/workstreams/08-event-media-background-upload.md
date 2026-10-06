# DVNT Workstream 08 — Non-blocking event media uploads

## Goal
Bring event flyer/video editing up to the post-publishing UX: selecting media should not freeze the whole event editor behind an upload percentage.

## Existing foundation
- video flyer transport/size/CORS bugs are fixed
- large video flyer upload works
- upload progress exists
- current event UI still blocks save/edit interaction around the upload

## Product behavior
On media selection:
1. render the local preview immediately
2. enqueue upload
3. keep the event editor interactive
4. show a compact media-level uploading indicator
5. bank completed upload result
6. reconcile draft/event when upload succeeds
7. preserve retry state when it fails

## Scope

### 1. Upload job descriptor
Persist serializable data:
- account/organizer ID
- draft/event ID
- local durable URI where native supports it
- media kind
- checksum/idempotency key
- current upload result
- retry state

No closure-only queue state.

### 2. Optimistic preview
The selected image/video appears instantly.
Video uses a generated/local poster where available and must not construct expensive player instances for every thumbnail.

### 3. Editor independence
While upload runs, organizer can:
- edit title/description/date
- edit ticket tiers
- navigate within the editor
- save draft

Publishing a live event must either:
- await required media completion, or
- explicitly publish without that media after user confirmation

Never silently publish a broken/temporary local URI.

### 4. Recovery
- app/browser restart restores upload state
- retry resumes safely
- completed remote media is banked so a retry doesn't upload twice
- replacing media cancels/supersedes old job safely

### 5. UI
Replace full-button "Uploading 47%" lock with:
- preview badge/progress ring
- "Uploading"
- retry/error affordance
- remove/replace
- optional detailed percent only in the media item, not as a global interaction blocker

### 6. Edit-event behavior
Existing flyer remains live until replacement upload succeeds; replacement failure cannot erase the old flyer.

## Acceptance criteria
- [ ] Editor remains usable during a 50MB video upload.
- [ ] Local preview appears immediately.
- [ ] Save Draft works while media uploads.
- [ ] Restart resumes/reconciles without duplicate upload.
- [ ] Failed replacement preserves existing published flyer.
- [ ] Publish cannot store local-only media URI.
- [ ] Web/iOS/Android expose equivalent state.
- [ ] Replacing/cancelling media leaves no orphaned job attached to the event.

## Test matrix
- 8/20/47MB video
- offline during upload
- app kill/relaunch
- browser refresh
- replace midway
- edit existing event vs new draft
