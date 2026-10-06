import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendResendEmail } from "../_shared/send-resend-email.ts";
import {
  buildFollowupEmail,
  recipientsToEnqueue,
  signUnsubscribeToken,
  suppressionDecision,
} from "../_shared/event-followup.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const SITE=(Deno.env.get("PUBLIC_SITE_URL")||"https://dvntapp.live").replace(/\/$/,"");

async function suppressionCheck(s:any,email:string,authId:string|null){
  const {data:unsub,error:e1}=await s.from("event_followup_email_suppressions")
    .select("email").eq("email",email).maybeSingle();
  let memberOptedOut=false; let lookupFailed=!!e1;
  if(!lookupFailed && authId){
    const {data:member,error:e2}=await s.from("users").select("id").eq("auth_id",authId).maybeSingle();
    if(e2) lookupFailed=true;
    else if(member?.id){
      const {data:opt,error:e3}=await s.from("brand_message_opt_outs")
        .select("recipient_id").eq("recipient_id",member.id).maybeSingle();
      if(e3) lookupFailed=true; else memberOptedOut=!!opt;
    }
  }
  return suppressionDecision({lookupFailed,addressUnsubscribed:!!unsub,memberOptedOut});
}

Deno.serve(async(req)=>{
  const secret=Deno.env.get("CRON_SECRET")||"";
  if(!secret){ console.error("[process-event-followups] CRON_SECRET not set — rejecting request"); return new Response("Misconfigured",{status:500}); }
  // Same header as event-reminders: pg_cron's cron_event_followup_sweep reads
  // CRON_SECRET from Vault and sends it as x-cron-secret.
  if(req.headers.get("x-cron-secret")!==secret) return new Response("Unauthorized",{status:401});
  // No signing secret means no working unsubscribe link, so nothing goes out.
  const unsubSecret=Deno.env.get("EVENT_FOLLOWUP_UNSUBSCRIBE_SECRET")||"";
  if(!unsubSecret){ console.error("[process-event-followups] EVENT_FOLLOWUP_UNSUBSCRIBE_SECRET not set — refusing to send"); return new Response("Misconfigured",{status:500}); }
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

    // Anyone mailed (or being mailed) for this event under an earlier version
    // is left out, so editing the copy never re-sends to past recipients.
    const {data:prior,error:priorErr}=await s.from("event_followup_outbox")
      .select("recipient_email").eq("event_id",campaign.event_id).in("status",["sent","sending"]);
    if(priorErr){
      await s.from("event_followup_campaigns").update({status:"partial_failure",updated_at:new Date().toISOString()}).eq("event_id",campaign.event_id);
      continue;
    }
    const alreadyMailed=new Set<string>((prior||[]).map((r:any)=>String(r.recipient_email).toLowerCase()));
    const recipients=recipientsToEnqueue(tickets||[],emailByAuth,alreadyMailed);
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
        const gate=await suppressionCheck(s,row.recipient_email,row.recipient_user_id);
        if(gate==="suppress"){
          await s.from("event_followup_outbox").update({status:"suppressed",last_error:"unsubscribed",updated_at:new Date().toISOString()}).eq("id",row.id);
          continue;
        }
        if(gate==="retry") throw new Error("suppression lookup failed");
        const token=await signUnsubscribeToken(unsubSecret,row.recipient_email);
        const email=buildFollowupEmail({
          eventTitle:event.title,
          subject:campaign.subject,
          message:campaign.message,
          ctaLabel:campaign.cta_label,
          reviewUrl:`${SITE}/feed/events/${campaign.event_id}/reviews`,
          unsubscribeUrl:`${SUPABASE_URL}/functions/v1/event-followup-unsubscribe?token=${encodeURIComponent(token)}`,
        });
        const id=await sendResendEmail({to:row.recipient_email,subject:email.subject,html:email.html,headers:email.headers});
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
