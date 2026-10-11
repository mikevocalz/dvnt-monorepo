/** Pure presentation policy: do not interrupt sign-in, purchases or Stripe setup. */
export function payoutReminderAllowed(pathname:string):boolean {
  if(!pathname || !pathname.startsWith('/'))return false;
  if(pathname==='/' || pathname==='/feed')return true;
  if(!pathname.startsWith('/feed/'))return false;
  const blocked=new Set(['auth','onboarding','verify','verification','checkout','cart','purchase','payment','billing','tickets','ticket','orders','stripe','organizer-setup','promoter','camera','call','video','room','sneaky-lynk','create','edit','live']);
  return !pathname.toLowerCase().split('/').filter(Boolean).some(p=>blocked.has(p));
}
export function payoutPromptCopy(state:'setup'|'action_required'|'reviewing'|undefined) {
  if(state==='reviewing')return {title:'Your payouts are being reviewed',message:'Stripe is reviewing your submitted payout details. Check your status for updates.',action:'View payout status'};
  if(state==='action_required')return {title:'Finish your payout setup',message:'Stripe needs more details before DVNT can send your earnings. Complete the remaining steps to receive payouts.',action:'Continue payout setup'};
  return {title:'Connect your payouts',message:'Finish secure Stripe setup so you can receive payments from your DVNT events or promotions.',action:'Set up payouts'};
}
