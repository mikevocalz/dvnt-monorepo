const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCommentInput, normalizeCommentAttachment } = require('./comment-attachment.ts');
const gif = { provider: 'klipy', id: '4551195970372378', url: 'https://static.klipy.com/ii/a/hello.gif', previewUrl: 'https://static1.klipy.com/ii/a/preview.webp', width: 300, height: 200, title: 'Hello' };

test('text-only old clients remain supported, with no attachment', () => {
  assert.deepEqual(normalizeCommentInput('  hello @friend  ', undefined), { ok: true, content: 'hello @friend', attachment: null, mentionText: 'hello @friend' });
  assert.equal(normalizeCommentInput('hello', null).ok, true);
});
test('GIF-only uses meaningful legacy content, while captions and mentions are preserved', () => {
  assert.deepEqual(normalizeCommentInput('', gif), { ok: true, content: 'GIF', attachment: gif, mentionText: '' });
  assert.equal(normalizeCommentInput(undefined, gif).ok, true);
  assert.equal(normalizeCommentInput('nice @friend', gif).mentionText, 'nice @friend');
  assert.equal(normalizeCommentInput('', { ...gif, title: '@victim' }).mentionText, '');
});
test('empty or malformed input is rejected, never silently dropping an invalid attachment', () => {
  for (const content of ['', '   ', undefined, null, 42, {}, []]) assert.equal(normalizeCommentInput(content, null).ok, false);
  for (const attachment of [false, 42, 'gif', [], {}, { ...gif, arbitrary: {} }]) assert.equal(normalizeCommentInput('caption', attachment).ok, false);
});
test('attachment metadata is bounded and numeric sizes are finite positive integers', () => {
  for (const field of ['width', 'height']) for (const value of [0, -1, 4097, 1.5, NaN, Infinity, '300', null]) assert.equal(normalizeCommentAttachment({ ...gif, [field]: value }), null);
  for (const patch of [{ id: '' }, { id: 'x'.repeat(129) }, { id: 'a\n' }, { title: 'x'.repeat(201) }, { title: null }, { title: 'a\0' }, { url: gif.url + '?a=' + 'x'.repeat(2048) }]) assert.equal(normalizeCommentAttachment({ ...gif, ...patch }), null);
});
test('HTTPS exact CDN allowlist rejects lookalikes, credentials, ports, local URLs, and video/html', () => {
  for (const url of ['http://static.klipy.com/a.gif', 'https://static.klipy.com.evil.test/a.gif', 'https://evil.klipy.com/a.gif', 'https://user@static.klipy.com/a.gif', 'https://static.klipy.com:8443/a.gif', 'https://localhost/a.gif', 'data:image/gif,abc', 'file:///a.gif', 'https://static.klipy.com/a.mp4', 'https://static.klipy.com/a.html', 'https://static.klipy.com/a.gif#fragment', 'https://static.klipy.com\\evil/a.gif', 'https://static.klipy.com/a\n.gif']) {
    assert.equal(normalizeCommentAttachment({ ...gif, url }), null, url);
    assert.equal(normalizeCommentAttachment({ ...gif, previewUrl: url }), null, url);
  }
});
test('Noto fallback permits only the existing emoji image path and matching provider', () => {
  const url = 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/512.gif';
  const noto = { ...gif, provider: 'noto', url, previewUrl: url };
  assert.deepEqual(normalizeCommentAttachment(noto), noto);
  for (const patch of [{ provider: 'other' }, { provider: 'klipy' }, { url: gif.url }, { url: 'https://fonts.gstatic.com/arbitrary.gif' }, { url: url + '?tracking=1' }]) assert.equal(normalizeCommentAttachment({ ...noto, ...patch }), null);
});

test('canonicalizes standard HTTPS ports and hostname case before persistence', () => {
  const result = normalizeCommentAttachment({ ...gif, url: 'https://STATIC.KLIPY.COM:443/ii/a.gif' });
  assert.equal(result.url, 'https://static.klipy.com/ii/a.gif');
});

test('documented static2 CDN accepted without wildcard expansion', () => {
  const valid = { ...gif, url: 'https://static2.klipy.com/a.gif', previewUrl: 'https://static2.klipy.com/p.webp' };
  assert.deepEqual(normalizeCommentAttachment(valid), valid);
  for (const host of ['static3.klipy.com','static12.klipy.com','static2.klipy.com.evil.test']) {
    assert.equal(normalizeCommentAttachment({ ...gif, url: `https://${host}/a.gif` }), null);
  }
});
