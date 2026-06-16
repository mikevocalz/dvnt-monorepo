/**
 * @dvnt/observability — Capture utilities tests
 *
 * Verifies flow failures, message errors, and media errors are captured correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  captureHandledError,
  captureFlowFailure,
  captureMessageFlowFailure,
  captureMediaFailure,
  captureSneakyLinkFailure,
  captureModerationDebugEvent,
  captureApiError,
  setSentryInstance,
} from '../capture';
import type { SentrySDK } from '../types';

function createMockSentry() {
  const captured: any[] = [];
  const scopes: any[] = [];

  const mockSentry: SentrySDK = {
    captureException(err) { captured.push({ type: 'exception', err }); return 'eid'; },
    captureMessage(msg, level) { captured.push({ type: 'message', msg, level }); return 'eid'; },
    addBreadcrumb(crumb) {},
    setUser() {},
    setTag() {},
    setTags() {},
    setExtra() {},
    setContext() {},
    withScope(cb) {
      const scope = {
        tags: {} as Record<string, string>,
        extras: {} as Record<string, any>,
        contexts: {} as Record<string, any>,
        level: 'error' as string,
        setTag(k: string, v: string) { scope.tags[k] = v; },
        setLevel(l: string) { scope.level = l; },
        setExtra(k: string, v: any) { scope.extras[k] = v; },
        setContext(name: string, ctx: any) { scope.contexts[name] = ctx; },
      };
      scopes.push(scope);
      cb(scope);
    },
  };

  return { sentry: mockSentry, captured, scopes };
}

describe('captureHandledError', () => {
  let mock: ReturnType<typeof createMockSentry>;

  beforeEach(() => {
    mock = createMockSentry();
    setSentryInstance(mock.sentry);
  });

  it('captures error with feature area tag', () => {
    const error = new Error('Test error');
    captureHandledError(error, { featureArea: 'auth', route: '/login' });

    expect(mock.captured.length).toBe(1);
    expect(mock.captured[0].type).toBe('exception');
    expect(mock.scopes[0].tags.featureArea).toBe('auth');
    expect(mock.scopes[0].tags.route).toBe('/login');
  });

  it('sanitizes extra data', () => {
    captureHandledError(new Error('test'), {
      featureArea: 'messaging',
      extra: { threadId: 'th_123', messageBody: 'should be redacted' },
    });

    expect(mock.scopes[0].extras.threadId).toBe('th_123');
    expect(mock.scopes[0].extras.messageBody).toBe('[REDACTED]');
  });
});

describe('captureFlowFailure', () => {
  let mock: ReturnType<typeof createMockSentry>;

  beforeEach(() => {
    mock = createMockSentry();
    setSentryInstance(mock.sentry);
  });

  it('tags flow name and step', () => {
    captureFlowFailure('auth', 'login', new Error('Invalid creds'));

    expect(mock.scopes[0].tags.flow).toBe('auth');
    expect(mock.scopes[0].tags['flow.step']).toBe('login');
    expect(mock.scopes[0].tags['error.type']).toBe('flow_failure');
  });

  it('sets flow context', () => {
    captureFlowFailure('messaging', 'inbox_load', new Error('timeout'), { screen: '/messages' });

    expect(mock.scopes[0].contexts.flow_failure.flow).toBe('messaging');
    expect(mock.scopes[0].contexts.flow_failure.step).toBe('inbox_load');
    expect(mock.scopes[0].contexts.flow_failure.screen).toBe('/messages');
  });
});

describe('captureMessageFlowFailure', () => {
  let mock: ReturnType<typeof createMockSentry>;

  beforeEach(() => {
    mock = createMockSentry();
    setSentryInstance(mock.sentry);
  });

  it('tags as messaging feature area', () => {
    captureMessageFlowFailure(new Error('route failed'), {
      route: '/(protected)/messages',
      queryName: 'route_transition',
    });

    expect(mock.scopes[0].tags.featureArea).toBe('messaging');
    expect(mock.scopes[0].tags['error.type']).toBe('message_flow_failure');
    expect(mock.scopes[0].tags.route).toBe('/(protected)/messages');
    expect(mock.scopes[0].tags['query.name']).toBe('route_transition');
  });

  it('includes context without leaking message body', () => {
    captureMessageFlowFailure(new Error('send failed'), {
      threadId: 'thread_abc',
      recipientId: 'user_xyz',
      networkStatus: 'online',
    });

    const ctx = mock.scopes[0].contexts.message_flow_failure;
    expect(ctx.threadId).toBe('thread_abc');
    expect(ctx.recipientId).toBe('user_xyz');
    expect(ctx.networkStatus).toBe('online');
    // No message body should ever appear
    expect(JSON.stringify(ctx)).not.toContain('messageBody');
    expect(JSON.stringify(ctx)).not.toContain('message_body');
  });
});

describe('captureMediaFailure', () => {
  let mock: ReturnType<typeof createMockSentry>;

  beforeEach(() => {
    mock = createMockSentry();
    setSentryInstance(mock.sentry);
  });

  it('tags media type and operation', () => {
    captureMediaFailure(new Error('upload timeout'), {
      mediaType: 'video',
      operation: 'upload',
      fileSize: 15_000_000,
    });

    expect(mock.scopes[0].tags.featureArea).toBe('media');
    expect(mock.scopes[0].tags['media.type']).toBe('video');
    expect(mock.scopes[0].tags['media.operation']).toBe('upload');
  });
});

describe('captureSneakyLinkFailure', () => {
  let mock: ReturnType<typeof createMockSentry>;

  beforeEach(() => {
    mock = createMockSentry();
    setSentryInstance(mock.sentry);
  });

  it('tags sneaky link operation', () => {
    captureSneakyLinkFailure(new Error('WebRTC failed'), {
      operation: 'connect',
      roomId: 'room_123',
      participantCount: 2,
    });

    expect(mock.scopes[0].tags.featureArea).toBe('sneaky-link');
    expect(mock.scopes[0].tags['sneaky_link.operation']).toBe('connect');
  });
});

describe('captureApiError', () => {
  let mock: ReturnType<typeof createMockSentry>;

  beforeEach(() => {
    mock = createMockSentry();
    setSentryInstance(mock.sentry);
  });

  it('captures Payload API errors with collection tag', () => {
    captureApiError(new Error('500 Internal Server Error'), {
      endpoint: '/api/posts',
      method: 'GET',
      queryName: 'fetch_posts',
      statusCode: 500,
      durationMs: 3200,
      collection: 'posts',
      featureArea: 'blog',
    });

    expect(mock.scopes[0].tags['api.endpoint']).toBe('/api/posts');
    expect(mock.scopes[0].tags['api.method']).toBe('GET');
    expect(mock.scopes[0].tags['api.statusCode']).toBe('500');
    expect(mock.scopes[0].tags['api.collection']).toBe('posts');
    expect(mock.scopes[0].tags.featureArea).toBe('blog');
  });
});

describe('captureModerationDebugEvent', () => {
  let mock: ReturnType<typeof createMockSentry>;

  beforeEach(() => {
    mock = createMockSentry();
    setSentryInstance(mock.sentry);
  });

  it('captures moderation action without private notes', () => {
    captureModerationDebugEvent({
      actionType: 'suspend_user',
      targetUserId: 'user_bad',
      moderatorId: 'mod_123',
      reportReason: 'harassment',
    });

    expect(mock.scopes[0].tags.featureArea).toBe('trust-safety');
    expect(mock.scopes[0].tags['moderation.action']).toBe('suspend_user');
    const ctx = mock.scopes[0].contexts.moderation_debug;
    expect(ctx.targetUserId).toBe('user_bad');
    expect(ctx.moderatorId).toBe('mod_123');
    // Ensure no private notes
    expect(JSON.stringify(ctx)).not.toContain('privateNotes');
    expect(JSON.stringify(ctx)).not.toContain('private_notes');
  });
});
