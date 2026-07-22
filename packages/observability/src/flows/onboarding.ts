/**
 * @dvnt/observability — Onboarding v2 funnel instrumentation (PROMPT NN · B5)
 *
 * Checkpoint names are API — boring and stable. Taxonomy:
 *   entry.oauth_start | entry.magic_link_sent | entry.complete
 *   profile.name_saved | profile.photo_saved | profile.photo_skipped
 *   profile.identity_saved | profile.identity_skipped
 *   profile.location_enabled | profile.location_skipped
 *   verification.triggered | verification.capture_start |
 *   verification.uploading | verification.processing |
 *   verification.verified | verification.failed | verification.retry |
 *   verification.camera_denied | verification.unsupported_document
 *   nudge.shown | nudge.dismissed | nudge.completed
 *
 * Meta is allowlisted by construction: step names and counts only — the §2.4
 * scrubber is the backstop, not the mechanism.
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureFlowFailure } from '../capture';
import { createTimer } from '../spans';

export type AllowlistedMeta = Record<string, string | number | boolean>;

/** A4 generic checkpoint — breadcrumb `<flow>.<step>` on the funnel trail. */
export function checkpoint(flow: string, step: string, meta?: AllowlistedMeta) {
  addSentryBreadcrumb(flow, `${flow}.${step}`, meta);
}

/** A4 traceFlow — a timer whose end() records the step duration as a span. */
export function traceFlow(flow: string, step: string) {
  return createTimer(`${flow}.${step}`, flow);
}

const FLOW = 'onboarding';

export function onboardingCheckpoint(step: string, meta?: AllowlistedMeta) {
  checkpoint(FLOW, step, meta);
}

export function onboardingFailure(step: string, error: unknown, meta?: AllowlistedMeta) {
  addSentryBreadcrumb(FLOW, `${FLOW}.${step}.failed`, meta, 'error');
  captureFlowFailure(FLOW, step, error, meta);
}
