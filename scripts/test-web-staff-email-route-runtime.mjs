import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staffEmailRoutes } from '../apps/web/src/lib/staff-email/routes.ts';
import { selectStaffEmailRuntime } from '../apps/web/src/lib/staff-email/runtime.ts';

const origin='https://app.example.invalid', rpc='https://db.example.invalid';
const env={
  DVNT_STAFF_EMAIL_ENABLED:'true',DVNT_STAFF_EMAIL_WEB_ORIGIN:origin,
  DVNT_STAFF_EMAIL_RPC_ORIGIN:rpc,DVNT_STAFF_EMAIL_RPC_SERVICE_KEY:'fixture-key',
  DVNT_STAFF_EMAIL_FROM:'Fixture <sender@example.invalid>',
  DVNT_STAFF_EMAIL_ACTIVE_KEY_ID:'fixture',DVNT_STAFF_EMAIL_KEYS:'fixture:'+'02'.repeat(32),
};
const requestId='fca4de13-9a6c-4b5b-9f70-9b664296e1cc';
const delivery='fca4de13-9a6c-4b5b-9f70-9b664296e1cd';
function req(path,{owner=true,headers={},payload}={}){
  const headersInit={host:new URL(origin).host,origin,
    ...(owner?{cookie:'better-auth.session_token=fixture-signed-session'}:{}),...headers};
  return new Request(origin+path,payload===undefined?{headers:headersInit}:{
    method:'POST',headers:{...headersInit,'content-type':'application/json'},body:JSON.stringify(payload),
  });
}
function fake({authenticated=true,budget=true,owner=true}={}){
  const calls=[];
  return {calls,fetcher:async (url,init)=>{
    assert.equal(init.redirect,'error');
    assert.equal(init.cache,'no-store');
    if (url===origin+'/api/auth/get-session'){
      assert.deepEqual(init.headers,{cookie:'better-auth.session_token=fixture-signed-session'});
      calls.push(['session']);
      return Response.json(authenticated ? {user:{id:'owner'},session:{userId:'owner'}} : null);
    }
    assert.ok(url.startsWith(rpc+'/rest/v1/rpc/'));
    const name=url.split('/').at(-1), payload=JSON.parse(init.body);
    assert.deepEqual(init.headers,{apikey:'fixture-key',Authorization:'Bearer fixture-key','Content-Type':'application/json'});
    calls.push([name,payload]);
    return Response.json(name==='take_event_staff_email_budget'?budget:
      name==='can_issue_event_staff_email_invite'?owner:name==='queue_event_staff_email_invite'?delivery:true);
  }};
}

test('routes are dark by default; unconfigured or noncanonical origins do not select runtime',async()=>{
  const forbid=()=>assert.fail('default-off could not call auth or storage');
  assert.equal(selectStaffEmailRuntime({},forbid),null);
  assert.equal(selectStaffEmailRuntime({...env,DVNT_STAFF_EMAIL_ENABLED:'false'},forbid),null);
  assert.equal(selectStaffEmailRuntime({...env,DVNT_STAFF_EMAIL_WEB_ORIGIN:'http://127.0.0.1:38437'},forbid),null);
  assert.equal(selectStaffEmailRuntime({...env,DVNT_STAFF_EMAIL_RPC_ORIGIN:rpc+'/wrong'},forbid),null);
  assert.equal(selectStaffEmailRuntime({...env,DVNT_STAFF_EMAIL_KEYS:'invalid'},forbid),null);
  const routes=staffEmailRoutes(null);
  assert.equal((await routes.claimPage(req('/public/staff/claim'))).status,404);
  assert.equal((await routes.issuePage(req('/staff-email/invite/1'))).status,404);
  assert.equal((await routes.mutate(req('/public/staff/claim',{payload:{token:'a'.repeat(64)}}),'claim')).status,404);
});

test('origin, session and active owner are enforced before accepting an invite mutation',async()=>{
  const f=fake();
  const routes=staffEmailRoutes(selectStaffEmailRuntime(env,f.fetcher));
  const fields={eventId:1,requestId,email:'member@example.invalid',role:'admin'};
  assert.equal((await routes.mutate(req('/staff-email/invite/1',{payload:fields,headers:{origin:'https://other.example.invalid'}}),'issue')).status,403);
  assert.equal((await routes.mutate(req('/staff-email/invite/1',{payload:fields,headers:{host:'other.example.invalid','x-forwarded-host':new URL(origin).host}}),'issue')).status,403);
  assert.equal((await routes.mutate(req('/staff-email/invite/1',{owner:false,payload:fields}),'issue')).status,401);
  assert.deepEqual(f.calls,[]);
  const inactive=fake({owner:false});
  const denied=staffEmailRoutes(selectStaffEmailRuntime(env,inactive.fetcher));
  assert.equal((await denied.mutate(req('/staff-email/invite/1',{payload:fields}),'issue')).status,404);
  assert.deepEqual(inactive.calls.map(c=>c[0]),['session','can_issue_event_staff_email_invite']);
});

test('issue passes real encrypted envelope only to service RPC; claim and revoke are exact',async()=>{
  const f=fake(), routes=staffEmailRoutes(selectStaffEmailRuntime(env,f.fetcher));
  const issue=(payload)=>routes.mutate(req('/staff-email/invite/1',{payload}),'issue');
  const fields={eventId:1,requestId,email:'Member@example.invalid',role:'admin'};
  assert.equal((await issue({...fields,eventId:2})).status,400);
  assert.equal((await issue({...fields,email:'a'.repeat(3000)})).status,400);
  assert.equal((await issue({...fields,actor:'attacker'})).status,400);
  assert.equal(f.calls.filter(c=>c[0]==='queue_event_staff_email_invite').length,0);
  const result=await issue(fields);
  assert.equal(result.status,202);
  assert.deepEqual(await result.json(),{state:'queued'});
  const envelope=f.calls.at(-1)[1];
  assert.equal(envelope.p_email,'member@example.invalid');
  assert.equal(envelope.p_actor,'owner');
  assert.match(envelope.p_token,/^[0-9a-f]{64}$/);
  assert.match(envelope.p_ciphertext,/^\\x[0-9a-f]+$/);
  assert.ok(!envelope.p_ciphertext.includes(envelope.p_token));
  const claim=await routes.mutate(req('/public/staff/claim',{payload:{token:envelope.p_token}}),'claim');
  assert.equal(claim.status,200);
  assert.deepEqual(f.calls.at(-1),['claim_event_staff_email_invite',{p_claimant:'owner',p_token:envelope.p_token}]);
  const revoke=await routes.mutate(req('/staff-email/invite/1',{payload:{eventId:1,requestId}}),'revoke');
  assert.equal(revoke.status,200);
  assert.deepEqual(f.calls.at(-1),['revoke_event_staff_email_invite',{p_event_id:1,p_actor:'owner',p_request_id:requestId}]);
});

test('budget denial never invokes a mutation RPC',async()=>{
  const f=fake({budget:false});
  const routes=staffEmailRoutes(selectStaffEmailRuntime(env,f.fetcher));
  assert.equal((await routes.mutate(req('/public/staff/claim',{payload:{token:'a'.repeat(64)}}),'claim')).status,429);
  assert.deepEqual(f.calls.map(c=>c[0]),['session','take_event_staff_email_budget']);
});
