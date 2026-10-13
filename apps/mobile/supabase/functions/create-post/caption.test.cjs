// Real create/update handlers and caption validator, with SDK/auth boundaries
// replaced by an in-memory database. Never connects to a live service.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const FUNCTIONS = path.resolve(__dirname, '..');
const ROOT = path.resolve(FUNCTIONS, '../../../..');
const MEDIA = [{ type: 'image', url: 'https://fixture.invalid/photo.jpg' }];
const ORIGINAL_CAPTION = 'Original #caption';
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ kind = 'media', owner = true, session = true, admission = true, spicy = true } = {}) {
  let nextId = 2;
  const tables = {
    posts: [{ id: 1, author_id: owner ? 7 : 8, post_kind: kind, content: ORIGINAL_CAPTION, is_nsfw: false }],
    posts_media: [{ _parent_id: 1, _order: 0, url: MEDIA[0].url }],
    post_text_slides: [{ post_id: 1, slide_index: 0, content: 'Existing slide' }],
  };
  const writes = [];
  const rpcCalls = [];
  const db = {
    async rpc(name, args) {
      rpcCalls.push({ name, args: plain(args) });
      assert.ok(['create_post_idempotent', 'create_post_with_dedupe'].includes(name), name);
      const payload = args.p_payload || {
        content: args.p_content,
        post_kind: args.p_post_kind,
        text_theme: args.p_text_theme,
        slides: args.p_slides,
        media: args.p_media,
      };
      const post = { id: nextId++, author_id: args.p_author_id, ...payload, was_created: true };
      tables.posts.push(post);
      writes.push({ table: 'posts', payload: plain(payload) });
      return { data: name === 'create_post_with_dedupe' ? [post] : post, error: null };
    },
    from(table) {
      assert.ok(table in tables, 'Unexpected table ' + table);
      const filters = [];
      let operation = 'select';
      let payload;
      let result;
      const run = () => {
        if (result) return result;
        let rows = tables[table].filter(row => filters.every(predicate => predicate(row)));
        if (operation === 'insert') {
          rows = (Array.isArray(payload) ? payload : [payload]).map(row => ({
            ...(table === 'posts' ? { id: nextId++ } : {}), ...plain(row),
          }));
          tables[table].push(...rows);
          writes.push({ table, payload: plain(payload) });
        } else if (operation === 'update') {
          rows.forEach(row => Object.assign(row, plain(payload)));
          writes.push({ table, payload: plain(payload) });
        } else if (operation === 'delete') {
          tables[table] = tables[table].filter(row => !rows.includes(row));
          writes.push({ table, operation });
        }
        result = { data: rows, error: null };
        return result;
      };
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        insert(value) { operation = 'insert'; payload = value; return query; },
        update(value) { operation = 'update'; payload = value; return query; },
        delete() { operation = 'delete'; return query; },
        single: async () => { const response = run(); return { ...response, data: response.data[0] || null }; },
        maybeSingle: async () => { const response = run(); return { ...response, data: response.data[0] || null }; },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return query;
    },
  };
  const cache = new Map();
  const handlers = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    cache.set(file, module.exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    assert.equal((source.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
    vm.runInNewContext(source.outputText, {
      module, exports: module.exports, Request, Response, URL, Date, crypto,
      console: { log() {}, warn() {}, error() {} },
      Deno: { env: { get: () => 'fixture' }, serve: handler => handlers.set(file, handler) },
      require(name) {
        if (name.includes('supabase-js')) return { createClient: () => db };
        if (name.endsWith('verify-session.ts')) return { verifySessionDetailed: async () => session
          ? { ok: true, userId: 'fixture-author' } : { ok: false, reason: 'expired' } };
        if (name.endsWith('resolve-user.ts')) return { resolveOrProvisionUser: async () => ({ id: 7, username: 'fixture-author' }) };
        if (name.endsWith('verified-admission.ts')) return {
          resolveVerifiedAdmission: async () => ({ state: admission ? 'allowed' : 'blocked' }),
          admissionRefusal: () => ({ code: 'verification_required', message: 'Verify your account' }),
        };
        if (name.endsWith('spicy-eligibility.ts')) return { resolveSpicyEligibility: async () => ({ state: spicy ? 'approved' : 'not_started' }) };
        if (name.endsWith('verification-state.ts')) return { resolveAdultVerificationState: async () => ({ state: 'approved' }) };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
        throw new Error('Unexpected import ' + name);
      },
    }, { filename: file });
    return module.exports;
  }
  return {
    tables, writes, rpcCalls, load,
    async call(fn, body) {
      const file = path.join(FUNCTIONS, fn, 'index.ts');
      load(file);
      const response = await handlers.get(file)(new Request('https://fixture.invalid/' + fn, {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture-session', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

const invalidCaptions = [
  ['prose over budget', 'x'.repeat(2201)],
  ['prose over budget with tags', 'x'.repeat(2201) + ' #東京 #café'],
  ['null', null],
  ['number', 12],
  ['boolean', false],
  ['array', ['#東京']],
  ['object', { caption: '#東京' }],
  ['raw storage guard', '#'.repeat(8001)],
  ['hashtag count guard', Array.from({ length: 31 }, (_, i) => '#tag' + i).join(' ')],
  ['duplicate hashtag count guard', Array.from({ length: 31 }, () => '#same').join(' ')],
  ['hashtag length guard', '#' + '語'.repeat(101)],
];

for (const fn of ['create-post', 'update-post']) {
  for (const [description, content] of invalidCaptions) {
    test(`${fn}: ${description} is refused before any post, slide or media write`, async () => {
      const h = harness();
      const before = plain(h.tables);
      const result = await h.call(fn, { postId: 1, content, media: MEDIA, location: 'New location' });
      assert.equal(result.body.ok, false, JSON.stringify(result));
      assert.equal(result.body.error.code, 'validation_error');
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.rpcCalls, []);
      assert.deepEqual(h.tables, before);
    });
  }

  test(`${fn}: 2200 prose characters plus Unicode hashtags stay intact`, async () => {
    const content = 'x'.repeat(2200) + ' #東京 #café #cafe\u0301 #night_life';
    const h = harness();
    const result = await h.call(fn, { postId: 1, content, media: MEDIA });
    assert.ok(content.length > 2200);
    assert.equal(result.body.ok, true, JSON.stringify(result));
    assert.equal(result.body.data.post.content, content);
    assert.equal(h.tables.posts.find(post => post.id === Number(result.body.data.post.id)).content, content);
  });

  for (const content of ['', undefined, '#東京 #café #cafe\u0301']) {
    test(`${fn}: optional and hashtag-only captions remain valid (${String(content)})`, async () => {
      const h = harness();
      const result = await h.call(fn, { postId: 1, content, media: MEDIA });
      assert.equal(result.body.ok, true, JSON.stringify(result));
      assert.equal(result.body.data.post.content, content === undefined
        ? fn === 'create-post' ? '' : ORIGINAL_CAPTION : content);
    });
  }
}

test('idempotent publishing keeps the exact inline caption in its RPC payload', async () => {
  const h = harness();
  const content = 'x'.repeat(2200) + ' #東京 #cafe\u0301';
  const result = await h.call('create-post', { operationId: 'caption-operation-1', content, media: MEDIA });
  assert.equal(result.body.ok, true, JSON.stringify(result));
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.rpcCalls[0].name, 'create_post_idempotent');
  assert.equal(h.rpcCalls[0].args.p_payload.content, content);
  assert.equal(result.body.data.post.content, content);
});

test('invalid idempotent publishing does not invoke the publish RPC', async () => {
  const h = harness();
  const result = await h.call('create-post', { operationId: 'caption-operation-1', content: 'x'.repeat(2201), media: MEDIA });
  assert.equal(result.body.error.code, 'validation_error');
  assert.deepEqual(h.rpcCalls, []);
  assert.deepEqual(h.writes, []);
});

test('create and update return the same validation explanation as the canonical helper', async () => {
  for (const [, content] of invalidCaptions) {
    const create = harness();
    const update = harness();
    const expected = create.load(path.join(FUNCTIONS, '_shared/post-caption.ts')).validatePostCaption(content);
    assert.equal(expected.valid, false);
    const created = await create.call('create-post', { content, media: MEDIA });
    const updated = await update.call('update-post', { postId: 1, content });
    assert.equal(created.body.error.message, expected.error);
    assert.equal(updated.body.error.message, expected.error);
  }
});

test('client and Edge caption contracts are byte-identical and agree on real payload fixtures', () => {
  const serverFile = path.join(FUNCTIONS, '_shared/post-caption.ts');
  const clientFile = path.join(ROOT, 'packages/app/lib/posts/post-caption.ts');
  assert.equal(fs.readFileSync(clientFile, 'utf8'), fs.readFileSync(serverFile, 'utf8'));
  const h = harness();
  const server = h.load(serverFile);
  const client = h.load(clientFile);
  const fixtures = [
    undefined, '', 'x'.repeat(2200),
    'x'.repeat(2200) + ' #東京 #café #cafe\u0301',
    'Prose with #東京 and #café inside.',
    'URL https://example.invalid/path#fragment and foo#bar are prose.',
    ...invalidCaptions.map(([, content]) => content),
  ];
  for (const content of fixtures) {
    assert.deepEqual(plain(client.validatePostCaption(content)), plain(server.validatePostCaption(content)));
    if (typeof content === 'string') {
      assert.deepEqual(plain(client.getCaptionMetrics(content)), plain(server.getCaptionMetrics(content)));
    }
  }
});

test('update uses the saved post kind, so a request cannot claim to be a text post to bypass validation', async () => {
  const h = harness();
  const result = await h.call('update-post', { postId: 1, kind: 'text', content: 'x'.repeat(2201), slides: ['Small slide'] });
  assert.equal(result.body.error.code, 'validation_error');
  assert.deepEqual(h.writes, []);
});

for (const fn of ['create-post', 'update-post']) {
  test(`${fn}: text slides retain their separate existing character limits`, async () => {
    const h = harness({ kind: 'text' });
    // Media captions reject a 101-character hashtag; text slides still accept it.
    const content = '#' + '語'.repeat(101);
    const allowed = await h.call(fn, { postId: 1, kind: 'text', content, slides: [content] });
    assert.equal(allowed.body.ok, true, JSON.stringify(allowed));
    assert.equal(allowed.body.data.post.content, content);

    const blocked = harness({ kind: 'text' });
    const tooLong = await blocked.call(fn, { postId: 1, kind: 'text', content: 'x'.repeat(2001), slides: ['x'.repeat(2001)] });
    assert.equal(tooLong.body.error.code, 'validation_error');
    assert.match(tooLong.body.error.message, /2000/);
    assert.deepEqual(blocked.writes, []);
  });

  test(`${fn}: caption validation does not weaken session, admission or SPICY gates`, async () => {
    for (const [options, code] of [
      [{ session: false }, 'unauthorized'],
      [{ admission: false }, 'verification_required'],
      [{ spicy: false }, 'adult_verification_required'],
    ]) {
      const h = harness(options);
      const result = await h.call(fn, { postId: 1, content: '#東京', media: MEDIA, isNSFW: true });
      assert.equal(result.body.ok, false);
      assert.equal(result.body.error.code, code);
      assert.deepEqual(h.writes, []);
    }
  });
}

test('ownership is still required before updating a valid or invalid caption', async () => {
  for (const content of ['#東京', 'x'.repeat(2201)]) {
    const h = harness({ owner: false });
    const result = await h.call('update-post', { postId: 1, content });
    assert.equal(result.body.error.code, 'forbidden');
    assert.deepEqual(h.writes, []);
  }
});
