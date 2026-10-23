import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyKlipyProvider } from './verify-klipy-provider.mjs';
const key = 'fixture-private-key-must-never-leak';
const image = (host = 'static.klipy.com') => ({ url: `https://${host}/fixture.gif`, width: 160, height: 120 });
const payload = (host) => ({ result: true, data: { current_page: 1, has_next: true, data: [{ id: '123', slug: 'fixture', file: { sm: { gif: image(host) } } }] } });
const json = (body, options = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, ...options });
const media = () => new Response('GIF89a fixture', { status: 200, headers: { 'content-type': 'image/gif' } });
function fixture(data = payload()) {
 const calls = [];
 const fetchImpl = async (url, options) => { calls.push({ url: String(url), options }); return String(url).startsWith('https://api.klipy.com/') ? json(data) : media(); };
 return { calls, fetchImpl };
}
test('missing key fails without any request or fallback', async () => {
 const f = fixture(); const result = await verifyKlipyProvider({ fetchImpl: f.fetchImpl });
 assert.equal(result.error, 'missing_api_key'); assert.equal(f.calls.length, 0); assert.equal(result.ok, false);
});
test('two live-shaped search/image checks succeed and redact URLs/key', async () => {
 const f = fixture(); const result = await verifyKlipyProvider({ key, fetchImpl: f.fetchImpl });
 assert.equal(result.ok, true); assert.equal(f.calls.length, 4); assert.equal(result.checks.length, 2);
 assert.equal(result.browserCorsVerified, false); assert.equal(result.browserImageDecodeVerified, false);
 for (const c of f.calls) { assert.equal(c.options.redirect, 'error'); assert.equal(c.options.credentials, 'omit'); }
 assert.equal(JSON.stringify(result).includes(key), false); assert.equal(JSON.stringify(result).includes('https:'), false);
});
test('204 is a failure, never fallback success', async () => {
 const result = await verifyKlipyProvider({ key, fetchImpl: async () => new Response(null, { status: 204 }) });
 assert.equal(result.error, 'http_status'); assert.equal(result.checks[0].status, 204);
});
test('provider failure and malformed shape fail closed', async () => {
 for (const data of [{ result: false }, { results: [{}] }, { result: true, data: { data: [] } }]) {
  const result = await verifyKlipyProvider({ key, fetchImpl: fixture(data).fetchImpl }); assert.equal(result.ok, false);
 }
});
test('raw exception never leaks request credentials', async () => {
 const result = await verifyKlipyProvider({ key, fetchImpl: async (url) => { throw new Error(`failed ${url}`); } });
 assert.equal(result.error, 'request_failed'); assert.equal(JSON.stringify(result).includes(key), false);
});
test('unapproved media host is never fetched', async () => {
 const f = fixture(payload('example.com')); const result = await verifyKlipyProvider({ key, fetchImpl: f.fetchImpl });
 assert.equal(result.error, 'no_supported_media'); assert.equal(f.calls.length, 1);
});
test('official static2 media passes the exact comment allowlist', async () => {
 const f = fixture(payload('static2.klipy.com')); const result = await verifyKlipyProvider({ key, fetchImpl: f.fetchImpl });
 assert.equal(result.ok, true);
 assert.equal(result.checks[0].media.host, 'static2.klipy.com');
});
test('HTML masquerading as image fails', async () => {
 const result = await verifyKlipyProvider({ key, fetchImpl: async (url) => String(url).includes('api.klipy.com') ? json(payload()) : new Response('<html>Denied</html>', { headers: { 'content-type': 'image/gif' } }) });
 assert.equal(result.error, 'invalid_image_response');
});
