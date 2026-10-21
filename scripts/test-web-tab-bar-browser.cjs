#!/usr/bin/env node
// Actual AppShell/WebTabBar + React Native Web in Chromium, no backend needed.
// Router, auth and unrelated top chrome are isolated; positioning is not mocked.
// Uses the repository's esbuild/React/Playwright test stack. Set
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use an installed browser in CI.
// --dom runs the runtime/DOM lane when browser processes are unavailable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-tab-bar-browser-'));
  let browser;
  let domWindow;
  const domOnly = process.argv.includes('--dom');
  const mocks = {
    'solito/navigation': `export const usePathname = () => '/feed'; export const useRouter = () => ({ push: route => window.tabbarFixture.routes.push(route) });`,
    '@dvnt/app/lib/stores/auth-store': `export const useAuthStore = selector => selector({user:{username:'member'}});`,
    '@dvnt/app/components/logo': `export default function Logo() { return <span>DVNT</span>; }`,
    './web-top-bar.web': `export const WebTopBar = () => <header>DVNT mobile header</header>;`,
  };
  const options = {
    bundle: true,
    jsx: 'automatic',
    tsconfigRaw: {},
    alias: { '@dvnt/app': path.join(root, 'packages/app'), 'react-native': 'react-native-web' },
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    plugins: [{ name: 'tab-bar-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const key = mocks[args.path] ? args.path : Object.keys(mocks).find(key => key.startsWith('@dvnt/app/') && args.path === path.join(root, 'packages/app', key.slice('@dvnt/app/'.length)));
        if (key) return { path: key, namespace: 'mock' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    } }],
  };
  try {
    // SSR never touches document and emits no portal markup to mismatch on hydration.
    await build({ ...options, stdin: { contents: `
      import React from 'react'; import { renderToString } from 'react-dom/server';
      import { WebTabBar } from './packages/app/components/web-tab-bar.web';
      export const html = renderToString(<WebTabBar/>);
    `, resolveDir: root, loader: 'tsx' }, platform: 'node', format: 'cjs', outfile: path.join(dir, 'server.cjs') });
    assert.equal(require(path.join(dir, 'server.cjs')).html, '');

    await build({ ...options, stdin: { contents: `
      import React, { act, useEffect, useState } from 'react'; import { createRoot, hydrateRoot } from 'react-dom/client';
      import { AppShell } from './packages/app/components/app-shell.web';
      import { WebTabBar } from './packages/app/components/web-tab-bar.web';
      const root = createRoot(document.getElementById('root'));
      const fixture = window.tabbarFixture = { routes: [], mounts: 0, unmounts: 0 };
      function Content() {
        const [value, setValue] = useState('retained');
        useEffect(() => { fixture.mounts++; return () => { fixture.unmounts++; }; }, []);
        return <div style={{height:3200}}><input aria-label="Retained value" value={value} onChange={e => setValue(e.target.value)}/><p>Long feed</p></div>;
      }
      fixture.render = mode => root.render(<React.StrictMode>{mode === 'standalone' ? <WebTabBar/> : <AppShell><Content/></AppShell>}</React.StrictMode>);
      fixture.unmount = () => root.unmount();
      fixture.hydrateBar = (node, onRecoverableError) => hydrateRoot(node, <WebTabBar/>, {onRecoverableError});
      export { act };
    `, resolveDir: root, loader: 'tsx' }, platform: domOnly ? 'node' : 'browser', format: domOnly ? 'cjs' : 'iife', outfile: path.join(dir, 'client.js') });

    if (domOnly) {
      const { Window } = await import(require.resolve('happy-dom'));
      domWindow = new Window();
      Object.assign(global, { window: domWindow, document: domWindow.document, HTMLElement: domWindow.HTMLElement, ShadowRoot: domWindow.ShadowRoot, IS_REACT_ACT_ENVIRONMENT: true });
      let width = 375;
      Object.defineProperties(document.documentElement, {
        clientWidth: { get: () => width }, clientHeight: { get: () => 812 },
      });
      document.body.innerHTML = '<div style="transform:translateZ(0);overflow:auto;contain:paint"><div id="root"></div></div>';
      const { act } = require(path.join(dir, 'client.js'));
      const fixture = window.tabbarFixture;
      const bar = () => document.querySelector('[data-dvnt-tab-bar]');
      const checkBar = () => {
        assert.ok(bar()); assert.equal(bar().parentElement, document.body);
        assert.equal(bar().style.position, 'fixed'); assert.equal(bar().style.bottom, 'auto'); assert.equal(bar().style.transform, 'translateY(-100%)');
        assert.equal(document.querySelectorAll('[data-dvnt-tab-bar]').length, 1);
      };
      const hydrationNode = document.createElement('div');
      document.body.append(hydrationNode);
      const hydrationErrors = [];
      let hydrationRoot;
      await act(async () => { hydrationRoot = fixture.hydrateBar(hydrationNode, error => hydrationErrors.push(error)); });
      checkBar(); assert.deepEqual(hydrationErrors, []);
      await act(async () => hydrationRoot.unmount());
      hydrationNode.remove(); assert.equal(bar(), null);
      await act(async () => fixture.render('shell'));
      checkBar();
      const content = document.querySelector('input');
      const mounts = fixture.mounts;
      await act(async () => bar().querySelector('[aria-label="Events"]').click());
      await act(async () => bar().querySelector('[aria-label="Create"]').click());
      assert.deepEqual(fixture.routes, ['/events', '/feed/create']);
      for (const nextWidth of [767, 768, 1024, 1440, 375]) {
        await act(async () => { width = nextWidth; window.dispatchEvent(new window.Event('resize')); });
        if (nextWidth < 768) checkBar(); else assert.equal(bar(), null);
        assert.equal(document.querySelectorAll('nav[aria-label="Primary"]').length, 1);
        assert.equal(document.querySelector('input'), content);
        assert.equal(fixture.mounts, mounts, 'resizing does not remount route content');
      }
      await act(async () => { width = 1280; window.dispatchEvent(new window.Event('resize')); fixture.render('standalone'); });
      assert.equal(bar().style.bottom, '18px'); assert.equal(bar().parentElement, document.body);
      await act(async () => fixture.unmount());
      assert.equal(bar(), null, 'portal is removed with its owning shell');
      console.log('PASS real WebTabBar/AppShell DOM: SSR + hydration, body portal, navigation, 375–1440px breakpoints, one primary nav, preserved route node/state, desktop offset, StrictMode cleanup. Browser geometry requires the default lane.');
      return;
    }


    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Load the production clearance CSS, rather than copying its dimensions.
    const css = fs.readFileSync(path.join(root, 'apps/web/src/app/(frontend)/globals.css'), 'utf8');
    const chromeCSS = css.slice(css.indexOf(':root {'), css.indexOf('/* Global rounded'));
    assert.ok(chromeCSS.includes('--dvnt-tabbar-clearance'));
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0;background:#06070d}*{box-sizing:border-box}${chromeCSS}</style></head><body><div style="height:120px"></div><div id="containing-block" style="transform:translateZ(0);contain:paint;overflow:auto;height:500px"><div id="root"></div></div><div style="height:2500px"></div></body></html>`);
    await page.addScriptTag({ path: path.join(dir, 'client.js') });
    await page.evaluate(() => window.tabbarFixture.render('shell'));
    const bar = page.locator('[data-dvnt-tab-bar]');
    await bar.waitFor();
    const geometry = () => bar.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      const panel = el.firstElementChild;
      return {
        bottom: bounds.bottom, left: bounds.left, right: bounds.right,
        height: bounds.height, viewportHeight: window.innerHeight, viewportWidth: window.innerWidth,
        fixed: getComputedStyle(el).position, bodyChild: el.parentElement === document.body,
        paddingBottom: parseFloat(getComputedStyle(panel).paddingBottom),
        clearance: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dvnt-tabbar-clearance')),
      };
    });
    const pinned = async () => {
      const g = await geometry();
      assert.equal(g.fixed, 'fixed');
      assert.equal(g.bodyChild, true, 'the tab bar escapes transformed/contained scroll ancestors');
      assert.ok(Math.abs(g.bottom - g.viewportHeight) < 1, JSON.stringify(g));
      assert.equal(g.left, 0); assert.equal(g.right, g.viewportWidth);
      assert.ok(g.height >= g.clearance, 'the touch bar has a stable minimum height');
      return g;
    };
    await pinned();
    await page.locator('input').fill('keep my draft');
    const baselineMounts = await page.evaluate(() => window.tabbarFixture.mounts);
    for (const scrollY of [400, 1500, 2300, 0]) {
      await page.evaluate(y => window.scrollTo(0, y), scrollY);
      await pinned();
    }
    for (const scrollTop of [600, 2100, 0]) {
      await page.locator('#containing-block').evaluate((el, top) => { el.scrollTop = top; }, scrollTop);
      await pinned();
    }
    await bar.getByRole('button', { name: 'Events', exact: true }).click();
    await bar.getByRole('button', { name: 'Create', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.tabbarFixture.routes), ['/events', '/feed/create']);

    for (const viewport of [{width:390,height:844},{width:767,height:1024},{width:375,height:560}]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(() => document.querySelector('[data-dvnt-tab-bar]')?.getBoundingClientRect().bottom === innerHeight);
      await pinned();
    }

    // Chromium's real safe-area environment, not a substituted padding value.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: 34 } });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-dvnt-tab-bar]').firstElementChild).paddingBottom === '42px');
    const inset = await pinned();
    assert.equal(inset.paddingBottom, 42);
    assert.ok(Math.abs(inset.height - inset.clearance - 34) < 1, 'the home-indicator area is added exactly once');
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: 0 } });

    // Resize the actual shell across the breakpoint: one rail OR one bar, and
    // the page is never remounted (important for calls and in-progress forms).
    for (const width of [768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await bar.waitFor({state:'detached'});
      assert.equal(await page.getByRole('navigation', { name: 'Primary' }).count(), 1);
      assert.equal(await page.locator('input').inputValue(), 'keep my draft');
      assert.equal(await page.evaluate(() => window.tabbarFixture.mounts), baselineMounts);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dvnt-tabbar-clearance').trim()), '0px');
    }
    await page.setViewportSize({width:375,height:812});
    await bar.waitFor(); await pinned();
    assert.equal(await page.locator('input').inputValue(), 'keep my draft');
    assert.equal(await page.evaluate(() => window.tabbarFixture.mounts), baselineMounts);
    assert.equal(await page.getByRole('navigation', { name: 'Primary' }).count(), 1);

    // The standalone component preserves its desktop floating-pill geometry.
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(() => window.tabbarFixture.render('standalone'));
    await bar.waitFor();
    const desktop = await geometry();
    assert.equal(desktop.bottom, 882);
    const panel = await bar.locator(':scope > div').boundingBox();
    assert.equal(panel.width, 460); assert.equal(panel.x, (1280 - 460) / 2);
    await page.evaluate(() => window.scrollTo(0, 1200));
    assert.equal((await geometry()).bottom, 882);
    await page.evaluate(() => window.tabbarFixture.unmount());
    await bar.waitFor({state:'detached'});
    assert.deepEqual(errors, []);
    console.log('PASS real WebTabBar/AppShell in Chromium: SSR, body portal, transformed + contained ancestors, document/nested scrolling, safe-area 34px, 375–1440px breakpoints, viewport-height changes, navigation, preserved page state, desktop pill, cleanup.');
  } finally {
    if (browser) await browser.close();
    if (domWindow) await domWindow.happyDOM.abort();
    fs.rmSync(dir, {recursive:true,force:true});
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
