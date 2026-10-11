import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createTicketEmbedHandler } from '../_shared/ticket-embed-commerce.ts';
const secret = Deno.env.get('STRIPE_SECRET_KEY') || '';
const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY') || '';
const live = /^(sk|rk)_live_/.test(secret);
const configured = /^(sk|rk)_(test|live)_/.test(secret) && publishableKey.startsWith(live ? 'pk_live_' : 'pk_test_');
const enabled = Deno.env.get('TICKET_EMBED_PAYMENTS_ENABLED') === 'true' && configured;
const db = enabled ? createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {auth:{persistSession:false,autoRefreshToken:false}}) : null;
const siteOrigin = new URL(Deno.env.get('PUBLIC_SITE_URL') || 'https://dvntapp.live').origin;
Deno.serve(createTicketEmbedHandler({
  db,enabled,publishableKey,livemode:live,siteOrigin,
  stripe:async(method,path,body,idempotencyKey)=>{
    const response = await fetch(`https://api.stripe.com/v1${path}`,{
      method,headers:{Authorization:`Bearer ${secret}`,'Stripe-Version':'2025-02-24.acacia',
        'Content-Type':'application/x-www-form-urlencoded',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},
      ...(method==='POST'?{body:new URLSearchParams(body).toString()}:{}),
      signal:AbortSignal.timeout(20000),
    });
    const data=await response.json();
    if(!response.ok || data.error) throw new Error('stripe_request_failed');
    return data;
  },
}));
