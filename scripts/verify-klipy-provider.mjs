#!/usr/bin/env node
/**
 * Read-only KLIPY provider preflight. No credentials in arguments, logs, files,
 * or result URLs. Requires EXPO_PUBLIC_KLIPY_API_KEY in the caller environment.
 * Runs two low-volume live searches and verifies one sample image per search.
 * This checks HTTP and image signatures, NOT browser CORS or image decoding.
 * Use only for an authorized integration; this is not a media proxy/cache.
 */
import { pathToFileURL } from 'node:url';

const API_ORIGIN = 'https://api.klipy.com';
const WEB_ORIGIN = 'https://dvntapp.live';
const OFFICIAL_MEDIA_HOSTS = new Set(['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com']);
const CURRENT_COMMENT_HOSTS = new Set(['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com']);
const SEARCHES = ['popular', 'happy'];
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 15000;

class CheckFailure extends Error {
  constructor(code, metadata = {}) { super(code); this.code = code; this.metadata = metadata; }
}
function fail(code, metadata) { throw new CheckFailure(code, metadata); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validDimension(value) { return Number.isInteger(value) && value > 0 && value <= 4096; }
function corsCategory(header) {
  if (header === '*') return 'wildcard';
  if (header === WEB_ORIGIN) return 'matches_origin';
  if (!header) return 'missing';
  return 'other';
}
function safeMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && OFFICIAL_MEDIA_HOSTS.has(u.hostname) && !u.username && !u.password && !u.port && !u.hash && /\.(gif|webp|png|jpe?g)$/i.test(u.pathname) ? u : null;
  } catch { return null; }
}
function selectMedia(item) {
  if (!isObject(item) || !isObject(item.file)) return null;
  const f = item.file;
  for (const [size, format] of [['sm', 'webp'], ['md', 'gif'], ['hd', 'gif'], ['md', 'webp'], ['sm', 'gif'], ['xs', 'gif']]) {
    const media = f[size]?.[format];
    if (isObject(media) && safeMediaUrl(media.url) && validDimension(media.width) && validDimension(media.height)) return { media, size, format };
  }
  return null;
}
async function readBounded(response, maxBytes, code) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) { await response.body?.cancel(); fail(code); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); fail(code); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function imageSignature(bytes) {
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(new TextDecoder().decode(bytes.subarray(0, 6)))) return 'image/gif';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((x, i) => bytes[i] === x)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  return null;
}
async function request(fetchImpl, url, maxBytes) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', credentials: 'omit',
      headers: { Accept: maxBytes === MAX_JSON_BYTES ? 'application/json' : 'image/*', Origin: WEB_ORIGIN },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const status = response.status;
    const cors = corsCategory(response.headers.get('access-control-allow-origin'));
    if (status !== 200) { await response.body?.cancel(); fail('http_status', { status, cors }); }
    const bytes = await readBounded(response, maxBytes, 'response_too_large');
    return { response, bytes, status, cors };
  } catch (error) {
    if (error instanceof CheckFailure) throw error;
    fail(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'request_timeout' : 'request_failed');
  }
}

export async function verifyKlipyProvider({ key, fetchImpl = globalThis.fetch } = {}) {
  const report = { ok: false, provider: 'klipy', checks: [], browserCorsVerified: false, browserImageDecodeVerified: false };
  if (typeof key !== 'string' || !key.trim()) return { ...report, error: 'missing_api_key' };
  if (key !== key.trim() || /\s/.test(key) || key.includes('${') || key.length > 512) return { ...report, error: 'invalid_api_key_format' };
  for (const query of SEARCHES) {
    const check = { query, ok: false }; report.checks.push(check);
    try {
      const url = new URL(`${API_ORIGIN}/api/v1/${encodeURIComponent(key)}/gifs/search`);
      url.searchParams.set('q', query); url.searchParams.set('per_page', '2');
      const api = await request(fetchImpl, url, MAX_JSON_BYTES);
      check.apiStatus = api.status; check.corsHeader = api.cors;
      let data;
      try { data = JSON.parse(new TextDecoder().decode(api.bytes)); } catch { fail('invalid_json'); }
      if (!isObject(data) || data.result !== true || !isObject(data.data) || !Array.isArray(data.data.data)) fail('unexpected_response_shape');
      const page = data.data;
      if (!page.data.length) fail('empty_results');
      if (page.current_page !== undefined && (!Number.isInteger(page.current_page) || page.current_page < 1)) fail('invalid_pagination');
      if (page.has_next !== undefined && typeof page.has_next !== 'boolean') fail('invalid_pagination');
      check.resultCount = page.data.length;
      check.currentPage = page.current_page ?? null;
      check.hasNext = page.has_next ?? null;
      const candidates = page.data.map(selectMedia).filter(Boolean);
      check.validMediaItems = candidates.length;
      if (!candidates.length) fail('no_supported_media');
      const { media, size, format } = candidates[0];
      const mediaUrl = safeMediaUrl(media.url);
      const image = await request(fetchImpl, mediaUrl, MAX_MEDIA_BYTES);
      const contentType = (image.response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      const signature = imageSignature(image.bytes);
      if (!signature || signature !== contentType) fail('invalid_image_response');
      check.media = { host: mediaUrl.hostname, status: image.status, contentType, bytes: image.bytes.length, signatureVerified: true, width: media.width, height: media.height, size, format, acceptedByCurrentCommentHostAllowlist: CURRENT_COMMENT_HOSTS.has(mediaUrl.hostname) };
      if (!check.media.acceptedByCurrentCommentHostAllowlist) fail('comment_host_allowlist_rejects_official_media');
      check.ok = true;
    } catch (error) {
      check.error = error instanceof CheckFailure ? error.code : 'unexpected_failure';
      if (error instanceof CheckFailure) Object.assign(check, error.metadata);
      report.error = check.error;
      return report;
    }
  }
  report.ok = true;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Never print the key, request URL, provider body, or raw exception.
  const report = await verifyKlipyProvider({ key: process.env.EXPO_PUBLIC_KLIPY_API_KEY });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
