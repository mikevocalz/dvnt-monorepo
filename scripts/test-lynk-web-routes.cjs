// Run the production Next redirect configuration and middleware without a
// server build or live auth. No URLs are visited and no sessions are created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const cache = new Map();
function load(relative) {
  const file = path.resolve(ROOT, relative);
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const requireModule = name => {
    if (name === 'next/server') return { NextResponse: {
      redirect: url => ({ kind:'redirect', url:String(url) }),
      rewrite: url => ({ kind:'rewrite', url:String(url) }),
      next: () => ({ kind:'next' }),
    }};
    if (name === '@payloadcms/next/withPayload') return {withPayload: config=>config};
    if (name === '@sentry/nextjs') return {withSentryConfig: config=>config};
    if (name.startsWith('@dvnt/app/')) return load('packages/app/'+name.slice('@dvnt/app/'.length).replace(/\.ts$/,'')+'.ts');
    if (name.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file),name);
      return /\.cjs$/.test(resolved) ? require(resolved) : load(path.relative(ROOT,resolved.replace(/\.ts$/,'')+'.ts'));
    }
    return require(name);
  };
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,require:requireModule,URL,URLSearchParams,console,process,__dirname:path.dirname(file)},{filename:file});
  return exports;
}
function request(raw, cookie=false) {
  const url = new URL(raw,'https://dvntapp.live');
  return {url:url.href,nextUrl:url,headers:{get: key=>key==='host'?url.host:null},cookies:{has:()=>cookie,getAll:()=>[]}};
}
(async()=>{
  const redirects = await load('apps/web/next.config.ts').default.redirects();
  const middleware = load('apps/web/src/middleware.ts').middleware;
  // Use only the actual config's room mappings. A missing or changed mapping
  // fails before middleware can conceal it.
  const shared = redirects.find(r=>r.source==='/sneaky-lynk/:path*');
  const short = redirects.find(r=>r.source==='/sl/:id');
  assert.equal(shared?.destination,'/feed/sneaky-lynk/:path*');
  assert.equal(short?.destination,'/feed/sneaky-lynk/room/:id');
  const nextRedirect = raw => {
    const url = new URL(raw,'https://dvntapp.live');
    if (url.pathname.startsWith('/sneaky-lynk/')) url.pathname=shared.destination.replace(':path*',url.pathname.slice('/sneaky-lynk/'.length));
    else if (/^\/sl\/[^/]+$/.test(url.pathname)) url.pathname=short.destination.replace(':id',url.pathname.slice('/sl/'.length));
    return url.href;
  };
  for (const alias of ['/sneaky-lynk/room/room_123','/sl/room_123','/sneaky/room_123','/sneaky-lynk/room_123','/feed/sneaky-lynk/room/room_123']) {
    for (const cookie of [false,true]) {
      const first = request(nextRedirect(alias+'?id=wrong&returnTo=%2Ffeed&next=https://evil.invalid'),cookie);
      const result = middleware(first);
      assert.equal(result.kind,'redirect');
      assert.equal(result.url,'https://dvntapp.live/feed/sneaky-lynk/room/room_123');
      assert.equal(middleware(request(result.url,cookie)).kind,'next','canonical destination does not loop or grant access');
    }
  }
  for (const alias of ['/sneaky/success','/sneaky/cancel','/feed/sneaky-lynk/create','/feed/sneaky-lynk/billing','/sneaky/a%2Fb','/sneaky/a%0A','/feed/sneaky-lynk/room/a%3Fb']) {
    assert.equal(middleware(request(alias)).kind,'next',alias+' must not become a room');
  }
  assert.equal(middleware(request('/admin/collections/posts')).url,'https://dvntapp.live/auth/login?returnTo=%2Fadmin%2Fcollections%2Fposts');
  assert.equal(middleware(request('https://blog.dvntapp.live/hello')).url,'https://blog.dvntapp.live/posts/hello');
  console.log('PASS: actual Next room redirects + middleware, canonical/legacy aliases, guest/member entry, query injection, malformed/reserved paths and no redirect loops');
})().catch(error=>{console.error(error);process.exitCode=1;});
