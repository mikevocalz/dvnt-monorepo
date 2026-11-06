import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deliverHostRecap, parseHostRecapRequest } from "../_shared/host-recap-delivery.ts";
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{"Content-Type":"application/json"}});
Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("CRON_SECRET") || "";
  if (!secret) return json({ok:false,error:"Misconfigured"},503);
  if (req.headers.get("x-cron-secret") !== secret) return json({ok:false,error:"Unauthorized"},401);
  if (req.method !== "POST") return json({ok:false,error:"Method not allowed"},405);
  let scope;
  try { scope = parseHostRecapRequest(await req.json()); } catch { return json({ok:false,error:"Explicit approved delivery required"},400); }
  const url=Deno.env.get("SUPABASE_URL")||"", key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"", sender=Deno.env.get("RESEND_FROM_EMAIL")||"";
  if (!url || !key || !sender || !Deno.env.get("RESEND_API_KEY")) return json({ok:false,error:"Email configuration unavailable"},503);
  try {
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    return json({ok:true,...await deliverHostRecap(db,scope.deliveryId,scope.approvedHash,sender)});
  } catch { return json({ok:false,error:"Delivery unavailable; reconcile original request before retry"},409); }
});
