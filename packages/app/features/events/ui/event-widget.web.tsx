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
interface WidgetData {ok:true;event:{id:number;title:string};settings:{id:string;allowed_origin:string;published:boolean;revision:number}|null;eligible:boolean;code:string|null}
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
 const mutation=useMutation({mutationFn:(action:'publish'|'revoke')=>request({action,eventId,origin:draft.origin??query.data?.settings?.allowed_origin??'',revision:query.data?.settings?.revision??0}),onSuccess:data=>{client.setQueryData(key,data);draft.setOrigin(null)}});
 const text={color:'#a7a7ae',fontSize:14,lineHeight:22};
 if(!authenticated)return <P style={text}>Sign in to manage your event widget.</P>;
 if(query.isPending)return <P style={text}>Loading event widget…</P>;
 if(query.isError||!query.data)return <Section style={{padding:24,gap:16}}><P style={text}>{query.error?.message||'Could not load this event.'}</P><Button onPress={()=>{void query.refetch()}}>Retry</Button></Section>;
 const d=query.data;const busy=mutation.isPending;const changed=draft.origin!==null;
 return <Main style={{backgroundColor:'#06070d',padding:24,minHeight:960}}><View style={{width:'100%',maxWidth:1100,alignSelf:'center',gap:20}}>
  <A href={`/feed/events/${eventId}/organizer`} style={{color:'#3FDCFF'}}>← Organizer dashboard</A>
  <H1 style={{color:'white',fontSize:28,fontWeight:'700'}}>Embed tickets</H1><P style={text}>{d.event.title}</P>
  <P style={text}>Show your event flyer and current ticket prices on your website. Buyers select and pay through the existing DVNT checkout in a new tab. Payment is not collected inside this iframe.</P>
  <Section style={{padding:20,borderWidth:1,borderColor:'#ffffff26',borderRadius:16,gap:16}}>
   <Input label="Website origin" value={draft.origin??d.settings?.allowed_origin??''} onChangeText={draft.setOrigin} placeholder="https://www.deviant.live" autoCapitalize="none" editable={!busy}/>
   <P style={text}>Use the exact HTTPS address of the website, without a page path. The widget can be framed only by that origin and DVNT. www and non-www are different origins.</P>
   <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>
    <Button disabled={busy||!d.eligible} loading={busy} onPress={()=>mutation.mutate('publish')}>Generate embed code</Button>
    <Button variant="outline" disabled={busy||!d.settings?.published} onPress={()=>{if(window.confirm('Disable this event widget? Existing orders and ticket purchases will not change.'))mutation.mutate('revoke')}}>Disable widget</Button>
    <Button variant="outline" disabled={busy} onPress={()=>{draft.setOrigin(null);mutation.reset();void query.refetch()}}>Reload</Button>
   </View>
   {!d.eligible?<P style={text}>Public non-Spicy ticketed events can be embedded. Private, hidden, draft, cancelled and Spicy events are not exposed through a public iframe.</P>:null}
   {mutation.error?<Text accessibilityRole="alert" style={{color:'#fca5a5'}}>{mutation.error.message}</Text>:null}
   {d.code&&!changed?<><EventWidgetCode code={d.code}/><Button variant="outline" onPress={()=>{void (async()=>{try{if(!navigator.clipboard)throw new Error();await navigator.clipboard.writeText(d.code!);toast('success','Embed code copied')}catch{toast('info','Select the code above to copy it.')}})()}}>Copy embed code</Button><P style={text}>Paste this iframe into your website’s HTML/embed block. No Stripe key or extra payment script is needed.</P></>:null}
  </Section>
  {d.settings?.published?<Section style={{gap:16}}><H2 style={{color:'white',fontSize:20,fontWeight:'600'}}>Live widget preview</H2><View style={{flexDirection:'row',gap:12}}><Button variant="outline" onPress={()=>draft.setWidth('100%')}>Desktop</Button><Button variant="outline" onPress={()=>draft.setWidth('390px')}>Mobile</Button></View><EventWidgetFrame id={d.settings.id} width={draft.width}/></Section>:null}
 </View></Main>;
}
