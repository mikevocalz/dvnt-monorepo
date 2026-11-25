import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchHostPayoutSetupEmail, planHostPayoutSetupEmail, type HostEvidence, type HostPayoutSetupEmailPorts } from "./host-payout-setup-email.ts";
const sample: HostEvidence = {
  hostId: 21, organizerEventId: 12, organizerAccountId: null, accountEvidence: "missing",
  stripe: null, verifiedDvntUserId: 21, verifiedEmail: "fixture@example.invalid", emailSuppressed: false,
};
const current = {
  ...sample, organizerAccountId: "acct_syntheticFixture", accountEvidence: "verified_current",
  stripe: { payoutsEnabled: false, chargesEnabled: false, detailsSubmitted: true, currentlyDue: ["bank"], pastDue: [], pendingVerification: [], disabledReason: null },
} satisfies HostEvidence;
function harness() {
  const h = { evidence: sample as HostEvidence|null, reads: 0, reservations: new Set<string>(), sendCalls: 0, records: [] as string[], pause: null as Promise<void>|null, responseLost: false, recordLost: false, changeOnRead: undefined as HostEvidence|undefined };
  const ports: HostPayoutSetupEmailPorts = {
    readFresh: async () => { h.reads++; return h.reads === 2 && h.changeOnRead ? h.changeOnRead : h.evidence; },
    reserveOnce: async key => {
      if(h.reservations.has(key)) return null;
      h.reservations.add(key);
      return { key, token: "fixture-claim" };
    },
    record: async (_, outcome) => {
      if(h.recordLost) throw Error("lost write");
      h.records.push(outcome);
    },
    send: async message => {
      h.sendCalls++;
      assert.equal(message.to, sample.verifiedEmail);
      assert.equal(message.idempotencyKey, "host-payout-setup:v1:21");
      assert.ok(message.text.endsWith("https://dvntapp.live/feed/events/organizer-setup"));
      await h.pause;
      if(h.responseLost) throw Error("lost provider acknowledgement");
      return { id: "synthetic-accepted" };
    },
  };
  return {h, ports};
}
test("disabled by default and touches no dependencies",async()=>{
  const {h,ports}=harness();
  assert.equal(await dispatchHostPayoutSetupEmail({},21,ports),"disabled");
  assert.equal(h.reads,0);
  assert.equal(h.sendCalls,0);
});
test("requires exact host, verified canonical email, organizer event, and no suppression",()=>{
  assert.equal(planHostPayoutSetupEmail(21,sample)?.state,"setup");
  for(const patch of [{verifiedDvntUserId:22},{organizerEventId:0},{emailSuppressed:true},{verifiedEmail:"a@mail.invalid\ncc:b@mail.invalid"}])
    assert.equal(planHostPayoutSetupEmail(21,{...sample,...patch}),null);
  assert.equal(planHostPayoutSetupEmail(22,sample),null);
});
test("actionable current Stripe evidence only; never email already ready, pending review or unknown",()=>{
  assert.equal(planHostPayoutSetupEmail(21,current)?.state,"action_required");
  const ready = {...current,stripe:{...current.stripe,payoutsEnabled:true,chargesEnabled:true}};
  const pending = {...current,stripe:{...current.stripe,currentlyDue:[],pendingVerification:["bank"]}};
  for(const evidence of [ready,pending,{...current,stripe:null},{...current,accountEvidence:"unknown"} as HostEvidence])
    assert.equal(planHostPayoutSetupEmail(21,evidence),null);
});
test("two competing dispatches issue one synthetic transport attempt",async()=>{
  const {h,ports}=harness();
  const result=await Promise.all([dispatchHostPayoutSetupEmail({enabled:true},21,ports),dispatchHostPayoutSetupEmail({enabled:true},21,ports)]);
  assert.deepEqual(result.sort(),["accepted","already_claimed"]);
  assert.equal(h.sendCalls,1);
  assert.deepEqual(h.records,["accepted"]);
});
test("recipient change after reservation suppresses old send",async()=>{
  const {h,ports}=harness();h.changeOnRead={...sample,verifiedEmail:"new@example.invalid"};
  assert.equal(await dispatchHostPayoutSetupEmail({enabled:true},21,ports),"stale");
  assert.equal(h.sendCalls,0);
});
for(const failure of ["responseLost","recordLost"] as const)
  test(failure+" leaves the once-ever reservation and never resends",async()=>{
    const {h,ports}=harness();h[failure]=true;
    assert.equal(await dispatchHostPayoutSetupEmail({enabled:true},21,ports),"uncertain");
    assert.equal(await dispatchHostPayoutSetupEmail({enabled:true},21,ports),"already_claimed");
    assert.equal(h.sendCalls,1);
  });
