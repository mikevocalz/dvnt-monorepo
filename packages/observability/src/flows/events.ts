/**
 * @dvnt/observability — Events, RSVP, tickets, QR flow instrumentation
 */

import { addSentryBreadcrumb } from '../breadcrumbs';
import { captureFlowFailure } from '../capture';
import { createTimer } from '../spans';

// ─── Event Open ──────────────────────────────────────────────────────────────

export function eventOpenStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('event.open', 'event.open.started', metadata);
  return createTimer('event.open', 'events');
}

export function eventOpenSuccess(durationMs?: number) {
  addSentryBreadcrumb('event.open', 'event.open.success', { durationMs });
}

export function eventOpenFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('event.open', 'event.open.failure', metadata, 'error');
  captureFlowFailure('event', 'open', error, metadata);
}

// ─── RSVP ────────────────────────────────────────────────────────────────────

export function eventRsvpStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('event.rsvp', 'event.rsvp.started', metadata);
  return createTimer('event.rsvp', 'events');
}

export function eventRsvpSuccess(durationMs?: number) {
  addSentryBreadcrumb('event.rsvp', 'event.rsvp.success', { durationMs });
}

export function eventRsvpFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('event.rsvp', 'event.rsvp.failure', metadata, 'error');
  captureFlowFailure('event', 'rsvp', error, metadata);
}

// ─── Ticket Checkout ─────────────────────────────────────────────────────────

export function ticketCheckoutStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('ticket.checkout', 'ticket.checkout.started', metadata);
  return createTimer('ticket.checkout', 'checkout');
}

export function ticketCheckoutSuccess(durationMs?: number) {
  addSentryBreadcrumb('ticket.checkout', 'ticket.checkout.success', { durationMs });
}

export function ticketCheckoutFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('ticket.checkout', 'ticket.checkout.failure', metadata, 'error');
  captureFlowFailure('ticket', 'checkout', error, metadata);
}

// ─── QR Scanning ─────────────────────────────────────────────────────────────

export function qrScanStarted(metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('qr.scan', 'qr.scan.started', metadata);
  return createTimer('qr.scan', 'qr');
}

export function qrScanSuccess(durationMs?: number) {
  addSentryBreadcrumb('qr.scan', 'qr.scan.success', { durationMs });
}

export function qrScanFailure(error: unknown, metadata?: Record<string, unknown>) {
  addSentryBreadcrumb('qr.scan', 'qr.scan.failure', metadata, 'error');
  captureFlowFailure('qr', 'scan', error, metadata);
}
