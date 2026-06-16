/**
 * @dvnt/observability — User context tests
 *
 * Verifies user identification and clearing works correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { identifySentryUser, clearSentryUser, setSentryInstance } from '../user';
import type { SentrySDK, SentryUserContext } from '../types';

function createMockSentry(): SentrySDK & { calls: Record<string, any[]> } {
  const calls: Record<string, any[]> = {
    setUser: [],
    setTags: [],
    setTag: [],
    setContext: [],
    setExtra: [],
    addBreadcrumb: [],
    captureException: [],
    captureMessage: [],
    withScope: [],
  };

  return {
    calls,
    setUser(user) { calls.setUser.push(user); return ''; },
    setTags(tags) { calls.setTags.push(tags); },
    setTag(key, value) { calls.setTag.push([key, value]); },
    setContext(name, ctx) { calls.setContext.push([name, ctx]); },
    setExtra(key, value) { calls.setExtra.push([key, value]); },
    addBreadcrumb(crumb) { calls.addBreadcrumb.push(crumb); },
    captureException(err) { calls.captureException.push(err); return 'event-id'; },
    captureMessage(msg) { calls.captureMessage.push(msg); return 'event-id'; },
    withScope(cb) { calls.withScope.push(cb); cb({ setTag: vi.fn(), setLevel: vi.fn(), setExtra: vi.fn(), setContext: vi.fn() }); },
  };
}

describe('identifySentryUser', () => {
  let mockSentry: ReturnType<typeof createMockSentry>;

  beforeEach(() => {
    mockSentry = createMockSentry();
    setSentryInstance(mockSentry);
  });

  it('sets user id and username', () => {
    const user: SentryUserContext = {
      id: 'user_abc123',
      username: 'cooluser',
      role: 'user',
      accountStatus: 'active',
      appVersion: '1.0.0',
      buildNumber: '42',
      platform: 'ios',
    };

    identifySentryUser(user);

    expect(mockSentry.calls.setUser[0]).toEqual({
      id: 'user_abc123',
      username: 'cooluser',
    });
  });

  it('sets user-level tags', () => {
    identifySentryUser({
      id: 'user_123',
      role: 'admin',
      accountStatus: 'active',
      appVersion: '1.0.0',
      buildNumber: '42',
      expoUpdateId: 'update_xyz',
      updateChannel: 'production',
      platform: 'ios',
      deviceModel: 'iPhone 15 Pro',
      osVersion: '18.0',
    });

    const tags = mockSentry.calls.setTags[0];
    expect(tags.userRole).toBe('admin');
    expect(tags.accountStatus).toBe('active');
    expect(tags.appVersion).toBe('1.0.0');
    expect(tags.buildNumber).toBe('42');
    expect(tags.expoUpdateId).toBe('update_xyz');
    expect(tags.updateChannel).toBe('production');
    expect(tags.platform).toBe('ios');
    expect(tags.deviceModel).toBe('iPhone 15 Pro');
    expect(tags.osVersion).toBe('18.0');
  });

  it('sets structured context', () => {
    identifySentryUser({
      id: 'user_456',
      username: 'testuser',
      role: 'moderator',
    });

    const [name, ctx] = mockSentry.calls.setContext[0];
    expect(name).toBe('dvnt_user');
    expect(ctx.id).toBe('user_456');
    expect(ctx.username).toBe('testuser');
    expect(ctx.role).toBe('moderator');
  });

  it('never includes sensitive data', () => {
    identifySentryUser({
      id: 'user_789',
      username: 'safeuser',
      role: 'user',
      appVersion: '1.0.0',
      buildNumber: '1',
      platform: 'android',
    });

    // Check no passwords, tokens, emails, etc in any call
    const allArgs = JSON.stringify(mockSentry.calls);
    expect(allArgs).not.toContain('password');
    expect(allArgs).not.toContain('token');
    expect(allArgs).not.toContain('email');
    expect(allArgs).not.toContain('phone');
  });
});

describe('clearSentryUser', () => {
  let mockSentry: ReturnType<typeof createMockSentry>;

  beforeEach(() => {
    mockSentry = createMockSentry();
    setSentryInstance(mockSentry);
  });

  it('clears user on logout', () => {
    identifySentryUser({ id: 'user_123', username: 'test' });
    clearSentryUser();

    // Should have called setUser(null)
    const lastSetUser = mockSentry.calls.setUser[mockSentry.calls.setUser.length - 1];
    expect(lastSetUser).toBeNull();
  });

  it('clears dvnt_user context', () => {
    identifySentryUser({ id: 'user_123' });
    clearSentryUser();

    const lastContext = mockSentry.calls.setContext[mockSentry.calls.setContext.length - 1];
    expect(lastContext[0]).toBe('dvnt_user');
    expect(lastContext[1]).toBeNull();
  });
});
