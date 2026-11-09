import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyLocationSession, locationSessionActive } from "./location-session.ts";
function db(data: unknown,error: unknown=null) {
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data,error})};
 return {from:()=>query};
}
const req=new Request("https://fixture.test",{headers:{"x-auth-token":"synthetic-session-token"}});
test("location verifier returns only verified non-secret identity and a strictly live expiry",async()=>{
 const value={id:"s",userId:"u",expiresAt:new Date(Date.now()+60000).toISOString()};
 assert.deepEqual(await verifyLocationSession(db(value),req),{ok:true,userId:"u",sessionId:"s",expiresAt:value.expiresAt});
 for(const data of [null,{...value,id:null},{...value,userId:""},{...value,expiresAt:"bad"}]) assert.equal((await verifyLocationSession(db(data),req)).ok,false);
 assert.equal((await verifyLocationSession(db({...value,expiresAt:new Date(Date.now()).toISOString()}),req)).ok,false);
 assert.equal((await verifyLocationSession(db(value,{message:"unavailable"}),req)).ok,false);
 assert.equal((await verifyLocationSession(db(value),new Request("https://fixture.test"))).ok,false);
 assert.equal(await locationSessionActive(db({expiresAt:"bad"}),"u","s"),null);
});
