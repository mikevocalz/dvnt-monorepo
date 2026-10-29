/** Explicit, expiring approximate avatar-map sharing. Never event attendance. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { resolveVerifiedAdmission } from "../_shared/verified-admission.ts";
import { consumeDbRateLimit } from "../_shared/db-rate-limit.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-auth-token,x-client-info,apikey,content-type,sentry-trace,baggage",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store, private",
};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {
  status, headers: {...cors,"Content-Type":"application/json"},
});
Deno.serve(async(req: Request) => {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST") return json({ok:false,error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return json({ok:false,error:"Map sharing is unavailable"},503);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const session=await verifySessionDetailed(db,req);
  if(!session.ok) return json({ok:false,error:"Sign in to manage map sharing"},401);
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=="object"||Array.isArray(body)) return json({ok:false,error:"Invalid request"},400);
  const action=body.action;
  if(!["settings","updateSettings","publish","nearby","revoke"].includes(action))
    return json({ok:false,error:"Unknown action"},400);
  const userId=session.userId;
  // Bind async token acquisition to the account that initiated the UI action.
  if(typeof body.expectedAuthId!=="string" || body.expectedAuthId!==userId)
    return json({ok:false,error:"Your account changed. Refresh and retry.",code:"account_changed"},409);
  // Stopping sharing never requires admission or a working rate limiter.
  const stopping=action==="revoke" || (action==="updateSettings" && body.eventsMapEnabled===false);
  if(!stopping && action!=="settings") {
    const admission=await resolveVerifiedAdmission(db,userId);
    if(admission.state==="blocked") return json({ok:false,error:admission.message||"Verify your account first",code:admission.reason},403);
  }
  if(!stopping) {
    const rate=await consumeDbRateLimit(db,userId,`member-map-${action}`,action==="publish"?12:60,600);
    if(rate.error) return json({ok:false,error:"Map sharing is temporarily unavailable"},503);
    if(!rate.allowed) return json({ok:false,error:"Too many map requests. Try again shortly."},429);
  }
  let name:string, args:Record<string,unknown>={p_user_id:userId};
  if(action==="settings") name="member_map_get_settings";
  else if(action==="revoke") {
    if(body.scope!=null && body.scope!=="overall" && body.scope!=="events") return json({ok:false,error:"Invalid revoke scope"},400);
    name="member_map_revoke"; args={...args,p_disable_overall:body.scope==="overall"};
  } else if(action==="nearby") name="member_map_nearby";
  else if(action==="updateSettings") {
    if(typeof body.locationEnabled!=="boolean"||typeof body.eventsMapEnabled!=="boolean"||
       !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)
      return json({ok:false,error:"Valid settings and revision required"},400);
    if(body.shareDurationHours!==undefined && body.shareDurationHours!==1 && body.shareDurationHours!==4)
      return json({ok:false,error:"Map sharing duration must be 1 or 4 hours"},400);
    // Older builds confirmed one hour; only new explicit opt-ins request four.
    name=body.shareDurationHours===4?"member_map_update_settings_four_hours":"member_map_update_settings";
    args={...args,p_expected_revision:body.expectedRevision,p_location_enabled:body.locationEnabled,
      p_events_map_enabled:body.eventsMapEnabled,p_consent_version:typeof body.consentVersion==="string"?body.consentVersion:null};
  } else {
    if(typeof body.latitude!=="number"||!Number.isFinite(body.latitude)||Math.abs(body.latitude)>85||
       typeof body.longitude!=="number"||!Number.isFinite(body.longitude)||Math.abs(body.longitude)>180||
       !Number.isSafeInteger(body.revision)||body.revision<0||
       typeof body.observedAt!=="string"||!Number.isFinite(Date.parse(body.observedAt)))
      return json({ok:false,error:"Fresh valid location and revision required"},400);
    // A moved cell is a search probe; same-cell refreshes do not spend this budget.
    const lat=Math.round(body.latitude*100)/100;
    const step=0.01/Math.max(Math.cos(lat*Math.PI/180),0.1);
    const lng=Math.max(-180,Math.min(180,Math.round(body.longitude/step)*step));
    const current=await db.from("member_map_presence").select("latitude,longitude").eq("user_id",userId).maybeSingle();
    if(current.error) return json({ok:false,error:"Map sharing is temporarily unavailable"},503);
    if(!current.data || Math.abs(current.data.latitude-lat)>1e-9 || Math.abs(current.data.longitude-lng)>1e-9) {
      for(const [label,max,seconds] of [["hour",4,3600],["day",12,86400]] as const) {
        const movement=await consumeDbRateLimit(db,userId,`member-map-move-${label}`,max,seconds);
        if(movement.error) return json({ok:false,error:"Map sharing is temporarily unavailable"},503);
        if(!movement.allowed) return json({ok:false,error:"Location changed too often. Try again later."},429);
      }
    }
    name="member_map_publish";
    args={...args,p_revision:body.revision,p_latitude:body.latitude,p_longitude:body.longitude,p_observed_at:body.observedAt};
  }
  const {data,error}=await db.rpc(name,args);
  if(error) {
    const conflict=error.code==="40001", forbidden=error.code==="42501", invalid=error.code==="22023";
    return json({ok:false,code:conflict?"settings_changed":forbidden?"map_consent_required":invalid?"invalid_location":"map_unavailable",
      error:conflict?"Settings changed. Refresh and retry.":forbidden?"Map sharing is off, expired, or requires a verified public adult profile.":invalid?"A fresh valid location is required.":"Could not update map sharing. Please retry."},
      conflict?409:forbidden?403:invalid?400:503);
  }
  return json({ok:true,data});
});
