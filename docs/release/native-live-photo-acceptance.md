# Native Live Photo acceptance

These are release gates, not completed device results. Unit/React harnesses adapt native bridges and cannot validate PhotoKit decoding. A web deployment is not an installed iOS build or OTA delivery.

## Identify the actual app first

Record the TestFlight/App Store build, iOS version and device. In builds with the diagnostic route, long-press the version label at the bottom of iOS Settings for one second. Record Current Launch (update ID, embedded/emergency launch) and Build Config (channel, runtimeVersion). The ordinary `Version 1.0.0` label is hardcoded and is not sufficient evidence of the installed source commit. Do not press fetch/reload controls just to read the values.

Match the installed runtime and update/build source to the candidate commit before claiming the patch is present. No build, OTA publication, submission or release is authorized by this document.

## One native selection, two resources

The native composer requests `images`, `videos`, and `livePhotos` from Expo ImagePicker. Its PhotoKit adapter returns one `livePhoto` asset plus `pairedVideoAsset`, preserving both originals. The shared publish path saves the still URL and `live_photo_video_url` together. A row with raw `type=image` and a paired URL is intentionally read as a Live Photo. A browser FileList containing only a JPEG is not equivalent and cannot provide absent motion.

## Physical iPhone checks (pending)

1. Pick several real Live Photos in one selection, mixed with a static photo and ordinary video. Confirm original ordering and pairing through publish and reload.
2. Verify bitmap crop is unavailable for Live Photos/GIFs, and remains available for static images. Verify static edits still publish. For a previously cropped composer item, use the retained original or reject if it is gone; already-enqueued descriptors without originals are not repairable by this guard.
3. Confirm an untouched local pair reaches native PhotoKit using file URLs and plays with correct orientation, original codec and Apple pairing metadata. Confirm tap-and-hold works while active.
4. Confirm remote originals are downloaded unchanged before native PhotoKit sees them. Inspect loading, success and error events on an actual device; do not count fallback movie playback as successful PhotoKit pairing.
5. Swipe forward/back through feed/detail/lightbox, then background/foreground, navigate away, replace source, and unmount while downloads are pending. Only the active item should play; stale completions must not restart old media.
6. Interrupt still and companion downloads/uploads separately. A partial upload must not publish a falsely successful still. A native resource-load failure should retain original-movie playback fallback when available. Retry and cache cleanup must remain bounded.
7. Verify a previously uploaded HEVC Live Photo on iOS; desktop browser codec support is not an iOS acceptance test. Existing still-only posts require re-uploading originals, not a fabricated motion URL.

Evidence should record actual build/update ID, device/OS, timestamp, observed outcome and a sanitized recording/log link. Do not commit private user media or signed asset URLs as test fixtures.
