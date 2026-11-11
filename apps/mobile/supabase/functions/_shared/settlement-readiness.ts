/** Observation only. Missing workers never cause a payment retry. */
type Db = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error?: unknown }> };
type Capture = (error: Error, tags: { function: string; 'event.type': string }) => Promise<void>;
export function settlementReadinessIssues(s: any): string[] {
 if (!s || typeof s.worker_expected !== 'boolean' || typeof s.scheduler_visible !== 'boolean' ||
     typeof s.observed_at !== 'string' || !Number.isFinite(Date.parse(s.observed_at)) ||
     (s.scheduler_visible ? !Number.isSafeInteger(s.active_schedules) || s.active_schedules < 0 : s.active_schedules !== null) ||
     ![s.last_completed_at,s.last_error_at,s.oldest_due_at,s.oldest_checkout_outcome_unknown_at].every(v => v === null || typeof v === 'string' && Number.isFinite(Date.parse(v))) ||
     !Number.isSafeInteger(s.platform_payout_policy_blocked) || s.platform_payout_policy_blocked < 0 ||
     !Number.isSafeInteger(s.failed_bank_deliveries) || s.failed_bank_deliveries < 0 ||
     !Number.isSafeInteger(s.manual_review_count) || s.manual_review_count < 0) throw Error('Invalid settlement health');
 const issues: string[] = [];
 // Existing monitoring tolerance only: this never changes financial eligibility.
 // Real liabilities remain visible when execution is paused after collection.
 if(s.oldest_due_at && Date.parse(s.observed_at)-Date.parse(s.oldest_due_at)>90*60_000) issues.push('due_settlement_attention');
 if(s.oldest_checkout_outcome_unknown_at && Date.parse(s.observed_at)-Date.parse(s.oldest_checkout_outcome_unknown_at)>90*60_000) issues.push('checkout_outcome_unknown');
 if(s.runtime_budget_blocked>0) issues.push('runtime_budget_required');
 if(s.failed_bank_deliveries>0) issues.push('bank_delivery_failed');
 if(s.platform_payout_policy_blocked > 0) issues.push('platform_payout_policy_unverified');
 if(s.manual_review_count > 0) issues.push('manual_recovery_review');
 if(s.worker_expected) {
  if(s.platform_payout_policy_verified!==true || !s.platform_payout_policy_checked_at ||
     !Number.isFinite(Date.parse(s.platform_payout_policy_checked_at)) || Date.parse(s.observed_at)-Date.parse(s.platform_payout_policy_checked_at)>90*60_000) issues.push('platform_payout_policy_unverified');
  if(!s.scheduler_visible) issues.push('scheduler_unverified');
  else if(s.active_schedules === 0) issues.push('scheduler_missing');
  else if(s.active_schedules !== 1) issues.push('scheduler_duplicate');
  if(!s.last_completed_at) issues.push('worker_never_completed');
  else if(Date.parse(s.observed_at)-Date.parse(s.last_completed_at)>90*60_000) issues.push('worker_stale');
  if(s.last_error_at && (!s.last_completed_at || Date.parse(s.last_error_at)>=Date.parse(s.last_completed_at))) issues.push('worker_failed');
 }
 return [...new Set(issues)].sort();
}
export async function watchSettlementReadiness(db: Db,capture: Capture): Promise<boolean> {
 let issues: string[]; let available=true;
 try { const {data,error}=await db.rpc('settlement_health'); if(error) throw Error('unavailable'); issues=settlementReadinessIssues(data); }
 catch { issues=['snapshot_unavailable']; available=false; }
 try {
  const {data,error}=await db.rpc('claim_settlement_readiness_alert',{p_issue_codes:issues});
  if(error || typeof data !== 'boolean') throw Error('unavailable');
  if(data && issues.length) await capture(new Error(`Settlement readiness requires review: ${issues.join(', ')}. Do not enable or retry payments to silence this alert.`),{function:'db-health','event.type':'settlement.readiness'});
  return available;
 } catch { console.error('[db-health] settlement monitoring unavailable'); return false; }
}
