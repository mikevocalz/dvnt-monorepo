// Exercise the actual public post mapper and article renderer with synthetic
// database results. Never loads production config, credentials or a database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-author-render-'));
const mocks = new Map([
  ['payload', `export const getPayload=async()=>({find:async()=>({docs:[globalThis.__authorPost],totalPages:1,page:1})});`],
  ['@payload-config', 'export default {};'],
  ['next/navigation', `export const notFound=()=>{throw Error('Unexpected missing article')};`],
  ['next/headers', `export const draftMode=async()=>({isEnabled:false});`],
  ['next/link', `export default function Link(p){return <a {...p}/>}`],
  ['next/image', `export default function Image({fill,priority,...p}){return <img {...p}/>}`],
  ['@/lib/comments', `export const getCommentsForPost=async()=>[];export const buildTree=a=>a;`],
  ['@/components/RichText', `export const RichText=()=>null;`],
  ['@/components/Comments', `export const Comments=()=>null;`],
  ['../components/ArticleProgress', `export const ArticleProgress=()=>null;`],
  ['../components/ArticleStickyTools', `export const ArticleStickyTools=()=>null;`],
  ['../components/NewsletterCTA', `export const NewsletterCTA=()=>null;`],
  ['../components/ScrollReveal', `export const ScrollReveal=({children})=>children;`],
]);
(async () => {
  try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
    await esbuild.build({
      stdin: { contents: `export{getPostBySlug}from'./apps/web/src/lib/posts';export{default as Page}from'./apps/web/src/app/(frontend)/posts/[slug]/page';`, resolveDir: root, loader: 'tsx' },
      outfile: path.join(directory, 'fixture.mjs'), platform: 'node', format: 'esm', bundle: true, packages: 'external', jsx: 'automatic', jsxImportSource: 'react',
      tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } },
      plugins: [{ name: 'synthetic-service-boundaries', setup(b) {
        b.onResolve({ filter: /.*/ }, a => mocks.has(a.path) ? { path: a.path, namespace: 'fixture' } : undefined);
        b.onResolve({ filter: /^@\/lib\/posts$/ }, () => ({ path: path.join(root, 'apps/web/src/lib/posts.ts') }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: mocks.get(a.path), loader: 'tsx', resolveDir: root }));
      } }],
    });
    const { getPostBySlug, Page } = await import(pathToFileURL(path.join(directory, 'fixture.mjs')).href);
    const { renderToStaticMarkup } = require('react-dom/server');
    const author = { id: 42, name: 'Account linked writer', slug: 'writer-fixture', bio: 'A full public biography.', role: 'Editor-at-Large',
      email: 'private@example.invalid', user: { id: 3, email: 'staff@example.invalid' }, avatarUrl: 'https://example.invalid/portrait.jpg',
      socials: { instagram: 'writer', twitter: 'writer', tiktok: 'writer', onlyfans: 'writer', website: 'https://example.invalid/site' }, profileUrl: 'https://example.invalid/profile' };
    const contributor = { ...author, id: 43, name: 'Account linked photographer', bio: 'A photographer biography.' };
    globalThis.__authorPost = { id: 71, title: 'Account author fixture', slug: 'fixture', content: { root: { children: [] } }, _status: 'published', authors: [author],
      contributors: [{ id: 'credit-1', author: contributor, role: 'Photographs by' }, { author: 999, role: 'Missing profile' }] };
    const mapped = await getPostBySlug('fixture');
    assert.equal(mapped.authors[0].avatar.url, author.avatarUrl);
    assert.equal(mapped.authors[0].email, undefined); assert.equal(mapped.authors[0].user, undefined);
    assert.equal(mapped.contributors.length, 1); assert.equal(mapped.contributors[0].author.name, contributor.name);
    assert.equal(mapped.contributors[0].role, 'Photographs by');
    let html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: 'fixture' }) }));
    for (const text of [author.name, author.bio, author.role, contributor.name, contributor.bio, 'Photographs by', author.profileUrl, author.socials.website]) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('private@example.invalid')); assert.ok(!html.includes('staff@example.invalid'));
    author.bio = 'Edited profile reaches the same article.';
    html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: 'fixture' }) }));
    assert.ok(html.includes(author.bio));
    author.profileUrl = 'javascript:alert(1)'; author.socials.website = 'data:text/html,unsafe';
    const unsafe = await getPostBySlug('fixture');
    assert.equal(unsafe.authors[0].profileUrl, undefined); assert.equal(unsafe.authors[0].socials.website, undefined);
    console.log('PASS real public mapper and article renderer: profile propagation, contributors, avatar fallback, HTTP(S) links and private-field exclusion');
  } finally { delete globalThis.__authorPost; fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
