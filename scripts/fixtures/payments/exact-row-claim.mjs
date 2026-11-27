/** OFFLINE REFERENCE MODEL, NOT a payment reservation service.
 * Pure serializable reducer: a production adapter would need atomic DB CAS,
 * unique ledger/provider-object constraints, verified evidence and authorization.
 * No adapter exists here. Funding authority is intentionally NOT implemented.
 */
const text = v => typeof v === 'string' && /^[A-Za-z0-9_:.-]{1,180}$/.test(v);
const positive = v => Number.isSafeInteger(v) && v > 0;
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const fail = reason => { throw new Error(reason); };
export const emptyRegistry = () => freeze({ version: 0, executionAllowed: false, operations: {}, rowOwners: {}, receiptOwners: {} });
function binding(input) {
  const { eventId, beneficiaryId, destinationAccount, fundingAccount, provider, mode, currency, sourceModel, rows } = input;
  if (![eventId, beneficiaryId, destinationAccount, fundingAccount, provider].every(text) ||
      !['test', 'live'].includes(mode) || !/^[a-z]{3}$/.test(currency) ||
      sourceModel !== 'destination_charge' || !Array.isArray(rows) || !rows.length) fail('invalid binding');
  const ids = new Set(); let amountCents = 0;
  const normalized = rows.map(row => {
    if (!row || ![row.ledgerId, row.orderId, row.chargeId, row.sourceTransferId].every(text) ||
        ids.has(row.ledgerId) || !positive(row.amountCents) || row.eventId !== eventId ||
        row.beneficiaryId !== beneficiaryId || row.currency !== currency ||
        row.sourceDestinationAccount !== fundingAccount || row.disputed !== false || row.held !== false ||
        row.externalPaymentReported !== false || row.externalReceiptId !== null ||
        row.providerObjectId !== null || row.status !== 'pending') fail('ineligible or uncertain row');
    ids.add(row.ledgerId); amountCents += row.amountCents;
    if (!positive(amountCents)) fail('amount overflow');
    return { ledgerId: row.ledgerId, orderId: row.orderId, chargeId: row.chargeId,
      sourceTransferId: row.sourceTransferId, amountCents: row.amountCents };
  }).sort((a,b) => a.ledgerId < b.ledgerId ? -1 : a.ledgerId > b.ledgerId ? 1 : 0);
  return { eventId, beneficiaryId, destinationAccount, fundingAccount, provider, mode, currency,
    sourceModel, amountCents, rows: normalized };
}
/** Caller-supplied operation ID must be durably allocated once, not a date/key
 * generated per retry. Key is namespaced by provider/account/mode in the binding.
 * This function simulates exclusivity only; it does NOT persist a reservation.
 */
export function reserve(registry, expectedVersion, operationId, input) {
  if (expectedVersion !== registry.version) fail('stale registry version');
  if (!text(operationId) || ['__proto__','constructor','prototype'].includes(operationId)) fail('invalid operation ID');
  const bound = binding(input), fingerprint = JSON.stringify(bound);
  if (Object.hasOwn(registry.operations, operationId)) {
    if (registry.operations[operationId].fingerprint !== fingerprint) fail('immutable operation mismatch');
    return registry;
  }
  for (const row of bound.rows) if (Object.hasOwn(registry.rowOwners, row.ledgerId)) fail('row already reserved');
  const next = structuredClone(registry);
  next.version++;
  next.operations[operationId] = { operationId, key: `promoter-exact-row:v1:${operationId}`, binding: bound,
    fingerprint, status: 'reserved', receipt: null, executionAllowed: false };
  for (const row of bound.rows) Object.defineProperty(next.rowOwners, row.ledgerId, { value: operationId, enumerable: true, writable: true, configurable: true });
  return freeze(next);
}
/** Unknown outcomes never release rows, expire, or create another operation. */
export function markUncertain(registry, expectedVersion, operationId) {
  if (expectedVersion !== registry.version) fail('stale registry version');
  const op = Object.hasOwn(registry.operations, operationId) && registry.operations[operationId];
  if (!op || op.status === 'settled') fail('unknown or terminal operation');
  if (op.status === 'uncertain') return registry;
  const next = structuredClone(registry); next.version++; next.operations[operationId].status = 'uncertain';
  return freeze(next);
}
/** Test-only normalized proof contract. Metadata alone is NOT provider evidence.
 * Real adapter must authenticate and normalize authoritative object/source data.
 * Empty searches, elapsed time, failure and missing proof cannot settle/retry.
 * This is a transfer receipt, NEVER a recipient bank-payout confirmation.
 */
export function reconcile(registry, expectedVersion, operationId, proof) {
  if (expectedVersion !== registry.version) fail('stale registry version');
  const op = Object.hasOwn(registry.operations, operationId) && registry.operations[operationId];
  if (!op || !proof || proof.status !== 'succeeded' || !text(proof.objectId) ||
      proof.operationKey !== op.key || proof.bindingFingerprint !== op.fingerprint ||
      proof.amountCents !== op.binding.amountCents || proof.currency !== op.binding.currency ||
      proof.provider !== op.binding.provider || proof.mode !== op.binding.mode ||
      proof.fundingAccount !== op.binding.fundingAccount || proof.destinationAccount !== op.binding.destinationAccount ||
      proof.reversed !== false || proof.sourceVerified !== true) fail('exact provider evidence required');
  const receiptKey = JSON.stringify([proof.provider,proof.mode,proof.fundingAccount,proof.objectId]);
  const owner = registry.receiptOwners[receiptKey];
  if (owner && owner !== operationId) fail('receipt already belongs to another operation');
  if (op.status === 'settled') {
    if (op.receipt !== receiptKey) fail('terminal receipt mismatch');
    return registry;
  }
  const next = structuredClone(registry); next.version++;
  next.operations[operationId].status = 'settled'; next.operations[operationId].receipt = receiptKey;
  next.receiptOwners[receiptKey] = operationId;
  return freeze(next);
}
