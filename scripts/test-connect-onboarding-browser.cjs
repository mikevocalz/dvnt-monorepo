// Browser enforces real CORS against the actual edge handlers. All auth, DB and
// Stripe operations are in-memory fixtures; this never reaches a live service.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('@playwright/test')); }
const { harness } = require('../apps/mobile/supabase/functions/_shared/connect-onboarding-fixture.cjs');
(async () => {
  const handlers = {};
  for (const slug of ['organizer-connect', 'promoter-connect']) {
    handlers[slug] = harness(slug);
    handlers[`${slug}-unauth`] = harness(slug, { user: null });
    handlers[`${slug}-error`] = harness(slug, { stripeFailure: true });
  }
  const api = http.createServer(async (req, res) => {
    const h = handlers[req.url.slice(1)];
    if (!h) { res.writeHead(404); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await h.handler(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString() } : {}) }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  const pageServer = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Connect onboarding fixture</title><p>Local synthetic browser checks</p>'); });
  let browser;
  try {
    await new Promise((resolve, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', resolve); });
    const port = Number(process.env.CONNECT_FIXTURE_PORT || 3000);
    await new Promise((resolve, reject) => { pageServer.once('error', reject); pageServer.listen(port, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, ...(fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    for (const slug of ['organizer-connect', 'promoter-connect']) {
      for (const scenario of ['', '-unauth', '-error']) {
        const result = await page.evaluate(async ({ url }) => {
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': 'fixture' }, body: JSON.stringify({ action: 'start', event_id: 42, platform: 'web' }) });
          return { status: r.status, body: await r.json() };
        }, { url: `http://127.0.0.1:${api.address().port}/${slug}${scenario}` });
        if (scenario === '') { assert.equal(result.status, 200); assert.equal(result.body.url, 'https://connect.stripe.com/setup/fixture'); }
        else if (scenario === '-unauth') { assert.equal(result.status, 401); assert.match(result.body.error, /Unauthorized/); }
        else assert.match(result.body.error, /unavailable/);
      }
    }
    console.log('PASS: real browser reads onboarding success, auth failures, and Stripe errors for both actual handlers after CORS preflight. No live writes.');
  } finally {
    await browser?.close();
    await Promise.all([new Promise(resolve => api.close(resolve)), new Promise(resolve => pageServer.close(resolve))]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
