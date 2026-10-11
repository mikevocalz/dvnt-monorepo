import { renderEventWidget, type EventWidget } from '@dvnt/app/lib/ticket-embed/event-widget-html';
export const dynamic = 'force-dynamic';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function unavailable(status=404){return new Response('This event widget is unavailable. Visit DVNT for current event information.',{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"frame-ancestors 'none'"}})}
export async function GET(_req:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;if(!ID.test(id))return unavailable();
 try{
  const configured=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.EXPO_PUBLIC_SUPABASE_URL;
  if(!configured)return unavailable(503);const base=new URL(configured);if(base.protocol!=='https:')return unavailable(503);
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const response=await fetch(new URL(`/functions/v1/event-ticket-widget?id=${encodeURIComponent(id)}`,base),{headers:key?{apikey:key}:{},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)return unavailable(response.status===404?404:503);
  const data=await response.json() as EventWidget;const origin=new URL(data.allowedOrigin);
  if(origin.protocol!=='https:'||origin.origin!==data.allowedOrigin||origin.username||origin.password)return unavailable(503);
  return new Response(renderEventWidget(data),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'none'; img-src https:; style-src 'unsafe-inline'; frame-ancestors 'self' ${origin.origin}; base-uri 'none'; form-action 'none'`}});
 }catch{return unavailable(503)}
}
