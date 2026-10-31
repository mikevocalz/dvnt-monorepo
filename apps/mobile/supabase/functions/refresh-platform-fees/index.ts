/** Reporting-only scheduled worker. No order, ticket, payment, email or payout
 * recovery is imported or invoked. Only pre-enrolled reporting rows are claimed.
 * Activating this function and its separate schedule requires explicit approval.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reconcilePlatformFeeSnapshots } from "../_shared/platform-fee-refund.ts";

const secret = Deno.env.get("CRON_SECRET") || "";
const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const allowedRpcs = new Set(["claim_platform_fee_snapshots", "complete_platform_fee_snapshot"]);
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store"}});
}
async function authorized(provided: string) {
  if (!provided || provided.length > 1024) return false;
  const encoder = new TextEncoder();
  const [a,b] = await Promise.all([secret,provided].map(value=>crypto.subtle.digest("SHA-256",encoder.encode(value))));
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let difference=0;
  for(let i=0;i<aa.length;i++)difference|=aa[i]^bb[i];
  return difference===0;
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({error: "Method not allowed"},405);
  if (!secret || !stripeSecret || !url || !serviceKey) return reply({error: "Reporting worker unavailable"},503);
  if (!await authorized(req.headers.get("x-cron-secret") || "")) return reply({error: "Unauthorized"},401);
  try {
    const client=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    // Capability-limited adapter: this worker has no table mutation API and the
    // provider helper can only invoke these two service-only reporting RPCs.
    const reportingDb={rpc(name:string,args:Record<string,unknown>){
      if(!allowedRpcs.has(name))throw new Error("Unsupported reporting operation");
      return client.rpc(name,args);
    }};
    const result=await reconcilePlatformFeeSnapshots(reportingDb,stripeSecret);
    return reply({ok:true,verified:result.verified,unavailable:result.unavailable});
  } catch {
    // Never expose provider payloads, payment identifiers or secret values.
    return reply({error:"Reporting verification unavailable"},503);
  }
});
