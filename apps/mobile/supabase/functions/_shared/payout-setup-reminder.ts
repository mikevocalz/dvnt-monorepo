/** Authenticated, self-only payout setup reminder. No payment mutations. */
export interface PayoutRecord {
  stripe_account_id?: string | null;
  payouts_enabled?: boolean | null;
  charges_enabled?: boolean | null;
  details_submitted?: boolean | null;
  event_id?: number;
  status?: string;
}
export interface LiveConnectState {
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  disabledReason: string | null;
}
export type PayoutReminder = { ok: true; eligible: boolean; needsSetup: boolean; role?: 'organizer' | 'promoter'; route?: string; state?: 'setup' | 'action_required' | 'reviewing' };
export function choosePayoutDestination(hasEvents: boolean, organizer: PayoutRecord | null, promoters: PayoutRecord[]): {role: 'organizer' | 'promoter'; route: string; account: PayoutRecord | null} | null {
  if (organizer || hasEvents) return { role: 'organizer', route: '/feed/events/organizer-setup', account: organizer };
  const eligible = promoters.filter(p => Number.isSafeInteger(p.event_id) && Number(p.event_id)>0 && p.status!=='removed');
  // Multiple promotion rows can reference the same Stripe identity; prefer the row
  // with its linked Connect account, not a stale duplicate with a missing ID.
  const p = eligible.find(x => x.stripe_account_id) || eligible[0];
  return p ? {role:'promoter', route:`/feed/events/${p.event_id}/promoter`,account:p} : null;
}
export function decidePayoutReminder(destination: ReturnType<typeof choosePayoutDestination>, live: LiveConnectState | null): PayoutReminder {
  if (!destination) return {ok:true,eligible:false,needsSetup:false};
  const common = {ok:true,eligible:true,role:destination.role,route:destination.route} as const;
  if (!destination.account?.stripe_account_id) return {...common,needsSetup:true,state:'setup'};
  // If Stripe cannot be reached, never claim a user is unverified or cleared.
  if (!live) return {...common,needsSetup:false};
  if (live.payoutsEnabled && live.chargesEnabled && live.detailsSubmitted) return {...common,needsSetup:false};
  const needsAction = live.currentlyDue.length>0 || live.pastDue.length>0 ||
    (!live.detailsSubmitted && live.pendingVerification.length===0) ||
    !!live.disabledReason && live.disabledReason!=='requirements.pending_verification';
  return {...common,needsSetup:true,state:needsAction?'action_required':'reviewing'};
}
export function createPayoutReminderHandler(deps: {
  db: any; authenticate:(req: Request)=>Promise<string|null>;
  lookupStripe:(accountId:string)=>Promise<LiveConnectState|null>;
  headers:(req:Request)=>Record<string,string>;
}) {
  return async(req:Request):Promise<Response>=>{
    const headers={...deps.headers(req),'Content-Type':'application/json','Cache-Control':'no-store'};
    const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return json({error:'Method not allowed'},405);
    const userId=await deps.authenticate(req);
    if(!userId)return json({error:'Please sign in'},401);
    const [organizer,events,promoters]=await Promise.all([
      deps.db.from('organizer_accounts').select('stripe_account_id,payouts_enabled,charges_enabled,details_submitted').eq('host_id',userId).maybeSingle(),
      deps.db.from('events').select('id').eq('host_id',userId).limit(1),
      deps.db.from('event_promoters').select('event_id,stripe_account_id,status,payouts_enabled,charges_enabled,details_submitted').eq('user_id',userId).neq('status','removed').order('updated_at',{ascending:false}).limit(30),
    ]);
    if(organizer.error||events.error||promoters.error)return json({error:'Payout status unavailable'},503);
    const destination=choosePayoutDestination((events.data||[]).length>0,organizer.data??null,promoters.data??[]);
    if(!destination)return json({ok:true,eligible:false,needsSetup:false});
    const accountId=destination.account?.stripe_account_id;
    if(!accountId)return json(decidePayoutReminder(destination,null));
    if(!/^acct_[A-Za-z0-9]{12,}$/.test(accountId))return json({error:'Payout status unavailable'},503);
    try {
      const live=await deps.lookupStripe(accountId);
      if(!live)return json({error:'Payout status unavailable'},503);
      return json(decidePayoutReminder(destination,live));
    }catch{return json({error:'Payout status unavailable'},503);}
  };
}
