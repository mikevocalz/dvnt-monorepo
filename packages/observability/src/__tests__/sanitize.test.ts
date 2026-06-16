/**
 * @dvnt/observability — Sanitization / redaction tests
 *
 * Verifies that sensitive data is never sent to Sentry.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeForSentry,
  sanitizeValue,
  sanitizeHeaders,
  createBeforeSend,
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
    expect((result.profile as any).name).toBe('Test User');
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
