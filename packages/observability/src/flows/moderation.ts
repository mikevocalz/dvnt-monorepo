/**
 * @dvnt/observability — Moderation / trust & safety flow instrumentation
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureFlowFailure, captureModerationDebugEvent } from '../capture';
import { createTimer } from '../spans';
import type { ModerationDebugContext } from '../types';

const FLOW = 'moderation';

// ─── Report Submit ───────────────────────────────────────────────────────────

export function reportSubmitStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('report.submit', 'report.submit.started', metadata);
  return createTimer('report.submit', 'trust-safety');
}

export function reportSubmitSuccess(durationMs?: number) {
  addSentryBreadcrumb('report.submit', 'report.submit.success', { durationMs });
}

export function reportSubmitFailure(error: unknown, ctx?: ModerationDebugContext) {
  addSentryBreadcrumb('report.submit', 'report.submit.failure', undefined, 'error');
  captureModerationDebugEvent({ ...ctx, actionType: 'report_submit', error });
}

// ─── Block User ──────────────────────────────────────────────────────────────

export function blockUserStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('block.user', 'block.user.started', metadata);
  return createTimer('block.user', 'trust-safety');
}

export function blockUserSuccess(durationMs?: number) {
  addSentryBreadcrumb('block.user', 'block.user.success', { durationMs });
}

export function blockUserFailure(error: unknown, ctx?: ModerationDebugContext) {
  addSentryBreadcrumb('block.user', 'block.user.failure', undefined, 'error');
  captureModerationDebugEvent({ ...ctx, actionType: 'block_user', error });
}

// ─── Unblock User ────────────────────────────────────────────────────────────

export function unblockUserStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('unblock.user', 'unblock.user.started', metadata);
  return createTimer('unblock.user', 'trust-safety');
}

export function unblockUserSuccess(durationMs?: number) {
  addSentryBreadcrumb('unblock.user', 'unblock.user.success', { durationMs });
}

export function unblockUserFailure(error: unknown, ctx?: ModerationDebugContext) {
  addSentryBreadcrumb('unblock.user', 'unblock.user.failure', undefined, 'error');
  captureModerationDebugEvent({ ...ctx, actionType: 'unblock_user', error });
}

// ─── Moderation Action (admin) ───────────────────────────────────────────────

export function moderationActionStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.action`, 'moderation.action.started', metadata);
  return createTimer('moderation.action', 'trust-safety');
}

export function moderationActionSuccess(ctx?: ModerationDebugContext) {
  addSentryBreadcrumb(`${FLOW}.action`, 'moderation.action.success');
  if (ctx) {
    captureModerationDebugEvent({ ...ctx, level: 'info' });
  }
}

export function moderationActionFailure(error: unknown, ctx?: ModerationDebugContext) {
  addSentryBreadcrumb(`${FLOW}.action`, 'moderation.action.failure', undefined, 'error');
  captureModerationDebugEvent({ ...ctx, actionType: ctx?.actionType ?? 'moderation_action', error });
}
