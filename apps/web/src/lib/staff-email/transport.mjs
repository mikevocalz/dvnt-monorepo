const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
const bytes = value => Uint8Array.from(value.match(/../g).map(x => parseInt(x, 16)));
const sha = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const canonical = (...fields) => JSON.stringify(fields);
const validKeyId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(id);
const validDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const origin = value => {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.origin !== value) throw new Error('Invalid staff invite origin');
  return value;
};

export async function keyring(active, material) {
  if (!validKeyId(active) || !(material instanceof Map) || !material.has(active) || material.size > 4) throw new Error('Invalid staff delivery key ring');
  const result = new Map();
  for (const [id, key] of material) {
    if (!validKeyId(id) || !(key instanceof Uint8Array) || key.byteLength !== 32) throw new Error('Invalid staff delivery key');
    const base = await crypto.subtle.importKey('raw', key, 'HKDF', false, ['deriveKey']);
    const derive = (info, type, operations) => crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('DVNT staff invite email 2026 v1'), info: enc.encode(info) },
      base, type, false, operations);
    result.set(id, {
      enc: await derive('outbox AEAD v1', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
      mac: await derive('exact issue intent v1', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
    });
  }
  return { active, keys: result };
}
const associated = row => enc.encode(canonical('staff-email-outbox:v1', row.event_id, row.issued_by, row.request_id, row.invite_hash, row.intent_digest, row.key_id));
export async function prepareIssue({eventId, actor, requestId, email, role, from, webOrigin}, keys, render) {
  const to = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!Number.isSafeInteger(eventId) || eventId <= 0 || typeof actor !== 'string' || !actor || actor.length > 128 ||
      typeof requestId !== 'string' || !uuidPattern.test(requestId) || !['admin','editor'].includes(role) ||
      to.length > 254 || !emailPattern.test(to) || !from || /[\r\n]/.test(from)) throw new Error('Invalid staff invitation');
  const request = enc.encode(canonical('staff-email-intent:v1', eventId, actor, requestId, to, role));
  const intents = await Promise.all([...keys.keys.values()].map(async key => hex(await crypto.subtle.sign('HMAC', key.mac, request))));
  const keyId = keys.active, key = keys.keys.get(keyId);
  const intent = hex(await crypto.subtle.sign('HMAC', key.mac, request));
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const claim = origin(webOrigin) + '/public/staff/claim#' + token;
  const { subject, html } = render(claim);
  if (typeof subject !== 'string' || !subject || typeof html !== 'string' || !html.includes(claim) || html.length > 30_000) {
    throw new Error('Invalid staff invitation template');
  }
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const row = {event_id:eventId, issued_by:actor, request_id:requestId, invite_hash:await sha(token), intent_digest:intent, key_id:keyId};
  const seal = await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:associated(row)}, key.enc,
    enc.encode(JSON.stringify({ mail:{to,from,subject,html}, token })));
  // Only the trusted issue RPC receives plaintext email+token; never log or return these args.
  return { ...row, offered_role:role, accept_intent_digests:intents, nonce:hex(nonce), ciphertext:hex(seal), email:to, token };
}
async function decrypt(row, keys) {
  const key = keys.keys.get(row.key_id);
  if (!key || !validDigest(row.invite_hash) || !validDigest(row.intent_digest) || !/^[0-9a-f]{24}$/.test(row.nonce) ||
      !/^(?:[0-9a-f]{2}){17,65000}$/.test(row.ciphertext)) throw new Error('Unusable delivery envelope');
  const decoded = JSON.parse(dec.decode(await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:bytes(row.nonce),additionalData:associated(row)}, key.enc, bytes(row.ciphertext))));
  if (!validDigest(decoded.token) || await sha(decoded.token) !== row.invite_hash || !emailPattern.test(decoded.mail?.to ?? '') ||
      !decoded.mail.from || !decoded.mail.subject || !decoded.mail.html?.includes('#'+decoded.token)) throw new Error('Unusable delivery payload');
  return decoded.mail;
}

export async function deliverOne({ repo, keys, provider }) {
  const row = await repo.lease();
  if (!row) return 'idle';
  const finish = outcome => repo.finish(row.delivery_id, row.lease_token, outcome);
  let mail;
  try { mail = await decrypt(row, keys); }
  catch { return (await finish({state:'retry'})) ? 'retry' : 'stale'; }
  // Revalidate immediately before send. A concurrent revoke after this point can
  // still race delivery; the independent claim gate must refuse the revoked offer.
  if (!(await repo.authorized(row.delivery_id, row.lease_token))) return 'stale';
  const idempotencyKey = 'dvnt-staff-invite:v1:' + row.delivery_id;
  let receipt;
  try { receipt = await provider({ ...mail, idempotencyKey, timeoutMs: 8000 }); }
  catch { return (await finish({state:'retry'})) ? 'retry' : 'stale'; }
  if (typeof receipt !== 'string' || !receipt.trim() || receipt.trim().length > 128) {
    return (await finish({state:'retry'})) ? 'retry' : 'stale';
  }
  return (await finish({state:'provider_accepted',receipt:receipt.trim()})) ? 'provider_accepted' : 'stale';
}
