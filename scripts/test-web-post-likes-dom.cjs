#!/usr/bin/env node
// Exercise the production API, TanStack cache/hook, and web likes popover.
// Only network/auth are mocked; React, pagination, focus and DOM are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');

(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-post-likes-dom-'));
  // Keep isolated runs internally consistent even while workspace deps install.
  const dependencyRoot = (process.env.NODE_PATH || '').split(path.delimiter).find(Boolean);
  const dependencyAliases = dependencyRoot ? Object.fromEntries(
    ['react', 'react-dom', '@tanstack/react-query', '@tanstack/query-core', 'zustand', 'lucide-react'].map(name =>
      [name, path.dirname(require.resolve(`${name}/package.json`, { paths: [path.dirname(dependencyRoot)] }))]),
  ) : {};
  let mounted;
  let client;
  try {
    await build({
      stdin: { contents: `
        import React, { act } from 'react';
        import { createRoot } from 'react-dom/client';
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
        import { LikesSheet } from './packages/app/features/posts/likes/LikesSheet.web';
        import { usePostLikers, prefetchPostLikers } from './packages/app/lib/hooks/use-post-likers';
        import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';
        import { likesApi } from './packages/app/lib/api/likes';
        import { postLikersKeys, likeStateKeys } from './packages/app/lib/query-keys';
        export { act, useAuthStore, likesApi, prefetchPostLikers, postLikersKeys, likeStateKeys };
        export const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        export let lastQuery;
        function Probe({ postId }) { lastQuery = usePostLikers(postId || undefined, !!postId, 50); return null; }
        export function mount(node) {
          const root = createRoot(node);
          return { render: (postId, onClose, onProfilePress) => root.render(
            <React.StrictMode><QueryClientProvider client={client}>
              <Probe postId={postId} />
              <LikesSheet postId={postId} onClose={onClose} onProfilePress={onProfilePress} />
            </QueryClientProvider></React.StrictMode>
          ), unmount: () => root.unmount() };
        }
      `, resolveDir: root, loader: 'tsx' },
      bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', define: { __DEV__: 'false' },
      outfile: path.join(dir, 'fixture.cjs'), alias: { '@dvnt/app': path.join(root, 'packages/app'), ...dependencyAliases },
      nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
      plugins: [{ name: 'mock-auth-network', setup(build) {
        build.onResolve({ filter: /(?:stores\/auth-store|auth\/identity|supabase\/client)$/ }, args => ({ path: args.path, namespace: 'mock' }));
        build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'js', resolveDir: root, contents:
          args.path.endsWith('auth-store') ? `import { create } from 'zustand'; export const useAuthStore = create(() => ({ user: { id: 'viewer' } }));` :
          args.path.endsWith('identity') ? `export const requireBetterAuthToken = async () => { if (globalThis.__rejectToken) throw new Error('Unauthorized'); return 'test-token'; }; export const hasAuthenticatedUser = () => true;` :
          `export const supabase = { functions: { invoke: (...args) => globalThis.__likesInvoke(...args) } };`
        }));
      } }],
    });
    const fixture = require(path.join(dir, 'fixture.cjs'));
    const { act, mount, useAuthStore, likesApi, prefetchPostLikers, postLikersKeys, likeStateKeys } = fixture;
    client = fixture.client;
    const node = document.createElement('div'); document.body.append(node);
    const trigger = document.createElement('button'); trigger.textContent = 'Open likes'; document.body.append(trigger);
    mounted = mount(node);
    const wait = ms => act(async () => new Promise(resolve => setTimeout(resolve, ms)));
    const click = async element => act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    const key = async (name, options = {}) => act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })));
    const buttons = () => [...document.querySelectorAll('[role="dialog"] button')];
    const rows = () => [...document.querySelectorAll('[aria-label="People who liked this post"] li')];
    const liker = id => ({ userId: id, username: `user${id}`, avatar: id === 1 ? 'https://example.com/avatar.jpg' : '', displayName: `Member ${id}`, likedAt: '2026-10-20T12:00:00Z' });
    const events = [];
    let active = null;
    const render = value => mounted.render(value, () => { events.push('close'); active = null; render(null); }, name => events.push(`profile:${name}`));
    const open = async value => act(async () => { active = value; render(value); });
    const calls = [];
    let respond = () => ({ data: { likers: [liker(1), liker(2)], likesCount: 650, nextCursor: { likedAt: '2026-10-20T12:00:00Z', userId: 2 } }, error: null });
    global.__likesInvoke = async (name, options) => { calls.push({ name, options }); return respond(options); };

    // Prefetch and hook must never put object/array shapes under the same key.
    client.setQueryData(likeStateKeys.forPost('viewer', '42'), { likes: 12, hasLiked: true });
    await act(async () => prefetchPostLikers(client, '42', 50)); await wait(5);
    const prefetched = client.getQueryData(postLikersKeys.forViewer('42', 'viewer', 50));
    assert.equal(prefetched.pages[0].likesCount, 650);
    assert.equal(prefetched.pages[0].likers.length, 2);
    assert.equal(client.getQueryData(likeStateKeys.forPost('viewer', '42')).likes, 650);
    trigger.focus();
    await open('42'); await wait(5);
    assert.equal(calls.length, 1, 'opening a fresh prefetch does not issue a duplicate request');
    assert.equal(Array.isArray(fixture.lastQuery.data), true, 'native hook API remains an array');
    assert.equal(rows().length, 2);
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Close likes');
    assert.equal(document.body.style.overflow, 'hidden');
    assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-modal'), 'true');
    assert.ok(document.getElementById(document.querySelector('[role="dialog"]').getAttribute('aria-labelledby')));
    assert.match(document.querySelector('[data-likes-scroll]').className, /overflow-y-auto/);
    assert.match(document.querySelector('[role="dialog"]').className, /max-h-\[85dvh\]/);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(calls[0].options.body.limit, 50);
    assert.equal(rows()[0].querySelector('img').getAttribute('src'), 'https://example.com/avatar.jpg');
    assert.equal(rows()[1].querySelector('img'), null, 'missing avatars use a local initial, not a broken image');
    await act(async () => rows()[0].querySelector('img').dispatchEvent(new window.Event('error')));
    assert.equal(rows()[0].querySelector('img').style.visibility, 'hidden', 'broken avatars reveal the fallback');

    await key('Tab', { shiftKey: true });
    assert.equal(document.activeElement.textContent, 'Load more', 'Shift+Tab wraps inside the dialog');
    await key('Tab');
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Close likes', 'Tab wraps forward');

    // A failed next page keeps existing users/counts and exposes an explicit retry.
    respond = () => ({ error: { message: 'Offline' } });
    await click(buttons().find(button => button.textContent === 'Load more')); await wait(5);
    assert.equal(rows().length, 2);
    assert.match(document.querySelector('[role="alert"]').textContent, /Couldn’t load more/);
    assert.equal(client.getQueryData(likeStateKeys.forPost('viewer', '42')).likes, 650);
    respond = () => ({ data: { likers: [liker(2), liker(3)], likesCount: 651, nextCursor: null }, error: null });
    await click(buttons().find(button => button.textContent === 'Try again')); await wait(5);
    assert.deepEqual(rows().map(row => row.querySelector('button').getAttribute('aria-label')), [1, 2, 3].map(id => `View @user${id}'s profile`));
    assert.equal(client.getQueryData(likeStateKeys.forPost('viewer', '42')).likes, 651);
    assert.equal(calls.at(-1).options.body.cursor.userId, 2);
    assert.ok(!buttons().some(button => button.textContent === 'Load more'));
    await click(rows()[0].querySelector('button'));
    assert.deepEqual(events.slice(-2), ['close', 'profile:user1']);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, trigger);
    assert.equal(document.body.style.overflow, '');

    await open('42'); await key('Escape');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await open('42'); await click(document.querySelector('[data-likes-backdrop]'));
    assert.equal(document.querySelector('[role="dialog"]'), null);

    // A slow first request displays loading; a failed request never sets zero.
    let resolve;
    respond = () => new Promise(done => { resolve = done; });
    client.setQueryData(likeStateKeys.forPost('viewer', '43'), { likes: 17, hasLiked: false });
    await open('43');
    assert.match(document.querySelector('[role="status"]').textContent, /Loading likes/);
    await act(async () => resolve({ error: { message: 'Unavailable' } })); await wait(5);
    assert.match(document.querySelector('[role="alert"]').textContent, /Couldn’t load likes/);
    assert.equal(client.getQueryData(likeStateKeys.forPost('viewer', '43')).likes, 17);
    respond = () => ({ data: { likers: [], likesCount: 0, nextCursor: null }, error: null });
    await click(buttons().find(button => button.textContent === 'Try again')); await wait(5);
    assert.match(document.querySelector('[role="dialog"]').textContent, /No likes yet/);

    // A response started before an optimistic toggle cannot overwrite it.
    respond = () => new Promise(done => { resolve = done; });
    client.setQueryData(likeStateKeys.forPost('viewer', '44'), { likes: 5, hasLiked: false });
    await open('44');
    client.setQueryData(likeStateKeys.forPost('viewer', '44'), { likes: 6, hasLiked: true });
    await act(async () => resolve({ data: { likers: [liker(5)], likesCount: 5, nextCursor: null }, error: null })); await wait(5);
    assert.deepEqual(client.getQueryData(likeStateKeys.forPost('viewer', '44')), { likes: 6, hasLiked: true });

    // Scrolling to the end automatically requests the next bounded page once.
    respond = options => ({ data: { likers: options.body.cursor ? [liker(12)] : [liker(11)], likesCount: 2, nextCursor: options.body.cursor ? null : { likedAt: '2026-10-20T12:00:00Z', userId: 11 } }, error: null });
    await open('45'); await wait(5);
    assert.equal(rows().length, 1, 'changing posts never shows the previous post’s users');
    const beforeScroll = calls.length;
    const scroller = document.querySelector('[data-likes-scroll]');
    Object.defineProperties(scroller, { scrollHeight: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 400 } });
    scroller.scrollTop = 395;
    await act(async () => { scroller.dispatchEvent(new window.Event('scroll', { bubbles: true })); scroller.dispatchEvent(new window.Event('scroll', { bubbles: true })); });
    await wait(5);
    assert.equal(calls.length, beforeScroll + 1, 'rapid scroll events do not duplicate a page request');
    assert.equal(rows().length, 2);

    // No cross-account cached rows and no anonymous network request.
    const beforeSignout = calls.length;
    await act(async () => useAuthStore.setState({ user: null })); await wait(5);
    assert.equal(rows().length, 0);
    assert.match(document.querySelector('[role="dialog"]').textContent, /Sign in/);
    assert.equal(calls.length, beforeSignout);
    prefetchPostLikers(client, '42', 50); await wait(5);
    assert.equal(calls.length, beforeSignout, 'anonymous hover does not prefetch protected data');
    respond = () => ({ data: { likers: [liker(99)], likesCount: 1, nextCursor: null }, error: null });
    await act(async () => useAuthStore.setState({ user: { id: 'other-viewer' } })); await wait(5);
    assert.equal(rows().length, 1);
    assert.match(rows()[0].textContent, /user99/);

    // Switching accounts while a read is pending cannot repopulate old caches.
    let resolveOld;
    respond = () => new Promise(done => { resolveOld = done; });
    client.setQueryData(likeStateKeys.forPost('other-viewer', '46'), { likes: 9, hasLiked: false });
    await open('46');
    respond = () => ({ data: { likers: [liker(100)], likesCount: 1, nextCursor: null }, error: null });
    await act(async () => useAuthStore.setState({ user: { id: 'third-viewer' } })); await wait(5);
    await act(async () => resolveOld({ data: { likers: [liker(101)], likesCount: 4, nextCursor: null }, error: null })); await wait(5);
    assert.match(rows()[0].textContent, /user100/);
    assert.equal(client.getQueryData(postLikersKeys.forViewer('46', 'other-viewer', 50)), undefined);
    assert.equal(client.getQueryData(likeStateKeys.forPost('other-viewer', '46')).likes, 9);

    // Input/auth/service errors reject instead of becoming an empty success.
    for (const postId of ['42wrong', '0', '-3']) await assert.rejects(likesApi.getPostLikers(postId), /Invalid post/);
    global.__rejectToken = true;
    await assert.rejects(likesApi.getPostLikers('42'), /Unauthorized/);
    global.__rejectToken = false;
    respond = () => ({ data: { error: 'Denied' }, error: null });
    await assert.rejects(likesApi.getPostLikers('42'), /Denied/);
    respond = () => ({ data: {}, error: null });
    await assert.rejects(likesApi.getPostLikers('42'), /Could not load/);
    console.log('PASS: web likes prefetch/cache, pagination/deduplication, counts, auth isolation, loading/error/retry, avatars, keyboard and profile navigation');
    await act(async () => mounted.unmount()); mounted = null;
  } finally {
    if (mounted) mounted.unmount();
    client?.clear();
    window.happyDOM.abort();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
