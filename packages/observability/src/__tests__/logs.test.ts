/**
 * @dvnt/observability — structured logs seam tests
 *
 * Verifies: routes to Sentry.logger when present, redacts attributes, and
 * degrades to a breadcrumb when the SDK has no logs surface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emitLog, logWebhookOutcome, logFunnelStep, setSentryInstance } from '../logs';
import type { SentrySDK } from '../types';

function createMockSentry(withLogger: boolean) {
  const logs: any[] = [];
  const breadcrumbs: any[] = [];

  const base: SentrySDK = {
    captureException() { return 'eid'; },
    captureMessage() { return 'eid'; },
    addBreadcrumb(crumb) { breadcrumbs.push(crumb); },
    setUser() {},
    setTag() {},
    setTags() {},
    setExtra() {},
    setContext() {},
    withScope() {},
  };

  if (withLogger) {
    base.logger = {
      trace(m, a) { logs.push({ level: 'trace', m, a }); },
      debug(m, a) { logs.push({ level: 'debug', m, a }); },
      info(m, a) { logs.push({ level: 'info', m, a }); },
      warn(m, a) { logs.push({ level: 'warn', m, a }); },
      error(m, a) { logs.push({ level: 'error', m, a }); },
      fatal(m, a) { logs.push({ level: 'fatal', m, a }); },
    };
  }

  return { sentry: base, logs, breadcrumbs };
}

describe('emitLog — with Sentry.logger present', () => {
  let mock: ReturnType<typeof createMockSentry>;
  beforeEach(() => {
    mock = createMockSentry(true);
    setSentryInstance(mock.sentry);
  });

  it('routes to the matching logger level', () => {
    emitLog('info', 'hello', { route: '/x' });
    expect(mock.logs).toHaveLength(1);
    expect(mock.logs[0].level).toBe('info');
    expect(mock.logs[0].m).toBe('hello');
    expect(mock.logs[0].a.route).toBe('/x');
    expect(mock.breadcrumbs).toHaveLength(0);
  });

  it('redacts sensitive attributes before logging', () => {
    emitLog('error', 'boom', { userId: 'u1', email: 'a@b.com', token: 'secret' });
    expect(mock.logs[0].a.userId).toBe('u1');
    expect(mock.logs[0].a.token).toBe('[REDACTED]');
    // email is masked (not raw) by the §2.4 scrubber
    expect(mock.logs[0].a.email).not.toBe('a@b.com');
  });

  it('drops sampled-out logs', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    emitLog('info', 'chatty', undefined, 0.1); // 0.9 > 0.1 → dropped
    expect(mock.logs).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe('emitLog — no logger surface (fallback)', () => {
  let mock: ReturnType<typeof createMockSentry>;
  beforeEach(() => {
    mock = createMockSentry(false);
    setSentryInstance(mock.sentry);
  });

  it('degrades to a breadcrumb', () => {
    emitLog('warn', 'no logs here', { a: 1 });
    expect(mock.logs).toHaveLength(0);
    expect(mock.breadcrumbs).toHaveLength(1);
    expect(mock.breadcrumbs[0].category).toBe('log');
    expect(mock.breadcrumbs[0].level).toBe('warning');
  });
});

describe('logWebhookOutcome', () => {
  let mock: ReturnType<typeof createMockSentry>;
  beforeEach(() => {
    mock = createMockSentry(true);
    setSentryInstance(mock.sentry);
  });

  it('logs ok at info, failed at error', () => {
    logWebhookOutcome('stripe', 'ok', { eventId: 'evt_1' });
    logWebhookOutcome('stripe', 'failed', { eventId: 'evt_2' });
    expect(mock.logs[0]).toMatchObject({ level: 'info', m: 'webhook.stripe.ok' });
    expect(mock.logs[0].a.outcome).toBe('ok');
    expect(mock.logs[1]).toMatchObject({ level: 'error', m: 'webhook.stripe.failed' });
  });
});

describe('logFunnelStep', () => {
  let mock: ReturnType<typeof createMockSentry>;
  beforeEach(() => {
    mock = createMockSentry(true);
    setSentryInstance(mock.sentry);
  });

  it('failures always log at error level', () => {
    logFunnelStep('checkout', 'confirm', 'failure', { orderId: 'o1' });
    expect(mock.logs).toHaveLength(1);
    expect(mock.logs[0].level).toBe('error');
    expect(mock.logs[0].m).toBe('checkout.confirm.failure');
    expect(mock.logs[0].a.stage).toBe('failure');
  });
});
