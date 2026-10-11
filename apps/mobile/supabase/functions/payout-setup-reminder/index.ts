import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifySession, corsHeaders } from '../_shared/verify-session.ts';
import { createPayoutReminderHandler, type LiveConnectState } from '../_shared/payout-setup-reminder.ts';

const url=Deno.env.get('SUPABASE_URL')||'';
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const stripeKey=Deno.env.get('STRIPE_SECRET_KEY')||'';
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

// Read the current Stripe account, not stale DB flags. This is a single owned
// account lookup after Better Auth verification; no customer secrets are returned.
async function lookupStripe(id:string):Promise<LiveConnectState|null> {
  if(!stripeKey)return null;
  const response=await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(id)}`,{
    headers:{Authorization:`Bearer ${stripeKey}`},signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)return null;
  const account=await response.json();
  if(account.id!==id || account.object!=='account')return null;
  const reqs=account.requirements||{};
  return {
    payoutsEnabled:account.payouts_enabled===true,
    chargesEnabled:account.charges_enabled===true,
    detailsSubmitted:account.details_submitted===true,
    currentlyDue:Array.isArray(reqs.currently_due)?reqs.currently_due:[],
    pastDue:Array.isArray(reqs.past_due)?reqs.past_due:[],
    pendingVerification:Array.isArray(reqs.pending_verification)?reqs.pending_verification:[],
    disabledReason:typeof reqs.disabled_reason==='string'?reqs.disabled_reason:null,
  };
}
Deno.serve(createPayoutReminderHandler({
  db,authenticate:req=>verifySession(db,req),lookupStripe,headers:req=>corsHeaders(req),
}));
