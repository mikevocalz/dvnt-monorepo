import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")||""; const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
function hasSources(profile:any,job:any){
 const p=profile?.source_policy||{}; const s=Array.isArray(job.source_snapshot)?job.source_snapshot:[];
 return !(p.citations_required||p.current_sources_required||p.citations_required_for_news) || s.length>0;
}
function isAdultDob(value:unknown){
 const dob=new Date(`${String(value||"")}T00:00:00Z`); if(!Number.isFinite(dob.getTime())) return false;
 const cutoff=new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear()-18);
 return dob.getTime()<=cutoff.getTime();
}
async function verifiedAdultTarget(db:any,userId:string){
 const {data}=await db.from("identity_verifications").select("status,date_of_birth").eq("user_id",userId).maybeSingle();
 return data?.status==="passed" && isAdultDob(data?.date_of_birth);
}
function basicModeration(payload:any,profile:any){
 const text=JSON.stringify(payload||{}).toLowerCase();
 const blocked=["child sexual","minor nude","non-consensual"];
 const reasons=blocked.filter(x=>text.includes(x));
 if(profile?.slug==="astrology") return {passed:reasons.length===0,reasons,disclosure:"For entertainment/editorial purposes."};
 return {passed:reasons.length===0,reasons};
}
Deno.serve(async(req)=>{
 const secret=Deno.env.get("CRON_SECRET")||"";
 if(secret && req.headers.get("authorization")!==`Bearer ${secret}`) return new Response("Unauthorized",{status:401});
 const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:jobs,error}=await db.from("editorial_jobs")
   .select("*, profile:editorial_profiles(*)").in("stage",["intake","generated","approved","scheduled"])
   .order("created_at").limit(50);
 if(error) return new Response(JSON.stringify({ok:false,error:error.message}),{status:500});
 let advanced=0;
 for(const job of jobs||[]){
   const profile=Array.isArray(job.profile)?job.profile[0]:job.profile;
   if(!profile||!profile.enabled||profile.paused||!profile.account_auth_id) continue;
   try{
     if(job.job_type==="engagement"){
       const action=String(job.engagement_action||"");
       const targetUserId=String(job.target_user_id||"");
       if(!["like","follow","comment"].includes(action)||!targetUserId||!(await verifiedAdultTarget(db,targetUserId))){
         await db.from("editorial_engagement_audit").insert({
           profile_id:profile.id,job_id:job.id,action:["like","follow","comment"].includes(action)?action:"comment",
           target_user_id:targetUserId||null,target_post_id:job.target_post_id||null,
           reason:"Execution blocked: target is not a verified adult",status:"blocked",
         });
         await db.from("editorial_jobs").update({
           stage:"rejected",last_error:"Editorial engagement target is not verified 18+",
           updated_at:new Date().toISOString(),
         }).eq("id",job.id);
         continue;
       }
     }
     if(job.stage==="intake"){
       if(!hasSources(profile,job)){
         await db.from("editorial_jobs").update({stage:"failed",last_error:"Required source provenance is missing",updated_at:new Date().toISOString()}).eq("id",job.id);
         continue;
       }
       // Generation is provider-agnostic. A separate trusted generator writes
       // generated_payload using this immutable job id; this worker never posts
       // an ungenerated placeholder as if it were content.
       await db.from("editorial_jobs").update({stage:"validated",updated_at:new Date().toISOString()}).eq("id",job.id);
       await db.from("editorial_job_events").insert({job_id:job.id,stage:"validated",actor_type:"system"});
       advanced++; continue;
     }
     if(job.stage==="generated"){
       const moderation=basicModeration(job.generated_payload,profile);
       const next=moderation.passed?(profile.requires_human_approval?"awaiting_approval":"approved"):"rejected";
       await db.from("editorial_jobs").update({stage:next,moderation_result:moderation,updated_at:new Date().toISOString()}).eq("id",job.id);
       await db.from("editorial_job_events").insert({job_id:job.id,stage:next,actor_type:"moderation",detail:moderation});
       advanced++; continue;
     }
     if(job.stage==="approved"||job.stage==="scheduled"){
       const due=!job.scheduled_for||Date.parse(job.scheduled_for)<=Date.now();
       if(!due) {
         if(job.stage==="approved") await db.from("editorial_jobs").update({stage:"scheduled",updated_at:new Date().toISOString()}).eq("id",job.id);
         continue;
       }
       // Publication deliberately fails closed until an approved payload exists.
       // The actual post writer can consume approved_payload with job.id as its
       // idempotency key; retries therefore cannot duplicate a post.
       if(!job.approved_payload && !job.generated_payload){
         await db.from("editorial_jobs").update({stage:"failed",last_error:"No approved payload to publish",updated_at:new Date().toISOString()}).eq("id",job.id);
         continue;
       }
     }
   }catch(e){
     await db.from("editorial_jobs").update({stage:"failed",attempt_count:(job.attempt_count||0)+1,last_error:String((e as Error)?.message||e).slice(0,500),updated_at:new Date().toISOString()}).eq("id",job.id);
   }
 }
 return new Response(JSON.stringify({ok:true,checked:(jobs||[]).length,advanced}),{headers:{"Content-Type":"application/json"}});
});
