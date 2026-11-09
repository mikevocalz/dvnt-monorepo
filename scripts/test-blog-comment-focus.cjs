#!/usr/bin/env node
/**
 * Real PostPage, Comments, article CSS and AppShell; synthetic CMS/auth/network.
 * No production session, comment or newsletter request is used.
 * Desktop Chromium/WebKit with phone viewport/touch emulation are NOT a physical
 * iOS keyboard test. --baseline records the exact pre-fix focus CSS conditions;
 * it does not pretend a desktop engine reproduces Safari's keyboard auto-zoom.
 * --build-only checks the fixture graph without launching a browser.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const depPaths = [ROOT, path.join(ROOT, 'apps/web'), ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
const resolve = name => require.resolve(name, { paths: depPaths });
const load = name => require(resolve(name));
const baseline = process.argv.includes('--baseline');
const originalRef = '157610c2';
const commentFile = 'apps/web/src/components/Comments/index.tsx';
const cssFile = 'apps/web/src/app/(frontend)/styles/dvnt-theme.css';
const source = file => baseline && [commentFile, cssFile].includes(file)
  ? execFileSync('git', ['show', `${originalRef}:${file}`], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(path.join(ROOT, file), 'utf8');
const out = process.env.BLOG_COMMENT_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'blog-comment-focus-'));
fs.mkdirSync(out, { recursive: true });
const boundaries = new Map([
  // Isolate new count services while preserving real chrome/formatting/layout.
  ['@dvnt/app/lib/hooks/use-notifications-query', `export const useBadges=()=>({data:{unread:0,total:0}});`],
  ['@dvnt/app/lib/hooks/use-messages', `export const useUnreadMessageCount=()=>({data:0,spamCount:0});`],
  ['@dvnt/app/lib/badges/unread-badge', source('packages/app/lib/badges/unread-badge.ts')],
  ['@dvnt/app/lib/web-chrome', source('packages/app/lib/web-chrome.ts')],
  ['@dvnt/app/lib/auth-client', `export const getSession=async()=>({data:{session:location.search.includes('guest')?null:{token:'fixture-token'}}});`],
  ['@dvnt/app/lib/stores/auth-store', `export const useAuthStore=selector=>selector({user:{username:'fixture'},isAuthenticated:true});`],
  ['solito/navigation', `export const usePathname=()=>'/posts/fixture';export const useRouter=()=>({push:url=>{throw Error('Unexpected navigation: '+url)}});`],
  ['next/navigation', `export const notFound=()=>{throw Error('Unexpected notFound')};`],
  ['next/headers', `export const draftMode=async()=>({isEnabled:false});`],
  ['next/link', `export default function Link(props){return <a {...props}/>}`],
  ['next/image', `export default function Image({fill,priority,...props}){return <img {...props}/>}`],
  ['solito/image', `export const SolitoImage=props=><img {...props}/>;`],
  ['@dvnt/app/components/logo', `export default function Logo(){return <span>DVNT</span>}`],
  ['@dvnt/app/components/ui/html', `export {Header,Nav} from '@expo/html-elements';`],
  ['@/lib/posts', `export const getPostBySlug=async(slug)=>({id:'fixture-post',slug,seo:slug==='fixture-syndicated'?{canonicalUrl:'https://publisher.example/articles/syndicated'}:undefined,title:'Long article focus fixture',excerpt:'Synthetic article; no live data.',authors:[],categories:[],content:{root:{children:[{type:'heading',tag:'h2',children:[{text:'First section'}]}]}}});export const getLatestPosts=async()=>[];export const getPublishedPosts=async()=>[];export const getFeaturedPost=async()=>null;export const getEditorsPicks=async()=>[];export const getTrending=async()=>[];export const getCategories=async()=>[];export const getAllSlugs=async()=>['fixture'];export const mediaUrl=()=>'';export const formatByline=()=>'';export const formatDate=()=>'';export const formatDateShort=()=>'';`],
  ['@/lib/comments', `export const getCommentsForPost=async()=>[{id:'existing-comment',body:'Existing comment',createdAt:'2026-10-19T00:00:00Z',authorMember:{id:'1',username:'fixture'},children:[]}];export const buildTree=comments=>comments;`],
  ['@/components/RichText', `export function RichText(){return <><h2>First section</h2>{Array.from({length:35},(_,i)=><p key={i}>Paragraph {i+1}: A long article keeps the actual comment composer below the fold so a focus-driven jump or remount is observable. All content here is a synthetic local fixture.</p>)}</>}`],
]);
async function build() {
  const bundle = await load('esbuild').build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import PostPage,{generateMetadata} from './apps/web/src/app/(frontend)/posts/[slug]/page';import {metadata as indexMetadata} from './apps/web/src/app/(frontend)/posts/page';import {AppShell} from './packages/app/components/app-shell.web';(async()=>{window.__blogFixtureMetadata={article:await generateMetadata({params:Promise.resolve({slug:'fixture'})}),syndicated:await generateMetadata({params:Promise.resolve({slug:'fixture-syndicated'})}),index:indexMetadata};const page=await PostPage({params:Promise.resolve({slug:'fixture'})});createRoot(document.getElementById('root')).render(<AppShell>{page}</AppShell>);})();`, resolveDir: ROOT, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    jsxImportSource: 'react', tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } },
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
    nodePaths: [...new Set(depPaths.flatMap(p => [p, path.join(p, 'node_modules')]))],
    resolveExtensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js'],
    alias: { 'react-native': 'react-native-web' },
    plugins: [{ name: 'synthetic-service-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, a => boundaries.has(a.path) ? { path: a.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: boundaries.get(a.path), loader: 'tsx', resolveDir: ROOT }));
      b.onResolve({ filter: /^@\// }, a => ({ path: path.join(ROOT, 'apps/web/src', a.path.slice(2), 'index.tsx') }));
      if (baseline) b.onLoad({ filter: /components\/Comments\/index\.tsx$/ }, () => ({ contents: source(commentFile), loader: 'tsx' }));
    } }],
  });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#07090c;color:#fff}*{box-sizing:border-box}${source(cssFile)}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script>', '<\\/script>')}</script></body></html>`;
}
async function runCase(browser, name, viewport, isMobile, origin) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  // Exercise real share handlers without clipboard permissions or any external
  // post/navigation: only record their intended destinations inside the fixture.
  await page.addInitScript(() => {
    window.__copiedUrls = []; window.__openedUrls = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async url => { window.__copiedUrls.push(url); } } });
    window.open = url => { window.__openedUrls.push(url); return null; };
  });
  const errors = [], requests = [];
  let status = 200, pending = null;
  page.on('pageerror', error => errors.push(String(error)));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, origin, 'fixture must never contact an external service');
    if (url.pathname !== '/api/comments') return route.continue();
    if (request.method() === 'GET') return route.fulfill({ json: { memberId: '1' } });
    const body = request.postDataJSON();
    requests.push({ method: request.method(), body, authorization: request.headers().authorization });
    if (pending) await new Promise(resolve => { pending.resolve = resolve; });
    await route.fulfill({ status, json: { comment: { id: `created-${requests.length}`, ...body, authorMember: { id: '1', username: 'fixture' }, createdAt: '2026-10-19T00:00:00Z', editedAt: '2026-10-19T00:01:00Z' } } });
  });
  const metrics = async () => page.evaluate(() => ({
    y: scrollY, x: scrollX, height: innerHeight,
    viewportHeight: visualViewport.height, viewportWidth: visualViewport.width, scale: visualViewport.scale,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    active: document.activeElement?.getAttribute('placeholder'),
    font: getComputedStyle(document.querySelector('textarea')).fontSize,
  }));
  const keepBelowFold = async label => assert.ok((await metrics()).y > 1000, `${name}: ${label} must stay by comments, not the article top`);
  const center = async locator => {
    await locator.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  };
  const press = locator => isMobile ? locator.tap() : locator.click();
  const clickText = text => press(page.getByText(text, { exact: true }));
  const focusVisible = async locator => {
    // Observe after native focus has settled, before fill() can refocus it and
    // accidentally hide a jump. Touch events exercise the mobile input path.
    await press(locator);
    await page.waitForTimeout(250);
    const state = await locator.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { focused: document.activeElement === el, top: rect.top, bottom: rect.bottom, height: innerHeight };
    });
    assert.equal(state.focused, true, 'textarea retains focus');
    assert.ok(state.top >= 0 && state.bottom <= state.height, 'focused textarea remains in the viewport');
    await keepBelowFold('settled focus');
  };
  try {
    await page.goto(`${origin}/posts/fixture?guest`);
    await page.getByText('Sign in to the DVNT app to join the conversation.').waitFor();
    assert.equal(await page.locator('textarea').count(), 0, 'guest has no comment editor');
    assert.equal(requests.length, 0);
    await page.goto(`${origin}/posts/fixture`);
    const input = page.getByPlaceholder('Add a comment…');
    await input.waitFor();
    const publicArticleUrl = 'https://dvntapp.live/posts/fixture';
    const metadata = await page.evaluate(() => window.__blogFixtureMetadata);
    assert.equal(metadata.article.alternates.canonical, publicArticleUrl, 'default canonical uses the working public origin');
    assert.equal(metadata.article.openGraph.url, publicArticleUrl, 'Open Graph shares the same public URL');
    assert.equal(metadata.index.alternates.canonical, 'https://dvntapp.live/posts', 'index canonical points to the actual blog route');
    assert.equal(metadata.syndicated.alternates.canonical, 'https://publisher.example/articles/syndicated', 'editor-supplied canonical override remains intact');
    const structuredData = await page.locator('script[type="application/ld+json"]').evaluate(el => JSON.parse(el.textContent));
    assert.equal(structuredData.mainEntityOfPage, publicArticleUrl);
    assert.equal(structuredData.breadcrumb.itemListElement[0].item, 'https://dvntapp.live/posts');
    assert.equal(structuredData.breadcrumb.itemListElement[1].item, publicArticleUrl);
    await center(input);
    await keepBelowFold('before focus');
    const before = await metrics();
    const node = await input.elementHandle();
    await focusVisible(input);
    const focused = await metrics();
    assert.equal(focused.font, baseline ? '14px' : '16px');
    assert.equal(focused.scrollBehavior, baseline ? 'smooth' : 'auto');
    await keepBelowFold('focus');
    if (!baseline) assert.equal(await input.getAttribute('aria-label'), 'Add a comment');
    await input.fill('   ');
    assert.equal(await page.getByText('Comment', { exact: true }).locator('..').getAttribute('aria-disabled'), 'true', 'blank comments remain disabled');
    await input.fill('First line\nSecond line');
    await input.press('Enter');
    assert.equal(requests.length, 0, 'multiline Enter must not submit or navigate');
    await keepBelowFold('typing');
    // Real visualViewport.resize and RNW Dimensions rerenders. Browser viewport
    // resizing models geometry, not an iPhone software keyboard or auto-zoom.
    await page.setViewportSize({ width: viewport.width, height: Math.max(360, viewport.height - 330) });
    await page.waitForFunction(() => window.visualViewport.height < 600);
    await input.pressSequentially('Still here');
    assert.equal(await node.evaluate(el => el === document.querySelector('textarea')), true, 'keyboard geometry must not remount textarea');
    await keepBelowFold('keyboard-height resize');
    assert.equal(await input.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return document.activeElement === el && rect.top >= 0 && rect.bottom <= visualViewport.height;
    }), true, 'focused composer stays visible while typing after keyboard-height resize');
    await page.setViewportSize(viewport);
    await keepBelowFold('keyboard close');
    await center(input);
    await page.screenshot({ path: path.join(out, `${name}-${baseline ? 'baseline' : 'focused'}.png`) });
    // Pending and rejected posts preserve the draft and article position.
    status = 403; pending = {};
    await clickText('Comment');
    await page.getByText('Posting…', { exact: true }).waitFor();
    assert.equal(requests.length, 1);
    while (!pending.resolve) await new Promise(resolve => setTimeout(resolve, 10));
    pending.resolve(); pending = null;
    await page.getByText("You can't comment right now.").waitFor();
    assert.match(await input.inputValue(), /Still here/);
    await keepBelowFold('validation failure');
    status = 200;
    await clickText('Comment');
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
    await keepBelowFold('submit');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].body.postId, 'fixture-post');
    assert.equal(requests[1].authorization, 'Bearer fixture-token');
    const first = page.getByText('Existing comment', { exact: true }).locator('..');
    await press(first.getByText('Reply', { exact: true }));
    const reply = page.getByPlaceholder('Write a reply…');
    await center(reply); await focusVisible(reply); await reply.fill('Nested fixture reply');
    await keepBelowFold('reply focus/type');
    if (!baseline) assert.equal(await reply.getAttribute('aria-label'), 'Write a reply');
    assert.equal(await reply.evaluate(el => getComputedStyle(el).fontSize), baseline ? '14px' : '16px');
    await press(reply.locator('..').getByText('Reply', { exact: true }));
    await page.getByText('Nested fixture reply', { exact: true }).waitFor();
    assert.equal(requests[2].body.parentId, 'existing-comment');
    await keepBelowFold('reply submit');
    await press(first.getByText('Edit', { exact: true }).first());
    const edit = page.getByPlaceholder('Edit your comment…');
    await edit.waitFor();
    assert.equal(await edit.evaluate(el => document.activeElement === el), true, 'edit keeps autofocus');
    assert.equal(await edit.evaluate(el => getComputedStyle(el).fontSize), baseline ? '14px' : '16px');
    await edit.fill('Discard this draft'); await clickText('Cancel');
    assert.equal(requests.length, 3, 'cancel has no mutation');
    await press(first.getByText('Edit', { exact: true }).first());
    await edit.fill('Edited fixture comment'); await clickText('Save');
    await page.getByText('Edited fixture comment', { exact: true }).waitFor();
    assert.equal(requests[3].method, 'PATCH');
    await keepBelowFold('edit save');
    // Repeated focus/blur; restoring smooth article navigation after editing.
    for (let i = 0; i < 3; i++) { await center(input); await focusVisible(input); await input.fill(`Repeat ${i}`); await input.press('Tab'); await keepBelowFold('repeat focus'); }
    await page.getByRole('heading', { name: 'Comments', exact: true }).click();
    assert.equal((await metrics()).scrollBehavior, 'smooth', 'normal article smooth scrolling remains available');
    await page.screenshot({ path: path.join(out, `${name}-${baseline ? 'baseline' : 'after'}-submitted.png`) });
    // Exercise the real table-of-contents action after leaving the composer;
    // computed CSS alone would not catch a broken anchor interaction.
    const articleUrl = page.url();
    if (isMobile) await press(page.getByRole('button', { name: 'Toggle table of contents' }));
    const tocBefore = await page.locator('#first-section').evaluate(el => ({ top: el.getBoundingClientRect().top, y: scrollY, transform: getComputedStyle(el).transform }));
    await press(page.getByRole('button', { name: 'First section', exact: true }));
    let toc;
    try {
      // ScrollReveal can remove its 16px translation after the TOC has measured
      // the target. Allow that existing visual offset plus 2px rounding, while
      // still requiring the actual heading near the intended 100px destination.
      await page.waitForFunction(() => {
        const heading = document.getElementById('first-section');
        return heading && Math.abs(heading.getBoundingClientRect().top - 100) <= 18;
      });
      // Read after both native smooth scroll and the 0.7s reveal settle.
      await page.waitForTimeout(750);
      toc = await page.locator('#first-section').evaluate(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, y: scrollY, transform: getComputedStyle(el).transform, height: innerHeight }));
      assert.ok(Math.abs(toc.top - 100) <= 18 && toc.bottom <= toc.height, `TOC must settle on visible heading: ${JSON.stringify(toc)}`);
    } finally {
      const actual = await page.locator('#first-section').evaluate(el => ({ top: el.getBoundingClientRect().top, y: scrollY, transform: getComputedStyle(el).transform }));
      fs.writeFileSync(path.join(out, `${name}-${baseline ? 'baseline' : 'current'}-toc.json`), JSON.stringify({ before: tocBefore, after: actual }, null, 2));
      await page.screenshot({ path: path.join(out, `${name}-${baseline ? 'baseline' : 'current'}-toc.png`) });
      console.log(`TOC ${name}: ${JSON.stringify({ before: tocBefore, after: actual })}`);
    }
    assert.equal(page.url(), articleUrl, 'TOC scrolling does not navigate away');
    assert.equal(await input.inputValue(), 'Repeat 2', 'TOC does not discard the comment draft');
    await press(page.getByRole('button', { name: 'Copy link', exact: true }).filter({ visible: true }));
    assert.deepEqual(await page.evaluate(() => window.__copiedUrls), [publicArticleUrl], 'Copy link uses the reachable apex article');
    await press(page.getByRole('button', { name: 'Share on X', exact: true }).filter({ visible: true }));
    const shareUrl = new URL(await page.evaluate(() => window.__openedUrls[0]));
    assert.equal(shareUrl.origin, 'https://x.com');
    assert.equal(shareUrl.pathname, '/intent/tweet');
    assert.equal(shareUrl.searchParams.get('url'), publicArticleUrl, 'social share uses the same article URL');
    assert.equal(page.url(), articleUrl, 'share controls preserve the current article');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal((await metrics()).scrollBehavior, 'auto', 'reduced motion remains respected');
    assert.deepEqual(errors, [], 'no error-boundary-triggering render errors');
    const result = { name, baseline, before, focused, toc, after: await metrics(), requests: requests.map(r => ({ method: r.method, parentId: r.body.parentId })), physicalIOSKeyboardTested: false };
    fs.writeFileSync(path.join(out, `${name}-${baseline ? 'baseline' : 'result'}.json`), JSON.stringify(result, null, 2));
    console.log(`PASS ${name}: ${baseline ? 'pre-fix 14px/smooth focus conditions recorded' : '16px/native focus scrolling'}, auth/guest, multiline, keyboard geometry, submit/reject/reply/edit, repeat focus, TOC, public share/canonical URLs, reduced motion`);
  } finally { await context.close(); }
}
(async () => {
  const html = await build();
  if (process.argv.includes('--build-only')) { console.log(`PASS: real article + Comments + AppShell fixture bundles (${html.length} bytes)`); return; }
  const server = http.createServer((request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const playwright = load('playwright');
  try {
    for (const engine of ['chromium', 'webkit']) {
      const browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' && process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
      try {
        await runCase(browser, `${engine}-375`, { width: 375, height: 812 }, true, origin);
        await runCase(browser, `${engine}-390`, { width: 390, height: 844 }, true, origin);
        await runCase(browser, `${engine}-1440`, { width: 1440, height: 900 }, false, origin);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
