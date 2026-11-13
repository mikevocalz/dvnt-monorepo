#!/usr/bin/env node
'use strict';
// Offline evidence checklist only. Never connects to a provider/database or writes data.
const MAX_BYTES = 128 * 1024;
function checkEvidence(input) {
  const blockers = new Set();
  const fail = code => blockers.add(code);
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const token = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
  const cents = v => Number.isSafeInteger(v) && v > 0;
  const x = object(input) ? input : {};
  const r = object(x.receipt) ? x.receipt : {};
  const q = object(x.quarantine) ? x.quarantine : {};
  const review = object(x.review) ? x.review : {};
  if (x.schema_version !== 1) fail('UNSUPPORTED_EVIDENCE_SCHEMA');
  if (!token(x.scope_id) || !token(x.recipient_binding_id)) fail('MISSING_OPAQUE_SCOPE_OR_RECIPIENT');
  if (r.status !== 'completed' || r.independently_verified !== true) fail('COMPLETED_RECEIPT_NOT_VERIFIED');
  if (!cents(r.amount_cents) || r.currency !== 'usd') fail('INVALID_RECEIPT_AMOUNT_OR_CURRENCY');
  if (!token(r.transaction_reference)) fail('MISSING_OPAQUE_TRANSACTION_REFERENCE');
  if (typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256) || r.immutable_private_copy_verified !== true) fail('IMMUTABLE_RECEIPT_EVIDENCE_MISSING');
  if (typeof r.paid_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(r.paid_at) || !Number.isFinite(Date.parse(r.paid_at)) || Date.parse(r.paid_at) > Date.now() || new Date(r.paid_at.slice(0,10) + 'T00:00:00Z').toISOString().slice(0,10) !== r.paid_at.slice(0,10)) fail('INVALID_PAYMENT_TIMESTAMP');
  if (r.recipient_binding_id !== x.recipient_binding_id || review.recipient_identity_verified !== true) fail('RECIPIENT_IDENTITY_NOT_VERIFIED');
  if (q.status !== 'on_hold' || q.release_at !== null) fail('PRESERVE_EVENT_QUARANTINE');
  for (const name of ['operator_authorized','workers_drained','stripe_destinations_reconciled','unknown_outcomes_absent','legacy_claims_absent','aggregate_payouts_absent','provider_reference_unused']) {
    if (review[name] !== true) fail('REVIEW_REQUIRED_' + name.toUpperCase());
  }
  const rows = Array.isArray(x.rows) ? x.rows : [];
  if (!rows.length || rows.length > 1000) fail('INVALID_ROW_SCOPE');
  const ids = new Set(), orders = new Set();
  let sum = 0;
  for (const raw of rows) {
    const row = object(raw) ? raw : {};
    if (!token(row.id) || ids.has(row.id) || !token(row.order_id) || orders.has(row.order_id)) fail('DUPLICATE_OR_INVALID_ROW_SCOPE');
    ids.add(row.id); orders.add(row.order_id);
    if (row.scope_id !== x.scope_id || row.recipient_binding_id !== x.recipient_binding_id || row.attribution_verified !== true) fail('ROW_IDENTITY_MISMATCH');
    if (row.entry_type !== 'earning' || !cents(row.amount_cents) || row.currency !== r.currency) fail('ROW_ECONOMICS_INVALID');
    if (row.order_status !== 'paid' || row.order_type !== 'event_ticket' || row.payout_status !== 'pending' && row.payout_status !== 'held') fail('ROW_NOT_ELIGIBLE');
    for (const name of ['paid_out_at','stripe_transfer_id','external_settlement_id']) if (row[name] !== null) fail('EXISTING_OR_UNKNOWN_SETTLEMENT');
    for (const name of ['has_refund','has_dispute','has_reversal','has_hold','has_reservation','has_unknown_outcome']) if (row[name] !== false) fail('SOURCE_RISK_OR_UNKNOWN');
    if (cents(row.amount_cents)) sum += row.amount_cents;
  }
  if (!Number.isSafeInteger(sum) || sum !== r.amount_cents) fail('WHOLE_ROW_AMOUNT_MISMATCH');
  // Even perfect user-supplied facts cannot certify deployment or provider receipt truth.
  return { evidence_check_passed: blockers.size === 0, deployment_ready: false,
    live_changes_performed: false, blockers: [...blockers].sort(),
    remaining_gates: ['canonical-compatible guard implementation and forward migration',
      'exact-head isolated SQL, ACL and cross-process race tests',
      'production schema/trigger and execution-drain verification',
      'explicit production-change and exact receipt-recording approval'] };
}
module.exports = { checkEvidence, MAX_BYTES };
if (require.main === module) {
  let bytes = 0, chunks = [];
  process.stdin.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) { process.stderr.write('Evidence input too large.\n'); process.exit(2); }
    chunks.push(chunk);
  });
  process.stdin.on('end', () => {
    try { const result = checkEvidence(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      process.stdout.write(JSON.stringify(result, null, 2) + '\n'); process.exitCode = result.evidence_check_passed ? 0 : 1;
    } catch { process.stderr.write('Invalid evidence JSON. No input details logged.\n'); process.exitCode = 2; }
  });
}
