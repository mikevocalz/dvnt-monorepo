import { URL } from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEventSaveSession } from './event-save-session.ts';

test('successful flyer, poster and gallery uploads survive a failed save without duplicate upload', async () => {
  const session = createEventSaveSession();
  let uploads = 0;
  const upload = async (url: string) => { uploads++; return `https://media.test/${url.slice(5)}`; };
  const urls = ['blob:video', 'blob:poster', 'blob:cover', 'blob:gallery'];
  const first = session.begin('event/account/epoch', () => true);
  const results = [];
  for (const url of urls) results.push(await first.upload(url, upload));
  // A failed database save does not invalidate completed uploads.
  const retry = session.begin('event/account/epoch', () => true);
  for (let i = 0; i < urls.length; i++) assert.equal(await retry.upload(urls[i], upload), results[i]);
  assert.equal(uploads, 4);
});

test('partial upload failure retries only the failed media', async () => {
  const session = createEventSaveSession();
  const calls: string[] = [];
  let fail = true;
  const upload = async (url: string) => {
    calls.push(url);
    if (url === 'blob:poster' && fail) throw new Error('network');
    return `https://media.test/${url.slice(5)}`;
  };
  const first = session.begin('scope', () => true);
  await first.upload('blob:video', upload);
  await assert.rejects(first.upload('blob:poster', upload), /network/);
  fail = false;
  const retry = session.begin('scope', () => true);
  await retry.upload('blob:video', upload);
  await retry.upload('blob:poster', upload);
  assert.deepEqual(calls, ['blob:video', 'blob:poster', 'blob:poster']);
});

test('pending old-account upload cannot complete or start a save after A -> B -> A', async () => {
  const session = createEventSaveSession();
  let complete!: (url: string) => void;
  const saving = session.begin('account-a', () => true);
  const pending = saving.upload('blob:video', () => new Promise<string>(resolve => { complete = resolve; }));
  session.invalidate(); // Synchronous account/session subscription, even before a render.
  session.begin('account-b', () => true);
  session.begin('account-a', () => true);
  complete('https://media.test/old');
  await assert.rejects(pending, /sign-in or event changed/);
  assert.throws(saving.assertCurrent, /sign-in or event changed/);
  assert.equal(await session.begin('account-a', () => true).upload('blob:video', async () => 'https://media.test/new'), 'https://media.test/new');
});

test('stale session refuses uploads and cached or hosted URLs before starting work', async () => {
  const session = createEventSaveSession();
  let current = true;
  const saving = session.begin('scope', () => current);
  await saving.upload('blob:video', async () => 'https://media.test/video');
  current = false;
  for (const url of ['blob:video', 'https://media.test/hosted', null]) {
    await assert.rejects(saving.upload(url, async () => { assert.fail('must not upload'); }), /sign-in or event changed/);
  }
});

test('different event or session epoch never reuses an old upload', async () => {
  const session = createEventSaveSession();
  let count = 0;
  for (const key of ['event-a/account/1', 'event-b/account/1', 'event-b/account/2']) {
    await session.begin(key, () => true).upload('blob:video', async () => `https://media.test/${++count}`);
  }
  assert.equal(count, 3);
});

test('editor wires session invalidation, token-bound upload and identity-bound mutation', () => {
  const source = readFileSync(new URL('../../features/events/event-edit.web.tsx', import.meta.url), 'utf8');
  assert.match(source, /subscribeSessionLifecycle\(\(\) => saveSession.current.invalidate\(\)\)/);
  assert.match(source, /useAuthStore.subscribe/);
  assert.match(source, /\{ expectedAuthToken \}/);
  assert.match(source, /updates: updateData, expectedAuthId, expectedSessionEpoch/);
  assert.match(source, /saving.assertCurrent\(\);\s*\/\/ 2\. Ticket/);
});
