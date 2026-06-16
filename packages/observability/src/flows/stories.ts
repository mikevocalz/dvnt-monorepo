/**
 * @dvnt/observability — Stories flow instrumentation
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureFlowFailure } from '../capture';
import { createTimer } from '../spans';

const FLOW = 'story';

export function storyCreateStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.create`, 'story.create.started', metadata);
  return createTimer('story.create', 'stories');
}

export function storyCreateSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.create`, 'story.create.success', { durationMs });
}

export function storyCreateFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.create`, 'story.create.failure', metadata, 'error');
  captureFlowFailure(FLOW, 'create', error, metadata);
}

export function storyPlaybackStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.playback`, 'story.playback.started', metadata);
}

export function storyPlaybackFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.playback`, 'story.playback.failure', metadata, 'error');
  captureFlowFailure(FLOW, 'playback', error, metadata);
}

export function storyReplyStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.reply`, 'story.reply.started', metadata);
}

export function storyReplyFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.reply`, 'story.reply.failure', metadata, 'error');
  captureFlowFailure(FLOW, 'reply', error, metadata);
}
