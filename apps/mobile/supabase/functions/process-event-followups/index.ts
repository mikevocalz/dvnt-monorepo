import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendResendEmail } from "../_shared/send-resend-email.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const SITE=(Deno.env.get("PUBLIC_SITE_URL")||"https://dvntapp.live").replace(/\/$/,"");

function escapeHtml(v:string){return v.replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}

Deno.serve(async(req)=>{
  const secret=Deno.env.get("CRON_SECRET")||"";
  if(!secret){ console.error("[process-event-followups] CRON_SECRET not set — rejecting request"); return new Response("Misconfigured",{status:500}); }
  if(req.headers.get("authorization")!==`Bearer ${secret}`) return new Response("Unauthorized",{status:401});
  const s=createClient(SUPABASE_URL, SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const now=new Date().toISOString();
  const {data:campaigns,error}=await s.from("event_followup_campaigns")
    .select("*, event:events(id,title,status)")
    .eq("enabled",true).lte("scheduled_at",now).in("status",["scheduled","partial_failure"]).limit(25);
  if(error) return new Response(JSON.stringify({ok:false,error:error.message}),{status:500});

  let processed=0;
  for(const campaign of campaigns||[]){
    const event=Array.isArray(campaign.event)?campaign.event[0]:campaign.event;
    if(!event || ["cancelled","deleted","postponed"].includes(event.status)){
      await s.from("event_followup_campaigns").update({enabled:false,status:"disabled",updated_at:now}).eq("event_id",campaign.event_id);
      continue;
    }
    await s.from("event_followup_campaigns").update({status:"processing",updated_at:now}).eq("event_id",campaign.event_id);

    const {data:tickets}=await s.from("tickets")
      .select("id,user_id,guest_email,status").eq("event_id",campaign.event_id).in("status",["active","scanned"]);
    const authIds=[...new Set((tickets||[]).map((t:any)=>t.user_id).filter(Boolean))];
    const emailByAuth=new Map<string,string>();
    if(authIds.length){
      const {data:authRows}=await s.from("user").select("id,email").in("id",authIds);
      for(const u of authRows||[]) if(u.email) emailByAuth.set(String(u.id),String(u.email).toLowerCase());
    }

    const recipients=new Map<string,{ticketId:string,userId:string|null}>();
    for(const t of tickets||[]){
      const email=String(t.guest_email||emailByAuth.get(String(t.user_id))||"").trim().toLowerCase();
      if(email && !recipients.has(email)) recipients.set(email,{ticketId:t.id,userId:t.user_id||null});
    }
    for(const [email,meta] of recipients){
      await s.from("event_followup_outbox").upsert({
        event_id:campaign.event_id,campaign_version:campaign.campaign_version,
        recipient_email:email,recipient_user_id:meta.userId,ticket_id:meta.ticketId,status:"pending",updated_at:now,
      },{onConflict:"event_id,campaign_version,recipient_email",ignoreDuplicates:true});
    }

    const {data:outbox}=await s.from("event_followup_outbox").select("*")
      .eq("event_id",campaign.event_id).eq("campaign_version",campaign.campaign_version)
      .in("status",["pending","failed"]);
    let sent=0,failed=0;
    for(const row of outbox||[]){
      // Claim row before sending; duplicate cron invocations cannot both own it.
      const {data:claimed}=await s.from("event_followup_outbox")
        .update({status:"sending",attempt_count:row.attempt_count+1,updated_at:new Date().toISOString()})
        .eq("id",row.id).in("status",["pending","failed"]).select("id").maybeSingle();
      if(!claimed) continue;
      try{
        const reviewUrl=`${SITE}/feed/events/${campaign.event_id}/reviews`;
        const message=escapeHtml(campaign.message||`Thanks for coming to ${event.title}.`);
        const id=await sendResendEmail({
          to:row.recipient_email,
          subject:campaign.subject||`How was ${event.title}?`,
          html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>${escapeHtml(event.title||"Thanks for coming")}</h2><p style="white-space:pre-wrap">${message}</p><p><a href="${reviewUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#111;color:#fff;text-decoration:none">${escapeHtml(campaign.cta_label||"Leave a review")}</a></p></div>`,
        });
        if(!id) throw new Error("Email provider not configured");
        await s.from("event_followup_outbox").update({status:"sent",provider_message_id:id,sent_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("id",row.id);
        sent++;
      }catch(e){
        await s.from("event_followup_outbox").update({status:"failed",last_error:String((e as Error)?.message||e).slice(0,300),updated_at:new Date().toISOString()}).eq("id",row.id);
        failed++;
      }
    }
    const {count:audience}=await s.from("event_followup_outbox").select("id",{count:"exact",head:true}).eq("event_id",campaign.event_id).eq("campaign_version",campaign.campaign_version);
    const {count:sentTotal}=await s.from("event_followup_outbox").select("id",{count:"exact",head:true}).eq("event_id",campaign.event_id).eq("campaign_version",campaign.campaign_version).eq("status","sent");
    const {count:failedTotal}=await s.from("event_followup_outbox").select("id",{count:"exact",head:true}).eq("event_id",campaign.event_id).eq("campaign_version",campaign.campaign_version).eq("status","failed");
    await s.from("event_followup_campaigns").update({
      audience_count:audience||0,sent_count:sentTotal||0,failed_count:failedTotal||0,
      status:(failedTotal||0)>0?"partial_failure":"sent",updated_at:new Date().toISOString(),
    }).eq("event_id",campaign.event_id);
    processed+=sent+failed;
  }
  return new Response(JSON.stringify({ok:true,processed}),{headers:{"Content-Type":"application/json"}});
});
