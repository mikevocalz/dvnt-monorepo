/** Read-only ticket marketing iframe. Payment always opens the EXISTING DVNT event page. */
import { normalizeEmbedOrigin } from './ticket-embed-settings.ts';
import { isUnpublished } from './event-access.ts';
import { salesCutoffAt } from './sales-cutoff.ts';
export const WIDGET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FIELDS = 'id,host_id,title,start_date,end_date,event_tz,location_name,location,flyer_image_url,cover_image_url,image,visibility,status,ticketing_enabled,is_hidden,publish_at,nsfw';
const SETTINGS='id,event_id,allowed_origin,published,revision';
export function widgetEventEligible(e:any, now=Date.now()) {
  return !!e && e.visibility==='public' && e.status==='active' && e.ticketing_enabled===true && e.nsfw!==true && !isUnpublished(e,now);
}
export function widgetCode(id:string) {
  if(!WIDGET_ID.test(id)) throw new Error('Invalid widget ID');
  return `<iframe src="https://dvntapp.live/tickets/embed/${id}" title="DVNT event tickets" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-popups allow-popups-to-escape-sandbox" style="width:100%;height:980px;border:0;border-radius:16px" ></iframe>`;
}
export function createEventWidgetHandler(d:{db:any;authenticate:(r:Request)=>Promise<string|null>;headers:(r:Request)=>Record<string,string>}) {
 return async(req:Request)=>{
  const headers={...d.headers(req),'Content-Type':'application/json','Cache-Control':'no-store'};
  const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  try {
   if(req.method==='GET') {
    const id=new URL(req.url).searchParams.get('id');if(!id||!WIDGET_ID.test(id))return json({error:'Widget unavailable'},404);
    const setting=await d.db.from('event_ticket_widgets').select(SETTINGS).eq('id',id).eq('published',true).maybeSingle();
    if(setting.error)throw new Error('settings');if(!setting.data)return json({error:'Widget unavailable'},404);
    const read=await d.db.from('events').select(FIELDS).eq('id',setting.data.event_id).maybeSingle();
    if(read.error)throw new Error('event');const e=read.data;
    if(!widgetEventEligible(e))return json({error:'Widget unavailable'},404);
    const cutoff=salesCutoffAt(e)?.getTime();const salesOpen=typeof cutoff==='number'&&cutoff>Date.now();
    const tiers=[];
    if(salesOpen){
     const t=await d.db.from('ticket_types').select('id,name,currency,is_active,status,tier_visibility,sale_start,sale_end').eq('event_id',e.id).limit(40);
     if(t.error)throw new Error('tiers');
     for(const tier of t.data||[]){
      if(tier.is_active===false || (tier.tier_visibility&&tier.tier_visibility!=='public') || tier.status!=='on_sale' ||
       (tier.sale_start && !(Date.parse(tier.sale_start)<=Date.now())) || (tier.sale_end && !(Date.parse(tier.sale_end)>Date.now())))continue;
      const [p,a]=await Promise.all([d.db.rpc('ticket_type_current_price_cents',{p_tier_id:tier.id}),d.db.rpc('ticket_type_available',{p_tier_id:tier.id})]);
      if(p.error||a.error||!Number.isSafeInteger(p.data)||p.data<0||typeof a.data!=='number'||a.data<=0)continue;
      const currency=String(tier.currency||'USD').toUpperCase();
      if(!/^[A-Z]{3}$/.test(currency))continue;
      tiers.push({name:String(tier.name||'Admission'),priceCents:p.data,currency});
     }
    }
    return json({ok:true,mode:'existing_checkout',allowedOrigin:normalizeEmbedOrigin(setting.data.allowed_origin),
      event:{id:e.id,title:e.title,startDate:e.start_date,timeZone:e.event_tz,location:e.location_name||e.location||'',flyerUrl:e.flyer_image_url||e.cover_image_url||e.image||null},
      tiers,salesOpen,checkoutUrl:`https://dvntapp.live/feed/events/${e.id}`});
   }
   if(req.method!=='POST')return json({error:'Method not allowed'},405);
   const user=await d.authenticate(req);if(!user)return json({error:'Sign in to manage this event widget.'},401);
   const raw=await req.text();if(raw.length>4096)return json({error:'Request too large'},413);
   let b:any;try{b=JSON.parse(raw)}catch{return json({error:'Invalid request'},400)}
   if(!b||!Number.isSafeInteger(b.eventId)||b.eventId<=0||!['get','publish','revoke'].includes(b.action))return json({error:'Invalid request'},400);
   const r=await d.db.from('events').select(FIELDS).eq('id',b.eventId).maybeSingle();
   if(r.error)throw new Error('event');if(!r.data)return json({error:'Event not found'},404);const e=r.data;
   if(e.host_id!==user){
    const a=await d.db.from('event_co_organizers').select('id').eq('event_id',b.eventId).eq('user_id',user).eq('role','admin').eq('accepted',true).maybeSingle();
    if(a.error)throw new Error('role');if(!a.data)return json({error:'Only the owner or accepted event admin may generate code.'},403);
   }
   const old=await d.db.from('event_ticket_widgets').select(SETTINGS).eq('event_id',b.eventId).maybeSingle();
   if(old.error)throw new Error('settings');let settings=old.data;
   if(b.action!=='get'){
    if(!Number.isSafeInteger(b.revision)||b.revision<0||b.revision!==(settings?.revision??0))return json({error:'Settings changed. Reload before saving.'},409);
    if(b.action==='publish'&&!widgetEventEligible(e))return json({error:'Only published public non-Spicy ticketed events can have a public widget.'},409);
    if(b.action==='revoke'&&!settings)return json({error:'No widget to revoke'},409);
    let origin=settings?.allowed_origin;
    if(b.action==='publish'){try{origin=normalizeEmbedOrigin(b.origin)}catch{return json({error:'Enter the exact HTTPS website origin, with no page path or wildcard.'},400)}}
    const patch={allowed_origin:origin,published:b.action==='publish',revision:b.revision+1,updated_by:user,updated_at:new Date().toISOString()};
    const write=settings?await d.db.from('event_ticket_widgets').update(patch).eq('event_id',b.eventId).eq('revision',b.revision).select(SETTINGS).maybeSingle()
      :await d.db.from('event_ticket_widgets').insert({...patch,event_id:b.eventId}).select(SETTINGS).maybeSingle();
    if(write.error?.code==='23505'||(!write.error&&!write.data))return json({error:'Settings changed. Reload before saving.'},409);
    if(write.error)throw new Error('save');settings=write.data;
   }
   return json({ok:true,event:{id:e.id,title:e.title},settings,eligible:widgetEventEligible(e),
     code:settings?.published?widgetCode(settings.id):null});
  }catch{return json({error:'The event widget is temporarily unavailable. Existing checkout is unchanged.'},503)}
 };
}
