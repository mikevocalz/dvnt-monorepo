export interface LegacyOwnershipSummary {
  verified: boolean;
  rows: {currency:string;recipient_role:string;stage:string;amount_cents:number|null;allocation_count:number}[];
}
/** An identity review is not evidence of transfer or bank delivery. */
export function legacyOwnershipLines(summary?:LegacyOwnershipSummary):string[] {
  if(!summary?.verified||!Array.isArray(summary.rows)) return ['Reviewed legacy history is unavailable.'];
  const rows=summary.rows.filter(r=>r.recipient_role==='promoter');
  if(!rows.length) return ['No reviewed legacy ownership records yet. This does not mean no historical earnings.'];
  return rows.map(row=>{
    if(row.stage==='legacy_ownership_needs_review') return 'Reviewed legacy history has changed and needs review; the amount is withheld.';
    if(row.stage!=='legacy_ownership_verified'||row.amount_cents==null||!Number.isSafeInteger(Number(row.amount_cents))||Number(row.amount_cents)<=0||!/^[a-z]{3}$/.test(row.currency)) return 'Legacy ownership evidence needs review.';
    return `Reviewed legacy earnings: ${(Number(row.amount_cents)/100).toFixed(2)} ${row.currency.toUpperCase()}. Payment status is unverified.`;
  });
}
