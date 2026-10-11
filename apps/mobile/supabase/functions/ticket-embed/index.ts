import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createTicketEmbedHandler } from '../_shared/ticket-embed-commerce.ts';
import { resolveTicketEmbedRuntime } from '../_shared/ticket-embed-runtime.ts';
const runtime = resolveTicketEmbedRuntime((name) => Deno.env.get(name));
const { secretKey: secret, publishableKey, paymentsEnabled: enabled, livemode: live, siteOrigin } = runtime;
const db = enabled ? createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {auth:{persistSession:false,autoRefreshToken:false}}) : null;
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
