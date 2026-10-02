import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||""; const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
Deno.serve(async(req)=>{
 const secret=Deno.env.get("CRON_SECRET")||"";
 if(!secret){ console.error("[process-event-lynk-lifecycle] CRON_SECRET not set — rejecting request"); return new Response("Misconfigured",{status:500}); }
 if(req.headers.get("authorization")!==`Bearer ${secret}`) return new Response("Unauthorized",{status:401});
 const s=createClient(SUPABASE_URL, SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:events,error}=await s.from("events").select("id,lynk_room_id,start_date,end_date,status")
   .not("lynk_room_id","is",null).limit(500);
 if(error) return new Response(JSON.stringify({ok:false,error:error.message}),{status:500});
 let changed=0;
 for(const e of events||[]){
   await s.rpc("sync_event_lynk_lifecycle",{p_event_id:e.id});
   const end=new Date(e.end_date||new Date(new Date(e.start_date).getTime()+6*60*60*1000).toISOString()).getTime();
   const start=new Date(e.start_date).getTime(); const now=Date.now();
   if(["cancelled","deleted"].includes(e.status) || now>=end){
     const {data:r}=await s.from("video_rooms").update({status:"ended",ended_at:new Date().toISOString()})
       .eq("uuid",e.lynk_room_id).neq("status","ended").select("id").maybeSingle();
     if(r) changed++;
   } else if(now>=start){
     // A pre-created event room becomes eligible to appear live at start.
     // Actual isLive still requires fresh host presence.
     const {data:r}=await s.from("video_rooms").update({status:"open"})
       .eq("uuid",e.lynk_room_id).eq("status","scheduled").select("id").maybeSingle();
     if(r) changed++;
   }
 }
 return new Response(JSON.stringify({ok:true,checked:(events||[]).length,changed}),{headers:{"Content-Type":"application/json"}});
});
