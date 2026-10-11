import { randomUUID } from 'node:crypto';
import { renderTicketEmbedWidget, type TicketEmbedDescriptor } from '@dvnt/app/lib/ticket-embed/widget';
import { ticketEmbedEndpoint, ticketEmbedHeaders } from '../../upstream';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const denied=(status:number)=>new Response('This event ticket embed is unavailable. Purchase tickets on the DVNT event page.',
    {status,headers:{'Content-Type':'text/plain','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}});
  if(!UUID.test(id)) return denied(404);
  try {
    const response=await fetch(ticketEmbedEndpoint(),{method:'POST',headers:ticketEmbedHeaders(),
      body:JSON.stringify({action:'describe',embedId:id}),cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok) return denied(response.status===404?404:503);
    const data=await response.json() as TicketEmbedDescriptor;
    const parent=new URL(data.allowedOrigin);
    if(parent.protocol!=='https:' || parent.origin!==data.allowedOrigin) return denied(503);
    const supplied=new URL(request.url).searchParams.get('channel');
    const channel=supplied && UUID.test(supplied)?supplied:randomUUID();
    return new Response(renderTicketEmbedWidget(data,channel),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Content-Security-Policy':`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors ${parent.origin}`,
      'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
  } catch {return denied(503);}
}
