import { ticketEmbedEndpoint, ticketEmbedHeaders } from '../upstream';
export const dynamic='force-dynamic';
export async function OPTIONS(request:Request) {
  const origin=request.headers.get('origin') || '';
  return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'content-type','Cache-Control':'no-store',Vary:'Origin'}});
}
export async function POST(request:Request) {
  const origin=request.headers.get('origin') || '';
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,Vary:'Origin'};
  const error=(status:number,message:string)=>new Response(JSON.stringify({error:message}),{status,headers});
  try {
    if(!origin.startsWith('https://')) return error(403,'A secure website origin is required.');
    if(Number(request.headers.get('content-length') || 0)>8192) return error(413,'Request too large.');
    const body=await request.text(); if(body.length>8192) return error(413,'Request too large.');
    const response=await fetch(ticketEmbedEndpoint(),{method:'POST',headers:ticketEmbedHeaders(origin),body,
      cache:'no-store',signal:AbortSignal.timeout(25000)});
    // Deliberately preserve the upstream deny/error. Never fall back to hosted
    // checkout or to another user's cached session when the embed is denied.
    return new Response(await response.text(),{status:response.status,headers});
  } catch {return error(503,'Checkout is temporarily unavailable. Retry to recover the same attempt.');}
}
