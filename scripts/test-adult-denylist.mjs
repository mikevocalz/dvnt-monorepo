import test from "node:test";
import assert from "node:assert/strict";
import { decideVerifiedAdmission } from "../apps/mobile/supabase/functions/_shared/verified-admission.ts";

const verified={
  userId:"adult",
  record:{user_id:"adult",status:"passed",date_of_birth:"1990-02-01"},
  now:new Date("2026-10-15T00:00:00Z"),
};
test("a verified adult on operator denylist stays blocked",()=>{
  const verdict=decideVerifiedAdmission({...verified,policy:{enforce:true},denied:true});
  assert.equal(verdict.state,"blocked");
  assert.equal(verdict.reason,"operator_denied");
});
test("denylist overrides allowlist, grace and disabled rollout",()=>{
  for(const policy of [
    {enforce:false},
    {enforce:true,grace_deadline:"2099-01-01T00:00:00Z"},
    {enforce:true},
  ]){
    const v=decideVerifiedAdmission({...verified,exempt:true,denied:true,policy});
    assert.equal(v.state,"blocked");
    assert.equal(v.reason,"operator_denied");
  }
});
test("under-18 evidence always takes priority over other gates",()=>{
  const v=decideVerifiedAdmission({...verified,
    record:{user_id:"adult",status:"passed",date_of_birth:"2015-01-01"},
    denied:true,exempt:true,policy:{enforce:false}});
  assert.equal(v.reason,"underage");
});
test("guest-restricted checkout profile stays blocked from participation",()=>{
  const v=decideVerifiedAdmission({...verified,record:null,
    restricted:true,policy:{enforce:false}});
  assert.equal(v.reason,"restricted_profile");
});
test("undeniably allowed verified adult still enters when operator did not deny",()=>{
  const v=decideVerifiedAdmission({...verified,denied:false,policy:{enforce:true}});
  assert.equal(v.state,"allowed");
});
