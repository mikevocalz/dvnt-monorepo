/**
 * @dvnt/observability — Sneaky Link (video room) flow instrumentation
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureSneakyLinkFailure } from '../capture';
import { createTimer } from '../spans';
import type { SneakyLinkFailureContext } from '../types';

const FLOW = 'sneaky_link';

// ─── Create ──────────────────────────────────────────────────────────────────

export function sneakyLinkCreateStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.create`, 'sneaky_link.create.started', metadata);
  return createTimer('sneaky_link.create', 'sneaky-link');
}

export function sneakyLinkCreateSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.create`, 'sneaky_link.create.success', { durationMs });
}

export function sneakyLinkCreateFailure(error: unknown, ctx?: SneakyLinkFailureContext) {
  addSentryBreadcrumb(`${FLOW}.create`, 'sneaky_link.create.failure', undefined, 'error');
  captureSneakyLinkFailure(error, { ...ctx, operation: 'create' });
}

// ─── Join ────────────────────────────────────────────────────────────────────

export function sneakyLinkJoinStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.join`, 'sneaky_link.join.started', metadata);
  return createTimer('sneaky_link.join', 'sneaky-link');
}

export function sneakyLinkJoinSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.join`, 'sneaky_link.join.success', { durationMs });
}

export function sneakyLinkJoinFailure(error: unknown, ctx?: SneakyLinkFailureContext) {
  addSentryBreadcrumb(`${FLOW}.join`, 'sneaky_link.join.failure', undefined, 'error');
  captureSneakyLinkFailure(error, { ...ctx, operation: 'join' });
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export function sneakyLinkCameraPermissionRequested() {
  addSentryBreadcrumb(`${FLOW}.permission`, 'sneaky_link.camera.permission.requested');
}

export function sneakyLinkCameraPermissionDenied() {
  addSentryBreadcrumb(`${FLOW}.permission`, 'sneaky_link.camera.permission.denied', undefined, 'warning');
}

export function sneakyLinkMicPermissionRequested() {
  addSentryBreadcrumb(`${FLOW}.permission`, 'sneaky_link.mic.permission.requested');
}

export function sneakyLinkMicPermissionDenied() {
  addSentryBreadcrumb(`${FLOW}.permission`, 'sneaky_link.mic.permission.denied', undefined, 'warning');
}

// ─── Face for Access ─────────────────────────────────────────────────────────

export function sneakyLinkFaceAccessStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.face_access`, 'sneaky_link.face_access.started', metadata);
  return createTimer('sneaky_link.face_access', 'sneaky-link');
}

export function sneakyLinkFaceAccessSuccess() {
  addSentryBreadcrumb(`${FLOW}.face_access`, 'sneaky_link.face_access.success');
}

export function sneakyLinkFaceAccessFailure(error: unknown, ctx?: SneakyLinkFailureContext) {
  addSentryBreadcrumb(`${FLOW}.face_access`, 'sneaky_link.face_access.failure', undefined, 'error');
  captureSneakyLinkFailure(error, { ...ctx, operation: 'face_access' });
}

// ─── Room Connection ─────────────────────────────────────────────────────────

export function sneakyLinkRoomConnected(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.room`, 'sneaky_link.room.connected', metadata);
}

export function sneakyLinkRoomDisconnected(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.room`, 'sneaky_link.room.disconnected', metadata, 'warning');
}

export function sneakyLinkRoomConnectionFailure(error: unknown, ctx?: SneakyLinkFailureContext) {
  addSentryBreadcrumb(`${FLOW}.room`, 'sneaky_link.room.connection_failure', undefined, 'error');
  captureSneakyLinkFailure(error, { ...ctx, operation: 'connect' });
}

// ─── Participant Events ──────────────────────────────────────────────────────

export function sneakyLinkParticipantBlocked(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.participant`, 'sneaky_link.participant.blocked', metadata);
}

export function sneakyLinkRoomReported(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.report`, 'sneaky_link.room.reported', metadata);
}
