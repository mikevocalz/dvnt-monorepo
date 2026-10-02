import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
const URL=Deno.env.get("SUPABASE_URL")||""; const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
function json(req:Request,b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...corsHeaders(req),"Content-Type":"application/json"}})}
function adminIds(){return new Set((Deno.env.get("DVNT_ADMIN_AUTH_IDS")||"").split(",").map(x=>x.trim()).filter(Boolean))}
function isAdultDob(value:unknown){
 const dob=new Date(`${String(value||"")}T00:00:00Z`); if(!Number.isFinite(dob.getTime())) return false;
 const cutoff=new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear()-18);
 return dob.getTime()<=cutoff.getTime();
}
async function verifiedAdultTarget(db:any,userId:string){
 const {data}=await db.from("identity_verifications").select("status,date_of_birth").eq("user_id",userId).maybeSingle();
 return data?.status==="passed" && isAdultDob(data?.date_of_birth);
}
function sourcesValid(profile:any,sources:any[]){
 const p=profile?.source_policy||{};
 if((p.citations_required||p.current_sources_required||p.citations_required_for_news) && sources.length===0) return false;
 if(p.quote_source_required && sources.some((s:any)=>s?.quote && !s?.url)) return false;
 return true;
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return optionsResponse();
 const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const actor=await verifySession(db,req); if(!actor) return json(req,{ok:false,error:"Unauthorized"},401);
 if(!adminIds().has(String(actor))) return json(req,{ok:false,error:"Forbidden"},403);
 if(req.method==="GET"){
   const url=new URL(req.url);
   const {data:profiles}=await db.from("editorial_profiles").select("*").order("display_name");
   const {data:jobs}=await db.from("editorial_jobs").select("*, profile:editorial_profiles(slug,display_name,disclosure_label)")
     .order("created_at",{ascending:false}).limit(Number(url.searchParams.get("limit")||100));
   return json(req,{ok:true,profiles:profiles||[],jobs:jobs||[]});
 }
 if(req.method!=="POST") return json(req,{ok:false,error:"Method not allowed"},405);
 const body=await req.json().catch(()=>({}));
 if(body.action==="profile"){
   const allowed=["account_auth_id","prompt_version","allowed_content_types","cadence","quiet_hours","source_policy","moderation_policy","engagement_budget","enabled","paused","requires_human_approval"];
   const patch:any={updated_at:new Date().toISOString()};
   for(const k of allowed) if(k in body.patch) patch[k]=body.patch[k];
   const {data,error}=await db.from("editorial_profiles").update(patch).eq("slug",String(body.slug||"")).select("*").single();
   if(error) return json(req,{ok:false,error:error.message},400);
   return json(req,{ok:true,data});
 }
 if(body.action==="enqueue"){
   const {data:profile}=await db.from("editorial_profiles").select("*").eq("slug",String(body.profile_slug||"")).maybeSingle();
   if(!profile) return json(req,{ok:false,error:"Editorial profile not found"},404);
   if(!profile.account_auth_id) return json(req,{ok:false,error:"Bind the profile to a real DVNT editorial account before scheduling"},409);
   const sources=Array.isArray(body.sources)?body.sources:[];
   if(!sourcesValid(profile,sources)) return json(req,{ok:false,error:"This editorial lane requires source provenance"},400);
   const jobType=body.job_type==="engagement"?"engagement":"content";
   const engagementAction=jobType==="engagement"?String(body.engagement_action||""):null;
   const targetUserId=jobType==="engagement"?String(body.target_user_id||""):null;
   const targetPostId=jobType==="engagement"&&body.target_post_id!=null?Number(body.target_post_id):null;
   if(jobType==="engagement"){
     if(!["like","follow","comment"].includes(engagementAction||"")||!targetUserId){
       return json(req,{ok:false,error:"Engagement jobs require a valid action and target_user_id"},400);
     }
     // Editorial automation never engages an account until DVNT has positive
     // 18+ identity evidence. This is intentionally stricter than the general
     // rollout cohort so a service-role bot cannot reach a minor through a
     // path the client gate would otherwise hide.
     if(!(await verifiedAdultTarget(db,targetUserId))){
       await db.from("editorial_engagement_audit").insert({
         profile_id:profile.id,action:engagementAction,target_user_id:targetUserId,
         target_post_id:Number.isFinite(targetPostId)?targetPostId:null,
         reason:"Target is not a verified adult",status:"blocked",
       });
       return json(req,{ok:false,error:"Editorial engagement target is not verified 18+"},403);
     }
   }
   const key=String(body.idempotency_key||crypto.randomUUID());
   const row={
     profile_id:profile.id,idempotency_key:key,job_type:jobType,
     engagement_action:engagementAction,target_user_id:targetUserId,
     target_post_id:Number.isFinite(targetPostId)?targetPostId:null,stage:"intake",
     idea:String(body.idea||"").trim().slice(0,5000),source_snapshot:sources,
     scheduled_for:body.scheduled_for||null,prompt_version:profile.prompt_version,created_by:actor,
   };
   const {data,error}=await db.from("editorial_jobs").insert(row).select("*").single();
   if(error && String(error.code)==="23505"){
     const {data:existing}=await db.from("editorial_jobs").select("*").eq("idempotency_key",key).single();
     return json(req,{ok:true,replayed:true,data:existing});
   }
   if(error) return json(req,{ok:false,error:error.message},400);
   await db.from("editorial_job_events").insert({job_id:data.id,stage:"intake",actor_type:"editor",actor_id:actor});
   return json(req,{ok:true,data});
 }
 if(["approve","reject","pause","unpause"].includes(body.action)){
   if(body.action==="pause"||body.action==="unpause"){
     const {error}=await db.from("editorial_profiles").update({paused:body.action==="pause",updated_at:new Date().toISOString()}).eq("slug",String(body.profile_slug||""));
     return error?json(req,{ok:false,error:error.message},400):json(req,{ok:true});
   }
   const stage=body.action==="approve"?"approved":"rejected";
   const patch:any={stage,updated_at:new Date().toISOString()};
   if(stage==="approved") patch.approved_by=actor;
   const {data,error}=await db.from("editorial_jobs").update(patch).eq("id",body.job_id)
     .in("stage",stage==="approved"?["moderated","awaiting_approval"]:["intake","validated","generated","moderated","awaiting_approval"]).select("*").maybeSingle();
   if(error||!data) return json(req,{ok:false,error:error?.message||"Job is not in an approvable state"},409);
   await db.from("editorial_job_events").insert({job_id:data.id,stage,actor_type:"editor",actor_id:actor,detail:{reason:body.reason||null}});
   return json(req,{ok:true,data});
 }
 return json(req,{ok:false,error:"Unknown action"},400);
});
