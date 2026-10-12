'use client';
import { useMemo } from 'react';
import { create } from 'zustand';
import { View, Text } from 'react-native';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Main,Section,H1,H2,P,A } from '@dvnt/app/components/ui/html';
import { Button } from '@dvnt/app/components/ui/button';
import { Input } from '@dvnt/app/components/ui/input';
import { EventWidgetFrame,EventWidgetCode } from '@dvnt/app/components/ui/event-widget-controls.web';
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';
import { useUIStore } from '@dvnt/app/lib/stores/ui-store';
import { useEventRole } from '@dvnt/app/lib/hooks/use-event-role';
import { invokeEdge } from '@dvnt/app/lib/api/invoke-edge';
import { onSiteTicketEmbedCode } from '@dvnt/app/lib/ticket-embed/unified-code';
import { prepareOrganizerOrigin } from '@dvnt/app/lib/ticket-embed/organizer-origin';
interface WidgetData {ok:true;event:{id:number;title:string};settings:{id:string;allowed_origin:string;published:boolean;revision:number}|null;eligible:boolean;eligibilityIssues?:string[];code:string|null}
async function request(body:Record<string,unknown>):Promise<WidgetData>{
 const result=await invokeEdge<WidgetData & {error?:string}>('event-ticket-widget',body);
 if(result.error)throw new Error(result.error.message);
 if(!result.data?.ok||result.data.error)throw new Error(result.data?.error||'Could not load this event widget.');
 return result.data;
}
export function EventWidgetEntry({eventId}:{eventId:string}){
 const {role}=useEventRole(eventId);if(role!=='owner'&&role!=='admin')return null;
 return <View style={{width:'100%',maxWidth:672,alignSelf:'center',padding:16}}><A href={`/feed/events/${encodeURIComponent(eventId)}/embed`} style={{color:'#3FDCFF',fontSize:16,fontWeight:'600'}}>Embed tickets ↗</A></View>;
}
export function EventWidgetScreen({eventId}:{eventId:number}){
 const userId=useAuthStore(s=>s.user?.id??'anonymous');const authenticated=useAuthStore(s=>s.isAuthenticated);
 return <Builder key={`${userId}:${eventId}`} eventId={eventId} userId={userId} authenticated={authenticated}/>;
}
function Builder({eventId,userId,authenticated}:{eventId:number;userId:string;authenticated:boolean}){
 const useDraft=useMemo(()=>create<{origin:string|null;width:string;setOrigin:(v:string|null)=>void;setWidth:(v:string)=>void}>(set=>({origin:null,width:'100%',setOrigin:origin=>set({origin}),setWidth:width=>set({width})})),[]);
 const draft=useDraft();const client=useQueryClient();const toast=useUIStore(s=>s.showToast);const key=['event-ticket-widget',userId,eventId];
 const query=useQuery({queryKey:key,queryFn:()=>request({action:'get',eventId}),enabled:authenticated,retry:false});
 const mutation=useMutation({mutationFn:(action:'publish'|'revoke')=>{
  const entered=draft.origin??query.data?.settings?.allowed_origin??'';
  const prepared=prepareOrganizerOrigin(entered);
  if(action==='publish'&&!prepared.origin)throw new Error(prepared.error||'Enter a valid website origin.');
  return request({action,eventId,origin:action==='publish'?prepared.origin:entered,revision:query.data?.settings?.revision??0});
 },onSuccess:data=>{client.setQueryData(key,data);draft.setOrigin(null)}});
 const text={color:'#a7a7ae',fontSize:14,lineHeight:22};
 if(!authenticated)return <P style={text}>Sign in to manage your event widget.</P>;
 if(query.isPending)return <P style={text}>Loading event widget…</P>;
 if(query.isError||!query.data)return <Section style={{padding:24,gap:16}}><P style={text}>{query.error?.message||'Could not load this event.'}</P><Button onPress={()=>{void query.refetch()}}>Retry</Button></Section>;
 const d=query.data;const busy=mutation.isPending;const changed=draft.origin!==null;
 const enteredOrigin=draft.origin??d.settings?.allowed_origin??'';
 const preparedOrigin=prepareOrganizerOrigin(enteredOrigin);
 const eligibilityIssues=d.eligibilityIssues?.length?d.eligibilityIssues:['This event must be public, active, published, non-Spicy and ticketing-enabled.'];
 const onSiteReady=process.env.NEXT_PUBLIC_TICKET_EMBED_PAYMENTS_ENABLED==='true';
 const onSiteCode=d.settings?.published&&onSiteReady?onSiteTicketEmbedCode(d.settings.id):null;
 return <Main style={{backgroundColor:'#06070d',padding:24,minHeight:960}}><View style={{width:'100%',maxWidth:1100,alignSelf:'center',gap:20}}>
  <A href={`/feed/events/${eventId}/organizer`} style={{color:'#3FDCFF'}}>← Organizer dashboard</A>
  <H1 style={{color:'white',fontSize:28,fontWeight:'700'}}>Embed tickets</H1><P style={text}>{d.event.title} · Event #{eventId}</P>
  <P style={text}>Generate an external ticket-sales embed for this event. Both ways use the same event, widget ID, ticket tiers, prices, inventory, orders and fulfillment. The standard iframe opens DVNT checkout; on-page payment keeps the buyer on the organizer's website when enabled.</P>
  <Section style={{padding:20,borderWidth:1,borderColor:'#ffffff26',borderRadius:16,gap:16}}>
   <Input label="Website origin" value={enteredOrigin} onChangeText={draft.setOrigin} placeholder="https://www.deviant.live" autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} error={enteredOrigin.trim()&&!preparedOrigin.origin?preparedOrigin.error??undefined:undefined}/>
   {preparedOrigin.origin&&preparedOrigin.origin!==enteredOrigin.trim()?<P style={{color:'#3FDCFF',fontSize:14}}>We'll use {preparedOrigin.origin} as your secure website origin.</P>:null}
   {!enteredOrigin.trim()?<P style={text}>Enter the website where you'll display this event's tickets to enable code generation.</P>:null}
   <P style={text}>Use the exact HTTPS address of the website, without a page path. The widget can be framed only by that origin and DVNT. www and non-www are different origins.</P>
   <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>
    <Button disabled={busy||!d.eligible||!preparedOrigin.origin} loading={busy} onPress={()=>mutation.mutate('publish')}>Generate embed code</Button>
    <Button variant="outline" disabled={busy||!d.settings?.published} onPress={()=>{if(window.confirm('Disable this event widget? Existing orders and ticket purchases will not change.'))mutation.mutate('revoke')}}>Disable widget</Button>
    <Button variant="outline" disabled={busy} onPress={()=>{draft.setOrigin(null);mutation.reset();void query.refetch()}}>Reload</Button>
   </View>
   {!d.eligible?<Section style={{gap:8,borderWidth:1,borderColor:'#fca5a566',borderRadius:12,padding:16}}>
    <Text accessibilityRole="alert" style={{color:'#fca5a5',fontWeight:'700',fontSize:15}}>This event isn't ready for an embed yet.</Text>
    {eligibilityIssues.map(issue=><P key={issue} style={text}>• {issue}</P>)}
    <A href={`/feed/events/${eventId}/organizer`} style={{color:'#3FDCFF',fontWeight:'600'}}>Review event settings →</A>
   </Section>:null}
   {mutation.error?<Text accessibilityRole="alert" style={{color:'#fca5a5'}}>{mutation.error.message}</Text>:null}
   {d.code&&!changed?<><EventWidgetCode code={d.code}/><Button variant="outline" onPress={()=>{void (async()=>{try{if(!navigator.clipboard)throw new Error();await navigator.clipboard.writeText(d.code!);toast('success','Embed code copied')}catch{toast('info','Select the code above to copy it.')}})()}}>Copy embed code</Button><P style={text}>Paste this event-specific iframe on your website. The standard mode opens DVNT checkout rather than taking payment inside the external site.</P></>:null}
  </Section>
  <Section style={{gap:12,padding:20,borderWidth:1,borderColor:'#ffffff26',borderRadius:16}}>
   <H2 style={{color:'white',fontSize:20,fontWeight:'600'}}>Checkout directly on your website</H2>
   <P style={text}>Use this option to embed the same event and take payment on an external site. The lightweight script creates the event's ticket iframe and mounts secure Stripe checkout into the host page; no additional event or second widget is created.</P>
   {onSiteCode&&!changed?<><EventWidgetCode code={onSiteCode}/><Button variant="outline" onPress={()=>{void (async()=>{try{if(!navigator.clipboard)throw new Error();await navigator.clipboard.writeText(onSiteCode);toast('success','On-page ticket embed copied')}catch{toast('info','Select the code above to copy it.')}})()}}>Copy on-page ticket embed</Button></>:<P style={text}>On-page Stripe checkout is not yet enabled for this event. The same-event payment code will appear here when the existing DVNT payment integration has passed its release test. The standard iframe above remains available.</P>}
  </Section>
  {d.settings?.published?<Section style={{gap:16}}><H2 style={{color:'white',fontSize:20,fontWeight:'600'}}>Live widget preview</H2><View style={{flexDirection:'row',gap:12}}><Button variant="outline" onPress={()=>draft.setWidth('100%')}>Desktop</Button><Button variant="outline" onPress={()=>draft.setWidth('390px')}>Mobile</Button></View><EventWidgetFrame id={d.settings.id} width={draft.width}/></Section>:null}
 </View></Main>;
}
