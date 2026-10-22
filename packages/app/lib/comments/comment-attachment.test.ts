import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const attachment = {
  provider: 'klipy', id: 'wave', url: 'https://static.klipy.com/wave.gif',
  previewUrl: 'https://static.klipy.com/wave.jpg', width: 320, height: 240, title: 'Wave',
};

// Execute production modules without the native app's runtime or dependencies.
function load(path: string, bindings: Record<string, unknown>, exposed: string) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = stripTypeScriptTypes(source)
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, '')
    .replace(/^export \{[^}]*\};?/gm, '')
    .replace(/\bexport /g, '');
  const context = { ...bindings, result: undefined, console };
  vm.runInNewContext(`${js}\nresult = ${exposed};`, context);
  return context.result as any;
}

function draftFixture() {
  let state: any;
  const create = (initialize: any) => {
    const set = (update: any) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
    state = initialize(set);
    return { getState: () => state };
  };
  return load('../stores/comment-draft-store.ts', { create }, 'useCommentDraftStore');
}

function authFixture() {
  let user: { id: string } | null = { id: 'actor-a' };
  const listeners = new Set<(state: any) => void>();
  return {
    getState: () => ({ user }),
    subscribe: (listener: (state: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    switchTo: (id: string | null) => { user = id ? { id } : null; for (const listener of listeners) listener({ user }); },
    listenerCount: () => listeners.size,
  };
}

test('GIF draft selection/removal invalidates submissions and reset clears it', () => {
  const draft = draftFixture();
  draft.getState().bindContext('post:1');
  const revision = draft.getState().revision;
  draft.getState().setAttachment(attachment);
  assert.equal(draft.getState().attachment, attachment);
  assert.equal(draft.getState().revision, revision + 1);
  draft.getState().setAttachment(null);
  assert.equal(draft.getState().attachment, null);
  assert.equal(draft.getState().revision, revision + 2);
  draft.getState().setAttachment(attachment);
  draft.getState().reset();
  assert.equal(draft.getState().attachment, null);
});

test('same context and reply cancellation retain GIF; changing thread clears it', () => {
  const draft = draftFixture();
  draft.getState().bindContext('post:1');
  draft.getState().setAttachment(attachment);
  const revision = draft.getState().revision;
  draft.getState().bindContext('post:1');
  assert.equal(draft.getState().revision, revision);
  draft.getState().setReplyTo(null);
  assert.equal(draft.getState().attachment, attachment);
  draft.getState().bindContext('post:2');
  assert.equal(draft.getState().attachment, null);
});

for (const root of ['..', '../../../../apps/mobile/lib']) {
  test(`${root}: loaded thread normalization retains root and reply GIF metadata`, () => {
    const normalize = load(`${root}/comments/threading.ts`, {}, 'buildTwoLevelCommentThreads');
    const comments = normalize([
      { id: '2', text: '', attachment },
      { id: '3', text: '', parentId: '2', rootId: '2', attachment },
    ]);
    assert.equal(comments[0].attachment, attachment);
    assert.equal(comments[0].replies[0].attachment, attachment);
  });

  test(`${root}: API forwards attachment metadata and preserves legacy text-only payloads`, async () => {
    const requests: any[] = [];
    const api = load(`${root}/api/comments.ts`, {
      useAuthStore: authFixture(),
      requireBetterAuthToken: async () => 'token',
      supabase: { functions: { invoke: async (_name: string, args: any) => {
        requests.push(args.body);
        return { data: { ok: true, data: { comment: { id: '1', attachment: args.body.attachment } } } };
      } } },
    }, 'commentsApi');
    const result = await api.createComment({ post: '1', text: '', parent: '2', replyToCommentId: '3', attachment });
    assert.equal(requests[0].attachment, attachment);
    assert.equal(requests[0].content, '');
    assert.equal(requests[0].parentId, 2);
    assert.equal(requests[0].replyToCommentId, 3);
    assert.equal(result.attachment, attachment);
    await api.createComment({ post: '1', text: 'Plain comment' });
    assert.equal(Object.hasOwn(requests[1], 'attachment'), false);
  });

  test(`${root}: expected actor mismatch rejects before fetching a token`, async () => {
    let fetched = false, dispatched = false;
    const auth = authFixture();
    const api = load(`${root}/api/comments.ts`, {
      useAuthStore: auth,
      requireBetterAuthToken: async () => { fetched = true; return 'token'; },
      supabase: { functions: { invoke: async () => { dispatched = true; } } },
    }, 'commentsApi');
    await assert.rejects(api.createComment({ post: '1', text: '', attachment, authorId: 'actor-b' }), /account changed/);
    assert.equal(fetched, false);
    assert.equal(dispatched, false);
    assert.equal(auth.listenerCount(), 0);
  });

  for (const explicitActor of [true, false]) {
    for (const switchBack of [true, false]) {
      test(`${root}: token refresh rejects account switch${switchBack ? ' and switch back' : ''}, explicit actor=${explicitActor}`, async () => {
        const auth = authFixture();
        let resolveToken!: (value: string) => void;
        let dispatched = false;
        const api = load(`${root}/api/comments.ts`, {
          useAuthStore: auth,
          requireBetterAuthToken: () => new Promise<string>(resolve => { resolveToken = resolve; }),
          supabase: { functions: { invoke: async () => { dispatched = true; } } },
        }, 'commentsApi');
        const pending = api.createComment({ post: '1', text: '', attachment, ...(explicitActor ? { authorId: 'actor-a' } : {}) });
        auth.switchTo('actor-b');
        if (switchBack) auth.switchTo('actor-a');
        resolveToken('refreshed-token');
        await assert.rejects(pending, /account changed/);
        assert.equal(dispatched, false);
        assert.equal(auth.listenerCount(), 0);
      });
    }
  }

  test(`${root}: rejected token refresh removes identity subscription`, async () => {
    const auth = authFixture();
    const api = load(`${root}/api/comments.ts`, {
      useAuthStore: auth,
      requireBetterAuthToken: async () => { throw new Error('Token unavailable'); },
    }, 'commentsApi');
    await assert.rejects(api.createComment({ post: '1', text: '', attachment }), /Token unavailable/);
    assert.equal(auth.listenerCount(), 0);
  });

  for (const switchBack of [false, true]) {
    test(`${root}: account switch${switchBack ? ' and back' : ''} during cancel cannot snapshot/write or dispatch`, async () => {
      const auth = authFixture();
      let finishCancel!: () => void;
      const writes: string[] = [];
      let dispatched = false;
      const client = {
        cancelQueries: () => new Promise<void>(resolve => { finishCancel = resolve; }),
        getQueriesData: () => { writes.push('snapshot'); return []; },
        setQueryData: () => writes.push('write'), setQueriesData: () => writes.push('write'),
        invalidateQueries: () => writes.push('invalidate'),
      };
      const callbacks = load(`${root}/hooks/use-comments.ts`, {
        useAuthStore: auth, __DEV__: false, useQueryClient: () => client,
        useMutation: (options: any) => options,
        commentKeys: { byPost: () => ['post'] },
        commentsApiClient: { createComment: async () => { dispatched = true; } },
      }, 'useCreateComment()');
      const input = { post: '1', text: '', attachment, authorId: 'actor-a' };
      // React Query only calls mutationFn after onMutate resolves successfully.
      const pending = callbacks.onMutate(input).then(() => callbacks.mutationFn(input));
      auth.switchTo('actor-b'); if (switchBack) auth.switchTo('actor-a');
      finishCancel();
      await assert.rejects(pending, /account changed/);
      callbacks.onError(new Error('stale'), input, undefined);
      callbacks.onSettled(undefined, new Error('stale'), input, undefined);
      assert.equal(dispatched, false);
      assert.deepEqual(writes, []);
      assert.equal(auth.listenerCount(), 0);
    });

    test(`${root}: old token rejection cannot restore cache or invalidate after account switch${switchBack ? ' and back' : ''}`, async () => {
      const auth = authFixture();
      const threading = load(`${root}/comments/threading.ts`, {}, '({insertCommentIntoThreads, findCommentThread})');
      const writes: string[] = [];
      const client = {
        cancelQueries: async () => {},
        getQueriesData: () => [[['post'], []]],
        setQueryData: () => writes.push('write'), setQueriesData: () => writes.push('write'),
        invalidateQueries: () => writes.push('invalidate'),
      };
      const callbacks = load(`${root}/hooks/use-comments.ts`, {
        ...threading, useAuthStore: auth, __DEV__: false, useQueryClient: () => client,
        useMutation: (options: any) => options, commentKeys: { byPost: () => ['post'] },
        usePostStore: { getState: () => ({ getCommentCount: () => 0, setCommentCount: () => writes.push('count') }) },
        postKeys: { detail: () => ['detail'], feed: () => ['feed'], feedInfinite: () => ['infinite'], feedInfiniteAll: () => ['infinite'] },
      }, 'useCreateComment()');
      const input = { post: '1', text: '', attachment, authorId: 'actor-a' };
      const context = await callbacks.onMutate(input);
      assert(writes.length > 0, 'original actor receives its optimistic update');
      writes.length = 0;
      auth.switchTo('actor-b'); if (switchBack) auth.switchTo('actor-a');
      callbacks.onError(new Error('token actor changed'), input, context);
      callbacks.onSettled(undefined, new Error('token actor changed'), input, context);
      assert.deepEqual(writes, []);
      assert.equal(auth.listenerCount(), 0);
    });
  }

  test(`${root}: optimistic GIF survives thread insertion; failure rolls cache back without erasing draft`, async () => {
    const threading = load(`${root}/comments/threading.ts`, {}, '({insertCommentIntoThreads, findCommentThread})');
    const parent: any = { id: '2', text: 'Root', replies: [] };
    let comments: any[] = [parent];
    let thread: any = { parentComment: parent, replies: [] };
    let count = 1;
    const keys = { byPost: () => ['post'], thread: () => ['thread'] };
    const client = {
      cancelQueries: async () => {},
      getQueriesData: ({queryKey}: any) => [[queryKey, queryKey.includes('post') ? comments : thread]],
      setQueriesData: ({queryKey}: any, updater: any) => {
        if (queryKey.includes('post')) comments = updater(comments);
        else if (queryKey.includes('thread')) thread = updater(thread);
      },
      setQueryData: (queryKey: any, data: any) => {
        if (queryKey.includes('post')) comments = data;
        else if (queryKey.includes('thread')) thread = data;
      },
      invalidateQueries: () => {},
    };
    const callbacks = load(`${root}/hooks/use-comments.ts`, {
      ...threading, useAuthStore: authFixture(), __DEV__: false, useQueryClient: () => client,
      useMutation: (options: any) => options, commentKeys: keys,
      usePostStore: { getState: () => ({ getCommentCount: () => count, setCommentCount: (_id: string, value: number) => { count = value; } }) },
      postKeys: { detail: () => ['detail'], feed: () => ['feed'], feedInfinite: () => ['infinite'], feedInfiniteAll: () => ['infinite'] },
    }, 'useCreateComment()');
    const draft = draftFixture();
    draft.getState().setAttachment(attachment);
    const input = { post: '1', parent: '2', text: '', attachment };
    const snapshot = await callbacks.onMutate(input);
    assert.equal(comments[0].replies[0].attachment, attachment);
    assert.equal(thread.replies[0].attachment, attachment);
    assert.equal(count, 2);
    callbacks.onError(new Error('Network failure'), input, snapshot);
    assert.equal(comments[0].replies.length, 0);
    assert.equal(thread.replies.length, 0);
    assert.equal(count, 1);
    assert.equal(draft.getState().attachment, attachment);
  });
}
