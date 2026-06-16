/**
 * @dvnt/observability — Media flow instrumentation
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureMediaFailure } from '../capture';
import { createTimer } from '../spans';
import type { MediaFailureContext } from '../types';

const FLOW = 'media';

// ─── Picker ──────────────────────────────────────────────────────────────────

export function mediaPickerOpened(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.picker`, 'media.picker.opened', metadata);
}

export function mediaSelected(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.picker`, 'media.selected', metadata);
}

// ─── Compress ────────────────────────────────────────────────────────────────

export function mediaCompressStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.compress`, 'media.compress.started', metadata);
  return createTimer('media.compress', 'media');
}

export function mediaCompressFailure(error: unknown, ctx?: MediaFailureContext) {
  addSentryBreadcrumb(`${FLOW}.compress`, 'media.compress.failure', undefined, 'error');
  captureMediaFailure(error, { ...ctx, operation: 'compress' });
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export function mediaUploadStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.upload`, 'media.upload.started', metadata);
  return createTimer('media.upload', 'media');
}

export function mediaUploadProgress(progress: number) {
  addSentryBreadcrumb(`${FLOW}.upload`, 'media.upload.progress', { progress });
}

export function mediaUploadSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.upload`, 'media.upload.success', { durationMs });
}

export function mediaUploadFailure(error: unknown, ctx?: MediaFailureContext) {
  addSentryBreadcrumb(`${FLOW}.upload`, 'media.upload.failure', undefined, 'error');
  captureMediaFailure(error, { ...ctx, operation: 'upload' });
}

// ─── Render / Playback ───────────────────────────────────────────────────────

export function mediaRenderFailure(error: unknown, ctx?: MediaFailureContext) {
  addSentryBreadcrumb(`${FLOW}.render`, 'media.render.failure', undefined, 'error');
  captureMediaFailure(error, { ...ctx, operation: 'render' });
}

export function videoPlaybackFailure(error: unknown, ctx?: MediaFailureContext) {
  addSentryBreadcrumb(`${FLOW}.playback`, 'video.playback.failure', undefined, 'error');
  captureMediaFailure(error, { ...ctx, operation: 'playback', mediaType: 'video' });
}
