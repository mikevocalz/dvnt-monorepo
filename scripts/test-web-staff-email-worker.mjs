import { test } from "node:test";
import assert from "node:assert/strict";
import { createStaffEmailWorker } from "../apps/web/src/lib/staff-email/worker.mjs";
import { keyring,prepareIssue } from "../apps/web/src/lib/staff-email/transport.mjs";

const auth="A".repeat(43), web="https://worker.example.invalid", db="https://db.example.invalid";
const delivery="4e272797-e426-48a6-81b3-a5e8effee0c1", lease="4e272797-e426-48a6-81b3-a5e8effee0c2";
const keys=await keyring("fixture",new Map([["fixture",new Uint8Array(32).fill(3)]]));
const req=(token=auth,over={})=>new Request(web+"/internal/staff-email",{method:"POST",headers:{authorization:"Bearer "+token},...over});
const defaults={enabled:true,schedulerToken:auth,keys,workerOrigin:web,rpcOrigin:db,rpcKey:"fixture-db",
  resendKey:"fixture-resend",approvedSenderDomain:"example.invalid",trackingVerifiedOff:true};
async function envelope(from="Fixture <sender@example.invalid>") {
  return {...await prepareIssue({eventId:1,actor:"host",requestId:crypto.randomUUID(),email:"receiver@example.invalid",
    role:"admin",from,webOrigin:"https://app.example.invalid"},keys,link=>({subject:"Invite",html:'<a href="'+link+'">Open</a>'})),
    lease_token:lease,delivery_id:delivery};
}
function setup(row,{authorized=true,wouldFailOnce=false}={}){
  const calls=[]; let tried=false;
  const worker=createStaffEmailWorker({...defaults,requestFetch:async(url,init)=>{
    assert.equal(init.redirect,"error");
    assert.equal(init.cache,"no-store");
    const body=JSON.parse(init.body);
    if(url==="https://api.resend.com/emails"){
      assert.equal(init.headers.Authorization,"Bearer fixture-resend");
      assert.equal(init.headers["Idempotency-Key"],"dvnt-staff-invite:v1:"+delivery);
      assert.deepEqual(body.to,["receiver@example.invalid"]);
      calls.push(["provider",body,init.headers["Idempotency-Key"]]);
      if(wouldFailOnce&&!tried){tried=true;throw new Error("synthetic transport uncertainty");}
      return Response.json({id:"fixture-receipt"});
    }
    const name=url.slice((db+"/rest/v1/rpc/").length);
    assert.equal(url,db+"/rest/v1/rpc/"+name);
    assert.equal(init.headers.Authorization,"Bearer fixture-db");
    calls.push([name,body]);
    if(name==="lease_staff_email_delivery")return Response.json(row?[row]:[]);
    if(name==="staff_email_delivery_authorized")return Response.json(authorized);
    if(name==="finish_staff_email_delivery")return Response.json(true);
    assert.fail("unexpected RPC");
  }});
  return {worker,calls};
}
test("default disabled, unattested tracking, or wrong request never touches storage/provider",async()=>{
  const deny=()=>assert.fail("no request expected");
  for(const settings of [{enabled:false},{trackingVerifiedOff:false},{schedulerToken:"too-short"}]) {
    const worker=createStaffEmailWorker({...defaults,...settings,requestFetch:deny});
    assert.equal((await worker(req())).status,404);
  }
  const worker=createStaffEmailWorker({...defaults,requestFetch:deny});
  assert.equal((await worker(req("B".repeat(43)))).status,404);
  assert.equal((await worker(req(auth,{method:"GET"}))).status,404);
  assert.equal((await worker(req(auth,{body:"{}"}))).status,400);
});
test("lease or authorization denial never contacts provider",async()=>{
  for(const fixture of [setup(null),setup(await envelope(),{authorized:false})]) {
    assert.equal((await fixture.worker(req())).status,204);
    assert.ok(!fixture.calls.some(c=>c[0]==="provider"));
  }
});
test("provider request has constant endpoint and stable key; uncertain retry preserves exact body",async()=>{
  const f=setup(await envelope(),{wouldFailOnce:true});
  assert.equal((await f.worker(req())).status,503);
  assert.equal((await f.worker(req())).status,204);
  const calls=f.calls.filter(x=>x[0]==="provider");
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0],calls[1]);
  const finishes=f.calls.filter(x=>x[0]==="finish_staff_email_delivery").map(x=>x[1]);
  assert.deepEqual(finishes,[
    {p_delivery:delivery,p_lease:lease,p_state:"retry",p_receipt:null},
    {p_delivery:delivery,p_lease:lease,p_state:"provider_accepted",p_receipt:"fixture-receipt"},
  ]);
});
test("sender outside attested nontracking domain does not call provider",async()=>{
  const f=setup(await envelope("Other <sender@outside.invalid>"));
  assert.equal((await f.worker(req())).status,503);
  assert.ok(!f.calls.some(c=>c[0]==="provider"));
});
