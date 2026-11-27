const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const {PGlite}=require("@electric-sql/pglite");
const source=name=>readFileSync(join(__dirname,name),"utf8");
const config={enabled:true,environment:"private-staging",path:"/internal/setup-reminder",bearer:"abc_".repeat(12),hostId:21,eventId:431,
  stagingInbox:"staging@example.invalid",testPlatformAccountId:"acct_mockTestPlatform"};
const request=(options={},path=config.path)=>new Request("https://fixture.invalid"+path,{method:"POST",headers:{Authorization:"Bearer "+config.bearer},...options});
async function fixture(t,overrides={}) {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    create table public.users(id bigint primary key,auth_id text not null);
    create table public."user"(id text primary key,email text not null,"emailVerified" boolean not null);
    create table public.events(id integer primary key,host_id text not null);
    create table public.organizer_accounts(host_id text primary key,stripe_account_id text unique);
    insert into public.users values(21,'fixture-auth'),(22,'other');
    insert into public."user" values('fixture-auth','staging@example.invalid',true),('other','other@example.invalid',true);
    insert into public.events values(431,'fixture-auth'),(432,'other');`);
  await db.exec(source("host-payout-setup-email-ledger.sql"));
  await db.exec(source("host-payout-setup-email-staging.sql"));
  await db.exec(`
    insert into dvnt_host_setup_email.staging_target(host_id,event_id,inbox) values(21,431,'staging@example.invalid');
    create role fixture_dispatcher;
    grant usage on schema dvnt_host_setup_email to fixture_dispatcher;
    grant execute on function dvnt_host_setup_email.staging_source(bigint,bigint),
      dvnt_host_setup_email.staging_reserve(bigint),
      dvnt_host_setup_email.staging_record(bigint,uuid,text,text) to fixture_dispatcher;
  `);
  const effects={queries:0,mail:[],suppressed:false,stripe:null,fail:false};
  const {createPrivateHostSetupReminder}=await import("./host-payout-setup-email-staging.ts");
  const create=extra=>createPrivateHostSetupReminder({...config,...extra},{
    query:(sql,args)=>{effects.queries++;return db.query(sql,args)},
    isSuppressed:async()=>effects.suppressed,
    readStripeTestAccount:async()=>effects.stripe,
    sendPrivate:async mail=>{
      effects.mail.push(mail);
      if(effects.fail)throw Error("synthetic accepted, acknowledgement lost");
      return {id:"fixture-provider"};
    },...overrides,
  });
  return {db,effects,create};
}
test("one authorized bodyless stage invocation through restricted SQL records one fake send",async t=>{
  const {db,effects,create}=await fixture(t);
  await db.exec("set role fixture_dispatcher");
  await assert.rejects(db.query("select * from dvnt_host_setup_email.deliveries"),/permission denied/);
  await assert.rejects(db.query("select * from dvnt_host_setup_email.reserve_once(22)"),/permission denied/);
  assert.deepEqual((await db.query("select * from dvnt_host_setup_email.staging_source(22,432)")).rows,[]);
  assert.deepEqual((await db.query("select * from dvnt_host_setup_email.staging_reserve(22)")).rows,[]);
  const handler=create();
  assert.deepEqual(await (await handler(request())).json(),{outcome:"accepted"});
  assert.deepEqual(await (await handler(request())).json(),{outcome:"already_claimed"});
  assert.equal(effects.mail.length,1);
  assert.equal(effects.mail[0].to,config.stagingInbox);
  assert.ok(!effects.mail[0].text.includes("fixture-auth"));
});
test("disabled, production, wrong bearer, URL, method or body touch no dependencies",async t=>{
  const {effects,create}=await fixture(t);
  for(const [handler,input,status] of [
    [create({enabled:undefined}),request(),404],[create({environment:"production"}),request(),404],
    [create(),request({headers:{Authorization:"Bearer "+config.bearer.slice(1)+"x"}}),401],
    [create(),request({method:"GET"}),405],[create(),request({body:"{}"}),400],
    [create(),request({},config.path+"?host=22"),404],
  ]) assert.equal((await handler(input)).status,status);
  assert.equal(effects.queries,0); assert.deepEqual(effects.mail,[]);
});
test("suppression, mismatched host binding, unverification, and unknown Stripe block sends",async t=>{
  const {db,effects,create}=await fixture(t);
  const handler=create();
  effects.suppressed=true;
  assert.deepEqual(await (await handler(request())).json(),{outcome:"ineligible"});
  effects.suppressed=false;
  await db.exec(`update public."user" set "emailVerified"=false where id='fixture-auth'`);
  assert.deepEqual(await (await handler(request())).json(),{outcome:"ineligible"});
  await db.exec(`update public."user" set "emailVerified"=true where id='fixture-auth';
    insert into public.organizer_accounts values('fixture-auth','acct_fixtureRecipient')`);
  assert.equal((await handler(request())).status,200);
  effects.stripe={mode:"live",accountId:"acct_fixtureRecipient",platformAccountId:config.testPlatformAccountId};
  assert.deepEqual(await (await handler(request())).json(),{outcome:"ineligible"});
  effects.stripe={mode:"test",accountId:"acct_fixtureRecipient",platformAccountId:"acct_otherTestPlatform"};
  assert.deepEqual(await (await handler(request())).json(),{outcome:"ineligible"});
  await db.exec("update public.events set host_id='other' where id=431");
  assert.deepEqual(await (await handler(request())).json(),{outcome:"ineligible"});
  assert.equal(effects.mail.length,0);
});
test("one failed or uncertain provider result cannot trigger a second send",async t=>{
  const {db,effects,create}=await fixture(t); effects.fail=true;
  await db.exec("set role fixture_dispatcher");
  const handler=create();
  assert.equal((await handler(request())).status,503);
  assert.deepEqual(await (await handler(request())).json(),{outcome:"already_claimed"});
  assert.equal(effects.mail.length,1);
});
test("actionable Stripe evidence must match both pinned sandbox platform and organizer account",async t=>{
  const {db,effects,create}=await fixture(t);
  await db.exec("insert into public.organizer_accounts values('fixture-auth','acct_fixtureRecipient')");
  effects.stripe={mode:"test",accountId:"acct_fixtureRecipient",platformAccountId:config.testPlatformAccountId,
    payoutsEnabled:false,chargesEnabled:true,detailsSubmitted:true,currentlyDue:["external_account"],pastDue:[],pendingVerification:[],disabledReason:null};
  await db.exec("set role fixture_dispatcher");
  const handler=create();
  assert.deepEqual(await (await handler(request())).json(),{outcome:"accepted"});
  assert.equal(effects.mail[0].subject,"Finish your DVNT payout setup");
});
