// Shared transport for the in-process contract and real Chromium HTTP test.
// Identity/admission and the entire media-upload/storage endpoint are test
// adapters. The application uploader, supabase-js wire serialization, create-post handler, SQL
// migrations and post read mapper are production code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../../..');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function loadTs(relative, adapters, globals = {}) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const requireAdapter = name => {
    assert.ok(Object.hasOwn(adapters, name), `Unexpected dependency in isolated edge handler: ${name}`);
    return adapters[name];
  };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(requireAdapter, module, module.exports, ...Object.values(globals));
  return module.exports;
}

async function createHarness() {
  const db = new PGlite();
  for (const relative of [
    'scripts/fixtures/live-photo-roundtrip/schema.sql',
    'apps/mobile/supabase/migrations/20260916091500_idempotent_post_publish.sql',
    'apps/mobile/supabase/migrations/20260918180000_text_post_theme_deviant.sql',
  ]) await db.exec(fs.readFileSync(path.join(root, relative), 'utf8'));
  const state = { objects: new Map(), uploads: [], creates: [], reads: [], failMotion: false, loseCreateAcknowledgement: false };
  const admin = {
    async rpc(name, args) {
      assert.equal(name, 'create_post_idempotent', 'queued publishes must use the real idempotent path');
      try {
        const result = await db.query('SELECT public.create_post_idempotent($1::integer, $2::text, $3::jsonb) AS post', [args.p_author_id, args.p_operation_id, JSON.stringify(args.p_payload)]);
        return { data: result.rows[0].post, error: null };
      } catch (error) { return { data: null, error: { message: error.message } }; }
    },
    from() { throw new Error('Unexpected non-idempotent DB write in queued publish'); },
  };
  let edgeHandler;
  const unused = () => { throw new Error('Unexpected unrelated account policy in fixture'); };
  loadTs('apps/mobile/supabase/functions/create-post/index.ts', {
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => admin },
    '../_shared/verify-session.ts': { verifySessionDetailed: async () => ({ ok: true, userId: 'fixture-owner' }) },
    '../_shared/resolve-user.ts': { resolveOrProvisionUser: async () => ({ id: 1, username: 'fixture', first_name: 'Fixture' }) },
    '../_shared/verified-admission.ts': { resolveVerifiedAdmission: async () => ({ state: 'allowed' }), admissionRefusal: unused },
    '../_shared/verification-state.ts': { resolveAdultVerificationState: unused },
    '../_shared/spicy-eligibility.ts': { resolveSpicyEligibility: unused },
    '../_shared/spicy-post-refusal.ts': { spicyPostRefusal: unused },
    '../_shared/first-post-gate.ts': { firstPostRefusal: unused },
    '../_shared/post-caption.ts': loadTs('apps/mobile/supabase/functions/_shared/post-caption.ts', {}),
  }, { Deno: { serve: fn => { edgeHandler = fn; }, env: { get: name => ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(name) ? 'synthetic-fixture-only' : undefined } } });
  assert.equal(typeof edgeHandler, 'function');

  async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname === '/functions/v1/media-upload') {
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture-token');
      assert.match(request.headers.get('Content-Type') || '', /^multipart\/form-data; boundary=/);
      const form = await request.formData();
      const file = form.get('file');
      assert.ok(file && typeof file.arrayBuffer === 'function');
      const bytes = Buffer.from(await file.arrayBuffer());
      const mime = form.get('mime');
      const kind = form.get('kind');
      assert.equal(file.type, mime);
      assert.equal(kind, mime.startsWith('video/') ? 'post-video' : 'post-image');
      const record = { bytes, sha256: digest(bytes), mime, kind, filename: file.name };
      state.uploads.push(record);
      if (state.failMotion && mime.startsWith('video/')) return json({ ok: false, error: 'Synthetic motion upload failure' });
      const key = `${state.uploads.length}-${record.sha256}.${file.name.split('.').pop()}`;
      const location = `/objects/${key}`;
      state.objects.set(location, record);
      return json({ ok: true, media: { url: `${url.origin}${location}`, key } });
    }
    if (url.pathname === '/functions/v1/create-post') {
      state.creates.push(await request.clone().json());
      const result = await edgeHandler(request);
      if (state.loseCreateAcknowledgement && result.ok) {
        state.loseCreateAcknowledgement = false;
        throw new Error('Synthetic lost acknowledgement after SQL commit');
      }
      return result;
    }
    if (url.pathname === '/rest/v1/posts') {
      assert.equal(request.method, 'GET');
      const select = url.searchParams.get('select');
      assert.ok(select.includes('live_photo_video_url') && select.includes('_order'), 'real post read must request both pairing and order');
      state.reads.push(url.search);
      const id = url.searchParams.get('id');
      assert.match(id, /^eq\.\d+$/);
      const posts = await db.query('SELECT * FROM public.posts WHERE id = $1', [id.slice(3)]);
      if (!posts.rows.length) return json(null);
      const row = posts.rows[0];
      // Deliberately reversed SQL results test that transformPost honors _order,
      // not array position returned by PostgREST.
      const media = await db.query('SELECT * FROM public.posts_media WHERE _parent_id = $1 ORDER BY _order DESC', [row.id]);
      return json({ ...row, media: media.rows, author: { id: 1, username: 'fixture', first_name: 'Fixture' } });
    }
    const object = state.objects.get(url.pathname);
    if (object) return new Response(object.bytes, { headers: { 'Content-Type': object.mime, 'Content-Length': String(object.bytes.length), 'Accept-Ranges': 'bytes' } });
    throw new Error(`Network denied: fixture has no route for ${request.method} ${url.pathname}`);
  }
  return { db, state, handle, close: () => db.close(), async counts() {
    const result = await db.query('SELECT (SELECT count(*)::integer FROM posts) AS posts, (SELECT count(*)::integer FROM posts_media) AS media, (SELECT count(*)::integer FROM post_publish_requests) AS requests');
    return result.rows[0];
  } };
}

// All fixture dependencies are explicit; native file APIs and real user stores
// cannot accidentally be reached while bundling production browser code.
function clientAdapters() {
  return { name: 'live-photo-isolation', setup(build) {
    build.onResolve({ filter: /./ }, args => {
      const name = args.path;
      if (name === 'expo-file-system/legacy') return { path: 'native-files', namespace: 'fixture' };
      if (name === 'react-native') return { path: 'platform', namespace: 'fixture' };
      if (name === '@dvnt/app/lib/auth-client') return { path: 'auth', namespace: 'fixture' };
      if (name === '@dvnt/app/lib/media/upload-watchdog-store') return { path: 'watchdog', namespace: 'fixture' };
      if (name === '@dvnt/app/lib/supabase/client' || (name === '../supabase/client' && args.importer.endsWith('/api/posts.ts'))) return { path: 'client', namespace: 'fixture' };
      if (args.importer.endsWith('/api/posts.ts')) {
        const adapters = { './auth-helper': 'auth', '../auth/identity': 'auth', './likes': 'likes', './feed-suppression': 'suppression' };
        if (adapters[name]) return { path: adapters[name], namespace: 'fixture' };
      }
    });
    build.onLoad({ filter: /./, namespace: 'fixture' }, args => ({ resolveDir: root, contents: {
      'native-files': 'export const cacheDirectory = null;',
      platform: 'export const Platform = { OS: "web" };',
      auth: 'export const getAuthToken = async () => "fixture-token"; export const requireBetterAuthToken = getAuthToken; export const getCurrentUserId = async () => 1; export const getCurrentUserIdSync = () => 1; export const hasAuthenticatedUser = () => true;',
      watchdog: 'export const beginUpload = () => "fixture-watch"; export const settleUpload = () => {};',
      client: 'import { createClient } from "@supabase/supabase-js"; export const supabase = createClient(globalThis.fixtureOrigin, "fixture-anon-key", { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }, global: { fetch: (...args) => globalThis.fetch(...args) } });',
      likes: 'export const likesApi = { getViewerLikedPostIds: async () => new Set() };',
      suppression: 'export const suppressedFeedAuthors = new Set();',
    }[args.path], loader: 'js' }));
  } };
}
module.exports = { createHarness, clientAdapters, root, digest };
