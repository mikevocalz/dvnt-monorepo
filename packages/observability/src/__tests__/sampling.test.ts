/**
 * @dvnt/observability — tracesSampler tests
 *
 * Locks the funnel policy: money/onboarding/lynk/upload → 1.0, chatty → 0,
 * everything else → 0.15. Both the server `"METHOD /route"` and client
 * `"/route"` name shapes must resolve identically.
 */

import { describe, it, expect } from 'vitest';
import {
  dvntTracesSampler,
  sampleRateForName,
  normalizeTransactionName,
  HIGH_VALUE_RATE,
  CHATTY_RATE,
  DEFAULT_RATE,
} from '../sampling';

describe('normalizeTransactionName', () => {
  it('strips the HTTP method prefix and lowercases', () => {
    expect(normalizeTransactionName('POST /api/Checkout/Session')).toBe('/api/checkout/session');
    expect(normalizeTransactionName('/Checkout')).toBe('/checkout');
  });
});

describe('sampleRateForName — high-value → 1.0', () => {
  const highValue = [
    '/checkout',
    'POST /api/checkout/session',
    '/checkout/success',
    'GET /api/purchases',
    '/onboarding/verification',
    'POST /api/verification/start',
    '/auth/signin',
    'GET /api/auth',
    '/sneaky-link/room/abc',
    'sneaky_link.join',
    'POST /api/media/upload',
    'media.upload',
  ];
  for (const name of highValue) {
    it(`samples "${name}" at 1.0`, () => {
      expect(sampleRateForName(name)).toBe(HIGH_VALUE_RATE);
    });
  }
});

describe('sampleRateForName — chatty → 0', () => {
  const chatty = [
    'GET /api/observability/probes',
    'GET /api/observability/sentry',
    '/health',
    'GET /healthz',
    'GET /.well-known/apple-app-site-association',
    '/api/feed/poll',
    'GET /presence',
    'POST /heartbeat',
  ];
  for (const name of chatty) {
    it(`samples "${name}" at 0`, () => {
      expect(sampleRateForName(name)).toBe(CHATTY_RATE);
    });
  }
});

describe('sampleRateForName — unmatched → null (caller applies default)', () => {
  it('returns null for generic routes', () => {
    expect(sampleRateForName('/feed')).toBeNull();
    expect(sampleRateForName('GET /api/comments')).toBeNull();
    expect(sampleRateForName('/settings/theme')).toBeNull();
    expect(sampleRateForName(undefined)).toBeNull();
  });
});

describe('dvntTracesSampler', () => {
  it('returns 1.0 for money paths', () => {
    expect(dvntTracesSampler({ name: 'POST /api/checkout/session' })).toBe(HIGH_VALUE_RATE);
  });

  it('returns 0 for health probes', () => {
    expect(dvntTracesSampler({ name: 'GET /api/observability/probes' })).toBe(CHATTY_RATE);
  });

  it('falls back to the default rate for unmatched routes', () => {
    expect(dvntTracesSampler({ name: '/feed' })).toBe(DEFAULT_RATE);
  });

  it('uses inheritOrSampleWith(default) when provided for unmatched routes', () => {
    const spy = (fallback: number) => fallback + 100; // sentinel to prove it's called
    expect(dvntTracesSampler({ name: '/feed', inheritOrSampleWith: spy })).toBe(DEFAULT_RATE + 100);
  });

  it('explicit rules ignore inheritOrSampleWith', () => {
    const spy = (fallback: number) => fallback + 100;
    expect(dvntTracesSampler({ name: '/checkout', inheritOrSampleWith: spy })).toBe(HIGH_VALUE_RATE);
    expect(dvntTracesSampler({ name: '/health', inheritOrSampleWith: spy })).toBe(CHATTY_RATE);
  });
});
