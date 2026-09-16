import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { MEDIA_SIZE_LIMITS, sizeLimitForKind, uploadPercentage, withUploadTimeout } from './upload-policy.ts';

test('client preflight caps match every server media kind', () => {
  const source = readFileSync(new URL('../../../../apps/mobile/supabase/functions/media-upload/index.ts', import.meta.url), 'utf8');
  const block = source.split('const SIZE_LIMITS:')[1].split('};')[0];
  const serverCaps = Object.fromEntries([...block.matchAll(/(?:"([a-z-]+)"|\b(avatar)):\s*(\d+)\s*\*\s*1024\s*\*\s*1024/g)].map((match) => [match[1] || match[2], Number(match[3]) * 1024 * 1024]));
  assert.deepEqual(MEDIA_SIZE_LIMITS, serverCaps);
  assert.equal(sizeLimitForKind('event-video'), 50 * 1024 * 1024);
  assert.equal(sizeLimitForKind('post-video'), 25 * 1024 * 1024);
});
test('byte progress is bounded and reserves completion for server acknowledgement', () => {
  assert.equal(uploadPercentage(0, 100), 0);
  assert.equal(uploadPercentage(50, 100), 48);
  assert.equal(uploadPercentage(100, 100), 95);
  assert.equal(uploadPercentage(1000, 100), 95);
  assert.equal(uploadPercentage(-5, 100), 0);
  assert.equal(uploadPercentage(1, 0), 0);
  assert.equal(uploadPercentage(Infinity, 10), 0);
});
test('stalled uploads cancel the actual transport and always release caller', async () => {
  let cancelled = 0;
  await assert.rejects(withUploadTimeout(new Promise(() => {}), async () => { cancelled++; throw Error('native cancel failed'); }, 5), /Upload timed out/);
  assert.equal(cancelled, 1);
});
test('a completed or failed upload does not leak its timeout/cancel the next upload', async () => {
  let cancelled = false;
  assert.equal(await withUploadTimeout(Promise.resolve('ok'), () => { cancelled = true; }, 5), 'ok');
  await assert.rejects(withUploadTimeout(Promise.reject(Error('Disconnected')), () => { cancelled = true; }, 5), /Disconnected/);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(cancelled, false);
});
