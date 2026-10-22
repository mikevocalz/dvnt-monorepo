const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const input = require('../_shared/comment-attachment.ts');
const gif = { provider: 'klipy', id: '123', url: 'https://static.klipy.com/ii/a.gif', previewUrl: 'https://static.klipy.com/ii/a.gif', width: 300, height: 200, title: 'Hello' };
function setup(options = {}) {
  const writes = [];
  let handler;
  const client = { from(table) {
    let inserted;
    const query = {
      select() { return this; }, eq() { return this; }, in() { return this; },
      async single() {
        if (table === 'comments' && inserted) return { data: { ...inserted, id: 100, created_at: '2026-10-22T00:00:00Z' } };
        if (table === 'comments') return { data: { id: 9, post_id: options.replyPost ?? 1, author_id: 3, parent_id: 8, root_id: 8, depth: 1 } };
        if (table === 'posts') return { data: { author_id: 2 } };
        return { data: null };
      },
      insert(value) { inserted = value; writes.push({ table, value }); return this; },
      then(resolve) { resolve({ data: [] }); },
    };
    return query;
  } };
  const deps = {
    createClient: () => client,
    verifySessionDetailed: async () => options.auth === false ? { ok: false } : { ok: true, userId: 'auth-user' },
    resolveOrProvisionUser: async () => ({ id: 1, username: 'test' }),
    resolveVerifiedAdmission: async () => ({ state: options.blocked ? 'blocked' : 'allowed' }),
    admissionRefusal: () => ({ code: 'verification_required', message: 'Verify' }),
    checkRateLimit: () => ({ allowed: !options.rateLimited }), WRITE_LIMIT: {},
    ...input,
  };
  const source = fs.readFileSync(`${__dirname}/index.ts`, 'utf8').replace(/^import .*?;\n/gm, '');
  new Function(...Object.keys(deps), 'Deno', stripTypeScriptTypes(source))(...Object.values(deps), { env: { get: () => 'test' }, serve(fn) { handler = fn; } });
  return { writes, async call(body) { return (await handler(new Request('https://test/add-comment', { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))).json(); } };
}
test('legacy text client inserts unchanged content and no attachment', async () => {
  const s = setup(); const result = await s.call({ postId: 1, content: ' hi ' });
  assert.equal(result.ok, true); assert.equal(result.data.comment.content, 'hi'); assert.equal(result.data.comment.attachment, null);
});
test('GIF-only reply persists metadata, normalizes thread, and notifies both authors', async () => {
  const s = setup(); const result = await s.call({ postId: 1, attachment: gif, replyToCommentId: 9 });
  assert.equal(result.ok, true); assert.equal(result.data.comment.content, 'GIF'); assert.deepEqual(result.data.comment.attachment, gif);
  assert.equal(s.writes[0].value.parent_id, 8); assert.equal(s.writes[0].value.root_id, 8); assert.equal(s.writes[0].value.depth, 1);
  assert.deepEqual(s.writes[1].value.map(n => n.recipient_id), [2, 3]);
});
test('invalid attachments and missing content never write comments', async () => {
  for (const body of [{ postId: 1 }, { postId: 1, content: 'hello', attachment: { ...gif, url: 'https://evil.test/a.gif' } }, null, []]) {
    const s = setup(); const result = await s.call(body); assert.equal(result.ok, false); assert.equal(result.error.code, 'validation_error'); assert.equal(s.writes.length, 0);
  }
});
test('GIF comments preserve auth, admission, rate limiting, and cross-post reply refusal', async () => {
  for (const [options, code] of [[{ auth: false }, 'unauthorized'], [{ blocked: true }, 'verification_required'], [{ rateLimited: true }, 'rate_limited'], [{ replyPost: 2 }, 'validation_error']]) {
    const s = setup(options); const result = await s.call({ postId: 1, attachment: gif, replyToCommentId: 9 }); assert.equal(result.error.code, code); assert.equal(s.writes.length, 0);
  }
});
