const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

async function fixture() {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname,"host-payout-setup-email-ledger.sql"),"utf8"));
  return db;
}
const reserve = async (db, id) => (await db.query("select * from dvnt_host_setup_email.reserve_once($1)",[id])).rows[0];
const record = async (db,id,token,state,provider=null) =>
  (await db.query("select dvnt_host_setup_email.record_once($1,$2,$3,$4) as recorded",[id,token,state,provider])).rows[0].recorded;
test("durable unique reservation survives certainty, uncertainty and retries", async t => {
  const db=await fixture(); t.after(()=>db.close());
  const { delivery_key, claim_token }=await reserve(db,21);
  assert.equal(delivery_key,"host-payout-setup:v1:21");
  assert.equal(await reserve(db,21),undefined);
  assert.equal(await record(db,21,claim_token,"uncertain"),true);
  assert.equal(await record(db,21,claim_token,"accepted","different-provider"),false);
  assert.equal(await reserve(db,21),undefined);
});
test("record checks exact host, claim, provider acknowledgement and terminal state",async t=>{
  const db=await fixture(); t.after(()=>db.close());
  const host=await reserve(db,21);
  const other=await reserve(db,23);
  assert.equal(await record(db,23,host.claim_token,"accepted","provider-a"),false);
  assert.equal(await record(db,21,host.claim_token,"accepted"),false);
  assert.equal(await record(db,21,host.claim_token,"accepted","provider-a"),true);
  assert.equal(await record(db,21,host.claim_token,"stale"),false);
  await assert.rejects(()=>record(db,23,other.claim_token,"accepted","provider-a"),/duplicate/);
  assert.equal(await reserve(db,23),undefined);
});
test("an unrelated SQL role cannot use the ledger even if it knows the function name",async t=>{
  const db=await fixture(); t.after(()=>db.close());
  await db.exec("create role signed_in_fixture; set role signed_in_fixture;");
  await assert.rejects(()=>reserve(db,21),/permission denied/);
});
test("the draft dispatcher stays at one fake send when accepted mail loses its final database write",async t=>{
  const db=await fixture(); t.after(()=>db.close());
  const { dispatchHostPayoutSetupEmail } = await import("./host-payout-setup-email.ts");
  let transport=0;
  const ports = {
    async readFresh(id) {
      return { hostId:id, organizerEventId:321, organizerAccountId:null, accountEvidence:"missing",
        stripe:null, verifiedDvntUserId:id, verifiedEmail:"fixture@example.invalid", emailSuppressed:false };
    },
    async reserveOnce(key) {
      const row=await reserve(db,Number(key.split(":").at(-1)));
      return row?{key:row.delivery_key,token:row.claim_token}:null;
    },
    async record(claim,state,provider) {
      if(state==="accepted") throw Error("simulated crash before recording provider acceptance");
      return record(db,21,claim.token,state,provider);
    },
    async send() { transport++; return {id:"synthetic-provider"}; },
  };
  assert.equal(await dispatchHostPayoutSetupEmail({enabled:true},21,ports),"uncertain");
  assert.equal(await dispatchHostPayoutSetupEmail({enabled:true},21,ports),"already_claimed");
  assert.equal(transport,1);
  assert.equal((await db.query("select state from dvnt_host_setup_email.deliveries")).rows[0].state,"reserved");
});
