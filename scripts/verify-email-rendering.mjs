/** Offline rendering of actual templates. The Gmail inversion profile is a
 * controlled CSS model, NOT acceptance evidence from the Gmail application. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fixtures } from '../apps/mobile/supabase/functions/_shared/email/fixtures.mjs';
const require = createRequire(import.meta.url);
const dependencyRoot = process.env.EMAIL_RENDER_NODE_MODULES;
assert.ok(dependencyRoot, 'Set EMAIL_RENDER_NODE_MODULES to the isolated CI node_modules directory');
const { chromium } = require(join(dependencyRoot, 'playwright'));
const { PNG } = require(join(dependencyRoot, 'pngjs'));
const out = resolve(process.env.EMAIL_RENDER_OUTPUT || '/tmp/dvnt-email-rendering');
await mkdir(out, { recursive: true });
const logo = await readFile(new URL('../apps/web/public/dvnt-email-logo@2x.png', import.meta.url));
const glyph = await readFile(new URL('../apps/web/public/dvnt-email-glyph.png', import.meta.url));
// A non-scannable deterministic fixture, never a ticket credential.
const qr = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="white"/><path fill="black" d="M24 24h56v56H24zM160 24h56v56h-56zM24 160h56v56H24zM100 100h20v20h-20zM140 120h20v20h-20zM120 160h20v20h-20zM180 180h20v20h-20z"/><text x="120" y="235" text-anchor="middle" font-size="9">PREVIEW ONLY</text></svg>';
function gmailModel(html) {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)[1];
  const [, attributes, content] = /<body([^>]*)>([\s\S]*)<\/body>/.exec(html);
  return `<!doctype html><html lang="en"><head>${head}</head><body><u></u><div${attributes}>${content}</div></body></html>`;
}
function textPixels(buffer) {
  const png = PNG.sync.read(buffer);
  let white = 0, dark = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = png.data.subarray(i, i + 3);
    if (Math.min(r, g, b) >= 180) white++;
    if (Math.max(r, g, b) <= 60) dark++;
  }
  const pixels = png.width * png.height;
  return { whiteFraction: white / pixels, darkFraction: dark / pixels };
}
const browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true });
const report = [];
try {
  for (const width of [390, 1024]) {
    for (const mode of ['light', 'dark', 'gmail-inversion-model']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: mode === 'light' ? 'light' : 'dark', serviceWorkers: 'block' });
      const unexpected = [];
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/dvnt-email-logo@2x.png')) return route.fulfill({ contentType: 'image/png', body: logo });
        if (url.pathname.endsWith('/dvnt-email-glyph.png')) return route.fulfill({ contentType: 'image/png', body: glyph });
        if (url.hostname === 'api.qrserver.com') return route.fulfill({ contentType: 'image/svg+xml', body: qr });
        unexpected.push(route.request().url());
        return route.abort();
      });
      for (const name of ['transfer', 'comp', 'followup', 'followupMember', 'followupGuest', 'guest']) {
        const page = await context.newPage();
        const id = `${name}-${width}-${mode}`;
        await page.setContent(mode === 'gmail-inversion-model' ? gmailModel(fixtures[name].html) : fixtures[name].html, { waitUntil: 'load' });
        await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
        if (mode === 'gmail-inversion-model') {
          await page.evaluate(() => {
            // Model the documented black/white inversion, while gradients and
            // image bytes remain unchanged. Never pretend this reproduces all
            // Gmail transformations or non-Google-account CSS stripping.
            const invert = value => {
              const numbers = value.match(/[\d.]+/g)?.map(Number);
              if (!numbers || numbers.length < 3 || numbers[3] === 0) return null;
              return `rgb(${numbers.slice(0, 3).map(n => 255 - n).join(',')})`;
            };
            const values = [...document.querySelectorAll('.dvnt-body, .dvnt-body *')].filter(el => el.tagName !== 'IMG').map(el => {
              const css = getComputedStyle(el);
              return { el, color: invert(css.color), bg: invert(css.backgroundColor) };
            });
            for (const { el, color, bg } of values) {
              if (color) el.style.setProperty('color', color, 'important');
              if (bg) el.style.setProperty('background-color', bg, 'important');
            }
          });
        }
        const metrics = await page.evaluate(() => {
          const shell = document.querySelector('.dvnt-body');
          const card = document.querySelector('.dvnt-card');
          return {
            overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
            canvas: getComputedStyle(shell).backgroundImage,
            panel: getComputedStyle(card).backgroundImage,
            cardWidth: card.getBoundingClientRect().width,
            screen: getComputedStyle(document.querySelector('.dvnt-blend-screen')).mixBlendMode,
            difference: getComputedStyle(document.querySelector('.dvnt-blend-difference')).mixBlendMode,
          };
        });
        assert.ok(metrics.overflow <= 1, `${id}: horizontal overflow ${metrics.overflow}`);
        assert.match(metrics.canvas, /linear-gradient\(rgb\(10, 10, 10\)/, `${id}: canvas is not protected dark`);
        assert.match(metrics.panel, /linear-gradient\(rgb\(15, 15, 18\)/, `${id}: panel is not protected dark`);
        assert.ok(metrics.cardWidth <= Math.min(601, width), `${id}: card wider than viewport/container`);
        if (mode === 'gmail-inversion-model') {
          assert.equal(metrics.screen, 'screen', 'Gmail-targeted screen layer is inactive');
          assert.equal(metrics.difference, 'difference', 'Gmail-targeted difference layer is inactive');
        }
        const heading = page.locator('h1').first();
        assert.equal(await heading.count(), 1);
        const pixels = textPixels(await heading.screenshot());
        assert.ok(pixels.whiteFraction >= .01, `${id}: heading lacks readable light text (${JSON.stringify(pixels)})`);
        assert.ok(pixels.darkFraction >= .25, `${id}: heading background is not dark (${JSON.stringify(pixels)})`);
        if (name === 'followupMember' || name === 'followupGuest') {
          const guest = name === 'followupGuest';
          assert.ok(await page.getByRole('link', { name: guest ? 'Join the platform' : 'Rate the party', exact: true }).isVisible(), `${id}: segment CTA missing`);
          assert.equal(await page.getByRole('link', { name: guest ? 'Rate the party' : 'Join the platform', exact: true }).count(), 0, `${id}: wrong segment CTA leaked`);
          assert.ok(await page.getByText('If the app opens instead, copy this link into your browser’s address bar:', { exact: false }).isVisible(), `${id}: fallback missing`);
          assert.ok(await page.getByRole('link', { name: 'Unsubscribe from event follow-up emails', exact: true }).isVisible(), `${id}: unsubscribe missing`);
        }
        await page.screenshot({ path: join(out, `${id}.png`), fullPage: true });
        report.push({ id, ...metrics, ...pixels, nativeGmailVerified: false });
        await page.close();
      }
      assert.deepEqual(unexpected, [], 'fixture attempted an unapproved network request');
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(`Passed ${report.length} offline fixture renders. Gmail profile is a model, not native-client acceptance. Artifacts: ${out}`);
