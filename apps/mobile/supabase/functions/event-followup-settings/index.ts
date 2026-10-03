import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { normaliseFollowupInput, planFollowupSave } from "../_shared/event-followup.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
function json(req:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders(req),"Content-Type":"application/json"}})}

async function canManage(s:any,eventId:number,authId:string){
  const {data:event}=await s.from("events").select("host_id").eq("id",eventId).maybeSingle();
  if(String(event?.host_id||"")===String(authId)) return true;
  const {data:co}=await s.from("event_co_organizers").select("user_id")
    .eq("event_id",eventId).eq("user_id",authId).eq("accepted",true).eq("role","admin").maybeSingle();
  return !!co;
}
function canonicalEnd(event:any):Date|null{
  const raw=event?.end_date || event?.start_date || event?.date;
  if(!raw) return null;
  const d=new Date(raw); if(Number.isNaN(d.getTime())) return null;
  // When no explicit end exists, use a conservative 3-hour fallback rather
  // than treating start as end.
  if(!event?.end_date) d.setTime(d.getTime()+3*60*60*1000);
  return d;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return optionsResponse();
  const s=createClient(SUPABASE_URL, SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const authId=await verifySession(s,req);
  if(!authId) return json(req,{ok:false,error:"Unauthorized"},401);
  const body=req.method==="POST"?await req.json().catch(()=>({})):{};
  const url=new URL(req.url); const eventId=Number(body.event_id||url.searchParams.get("event_id"));
  if(!Number.isInteger(eventId)||eventId<=0) return json(req,{ok:false,error:"event_id required"},400);
  if(!(await canManage(s,eventId,authId))) return json(req,{ok:false,error:"Forbidden"},403);

  if(req.method==="GET"){
    const {data}=await s.from("event_followup_campaigns").select("*").eq("event_id",eventId).maybeSingle();
    return json(req,{ok:true,data:data||{event_id:eventId,enabled:false,status:"disabled"}});
  }
  if(req.method!=="POST") return json(req,{ok:false,error:"Method not allowed"},405);

  const {data:event}=await s.from("events").select("id,title,status,end_date,start_date,date")
    .eq("id",eventId).maybeSingle();
  if(!event) return json(req,{ok:false,error:"Event not found"},404);
  const end=canonicalEnd(event); if(!end) return json(req,{ok:false,error:"Event end time is missing"},409);
  const input=normaliseFollowupInput(body);
  const scheduledAt=new Date(end.getTime()+input.delay_minutes*60_000).toISOString();

  const {data:existing}=await s.from("event_followup_campaigns")
    .select("enabled,subject,message,cta_label,delay_minutes,campaign_version,status,scheduled_at")
    .eq("event_id",eventId).maybeSingle();
  const plan=planFollowupSave(existing||null,input,scheduledAt,authId,new Date().toISOString());
  if(!plan.write){
    const {data}=await s.from("event_followup_campaigns").select("*").eq("event_id",eventId).maybeSingle();
    return json(req,{ok:true,data,unchanged:true});
  }
  const {data,error}=existing
    ? await s.from("event_followup_campaigns").update(plan.row).eq("event_id",eventId).select("*").single()
    : await s.from("event_followup_campaigns").insert({...plan.row,event_id:eventId}).select("*").single();
  if(error) return json(req,{ok:false,error:error.message},500);
  return json(req,{ok:true,data});
});
