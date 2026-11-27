/**
 * Disposable, network-free PostgreSQL/WASM contract for the dormant service-only
 * invite schema. Run: NODE_PATH=<pglite install>/node_modules node --test \
 * scripts/test-web-staff-email-invite-foundation.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrations = join(__dirname, '../apps/mobile/supabase/migrations');
const candidate = readFileSync(join(migrations, '20261124221500_web_staff_email_invite_foundation.sql'), 'utf8');
const verified = readFileSync(join(migrations, '20260916150000_verified_adult_age_gate.sql'), 'utf8');
const checkout = readFileSync(join(migrations, '20261003180000_checkout_restricted_profiles.sql'), 'utf8');

test('dormant staff invitations: role ACLs, close-on-revoke and exact verified contact', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.events(id integer PRIMARY KEY, status text, host_id text);
    INSERT INTO public.events VALUES (1,'active','host'),(2,'active','other');
    CREATE TABLE public."user"(id text PRIMARY KEY,email text,"emailVerified" boolean);
    INSERT INTO public."user" VALUES ('member','invitee@example.invalid',true),('other','different@example.invalid',true);
    CREATE TABLE public.identity_verifications(user_id text PRIMARY KEY,status text,date_of_birth date,failure_code text,failure_message text);
    CREATE TABLE public.verified_admission_policy(id integer PRIMARY KEY,denylist text[] NOT NULL);
    INSERT INTO public.verified_admission_policy VALUES(1,'{}');
    CREATE TABLE public.user_private_profile(auth_id text PRIMARY KEY,checkout_restricted boolean);
    CREATE TABLE public.event_co_organizers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id int,user_id text,role text,invited_by text,accepted boolean,UNIQUE(event_id,user_id));
  `);
  await db.exec(verified);
  await db.exec(checkout.slice(checkout.indexOf('CREATE OR REPLACE FUNCTION public.is_checkout_restricted('),checkout.indexOf('-- ── Create or reuse')));
  await db.exec(candidate);
  await db.exec(readFileSync(join(migrations, "20261124221600_web_staff_email_route_policy.sql"), "utf8"));
  const q = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const service = async (sql, args) => {
    await db.exec('SET ROLE service_role');
    try {
      await q("SELECT set_config('request.jwt.claims', $1, false)", ['{"role":"service_role"}']);
      return await q(sql, args);
    }
    finally { await db.exec('RESET request.jwt.claims; RESET ROLE'); }
  };
  const queue = (token, request, email = 'invitee@example.invalid') => service(`
    SELECT public.queue_event_staff_email_invite(1,'host',$1,'admin',$2,$3,decode(repeat('a',64),'hex'),
      ARRAY[decode(repeat('a',64),'hex')],'stage',decode(repeat('b',24),'hex'),decode(repeat('c',34),'hex')) id
  `, [email, request, token]);
  const revoke = (actor, request) => service('SELECT public.revoke_event_staff_email_invite(1,$1,$2) ok', [actor, request]);
  const claim = (actor, token) => service('SELECT public.claim_event_staff_email_invite($1,$2) ok', [actor, token]);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const rel of ['event_staff_email_invites','event_staff_email_outbox','event_staff_email_rate_budget']) {
      const access = await q('SELECT has_table_privilege($1,$2,$3) ok', [role,'public.'+rel,'SELECT,INSERT,UPDATE,DELETE']);
      assert.equal(access.ok,false, `${role} cannot inspect or mutate ${rel}`);
    }
  }
  for (const role of ['anon', 'authenticated']) {
    const denied = await q("SELECT has_function_privilege($1, 'public.claim_event_staff_email_invite(text,text)', 'EXECUTE') ok",[role]);
    assert.equal(denied.ok,false);
  }
  for (let i = 0; i < 8; i++) {
    assert.equal((await service("SELECT public.take_event_staff_email_budget('rate-fixture','issue') ok")).ok, true);
  }
  assert.equal((await service("SELECT public.take_event_staff_email_budget('rate-fixture','issue') ok")).ok, false);
  const noDirectIssue=await q("SELECT has_function_privilege('service_role', 'public.issue_event_staff_email_invite(integer,text,text,text,uuid,text)', 'EXECUTE') ok");
  assert.equal(noDirectIssue.ok,false);
  const a = '1'.repeat(64), b = '2'.repeat(64), r1 = crypto.randomUUID(), r2 = crypto.randomUUID();
  const first = await queue(a, r1);
  assert.ok(first.id);
  assert.deepEqual(await queue(a, r1),first);
  const lease = await service('SELECT * FROM public.lease_staff_email_delivery()');
  assert.equal(lease.delivery_id,first.id);
  assert.equal((await revoke('other',r1)).ok,false);
  assert.equal((await revoke('host',r1)).ok,true);
  assert.equal((await queue(a,r1)).id,null);
  assert.deepEqual(await q('SELECT state, key_id, nonce, ciphertext, lease_token, lease_until FROM public.event_staff_email_outbox WHERE delivery_id=$1',[first.id]),
    {state:'closed',key_id:null,nonce:null,ciphertext:null,lease_token:null,lease_until:null});
  assert.equal((await service('SELECT public.finish_staff_email_delivery($1,$2,$3,$4) ok',[first.id,lease.lease_token,'provider_accepted','fixture'])).ok,false);
  assert.equal((await claim('member',a)).ok,false);
  assert.ok((await queue(b,r2)).id);
  await db.exec("INSERT INTO public.identity_verifications(user_id,status,date_of_birth) VALUES ('member','passed','1990-01-01'),('other','passed','1990-01-01')");
  assert.equal((await claim('other',b)).ok,false);
  await db.exec("UPDATE public.verified_admission_policy SET denylist=ARRAY['member'] WHERE id=1");
  assert.equal((await claim('member',b)).ok,false);
  await db.exec("UPDATE public.verified_admission_policy SET denylist='{}' WHERE id=1");
  assert.equal((await claim('member',b)).ok,true);
  assert.equal((await claim('member',b)).ok,true);
  assert.equal((await revoke('host',r2)).ok,false);
  assert.deepEqual(await q('SELECT user_id,role,accepted FROM public.event_co_organizers'),{user_id:'member',role:'admin',accepted:true});
});

test('no-account invite runs queue → synthetic provider acceptance → verified signup → exact role', async (t) => {
  const [{ selectStaffEmailRuntime }, { staffEmailRoutes }, { selectStaffEmailWorker }] = await Promise.all([
    import('../apps/web/src/lib/staff-email/runtime.ts'),
    import('../apps/web/src/lib/staff-email/routes.ts'),
    import('../apps/web/src/lib/staff-email/worker-runtime.mjs'),
  ]);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.events(id integer PRIMARY KEY, status text, host_id text);
    INSERT INTO public.events VALUES (1,'active','host');
    CREATE TABLE public."user"(id text PRIMARY KEY,email text,"emailVerified" boolean);
    INSERT INTO public."user" VALUES ('host','host@example.invalid',true),('wrong','wrong@example.invalid',true);
    CREATE TABLE public.identity_verifications(user_id text PRIMARY KEY,status text,date_of_birth date,failure_code text,failure_message text);
    INSERT INTO public.identity_verifications VALUES ('wrong','passed','1990-01-01',NULL,NULL);
    CREATE TABLE public.verified_admission_policy(id integer PRIMARY KEY,denylist text[] NOT NULL);
    INSERT INTO public.verified_admission_policy VALUES(1,'{}');
    CREATE TABLE public.user_private_profile(auth_id text PRIMARY KEY,checkout_restricted boolean);
    CREATE TABLE public.event_co_organizers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id int,user_id text,role text,invited_by text,accepted boolean,UNIQUE(event_id,user_id));
  `);
  await db.exec(verified);
  await db.exec(checkout.slice(checkout.indexOf('CREATE OR REPLACE FUNCTION public.is_checkout_restricted('),checkout.indexOf('-- ── Create or reuse')));
  await db.exec(candidate);
  await db.exec(readFileSync(join(migrations, '20261124221600_web_staff_email_route_policy.sql'), 'utf8'));
  const web='https://app.example.invalid', storage='https://storage.example.invalid', workerToken='W'.repeat(43);
  const env={
    DVNT_STAFF_EMAIL_ENABLED:'true',DVNT_STAFF_EMAIL_WEB_ORIGIN:web,
    DVNT_STAFF_EMAIL_RPC_ORIGIN:storage,DVNT_STAFF_EMAIL_RPC_SERVICE_KEY:'fixture-db',
    DVNT_STAFF_EMAIL_FROM:'DVNT Fixture <sender@example.invalid>',
    DVNT_STAFF_EMAIL_ACTIVE_KEY_ID:'fixture',DVNT_STAFF_EMAIL_KEYS:'fixture:'+'12'.repeat(32),
    DVNT_STAFF_EMAIL_WORKER_ENABLED:'true',DVNT_STAFF_EMAIL_TRACKING_VERIFIED_OFF:'true',
    DVNT_STAFF_EMAIL_WORKER_ORIGIN:web,DVNT_STAFF_EMAIL_WORKER_TOKEN:workerToken,
    DVNT_STAFF_EMAIL_WORKER_RESEND_KEY:'fixture-resend',DVNT_STAFF_EMAIL_WORKER_SENDER_DOMAIN:'example.invalid',
  };
  const rpcs={
    can_issue_event_staff_email_invite:['p_event_id','p_actor'],
    take_event_staff_email_budget:['p_actor','p_operation'],
    queue_event_staff_email_invite:['p_event','p_actor','p_email','p_role','p_request','p_token','p_intent','p_acceptable_intents','p_key_id','p_nonce','p_ciphertext'],
    lease_staff_email_delivery:[],
    staff_email_delivery_authorized:['p_delivery','p_lease'],
    finish_staff_email_delivery:['p_delivery','p_lease','p_state','p_receipt'],
    claim_event_staff_email_invite:['p_claimant','p_token'],
  };
  let mail, issued=0, providerCalls=0;
  const fixtureFetch=async(url,init)=>{
    if(url===web+'/api/auth/get-session'){
      const actor=init.headers.cookie?.match(/^fixture-session=(host|joiner|wrong)$/)?.[1];
      const found=actor && (await db.query('SELECT id FROM public."user" WHERE id=$1',[actor])).rows[0]?.id;
      return Response.json(found ? {user:{id:found},session:{userId:found}} : null);
    }
    if(url==='https://api.resend.com/emails'){
      providerCalls++;
      assert.equal(init.headers.Authorization,'Bearer fixture-resend');
      assert.match(init.headers['Idempotency-Key'],/^dvnt-staff-invite:v1:[a-f0-9-]{36}$/);
      mail=JSON.parse(init.body);
      return Response.json({id:'synthetic-provider-acceptance'});
    }
    assert.ok(url.startsWith(storage+'/rest/v1/rpc/'));
    assert.equal(init.headers.Authorization,'Bearer fixture-db');
    const name=url.split('/').at(-1);
    const args=rpcs[name];
    assert.ok(args, 'only known test RPCs are supported');
    const body=JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(),[...args].sort());
    const params=args.map(key=>body[key]);
    // PostgreSQL/WASM uses a text encoder for the named bytea array, while
    // PostgREST receives a JSON array. Match the same bytes in both adapters.
    const bindings=args.map((key,i)=>key==='p_acceptable_intents'?
      `ARRAY(SELECT jsonb_array_elements_text($${i+1}::jsonb)::bytea)`:`$${i+1}`).join(',');
    if(name==='queue_event_staff_email_invite'){
      issued++;
      params[7]=JSON.stringify(params[7]);
      for (const i of [6,9,10]) params[i]=Buffer.from(params[i].slice(2),"hex");
    }
    await db.exec('SET ROLE service_role');
    try {
      await db.query("SELECT set_config('request.jwt.claims', $1, false)", ['{"role":"service_role"}']);
      const table=name==='lease_staff_email_delivery';
      const rows=(await db.query(table?`SELECT * FROM public.${name}(${bindings})`:`SELECT public.${name}(${bindings}) AS result`,params)).rows;
      return Response.json(table?rows:rows[0].result);
    } finally {
      await db.exec('RESET request.jwt.claims; RESET ROLE');
    }
  };
  const routes=staffEmailRoutes(selectStaffEmailRuntime(env,fixtureFetch));
  const worker=selectStaffEmailWorker(env,fixtureFetch);
  const { runPrivateStaffEmailTick } = await import('./dvnt-private-staff-email-tick.mjs');
  const schedulerEnv={...env,DVNT_ENVIRONMENT:'private-staging',DVNT_PRIVATE_STAFF_EMAIL_SCHEDULER:'true'};
  const tick=()=>runPrivateStaffEmailTick(schedulerEnv,(url,init)=>worker(new Request(url,init)));
  const req=(path,actor,payload)=>new Request(web+path,{
    method:payload===undefined?'GET':'POST',
    headers:{host:new URL(web).host,origin:web,cookie:'fixture-session='+actor,'content-type':'application/json'},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
  });
  const email='not-yet-registered@example.invalid', invitePath='/staff-email/invite/1', claimPath='/public/staff/claim';
  assert.equal((await routes.issuePage(req(invitePath,'host'))).status,200);
  assert.equal((await routes.mutate(req(invitePath,'host',{eventId:1,requestId:crypto.randomUUID(),email,role:'editor'}),'issue')).status,202);
  assert.equal(issued,1);
  assert.equal(providerCalls,0);
  assert.equal(await tick(),'completed');
  assert.equal(await tick(),'completed');
  assert.equal(providerCalls,1);
  assert.deepEqual(mail.to,[email]);
  const token=mail.html.match(/\/public\/staff\/claim#([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  assert.equal((await routes.mutate(req(claimPath,'joiner',{token}),'claim')).status,401);
  assert.equal((await routes.mutate(req(claimPath,'wrong',{token}),'claim')).status,404);
  await db.query('INSERT INTO public."user" VALUES ($1,$2,false)',['joiner',email]);
  assert.equal((await routes.mutate(req(claimPath,'joiner',{token}),'claim')).status,404);
  await db.exec(`UPDATE public."user" SET "emailVerified"=true WHERE id='joiner';
    INSERT INTO public.identity_verifications VALUES ('joiner','passed','1990-01-01',NULL,NULL)`);
  await t.test('explicit acceptance from the real browser page', {
    skip: !process.env.DVNT_STAFF_CLAIM_BROWSER,
  }, async () => {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      executablePath: process.env.DVNT_STAFF_CLAIM_BROWSER,
      headless: true,
    });
    try {
      const context=await browser.newContext({serviceWorkers:'block'});
      let postCount=0;
      await context.route('**/*',async route => {
        const inbound=route.request(), actual=new URL(inbound.url());
        if(actual.origin!==web || actual.pathname!==claimPath) return route.abort();
        const get=inbound.method()==='GET';
        assert.ok(!actual.hash);
        const headers=await inbound.allHeaders();
        const request=new Request(actual,{method:inbound.method(),headers:{...headers,host:actual.host},
          ...(!get&&{body:inbound.postData()})});
        if(!get) postCount++;
        const response=get ? await routes.claimPage(request) : await routes.mutate(request,'claim');
        await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
      });
      const page=await context.newPage();
      const open=async()=>{
        await page.goto(web+claimPath+'#'+token);
        await page.waitForURL(web+claimPath);
      };
      await open();
      await page.getByRole('link',{name:'Create an account'}).waitFor();
      assert.equal((await page.getByRole('link',{name:'Create an account'}).getAttribute('href')).includes(token),false);
      assert.equal(postCount,0);
      await context.addCookies([{name:'fixture-session',value:'wrong',url:web}]);
      await open();
      await page.getByRole('button',{name:'Accept with this account'}).click();
      await page.getByText('This invitation is not available to this account.',{exact:false}).waitFor();
      await context.addCookies([{name:'fixture-session',value:'joiner',url:web}]);
      await open();
      assert.equal(postCount,1);
      await page.getByRole('button',{name:'Accept with this account'}).click();
      await page.getByText('Staff invitation accepted.',{exact:true}).waitFor();
      assert.equal(postCount,2);
    } finally { await browser.close(); }
  });
  assert.equal((await routes.mutate(req(claimPath,'joiner',{token}),'claim')).status,200);
  assert.equal((await routes.mutate(req(claimPath,'joiner',{token}),'claim')).status,200);
  assert.deepEqual((await db.query('SELECT event_id,user_id,role,accepted FROM public.event_co_organizers')).rows,
    [{event_id:1,user_id:'joiner',role:'editor',accepted:true}]);
});
