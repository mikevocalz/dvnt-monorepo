/** Offline incident assessment only. No provider, database or filesystem access.
 * Input is an operator-collected snapshot, NOT trusted payment authorization.
 * Never call the #286 worker with execute:false as a substitute: it writes.
 */
export function assessPromoter(snapshot, scope, now = Date.now()) {
  const blockers = new Set(['execution_not_implemented']);
  const result = { executionAllowed: false, status: 'review_required',
    unsettledLedgerCents: null, currency: null, blockers: [] };
  const finish = () => ({ ...result, blockers: [...blockers].sort() });
  if (!snapshot || !scope || typeof scope.eventId !== 'number' ||
      !Number.isSafeInteger(scope.eventId) || scope.eventId <= 0 ||
      typeof scope.promoterId !== 'string' || !scope.promoterId ||
      snapshot.event?.id !== scope.eventId || snapshot.promoter?.id !== scope.promoterId ||
      snapshot.promoter?.eventId !== scope.eventId) {
    blockers.add('explicit_scope_mismatch'); return finish();
  }
  const observed = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now || now - observed > 300_000) {
    blockers.add('fresh_snapshot_required');
  }
  const { event, promoter, runtime, external, entries } = snapshot;
  if (event.payoutStatus !== 'pending') blockers.add('event_not_pending');
  const release = Date.parse(event.releaseAt);
  if (!Number.isFinite(release)) blockers.add('release_date_missing_or_invalid');
  else if (release > now) blockers.add('release_not_due');
  if (event.disputesClear !== true) blockers.add('dispute_review_required');
  if (external?.quarantined !== false || external?.reported !== false) {
    blockers.add('external_payment_or_quarantine_review');
  }
  if (runtime?.supabaseCronPresent !== true) blockers.add('supabase_schedule_not_verified');
  // A missing Supabase job does not establish absence of external schedules.
  if (runtime?.externalSchedulesReviewed !== true) blockers.add('external_schedules_unverified');
  if (runtime?.claimStatusAccepted !== true) blockers.add('claim_status_contract_unverified');
  if (promoter.recipientCapabilityActive !== true) blockers.add('recipient_capability_unverified');
  if (promoter.recipientOwnershipVerified !== true) blockers.add('recipient_ownership_unverified');
  // Even a fully populated snapshot cannot authorize or enable a transfer.
  blockers.add('source_funding_and_prior_transfers_require_reconciliation');
  blockers.add('durable_per_promoter_claim_and_provider_recovery_required');
  if (!Array.isArray(entries) || !entries.length) {
    blockers.add('ledger_evidence_missing'); return finish();
  }
  const ids = new Set(); let amount = 0; let currency;
  for (const row of entries) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) ||
        row.eventId !== scope.eventId || row.promoterId !== scope.promoterId ||
        !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0 ||
        row.entryType !== 'earning' || !/^[a-z]{3}$/.test(row.currency) ||
        (currency && row.currency !== currency)) {
      blockers.add('ledger_scope_or_economics_invalid'); return finish();
    }
    ids.add(row.id); currency = row.currency;
    if (row.paidAt !== null || row.transferId !== null || row.externalSettlementId !== null ||
        row.status !== 'pending') {
      blockers.add('prior_or_uncertain_settlement_review'); return finish();
    }
    amount += row.amountCents;
    if (!Number.isSafeInteger(amount)) { blockers.add('ledger_amount_overflow'); return finish(); }
  }
  result.unsettledLedgerCents = amount;
  result.currency = currency;
  // Unsettled means no receipt in these rows; it is never a claim of nonpayment.
  return finish();
}

/** Future-policy preview only: two business dates after the event's local end.
 * Caller must supply reviewed local date and calendar coverage. No UTC coercion,
 * guessed holidays, release timestamps, schedule activation or historical backfill.
 */
export function previewTwoBusinessDays(localEndDate, calendar) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const d = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value ? d : null;
  };
  const date = parse(localEndDate);
  if (!date || !calendar || !parse(calendar.from) || !parse(calendar.through) ||
      localEndDate < calendar.from || localEndDate > calendar.through ||
      !Array.isArray(calendar.holidays) || calendar.holidays.some(d => !parse(d)) ||
      typeof calendar.timeZone !== 'string' || !calendar.timeZone) throw new Error('reviewed local date and calendar required');
  try { new Intl.DateTimeFormat('en', { timeZone: calendar.timeZone }); }
  catch { throw new Error('reviewed time zone required'); }
  let days = 0;
  for (let i = 0; i < 370; i++) {
    date.setUTCDate(date.getUTCDate() + 1);
    const next = date.toISOString().slice(0, 10);
    if (next > calendar.through) throw new Error('calendar coverage exhausted');
    if (![0, 6].includes(date.getUTCDay()) && !calendar.holidays.includes(next)) days++;
    if (days === 2) return { policy: 'two_business_days', localReleaseDate: next,
      timeZone: calendar.timeZone, executionAllowed: false, historicalAutoRelease: false };
  }
  throw new Error('calendar coverage exhausted');
}

/**
 * Date eligibility for a future automated promoter scheduler. This is not a
 * transfer decision. Use the reviewed event time zone and end timestamp, never
 * the UTC date, start time, current venue offset, or a guessed end time.
 */
export function evaluateFuturePromoterSchedule(event, policy, now) {
  const result = { status: 'blocked', blocker: null, localEndDate: null,
    localReleaseDate: null, timeZone: null, executionAllowed: false };
  const block = reason => ({ ...result, blocker: reason });
  const parseInstant = value => {
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
    const d = new Date(value.slice(0, 10) + 'T12:00:00Z');
    if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
    return Date.parse(value);
  };
  const cutover = parseInstant(policy?.effectiveAt);
  if (!Number.isFinite(now) || !Number.isFinite(cutover)) return block('schedule_policy_not_configured');
  if (!Number.isSafeInteger(event?.id) || event.id < 1) return block('event_required');
  if (event.status !== 'active' || event.payoutStatus !== 'pending') return block('event_not_pending');
  if (event.disputesClear !== true) return block('dispute_review_required');
  const starts = parseInstant(event.startAt);
  const ends = parseInstant(event.endAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) return block('event_times_not_verified');
  // Never make an event that already started before the approved cutover
  // automatically due, including an overnight event that ends after cutover.
  if (starts < cutover) return block('historical_event_requires_review');
  if (typeof event.timeZone !== 'string' || event.timeZone !== policy.calendar?.timeZone ||
      !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/.test(event.timeZone)) return block('event_time_zone_not_verified');

  try {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: event.timeZone, calendar: 'iso8601',
      numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' });
    const localDate = value => {
      const parts = Object.fromEntries(format.formatToParts(value).map(p => [p.type, p.value]));
      return [parts.year.padStart(4, '0'), parts.month, parts.day].join('-');
    };
    const localEndDate = localDate(ends);
    const release = previewTwoBusinessDays(localEndDate, policy.calendar);
    return { status: now >= ends && localDate(now) >= release.localReleaseDate ? 'due_for_checks' : 'scheduled',
      blocker: null, localEndDate, localReleaseDate: release.localReleaseDate,
      timeZone: event.timeZone, executionAllowed: false };
  } catch {
    return block('reviewed_calendar_coverage_required');
  }
}

/**
 * Read-only event-level ordering check. A complete, reconciled snapshot is
 * required; an individual order's completed transfers cannot clear the event.
 */
export function assessOrganizerPayoutOrder(snapshot, eventId, now) {
  const result = (blocker) => ({ promoterFirstSatisfied: blocker === null, executionAllowed: false, blocker });
  if (!Number.isSafeInteger(eventId) || eventId < 1 || snapshot?.eventId !== eventId) return result('event_scope_mismatch');
  if (snapshot.payoutStatus !== 'pending' || snapshot.disputesClear !== true) return result('event_not_clear');
  const observed = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now || now - observed > 300_000) {
    return result('fresh_snapshot_required');
  }
  if (snapshot.completePromoterLedger !== true || !Array.isArray(snapshot.obligations)) {
    return result('complete_event_ledger_required');
  }
  const payees = new Set();
  const receipts = new Set();
  for (const row of snapshot.obligations) {
    if (row?.eventId !== eventId || typeof row.promoterId !== 'string' || !row.promoterId ||
        typeof row.accountingCurrency !== 'string' || !/^[a-z]{3}$/.test(row.accountingCurrency) ||
        !Number.isSafeInteger(row.netCents) || row.netCents < 0 || payees.has(row.promoterId)) {
      return result('invalid_promoter_obligation');
    }
    payees.add(row.promoterId);
    if (row.netCents === 0 && row.status === 'verified_no_balance_due') continue;
    if (row.netCents === 0 || !['verified_transfer','verified_external_payment'].includes(row.status) ||
        row.settledCents !== row.netCents || row.settledCurrency !== row.accountingCurrency ||
        typeof row.verifiedReceiptId !== 'string' || !row.verifiedReceiptId || receipts.has(row.verifiedReceiptId)) {
      return result('promoter_settlement_unresolved');
    }
    receipts.add(row.verifiedReceiptId);
  }
  return result(null);
}
