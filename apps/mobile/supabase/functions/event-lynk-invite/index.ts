import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
const URL=Deno.env.get("SUPABASE_URL")||""; const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
function json(req:Request,b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...corsHeaders(req),"Content-Type":"application/json"}})}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return optionsResponse();
 if(req.method!=="POST") return json(req,{ok:false,error:"Method not allowed"},405);
 const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const actor=await verifySession(db,req); if(!actor) return json(req,{ok:false,error:"Unauthorized"},401);
 const body=await req.json().catch(()=>({})); const eventId=Number(body.event_id);
 const targets=Array.isArray(body.user_ids)?[...new Set(body.user_ids.map(String))].slice(0,50):[];
 if(!Number.isInteger(eventId)||!targets.length) return json(req,{ok:false,error:"event_id and user_ids required"},400);
 const {data:event}=await db.from("events").select("id,host_id,lynk_room_id,status").eq("id",eventId).maybeSingle();
 if(!event?.lynk_room_id) return json(req,{ok:false,error:"Event Lynk not found"},404);
 let allowed=String(event.host_id)===String(actor);
 if(!allowed){
   const {data:co}=await db.from("event_co_organizers").select("id").eq("event_id",eventId)
     .eq("user_id",actor).eq("accepted",true).in("role",["admin","editor"]).maybeSingle();
   allowed=!!co;
 }
 if(!allowed) return json(req,{ok:false,error:"Only host/cohost can invite"},403);
 const {data:room}=await db.from("video_rooms").select("id,status").eq("uuid",event.lynk_room_id).maybeSingle();
 if(!room||room.status!=="open") return json(req,{ok:false,error:"Room is not live"},409);

 const {data:blocked}=await db.from("blocks").select("blocker_id,blocked_id")
   .or(`blocker_id.eq.${actor},blocked_id.eq.${actor}`);
 const blockedIds=new Set((blocked||[]).flatMap((x:any)=>[String(x.blocker_id),String(x.blocked_id)]).filter((x:string)=>x!==String(actor)));
 const valid=targets.filter((id:string)=>!blockedIds.has(id)&&id!==String(actor));
 if(valid.length){
   await db.from("video_room_invites").upsert(valid.map((id:string)=>({room_id:room.id,user_id:id,invited_by:actor})),{onConflict:"room_id,user_id"});
   const {data:profiles}=await db.from("users").select("id,auth_id").in("auth_id",valid);
   const intIds=(profiles||[]).map((u:any)=>u.id);
   if(intIds.length) await db.from("notifications").insert(intIds.map((id:number)=>({
     recipient_id:id,type:"room_invite",entity_type:"event",entity_id:String(eventId),
     entity_payload:{url:`/feed/sneaky-lynk/room/${event.lynk_room_id}`,event_id:eventId},
   })));
 }
 return json(req,{ok:true,invited:valid.length,skipped:targets.length-valid.length});
});
