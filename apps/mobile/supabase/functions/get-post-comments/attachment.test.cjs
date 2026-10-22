const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const { normalizeCommentAttachment } = require('../_shared/comment-attachment.ts');
const gif = { provider: 'klipy', id: '123', url: 'https://static.klipy.com/ii/a.gif', previewUrl: 'https://static.klipy.com/ii/a.gif', width: 300, height: 200, title: 'Hello' };
function setup() {
  let handler;
  const root = { id: 8, post_id: 1, content: 'GIF', attachment: gif, parent_id: null, root_id: null, created_at: '2026-10-22T00:00:00Z' };
  const replies = [
    { ...root, id: 9, parent_id: 8, root_id: 8, content: 'legacy', attachment: null },
    { ...root, id: 10, parent_id: 8, root_id: 8, attachment: { ...gif, url: 'https://evil.test/a.gif' } },
    { ...root, id: 11, parent_id: 8, root_id: 8 },
  ];
  const client = { from() {
    let roots = false;
    return { select(columns) { if (columns.includes('content')) assert.ok(columns.includes('attachment')); return this; }, eq() { return this; }, in() { return this; }, is() { roots = true; return this; }, order() { return this; }, limit() { return this; }, single: async () => ({ data: root }), maybeSingle: async () => ({ data: root }), then(resolve) { resolve({ data: roots ? [root] : replies }); } };
  } };
  const source = fs.readFileSync(`${__dirname}/index.ts`, 'utf8').replace(/^import .*?;\n/gm, '');
  new Function('createClient', 'verifySession', 'resolveOrProvisionUser', 'normalizeCommentAttachment', 'Deno', stripTypeScriptTypes(source))(() => client, async () => null, async () => null, normalizeCommentAttachment, { env: { get: () => 'test' }, serve(fn) { handler = fn; } });
  return async body => (await handler(new Request('https://test/get-post-comments', { method: 'POST', body: JSON.stringify(body) }))).json();
}
test('root and reply reads include safe attachments, legacy text remains readable, malformed stored metadata is omitted', async () => {
  for (const body of [{ postId: 1 }, { postId: 1, rootCommentId: 8 }]) {
    const result = await setup()(body);
    const root = result.parentComment || result.comments[0];
    assert.equal(root.text, 'GIF'); assert.deepEqual(root.attachment, gif);
    assert.equal(root.replies.length, 3); assert.equal(root.replies[0].text, 'legacy'); assert.equal(root.replies[0].attachment, null); assert.equal(root.replies[1].attachment, null); assert.deepEqual(root.replies[2].attachment, gif);
  }
});
