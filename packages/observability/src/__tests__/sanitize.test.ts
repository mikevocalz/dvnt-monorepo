/**
 * @dvnt/observability — Sanitization / redaction tests
 *
 * Verifies that sensitive data is never sent to Sentry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  sanitizeForSentry,
  sanitizeValue,
  sanitizeHeaders,
  createBeforeSend,
  deriveFingerprintKey,
  isEventClamped,
  resetFingerprintClamp,
} from '../sanitize';

describe('sanitizeValue', () => {
  it('redacts password fields', () => {
    expect(sanitizeValue('password', 'my-secret-pass')).toBe('[REDACTED]');
  });

  it('redacts token fields', () => {
    expect(sanitizeValue('accessToken', 'eyJhbGci...')).toBe('[REDACTED]');
    expect(sanitizeValue('access_token', 'eyJhbGci...')).toBe('[REDACTED]');
    expect(sanitizeValue('refreshToken', 'rt_xyz')).toBe('[REDACTED]');
    expect(sanitizeValue('refresh_token', 'rt_xyz')).toBe('[REDACTED]');
  });

  it('redacts authorization headers', () => {
    expect(sanitizeValue('authorization', 'Bearer xyz')).toBe('[REDACTED]');
    expect(sanitizeValue('Authorization', 'Bearer xyz')).toBe('[REDACTED]');
  });

  it('redacts payment fields', () => {
    expect(sanitizeValue('cardNumber', '4242424242424242')).toBe('[REDACTED]');
    expect(sanitizeValue('cvv', '123')).toBe('[REDACTED]');
    expect(sanitizeValue('clientSecret', 'pi_xxx_secret_yyy')).toBe('[REDACTED]');
    expect(sanitizeValue('ephemeralKey', 'ek_test_xxx')).toBe('[REDACTED]');
  });

  it('redacts phone numbers', () => {
    expect(sanitizeValue('phoneNumber', '+1234567890')).toBe('[REDACTED]');
    expect(sanitizeValue('phone_number', '+1234567890')).toBe('[REDACTED]');
  });

  it('redacts DM text', () => {
    expect(sanitizeValue('messageBody', 'Hey what are you up to?')).toBe('[REDACTED]');
    expect(sanitizeValue('message_body', 'Hey!')).toBe('[REDACTED]');
    expect(sanitizeValue('dmText', 'private message')).toBe('[REDACTED]');
    expect(sanitizeValue('body', 'text content')).toBe('[REDACTED]');
  });

  it('redacts private report notes', () => {
    expect(sanitizeValue('privateNotes', 'moderator notes')).toBe('[REDACTED]');
    expect(sanitizeValue('private_notes', 'internal notes')).toBe('[REDACTED]');
    expect(sanitizeValue('reportNotes', 'details')).toBe('[REDACTED]');
  });

  it('redacts signed URLs', () => {
    expect(sanitizeValue('signedUrl', 'https://storage.example.com/file?token=abc')).toBe('[REDACTED]');
    expect(sanitizeValue('signed_url', 'https://cdn.example.com/img.png?sig=xyz')).toBe('[REDACTED]');
    expect(sanitizeValue('mediaUrl', 'https://private.example.com/video.mp4')).toBe('[REDACTED]');
  });

  it('masks email addresses', () => {
    const result = sanitizeValue('email', 'john.doe@gmail.com');
    expect(result).not.toBe('john.doe@gmail.com');
    expect(result).toContain('@gmail.com');
    expect(result).toContain('*');
  });

  it('preserves safe domain emails', () => {
    expect(sanitizeValue('email', 'admin@dvntapp.live')).toBe('admin@dvntapp.live');
    expect(sanitizeValue('email', 'support@dvnt.app')).toBe('support@dvnt.app');
  });

  it('passes through safe string values', () => {
    expect(sanitizeValue('username', 'cooluser123')).toBe('cooluser123');
    expect(sanitizeValue('screen', '/feed')).toBe('/feed');
    expect(sanitizeValue('route', '/(protected)/messages')).toBe('/(protected)/messages');
  });

  it('passes through numbers and booleans', () => {
    expect(sanitizeValue('count', 42)).toBe(42);
    expect(sanitizeValue('enabled', true)).toBe(true);
  });

  it('truncates very long strings', () => {
    const longString = 'a'.repeat(3000);
    const result = sanitizeValue('description', longString) as string;
    expect(result.length).toBeLessThan(3000);
    expect(result).toContain('…[TRUNCATED]');
  });

  it('redacts URLs with token params', () => {
    const url = 'https://npfjanxturvmjyevoyfo.supabase.co/storage/v1/object/sign/uploads/photo.jpg?token=abc123';
    const result = sanitizeValue('imageUrl', url) as string;
    expect(result).not.toContain('abc123');
  });
});

describe('sanitizeForSentry', () => {
  it('recursively sanitizes objects', () => {
    const input = {
      userId: 'user_123',
      password: 'secret',
      profile: {
        name: 'Test User',
        phoneNumber: '+1234567890',
      },
      tokens: {
        accessToken: 'at_xxx',
        refreshToken: 'rt_yyy',
      },
    };

    const result = sanitizeForSentry(input);
    expect(result.userId).toBe('user_123');
    expect(result.password).toBe('[REDACTED]');
    // §2.4 identity denylist: `name` is redacted since PROMPT NN.
    expect((result.profile as any).name).toBe('[REDACTED]');
    expect((result.profile as any).phoneNumber).toBe('[REDACTED]');
    expect((result.tokens as any).accessToken).toBe('[REDACTED]');
    expect((result.tokens as any).refreshToken).toBe('[REDACTED]');
  });
});

describe('sanitizeHeaders', () => {
  it('redacts auth headers', () => {
    const headers = {
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9',
      'Cookie': 'session=abc123',
      'Content-Type': 'application/json',
      'X-Request-Id': 'req_xyz',
    };

    const result = sanitizeHeaders(headers);
    expect(result['Authorization']).toBe('[REDACTED]');
    expect(result['Cookie']).toBe('[REDACTED]');
    expect(result['Content-Type']).toBe('application/json');
    expect(result['X-Request-Id']).toBe('req_xyz');
  });
});

describe('createBeforeSend', () => {
  it('sanitizes event request data', () => {
    const beforeSend = createBeforeSend();
    const event = {
      request: {
        headers: { Authorization: 'Bearer xxx' },
        data: { password: 'secret', username: 'test' },
        cookies: 'session=abc',
      },
    };

    const result = beforeSend(event);
    expect(result.request.headers.Authorization).toBe('[REDACTED]');
    expect(result.request.data.password).toBe('[REDACTED]');
    expect(result.request.data.username).toBe('test');
    expect(result.request.cookies).toBe('[REDACTED]');
  });

  it('sanitizes breadcrumbs', () => {
    const beforeSend = createBeforeSend();
    const event = {
      breadcrumbs: [
        { category: 'http', data: { token: 'secret_value', url: '/api/users' } },
      ],
    };

    const result = beforeSend(event);
    expect(result.breadcrumbs[0].data.token).toBe('[REDACTED]');
    expect(result.breadcrumbs[0].data.url).toBe('/api/users');
  });

  it('masks user email', () => {
    const beforeSend = createBeforeSend();
    const event = {
      user: { id: '123', email: 'test@example.com' },
    };

    const result = beforeSend(event);
    expect(result.user.email).not.toBe('test@example.com');
    expect(result.user.email).toContain('@example.com');
    expect(result.user.id).toBe('123');
  });

  it('does not mask safe domain emails', () => {
    const beforeSend = createBeforeSend();
    const event = {
      user: { id: '123', email: 'admin@dvntapp.live' },
    };

    const result = beforeSend(event);
    expect(result.user.email).toBe('admin@dvntapp.live');
  });
});

// Budget clamp: after N events sharing a derived fingerprint in one session,
// the rest are dropped client-side + one summary breadcrumb is emitted.
describe('per-session fingerprint clamp', () => {
  beforeEach(() => {
    resetFingerprintClamp();
  });

  function errorEvent(
    type: string,
    value: string,
    frames: Array<{ filename?: string; function?: string }> = [
      { filename: 'app.js', function: 'outer' },
      { filename: 'app.js', function: 'boom' },
    ],
  ) {
    return {
      exception: {
        values: [{ type, value, stacktrace: { frames } }],
      },
    };
  }

  it('derives a deterministic key from type + message + top (last) frame', () => {
    const key = deriveFingerprintKey(errorEvent('TypeError', 'x is not a function'));
    expect(key).toBe('TypeError|x is not a function|app.js:boom');
    expect(deriveFingerprintKey(errorEvent('TypeError', 'x is not a function'))).toBe(key);
    expect(deriveFingerprintKey({ message: 'plain message' })).toBe('Error|plain message|noframe');
  });

  it('passes the first N events, drops every one after', () => {
    const beforeSend = createBeforeSend();
    for (let i = 0; i < 5; i++) {
      expect(beforeSend(errorEvent('TypeError', 'x is not a function'))).not.toBeNull();
    }
    expect(beforeSend(errorEvent('TypeError', 'x is not a function'))).toBeNull();
    expect(beforeSend(errorEvent('TypeError', 'x is not a function'))).toBeNull();
  });

  it('counts fingerprints independently', () => {
    const beforeSend = createBeforeSend();
    for (let i = 0; i < 6; i++) beforeSend(errorEvent('TypeError', 'x is not a function'));
    // A different bug is unaffected by the clamped one.
    expect(beforeSend(errorEvent('RangeError', 'out of bounds'))).not.toBeNull();
  });

  it('respects a configurable limit', () => {
    const beforeSend = createBeforeSend({ clampLimit: 2 });
    expect(beforeSend(errorEvent('TypeError', 'x is not a function'))).not.toBeNull();
    expect(beforeSend(errorEvent('TypeError', 'x is not a function'))).not.toBeNull();
    expect(beforeSend(errorEvent('TypeError', 'x is not a function'))).toBeNull();
  });

  it('emits ONE summary breadcrumb on the next event that goes out', () => {
    const beforeSend = createBeforeSend({ clampLimit: 1 });
    beforeSend(errorEvent('TypeError', 'x is not a function'));
    beforeSend(errorEvent('TypeError', 'x is not a function')); // dropped → queues crumb
    beforeSend(errorEvent('TypeError', 'x is not a function')); // dropped → no second crumb

    const next = beforeSend(errorEvent('RangeError', 'out of bounds'));
    const crumbs = next.breadcrumbs.filter((c: any) => c.category === 'observability.clamp');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].message).toBe(
      'clamped fingerprint TypeError|x is not a function|app.js:boom after 1 events',
    );

    // Delivered once — the following event carries no clamp breadcrumb.
    const after = beforeSend(errorEvent('SyntaxError', 'unexpected token'));
    expect(after.breadcrumbs ?? []).toHaveLength(0);
  });

  it('reports clamped fingerprints via isEventClamped (replay gating)', () => {
    const beforeSend = createBeforeSend({ clampLimit: 1 });
    const event = errorEvent('TypeError', 'x is not a function');
    expect(isEventClamped(event)).toBe(false);
    beforeSend(errorEvent('TypeError', 'x is not a function'));
    expect(isEventClamped(event)).toBe(false);
    beforeSend(errorEvent('TypeError', 'x is not a function')); // over budget
    expect(isEventClamped(event)).toBe(true);
  });

  it('never clamps events without an exception or message', () => {
    const beforeSend = createBeforeSend({ clampLimit: 1 });
    for (let i = 0; i < 10; i++) {
      expect(beforeSend({ request: { data: { screen: '/feed' } } })).not.toBeNull();
    }
  });

  it('never clamps transactions', () => {
    const beforeSend = createBeforeSend({ clampLimit: 1 });
    for (let i = 0; i < 10; i++) {
      expect(beforeSend({ type: 'transaction', message: 'same' })).not.toBeNull();
    }
  });
});

// §2.4 acceptance: a poisoned event with email + hiv_status arrives stripped.
describe('§2.4 identity denylist', () => {
  it('strips demographic/identity keys and patterns', () => {
    const result = sanitizeForSentry({
      email: 'person@example.com',
      hiv_status: 'positive',
      gender: 'x',
      pronouns: 'they/them',
      sexuality: ['Queer'],
      eventAudience: 'Everyone',
      date_of_birth: '1990-01-01',
      surveyAnswers: { q1: 'yes' },
      id_image_url: 'https://cdn/x.png',
      safeCount: 3,
    });
    expect(result.hiv_status).toBe('[REDACTED]');
    expect(result.gender).toBe('[REDACTED]');
    expect(result.pronouns).toBe('[REDACTED]');
    expect(result.sexuality).toBe('[REDACTED]');
    expect(result.eventAudience).toBe('[REDACTED]');
    expect(result.date_of_birth).toBe('[REDACTED]');
    expect(result.surveyAnswers).toBe('[REDACTED]');
    expect(result.id_image_url).toBe('[REDACTED]');
    expect(String(result.email)).not.toContain('person@example.com');
    expect(result.safeCount).toBe(3);
  });
});
