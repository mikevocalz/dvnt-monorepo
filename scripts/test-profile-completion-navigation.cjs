// Real Next App Router regression: production shells + popup + Solito + RNW.
// Only auth/progress/JWT, unread services, marketing chrome, and native CSS leaves are fixtures.
// Run after installing the workspace dependencies and Playwright Chromium:
//   node scripts/test-profile-completion-navigation.cjs
// NODE_PATH may point at an existing read-only dependency installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(__dirname, 'fixtures/profile-navigation');
const resolveDependency = name => require.resolve(name, { paths: [ROOT, path.join(ROOT, 'apps/web')] });
const BASELINE = process.argv.includes('--baseline-regression');
const COMPLETE = { step: 'complete', required: false, hasPhoto: true, hasPost: true, emailVerified: true, adultVerified: true };
const FIRST_POST = { ...COMPLETE, step: 'first_post', required: true, hasPost: false };
const PHOTO = { ...COMPLETE, step: 'photo', required: true, hasPhoto: false };
const desktopRoutes = [
  ['Events', '/events'], ['Blog', '/blog'], ['Search', '/feed/search'],
  ['Activity', '/notifications'], ['Messages', '/feed/messages'],
  ['Game Night', '/game-night'], ['Profile', '/feed/profile'],
  ['Create', '/feed/create'], ['Home', '/feed'],
];
const mobileRoutes = [
  ['Events', '/events'], ['Activity', '/notifications'],
  ['Profile', '/profile/fixture_member'], ['Home', '/feed'],
  ['Search', '/feed/search'], ['Blog', '/blog'],
  ['Messages', '/feed/messages'], ['Create', '/feed/create'], ['Home', '/feed'],
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const quoted = value => JSON.stringify(value);
function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}
function prepareFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-profile-navigation-'));
  // All generated files, Next caches, and symlinks live outside the checkout.
  // No dependency install, lockfile edit, account, or live data is required.
  write(path.join(directory, 'package.json'), '{"private":true,"name":"dvnt-profile-navigation-fixture"}\n');
  write(path.join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', jsx: 'react-jsx', jsxImportSource: 'react', module: 'esnext', moduleResolution: 'bundler', esModuleInterop: true, skipLibCheck: true, allowJs: true, noEmit: true }, include: ['**/*.ts', '**/*.tsx', '.next/types/**/*.ts'] }));
  fs.copyFileSync(path.join(SOURCE, 'next.config.cjs'), path.join(directory, 'next.config.js'));
  const dependencies = [path.join(ROOT, 'node_modules'), path.join(ROOT, 'apps/web/node_modules'), ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
  const modules = path.join(directory, 'node_modules');
  fs.mkdirSync(modules);
  for (const depRoot of dependencies) {
    if (!fs.existsSync(depRoot)) continue;
    for (const entry of fs.readdirSync(depRoot)) {
      if (entry.startsWith('.')) continue;
      const target = path.join(modules, entry);
      if (entry.startsWith('@')) {
        fs.mkdirSync(target, { recursive: true });
        for (const child of fs.readdirSync(path.join(depRoot, entry))) {
          const link = path.join(target, child);
          if (!fs.existsSync(link)) fs.symlinkSync(path.join(depRoot, entry, child), link, 'junction');
        }
      } else if (!fs.existsSync(target)) fs.symlinkSync(path.join(depRoot, entry), target, 'junction');
    }
  }
  const client = quoted(path.join(SOURCE, 'client.tsx'));
  write(path.join(directory, 'app/layout.tsx'), `import {FixtureRoot} from ${client};\nimport './style.css';\nexport default function Layout({children}) { return <html lang="en"><body><FixtureRoot>{children}</FixtureRoot></body></html>; }\n`);
  write(path.join(directory, 'app/style.css'), 'body{margin:0;background:#06070d;color:white;font:16px system-ui}a{color:#3fdcff}button{cursor:pointer}[role="dialog"]{position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center;padding:20px;background:#000b}[role="dialog"]>div{background:#101321;padding:24px}[role="dialog"] button{padding:12px;margin:6px;color:white;background:#483969;border:1px solid #888;border-radius:8px}\n');
  // These are separate real App Router route groups with distinct layouts.
  const groups = {
    application: ['/feed', '/feed/search', '/feed/messages', '/feed/profile', '/feed/create', '/feed/onboarding/photo', '/feed/events/my-tickets', '/notifications', '/profile/fixture_member'],
    public: ['/events', '/blog', '/game-night', '/settings'],
  };
  for (const [group, routes] of Object.entries(groups)) {
    const groupRoot = path.join(directory, 'app', `(${group})`);
    write(path.join(groupRoot, 'layout.tsx'), `import {Section} from ${client};\nexport default function Layout({children}) { return <Section name=${quoted(group)}>{children}</Section>; }\n`);
    for (const route of routes) write(path.join(groupRoot, route, 'page.tsx'), `import {FixturePage} from ${client};\nexport default function Page(){ return <FixturePage path=${quoted(route)}/>; }\n`);
  }
  return directory;
}
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function runBrowser(baseURL, evidenceFile) {
  let chromium;
  try { ({ chromium } = require(resolveDependency('playwright'))); } catch { ({ chromium } = require(resolveDependency('@playwright/test'))); }
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  try {
    for (const [name, viewport, routes] of [
      ['desktop', { width: 1440, height: 1000 }, desktopRoutes],
      ['mobile', { width: 390, height: 844 }, mobileRoutes],
    ]) {
      const context = await browser.newContext({ viewport });
      // All browser HTTP traffic is constrained to this fictional local fixture.
      const forbidden = [];
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(baseURL + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        forbidden.push(url); return route.abort();
      });
      await context.addInitScript(() => {
        window.__profileEvidence = { documentId: crypto.randomUUID(), routes: [], dialogs: [], hostMounts: 0, hostUnmounts: 0, sectionMounts: [], sectionUnmounts: [] };
        const seen = new WeakSet();
        const record = node => {
          if (!(node instanceof Element)) return;
          for (const dialog of [...(node.matches('[role="dialog"]') ? [node] : []), ...node.querySelectorAll('[role="dialog"]')]) {
            if (seen.has(dialog)) continue;
            seen.add(dialog);
            window.__profileEvidence.dialogs.push({ path: location.pathname, text: dialog.textContent, time: performance.now() });
          }
        };
        new MutationObserver(records => records.forEach(record_ => record_.addedNodes.forEach(record))).observe(document, { childList: true, subtree: true });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors = [], documents = [], steps = [];
      const result = { viewport: name, passed: false, documentRequests: documents, steps, errors };
      results.push(result);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
      const read = () => page.evaluate(() => ({ ...window.__profileEvidence, requests: window.profileNavigation.progress.requests.length }));
      const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const noDialog = async () => { await frames(); assert.equal(await page.getByRole('dialog').count(), 0); };
      const waitPath = async route => {
        await page.waitForURL(baseURL + route);
        await page.getByTestId('route-heading').filter({ hasText: new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).waitFor();
        await page.waitForFunction(route_ => window.__profileEvidence.routes.at(-1) === route_, route);
      };
      const checkpoint = async label => { const value = await read(); steps.push({ label, path: new URL(page.url()).pathname, requests: value.requests, dialogs: value.dialogs.length, documentId: value.documentId }); return value; };
      await page.goto(baseURL + '/feed');
      await page.waitForFunction(() => !!window.profileNavigation && window.profileNavigation.progress.requests.length > 0);
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.getByRole('navigation', { name: 'Primary', exact: true }).waitFor();
      const initial = await checkpoint('initial confirmed complete');
      if (BASELINE) {
        await page.evaluate(() => { window.profileNavigation.progress.manual = true; });
        await page.getByRole('button', { name: 'Events', exact: true }).click();
        await waitPath('/events');
        await page.waitForFunction(n => window.profileNavigation.progress.requests.length > n, initial.requests);
        await page.evaluate(() => window.profileNavigation.settle()); await noDialog();
        const before = await checkpoint('baseline defect: primary navigation refetched');
        await page.evaluate(() => window.profileNavigation.setHostMounted(false));
        await page.waitForFunction(n => window.__profileEvidence.hostUnmounts > n, before.hostUnmounts);
        await page.evaluate(() => window.profileNavigation.setHostMounted(true));
        await page.waitForFunction(n => window.profileNavigation.progress.requests.length > n, before.requests);
        await page.getByText('Checking your profile…', { exact: true }).waitFor();
        const after = await checkpoint('baseline defect: remount flashed checking dialog');
        assert.ok(after.dialogs.length > before.dialogs.length, 'baseline must reproduce the popup recurrence');
        assert.equal(after.documentId, initial.documentId);
        assert.equal(documents.length, 1);
        assert.deepEqual(errors, []);
        assert.deepEqual(forbidden, []);
        Object.assign(result, { passed: true, expectedBaselineDefectReproduced: true, final: after });
        await context.close();
        continue;
      }
      assert.equal(initial.requests, 1, `${name}: StrictMode must not duplicate initial read`);
      const assertSessionUnchanged = async label => {
        await noDialog();
        const state = await checkpoint(label);
        assert.equal(state.documentId, initial.documentId, `${name}/${label}: document reloaded`);
        assert.equal(documents.length, 1, `${name}/${label}: ordinary navigation requested a new document`);
        assert.equal(state.dialogs.length, initial.dialogs.length, `${name}/${label}: popup appeared for completed member`);
        assert.equal(state.requests, initial.requests, `${name}/${label}: completed session refetched`);
      };
      for (let cycle = 1; cycle <= 2; cycle++) {
        for (const [label, target] of routes) {
          await page.getByRole('button', { name: label, exact: true }).click();
          await waitPath(target);
          await assertSessionUnchanged(`primary ${label}, cycle ${cycle}`);
        }
      }
      await page.getByRole('link', { name: 'Fixture settings', exact: true }).click();
      await waitPath('/settings'); await assertSessionUnchanged('Next Link crossing route group');
      await page.goBack(); await waitPath('/feed'); await assertSessionUnchanged('browser Back');
      await page.goForward(); await waitPath('/settings'); await assertSessionUnchanged('browser Forward');
      const groups = await read();
      assert.ok(groups.sectionMounts.includes('application') && groups.sectionMounts.includes('public'));
      assert.ok(groups.sectionUnmounts.includes('application') && groups.sectionUnmounts.includes('public'));

      await page.evaluate(() => { const state = window.profileNavigation.getAuth(); window.profileNavigation.replaceAuth({ ...state, user: { ...state.user } }); });
      await assertSessionUnchanged('equal-value auth snapshot replacement');
      await page.evaluate(() => { const user = window.profileNavigation.getAuth().user; window.profileNavigation.replaceAuth({ user: { ...user, avatar: 'fictional-cache-refresh', postsCount: 0 } }); });
      await assertSessionUnchanged('ordinary avatar/count cache churn');
      const beforeUnmount = await read();
      await page.evaluate(() => window.profileNavigation.setHostMounted(false));
      await page.waitForFunction(n => window.__profileEvidence.hostUnmounts > n, beforeUnmount.hostUnmounts);
      await page.evaluate(() => window.profileNavigation.setHostMounted(true));
      await page.waitForFunction(n => window.__profileEvidence.hostMounts > n, beforeUnmount.hostMounts);
      await assertSessionUnchanged('actual popup host unmount/remount');

      // Auth transitions while no host is mounted must invalidate old evidence.
      await page.evaluate(() => window.profileNavigation.setHostMounted(false));
      await frames();
      await page.evaluate(() => {
        const saved = window.profileNavigation.getAuth();
        window.profileNavigation.progress.manual = true;
        window.profileNavigation.replaceAuth({ user: null, isAuthenticated: false });
        window.profileNavigation.replaceAuth(saved);
      });
      await page.evaluate(() => window.profileNavigation.setHostMounted(true));
      await page.waitForFunction(n => window.profileNavigation.progress.requests.length === n + 1, initial.requests);
      await noDialog();
      await page.evaluate(() => window.profileNavigation.settle()); await noDialog();
      await checkpoint('same-member re-login while popup host absent');

      // Authentication can replace a session without changing the profile
      // snapshot at all; exercise the production explicit lifecycle signal.
      const beforeBoundary = (await read()).requests;
      await page.evaluate(() => {
        const authId = window.profileNavigation.getAuth().user.authId;
        window.profileNavigation.publishSessionBoundary({ ready: false });
        window.profileNavigation.publishSessionBoundary({ ready: true, authId });
      });
      await page.waitForFunction(n => window.profileNavigation.progress.requests.length === n + 1, beforeBoundary);
      await noDialog();
      await page.evaluate(() => window.profileNavigation.settle()); await noDialog();
      await checkpoint('same-ID explicit authentication session replacement');

      for (const [label, result, action] of [
        ['confirmed first-post deletion', FIRST_POST, 'Create my first post'],
        ['confirmed avatar removal', PHOTO, 'Add my profile picture'],
      ]) {
        const before = (await read()).requests;
        await page.evaluate(result_ => { window.profileNavigation.progress.result = result_; window.profileNavigation.invalidate(); }, result);
        await page.waitForFunction(n => window.profileNavigation.progress.requests.length === n + 1, before);
        await noDialog();
        await page.evaluate(() => window.profileNavigation.settle());
        await page.getByRole('button', { name: action, exact: true }).waitFor();
        await checkpoint(label);
      }
      const beforeRestore = (await read()).requests;
      await page.evaluate(result => { window.profileNavigation.progress.result = result; window.profileNavigation.invalidate(); }, COMPLETE);
      await page.waitForFunction(n => window.profileNavigation.progress.requests.length === n + 1, beforeRestore);
      await page.evaluate(() => window.profileNavigation.settle()); await noDialog();
      await checkpoint('confirmed writes restored completion');
      result.sameDocumentEvidence = await read();

      // Deliberate reload is the one operation that SHOULD discard evidence.
      await page.reload();
      await page.waitForFunction(() => !!window.profileNavigation && window.profileNavigation.progress.requests.length > 0);
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      const fresh = await checkpoint('new document performs a fresh server check');
      assert.notEqual(fresh.documentId, initial.documentId);
      assert.equal(documents.length, 2);
      assert.equal(fresh.requests, 1);
      assert.deepEqual(errors, []);
      assert.deepEqual(forbidden, []);
      Object.assign(result, { passed: true, final: fresh });
      await context.close();
    }
  } finally {
    await browser.close();
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, JSON.stringify({ mode: BASELINE ? 'baseline-defect-reproduction' : 'fixed-regression', nextVersion: require(resolveDependency('next/package.json')).version, results }, null, 2) + '\n');
  }
  console.log(BASELINE
    ? `PASS: frozen baseline reproduced extra navigation reads and a remount popup in the same real Next document on desktop/mobile.\nEvidence: ${evidenceFile}`
    : `PASS: real Next App Router desktop/mobile primary navigation, route groups, Back/Forward, equal auth snapshots, local cache churn, host remount, host-absent re-login, confirmed mutations and fresh documents.\nEvidence: ${evidenceFile}`);
}
(async () => {
  if (BASELINE && !process.env.PROFILE_NAVIGATION_POPUP_PATH) process.env.PROFILE_NAVIGATION_POPUP_PATH = path.join(SOURCE, 'baseline-popup.tsx');
  const evidenceFile = path.resolve(process.env.PROFILE_NAVIGATION_EVIDENCE || path.join(os.tmpdir(), BASELINE ? 'dvnt-profile-navigation-baseline-evidence.json' : 'dvnt-profile-navigation-evidence.json'));
  if (process.env.PROFILE_NAVIGATION_BASE_URL) return runBrowser(process.env.PROFILE_NAVIGATION_BASE_URL.replace(/\/$/, ''), evidenceFile);
  const directory = prepareFixture();
  console.log(`Fixture: ${directory}`);
  if (process.argv.includes('--prepare-only')) return;
  const port = Number(process.env.PROFILE_NAVIGATION_PORT) || await unusedPort();
  const baseURL = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [resolveDependency('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: directory, env: { ...process.env, DVNT_PROFILE_REPO: ROOT, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; if (process.env.PROFILE_NAVIGATION_VERBOSE) process.stderr.write(data); });
  try {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Next exited with ${child.exitCode}:\n${output}`);
      try { const response = await fetch(baseURL + '/feed'); if (response.ok) break; } catch {}
      await pause(250);
    }
    if (Date.now() >= deadline) throw new Error(`Next did not become ready:\n${output}`);
    if (process.argv.includes('--serve')) {
      console.log(`Ready: ${baseURL}\nDVNT_PROFILE_REPO=${ROOT}\nRun PROFILE_NAVIGATION_BASE_URL=${baseURL} node scripts/test-profile-completion-navigation.cjs`);
      await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
    } else await runBrowser(baseURL, evidenceFile);
  } catch (error) {
    console.error(output.slice(-16000));
    throw error;
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000).then(() => child.kill('SIGKILL'))]);
    if (!process.env.PROFILE_NAVIGATION_KEEP_FIXTURE) fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
