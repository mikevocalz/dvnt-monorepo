export interface SettlementSummary {
 verified: boolean;
 rows: {currency:string;recipient_role:string;stage:string;amount_cents:number;allocation_count:number;bank_net_contribution_cents?:number|null}[];
}
const labels:Record<string,string>={awaiting_settlement:'Awaiting settlement',transfer_submitted:'Transfer submitted',
 in_connected_balance:'In Stripe balance; bank payout unverified',bank_pending:'Included in pending bank payout',
 bank_paid:'Included in verified bank payout',bank_failed:'Bank payout failed',needs_review:'Needs payment review',
 paid_externally:'Paid externally (receipt manually verified)',external_needs_review:'External payment recorded; recovery needs review'};
export function settlementSummaryLines(summary:SettlementSummary|undefined,role:'organizer'|'promoter'):string[]{
 if(!summary?.verified||!Array.isArray(summary.rows))return ['Bank payout status is not verified.'];
 const rows=summary.rows.filter(r=>r.recipient_role===role);
 if(!rows.length)return ['No tracked settlement transfers yet. Historical earnings are not marked bank-paid.'];
 return rows.map(row=>{
  if(!labels[row.stage]||!Number.isSafeInteger(Number(row.amount_cents))||Number(row.amount_cents)<0||!/^[a-z]{3}$/.test(row.currency))return 'Payment status needs review.';
  const gross=`${labels[row.stage]}: ${(Number(row.amount_cents)/100).toFixed(2)} ${row.currency.toUpperCase()}`;
  const net=row.bank_net_contribution_cents;
  return ['bank_paid','bank_pending'].includes(row.stage)&&net!=null&&Number.isSafeInteger(Number(net))&&Number(net)>=0
   ? `${gross} gross; verified bank contribution ${(Number(net)/100).toFixed(2)} ${row.currency.toUpperCase()}` : gross;
 });
}
