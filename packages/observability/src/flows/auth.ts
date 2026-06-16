/**
 * @dvnt/observability — Auth flow instrumentation
 *
 * Tracks: login, signup, session restore, forgot password, logout
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureFlowFailure } from '../capture';
import { createTimer } from '../spans';

const FLOW = 'auth';

// ─── Login ───────────────────────────────────────────────────────────────────

export function authLoginStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.login`, 'auth.login.started', metadata);
  return createTimer('auth.login', 'auth');
}

export function authLoginSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.login`, 'auth.login.success', { durationMs });
}

export function authLoginFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.login`, 'auth.login.failure', metadata, 'error');
  captureFlowFailure(FLOW, 'login', error, metadata);
}

// ─── Signup ──────────────────────────────────────────────────────────────────

export function authSignupStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.signup`, 'auth.signup.started', metadata);
  return createTimer('auth.signup', 'auth');
}

export function authSignupSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.signup`, 'auth.signup.success', { durationMs });
}

export function authSignupFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.signup`, 'auth.signup.failure', metadata, 'error');
  captureFlowFailure(FLOW, 'signup', error, metadata);
}

// ─── Session Restore ─────────────────────────────────────────────────────────

export function authSessionRestoreStarted() {
  addSentryBreadcrumb(`${FLOW}.session`, 'auth.session.restore.started');
  return createTimer('auth.session.restore', 'auth');
}

export function authSessionRestoreSuccess(durationMs?: number) {
  addSentryBreadcrumb(`${FLOW}.session`, 'auth.session.restore.success', { durationMs });
}

export function authSessionRestoreFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb(`${FLOW}.session`, 'auth.session.restore.failure', metadata, 'error');
  captureFlowFailure(FLOW, 'session.restore', error, metadata);
}

// ─── Forgot Password ─────────────────────────────────────────────────────────

export function authForgotPasswordStarted() {
  addSentryBreadcrumb(`${FLOW}.forgot_password`, 'auth.forgot_password.started');
}

export function authForgotPasswordSuccess() {
  addSentryBreadcrumb(`${FLOW}.forgot_password`, 'auth.forgot_password.success');
}

export function authForgotPasswordFailure(error: unknown) {
  addSentryBreadcrumb(`${FLOW}.forgot_password`, 'auth.forgot_password.failure', undefined, 'error');
  captureFlowFailure(FLOW, 'forgot_password', error);
}

// ─── Logout ──────────────────────────────────────────────────────────────────

export function authLogout() {
  addSentryBreadcrumb(`${FLOW}.logout`, 'auth.logout');
}
