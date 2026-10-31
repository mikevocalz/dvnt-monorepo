import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deliverFollowup, parseFollowupScope } from "../_shared/event-followup-delivery.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const SITE=(Deno.env.get("PUBLIC_SITE_URL")||"https://dvntapp.live").replace(/\/$/,"");
const response = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
  const secret=Deno.env.get("CRON_SECRET")||"";
  if(!secret){ return response({ok:false,error:"Misconfigured"},500); }
  if(req.headers.get("x-cron-secret")!==secret) return response({ok:false,error:"Unauthorized"},401);
  if(req.method!=="POST") return response({ok:false,error:"Method not allowed"},405);
  let scope;
  try { scope=parseFollowupScope(await req.json()); } catch { return response({ok:false,error:"Invalid scope"},400); }
  const config={site:SITE,supabaseUrl:SUPABASE_URL,unsubscribeSecret:Deno.env.get("EVENT_FOLLOWUP_UNSUBSCRIBE_SECRET")||"",from:Deno.env.get("RESEND_FROM_EMAIL")||""};
  if(!config.unsubscribeSecret || !config.from || !Deno.env.get("RESEND_API_KEY")) return response({ok:false,error:"Email configuration unavailable"},500);
  const s=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  let previewId=null;
  let campaignIds:number[]=[];
  try {
    if(scope.previewEmail){
      const r=await s.rpc("enqueue_event_followup_preview",{p_event_id:scope.eventIds![0],p_email:scope.previewEmail,p_content:scope.previewContent});
      if(r.error) throw Error("Preview unavailable");
      previewId=r.data;
    } else {
      let query=s.from("event_followup_campaigns").select("event_id").eq("enabled",true).lte("scheduled_at",new Date().toISOString()).in("status",["scheduled","partial_failure","processing"]).order("updated_at").limit(25);
      if(scope.eventIds) query=query.in("event_id",scope.eventIds);
      const campaigns=await query;
      if(campaigns.error) throw Error("Campaigns unavailable");
      campaignIds=(campaigns.data||[]).map(c=>c.event_id);
      for(const c of campaigns.data||[]){
        const r=await s.rpc("enqueue_event_followup",{p_event_id:c.event_id});
        if(r.error) throw Error("Audience unavailable");
      }
    }
    const results=[];
    const started=Date.now();
    // Bounded invocation, concurrent leases, paced below shared provider limits.
    for(let round=0;round<(previewId?1:8) && Date.now()-started<75000;round++){
      const claimed=await s.rpc("claim_event_followups",{p_event_ids:scope.eventIds,p_preview_id:previewId,p_limit:8});
      if(claimed.error) throw Error("Queue unavailable");
      if(!claimed.data?.length) break;
      for(let i=0;i<claimed.data.length;i+=2){
        results.push(...await Promise.all(claimed.data.slice(i,i+2).map((row:any)=>deliverFollowup(s,row,config))));
        await new Promise(resolve=>setTimeout(resolve,1100));
      }
      // Failed rows must wait for the next invocation, not repeatedly consume this one.
      if(results.some(r=>r.status==="failed")) break;
    }
    if(!previewId){
      const refreshed=await s.rpc("refresh_event_followup_status",{p_event_ids:[...new Set([...campaignIds,...results.map(r=>r.event_id)])]});
      if(refreshed.error) return response({ok:false,error:"Delivery status refresh unavailable",results},500);
    }
    return response({ok:true,results});
  }catch{return response({ok:false,error:"Follow-up processing unavailable"},500);}
});
