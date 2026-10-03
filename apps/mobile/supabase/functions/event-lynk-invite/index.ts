import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { isEventLynkHost } from "../_shared/event-lynk-host.ts";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||""; const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
function json(req:Request,b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...corsHeaders(req),"Content-Type":"application/json"}})}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return optionsResponse();
 if(req.method!=="POST") return json(req,{ok:false,error:"Method not allowed"},405);
 const db=createClient(SUPABASE_URL, SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const actor=await verifySession(db,req); if(!actor) return json(req,{ok:false,error:"Unauthorized"},401);
 const body=await req.json().catch(()=>({})); const eventId=Number(body.event_id);
 const targets:string[]=Array.isArray(body.user_ids)?[...new Set<string>(body.user_ids.map(String))].slice(0,50):[];
 if(!Number.isInteger(eventId)||!targets.length) return json(req,{ok:false,error:"event_id and user_ids required"},400);
 const {data:event,error:eventError}=await db.from("events").select("id,title,host_id,lynk_room_id,status").eq("id",eventId).maybeSingle();
 if(eventError) return json(req,{ok:false,error:"Could not load event"},500);
 if(!event?.lynk_room_id) return json(req,{ok:false,error:"Event Lynk not found"},404);
 let allowed=false;
 try{ allowed=await isEventLynkHost(db,event,String(actor)); }
 catch{ return json(req,{ok:false,error:"Could not verify host"},500); }
 if(!allowed) return json(req,{ok:false,error:"Only host/cohost can invite"},403);
 const {data:room}=await db.from("video_rooms").select("id,status").eq("uuid",event.lynk_room_id).maybeSingle();
 if(!room||room.status!=="open") return json(req,{ok:false,error:"Room is not live"},409);

 // blocks stores INTEGER users.id values, while actor and targets are Better
 // Auth text ids. Resolve both sides to users.id before checking blocks, and
 // fail closed if any lookup errors: an unread block list must not invite.
 const {data:profiles,error:profilesError}=await db.from("users").select("id,auth_id")
   .in("auth_id",[String(actor),...targets]);
 if(profilesError) return json(req,{ok:false,error:"Could not resolve members"},500);
 const intByAuth=new Map<string,number>((profiles||[]).map((u:any)=>[String(u.auth_id),Number(u.id)]));
 const actorInt=intByAuth.get(String(actor));
 if(!actorInt) return json(req,{ok:false,error:"Host profile not found"},404);
 const {data:blocked,error:blocksError}=await db.from("blocks").select("blocker_id,blocked_id")
   .or(`blocker_id.eq.${actorInt},blocked_id.eq.${actorInt}`);
 if(blocksError) return json(req,{ok:false,error:"Could not check blocks"},500);
 const blockedInts=new Set<number>((blocked||[]).flatMap((x:any)=>[Number(x.blocker_id),Number(x.blocked_id)]).filter((x:number)=>x!==actorInt));
 const valid=targets.filter((id:string)=>{
   const intId=intByAuth.get(id);
   return intId!==undefined&&intId!==actorInt&&!blockedInts.has(intId);
 });
 let notified=0;
 if(valid.length){
   const {error:inviteError}=await db.from("video_room_invites").upsert(valid.map((id:string)=>({room_id:room.id,user_id:id,invited_by:actor})),{onConflict:"room_id,user_id"});
   if(inviteError) return json(req,{ok:false,error:"Could not save invites"},500);
   const {error:notifyError}=await db.from("notifications").insert(valid.map((id:string)=>({
     recipient_id:intByAuth.get(id),actor_id:actorInt,type:"room_invite",entity_type:"event",entity_id:String(eventId),
     // event_title lets Activity name the event even when the batched events
     // lookup misses the row; entity_type/entity_id already drive that lookup.
     entity_payload:{url:`/feed/sneaky-lynk/room/${event.lynk_room_id}`,event_id:eventId,event_title:event.title??null},
   })));
   // The invites are saved, which is what admits the member to the room.
   // A missing activity row is reported rather than failing the request.
   if(notifyError) console.error("[event-lynk-invite] notification insert failed:",notifyError.message);
   else notified=valid.length;
 }
 return json(req,{ok:true,invited:valid.length,notified,skipped:targets.length-valid.length});
});
