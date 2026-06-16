/**
 * @dvnt/observability — Messaging flow instrumentation
 *
 * CRITICAL: This is the most important flow to instrument because
 * the App Store rejection involved the Message button.
 *
 * Never captures actual message text.
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureFlowFailure, captureMessageFlowFailure } from '../capture';
import { createTimer } from '../spans';
import type { MessageFlowFailureContext } from '../types';

const FLOW = 'messaging';

// ─── Message Button Tap ──────────────────────────────────────────────────────

export function messageButtonTap(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('message.button', 'message.button.tap', metadata);
}

// ─── Auth Check ──────────────────────────────────────────────────────────────

export function messageAuthCheckStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.auth`, 'message.auth.check.started', metadata);
  return createTimer('message.auth.check', 'messaging');
}

export function messageAuthCheckSuccess() {
  addSentryBreadcrumb(`${FLOW}.auth`, 'message.auth.check.success');
}

export function messageAuthCheckFailure(error: unknown, ctx?: MessageFlowFailureContext) {
  addSentryBreadcrumb(`${FLOW}.auth`, 'message.auth.check.failure', undefined, 'error');
  captureMessageFlowFailure(error, { ...ctx, queryName: 'auth_check' });
}

// ─── Route Transition ────────────────────────────────────────────────────────

export function messagesRouteTransitionStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.route`, 'messages.route.transition.started', metadata);
  return createTimer('messages.route.transition', 'messaging');
}

export function messagesRouteTransitionSuccess() {
  addSentryBreadcrumb(`${FLOW}.route`, 'messages.route.transition.success');
}

export function messagesRouteTransitionFailure(error: unknown, ctx?: MessageFlowFailureContext) {
  addSentryBreadcrumb(`${FLOW}.route`, 'messages.route.transition.failure', undefined, 'error');
  captureMessageFlowFailure(error, { ...ctx, queryName: 'route_transition' });
}

// ─── Inbox Query ─────────────────────────────────────────────────────────────

export function inboxQueryStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.inbox`, 'inbox.query.started', metadata);
  return createTimer('inbox.query', 'messaging');
}

export function inboxQuerySuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.inbox`, 'inbox.query.success', { durationMs });
}

export function inboxQueryFailure(error: unknown, ctx?: MessageFlowFailureContext) {
  addSentryBreadcrumb(`${FLOW}.inbox`, 'inbox.query.failure', undefined, 'error');
  captureMessageFlowFailure(error, { ...ctx, queryName: 'inbox_query' });
}

// ─── Spam Query ──────────────────────────────────────────────────────────────

export function spamQueryStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.spam`, 'spam.query.started', metadata);
  return createTimer('spam.query', 'messaging');
}

export function spamQuerySuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.spam`, 'spam.query.success', { durationMs });
}

export function spamQueryFailure(error: unknown, ctx?: MessageFlowFailureContext) {
  addSentryBreadcrumb(`${FLOW}.spam`, 'spam.query.failure', undefined, 'error');
  captureMessageFlowFailure(error, { ...ctx, queryName: 'spam_query' });
}

// ─── DM Thread Open ──────────────────────────────────────────────────────────

export function dmThreadOpenStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.thread`, 'dm.thread.open.started', metadata);
  return createTimer('dm.thread.open', 'messaging');
}

export function dmThreadOpenSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.thread`, 'dm.thread.open.success', { durationMs });
}

export function dmThreadOpenFailure(error: unknown, ctx?: MessageFlowFailureContext) {
  addSentryBreadcrumb(`${FLOW}.thread`, 'dm.thread.open.failure', undefined, 'error');
  captureMessageFlowFailure(error, { ...ctx, queryName: 'dm_thread_open' });
}

// ─── DM Message Send ─────────────────────────────────────────────────────────

export function dmMessageSendStarted(metadata?: Record<string, unknown>) {
  // Never include message text in metadata
  const safeMeta = metadata ? { ...metadata } : undefined;
  if (safeMeta) {
    delete safeMeta['body'];
    delete safeMeta['text'];
    delete safeMeta['content'];
    delete safeMeta['message'];
  }
  addSentryBreadcrumb(`${FLOW}.send`, 'dm.message.send.started', safeMeta);
  return createTimer('dm.message.send', 'messaging');
}

export function dmMessageSendSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.send`, 'dm.message.send.success', { durationMs });
}

export function dmMessageSendFailure(error: unknown, ctx?: MessageFlowFailureContext) {
  addSentryBreadcrumb(`${FLOW}.send`, 'dm.message.send.failure', undefined, 'error');
  captureMessageFlowFailure(error, { ...ctx, queryName: 'dm_message_send' });
}

// ─── Notification Deep Link ──────────────────────────────────────────────────

export function notificationDmDeepLinkStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.deep_link`, 'notification.dm.deep_link.started', metadata);
  return createTimer('notification.dm.deep_link', 'messaging');
}

export function notificationDmDeepLinkSuccess() {
  addSentryBreadcrumb(`${FLOW}.deep_link`, 'notification.dm.deep_link.success');
}

export function notificationDmDeepLinkFailure(error: unknown, ctx?: MessageFlowFailureContext) {
  addSentryBreadcrumb(`${FLOW}.deep_link`, 'notification.dm.deep_link.failure', undefined, 'error');
  captureMessageFlowFailure(error, { ...ctx, queryName: 'notification_dm_deep_link' });
}
