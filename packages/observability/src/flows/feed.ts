/**
 * @dvnt/observability — Feed & post flow instrumentation
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureFlowFailure } from '../capture';
import { createTimer } from '../spans';

const FLOW = 'feed';

// ─── Feed Load ───────────────────────────────────────────────────────────────

export function feedLoadStarted() {
  addSentryBreadcrumb(`${FLOW}.load`, 'feed.load.started');
  return createTimer('feed.load', 'feed');
}

export function feedLoadSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.load`, 'feed.load.success', { durationMs });
}

export function feedLoadFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.load`, 'feed.load.failure', metadata, 'error');
  captureFlowFailure(FLOW, 'load', error, metadata);
}

// ─── Post Create ─────────────────────────────────────────────────────────────

export function postCreateStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('post.create', 'post.create.started', metadata);
  return createTimer('post.create', 'post');
}

export function postCreateSuccess(durationMs?: number) {
  addSentryBreadcrumb('post.create', 'post.create.success', { durationMs });
}

export function postCreateFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('post.create', 'post.create.failure', metadata, 'error');
  captureFlowFailure('post', 'create', error, metadata);
}

// ─── Post Media Upload ───────────────────────────────────────────────────────

export function postMediaUploadStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('post.media', 'post.media.upload.started', metadata);
  return createTimer('post.media.upload', 'media');
}

export function postMediaUploadSuccess(durationMs?: number) {
  addSentryBreadcrumb('post.media', 'post.media.upload.success', { durationMs });
}

export function postMediaUploadFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('post.media', 'post.media.upload.failure', metadata, 'error');
  captureFlowFailure('post', 'media.upload', error, metadata);
}
