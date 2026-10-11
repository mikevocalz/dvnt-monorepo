import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifySession, corsHeaders } from '../_shared/verify-session.ts';
import { createEventWidgetHandler } from '../_shared/event-ticket-widget.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
// GET exposes only an eligible published public event DTO. POST requires Better Auth and owner/admin checks.
Deno.serve(createEventWidgetHandler({db,headers:(req)=>({...corsHeaders(req),'Access-Control-Allow-Methods':'GET, POST, OPTIONS'}),authenticate:req=>verifySession(db,req)}));
