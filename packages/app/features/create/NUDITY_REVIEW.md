# Browser-local pre-post review

Web composer only. Sweet media drafts are scanned before the publish queue or
uploads begin. Already-Spicy drafts and text posts skip inference. NSFWJS 4.4.0
(MIT) and TensorFlow.js 4.22.0 (Apache-2.0) are lazy loaded. NSFWJS's bundled
MobileNetV2 weights load from the application's own JS chunks. No user media is
sent to an AI provider, and no scores/images are logged or retained by this code.

A Porn or Hentai score >= 0.65 produces an advisory dialog, not an allegation or
hard moderation block. Users can review, mark Spicy and share, or explicitly
correct a false positive and share Sweet. Sexy alone is intentionally not treated
as nudity. Thresholds are heuristics, not calibrated accuracy guarantees.

Five frames per video/motion component are sampled (0/25/50/75/98%). This does not
certify the entire clip. Live Photo still and paired motion are both visited.
Unsupported decodes, model failure, animated GIFs and remote handoff media produce
an incomplete-check dialog with explicit continue/review choices, not silent pass.
Only blob/data media is decoded; remote user-media URLs are not fetched by this
checker. Cancel returns to the draft without posting. Draft media/label changes
invalidate review, including during async onboarding checks.

Still required before release: signed-in Chrome/Safari/iOS-web testing, realistic
performance/false-positive evaluation, keyboard/screen reader checks, a full web
build, and product review of advisory override and threshold. No server-side
moderation/security enforcement is claimed. Animated WebP/APNG and short explicit
segments between video samples can be missed; the UI expressly disclaims complete
review. This does not change Spicy visibility rules or identity verification.
