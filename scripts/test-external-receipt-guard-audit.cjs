const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const promoter = '00000000-0000-4000-8000-000000000002';
const binding = '00000000-0000-4000-8000-000000000003';
const ledger = '00000000-0000-4000-8000-000000000021';
async function fixture({ beforeReport = "", beforeInstall = "" } = {}) {
  const db = new PGlite();
  for (const file of ['schema.sql', 'ledger.sql']) await db.exec(fs.readFileSync(path.join(root, 'scripts/fixtures/external-receipt-guard', file), 'utf8'));
  if(beforeInstall) await db.exec(beforeInstall);
  await db.exec('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;');
  await db.exec(fs.readFileSync(path.join(root, 'docs/payments/drafts/external-receipt-guard.sql'), 'utf8'));
  const seed=fs.readFileSync(path.join(root, 'scripts/fixtures/external-receipt-guard/seed.sql'), 'utf8');
  const invocation=seed.match(/SELECT public\.settlement_report_external_payment\([^;]+;/g);
  assert.equal(invocation?.length,1,'fixture must expose exactly one report invocation');
  await db.exec(seed.replace(invocation[0],''));
  if(beforeReport) await db.exec(beforeReport);
  await db.exec(invocation[0]);
  return db;
}
async function rpc(db, name, args) {
  const entries = Object.entries(args);
  return (await db.query(`SELECT public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) AS value`, entries.map(([, value]) => value))).rows[0].value;
}
function recordArgs() { return {p_actor:'fixture-operator',p_request_key:'00000000-0000-4000-8000-000000000031',p_event_id:1,p_promoter_id:promoter,p_recipient_binding_id:binding,p_ledger_entry_ids:[ledger],p_amount_cents:1000,p_currency:'usd',p_provider:'fixture_provider',p_transaction_reference:'fixture-transaction',p_receipt_sha256:'a'.repeat(64),p_receipt_reference:'fixture-vault/receipt/version-1',p_evidence_status:'completed',p_paid_at:'2026-01-01T00:00:00Z',p_receipt_beneficiary_reference:'fixture-beneficiary',p_attestation:{independently_checked_completed_final:true,receipt_retained:true,recipient_and_details_match:true}}; }

test('independent audit: permissive default privileges never expose new private tables or trigger helpers', async () => {
  const db = await fixture();
  try {
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='dvnt_settlement'")).rows;
    const functions = (await db.query("SELECT p.oid::text AS oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dvnt_settlement'")).rows;
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const {tablename} of tables) {
        for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
          assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS v',[role,`dvnt_settlement.${tablename}`,privilege])).rows[0].v,false,`${role} ${privilege} ${tablename}`);
        }
      }
      for (const {oid} of functions) assert.equal((await db.query('SELECT has_function_privilege($1,$2::oid,$3) AS v',[role,oid,'EXECUTE'])).rows[0].v,false,`${role} EXECUTE ${oid}`);
    }
  } finally { await db.close(); }
});

test('independent audit: report-only quarantine survives owner hold clearing without claiming paid', async () => {
  const db = await fixture();
  try {
    assert.equal((await db.query('SELECT count(*)::int AS n FROM dvnt_settlement.external_promoter_payments')).rows[0].n,0);
    const row=(await db.query('SELECT paid_out_at,payout_status,stripe_transfer_id FROM promoter_ledger_entries')).rows[0];
    assert.deepEqual(row,{paid_out_at:null,payout_status:'pending',stripe_transfer_id:null});
    await db.exec('GRANT SELECT,UPDATE ON public.events TO authenticated; SET ROLE authenticated; UPDATE events SET payout_status=\'pending\',payout_release_at=now(); RESET ROLE;');
    assert.equal((await rpc(db,'settlement_legacy_event_eligible',{p_event_id:1})).eligible,false);
    await assert.rejects(rpc(db,'settlement_claim_legacy_event',{p_event_id:1}),/quarantined|excluded/);
    await assert.rejects(db.exec("INSERT INTO payouts(event_id,status) VALUES(1,'paid')"),/excludes legacy/);
    await assert.rejects(db.exec('DELETE FROM events WHERE id=1'));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM dvnt_settlement.external_event_quarantines')).rows[0].n,1);
  } finally { await db.close(); }
});

test('independent audit: original payment record cannot be restamped, rebound or reparented', async () => {
  const db = await fixture();
  try {
    const original=await rpc(db,'settlement_record_external_promoter_payment',recordArgs());
    const mutations=["UPDATE dvnt_settlement.external_promoter_payments SET amount_cents=1","UPDATE dvnt_settlement.external_promoter_payments SET provider='other_provider'","UPDATE dvnt_settlement.external_promoter_rows SET recipient_user_id='other'","UPDATE dvnt_settlement.external_event_exclusions SET event_id=2","UPDATE promoter_ledger_entries SET payout_status='pending'","UPDATE promoter_ledger_entries SET external_settlement_id=NULL","UPDATE promoter_ledger_entries SET order_id=gen_random_uuid()","DELETE FROM promoter_attributions","DELETE FROM event_promoters","DELETE FROM orders","DELETE FROM events"];
    for (const sql of mutations) await assert.rejects(db.exec(sql));
    assert.equal((await rpc(db,'settlement_record_external_promoter_payment',recordArgs())).id,original.id);
    assert.equal((await db.query('SELECT amount_cents FROM promoter_ledger_entries')).rows[0].amount_cents,1000);
  } finally { await db.close(); }
});

test('independent audit: fresh reviews append, while old evidence stays immutable', async () => {
  const db=await fixture();
  try {
    const countBefore=(await db.query('SELECT count(*)::int AS n FROM dvnt_settlement.external_event_reviews')).rows[0].n;
    await db.exec("INSERT INTO dvnt_settlement.external_event_reviews(event_id,reviewed_by,reviewed_at,expires_at,proof_sha256,attestation) SELECT event_id,reviewed_by,clock_timestamp(),clock_timestamp()+interval '10 minutes',repeat('c',64),attestation FROM dvnt_settlement.external_event_reviews LIMIT 1");
    assert.equal((await db.query('SELECT count(*)::int AS n FROM dvnt_settlement.external_event_reviews')).rows[0].n,countBefore+1);
    await assert.rejects(db.exec("UPDATE dvnt_settlement.external_event_reviews SET expires_at=now()+interval '1 day'"),/immutable/);
    await assert.rejects(db.exec('DELETE FROM dvnt_settlement.external_event_reviews'),/immutable/);
  } finally { await db.close(); }
});

test('independent audit: report-only identity and unpaid obligation cannot escape to another event', async () => {
  const db=await fixture();
  try {
    await db.exec("INSERT INTO events(id,host_id,payout_status) VALUES(2,'fixture-host','pending')");
    for (const sql of ["UPDATE event_promoters SET event_id=2", "UPDATE event_promoters SET user_id='replacement-user'", "UPDATE orders SET event_id=2", "UPDATE promoter_ledger_entries SET event_id=2", "UPDATE promoter_ledger_entries SET amount_cents=999", "DELETE FROM promoter_ledger_entries", "DELETE FROM promoter_attributions", "DELETE FROM orders"]) await assert.rejects(db.exec(sql),undefined,sql);
    assert.equal((await db.query('SELECT event_id,amount_cents,paid_out_at FROM promoter_ledger_entries')).rows[0].event_id,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM dvnt_settlement.external_promoter_payments')).rows[0].n,0);
    await db.exec("UPDATE orders SET status='refunded'; INSERT INTO promoter_ledger_entries(promoter_id,event_id,order_id,entry_type,amount_cents) SELECT promoter_id,event_id,order_id,'reversal',-1000 FROM promoter_ledger_entries LIMIT 1");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM promoter_ledger_entries WHERE entry_type='reversal'")).rows[0].n,1);
  } finally { await db.close(); }
});

test('independent audit: a global operator has no authority outside its explicit event/promoter scope', async () => {
  const db=await fixture();
  try {
    const other='00000000-0000-4000-8000-000000000099';
    await db.exec(`INSERT INTO events(id,host_id,payout_status) VALUES(2,'fixture-host','on_hold'); INSERT INTO event_promoters(id,event_id,user_id) VALUES('${other}',2,'other-recipient');`);
    await assert.rejects(rpc(db,'settlement_report_external_payment',{p_actor:'fixture-operator',p_event_id:2,p_promoter_id:other,p_request_key:'00000000-0000-4000-8000-000000000098',p_report_reference:'other-report'}),/scope/);
    await db.exec('UPDATE dvnt_settlement.external_operator_scopes SET may_record=false');
    await assert.rejects(rpc(db,'settlement_record_external_promoter_payment',recordArgs()),/scope/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM dvnt_settlement.external_promoter_payments')).rows[0].n,0);
  } finally { await db.close(); }
});


test('independent audit: partial whole-row receipt does not hide remaining reported obligations', async () => {
  const order2='00000000-0000-4000-8000-000000000012',ledger2='00000000-0000-4000-8000-000000000022';
  const db=await fixture({beforeReport:`INSERT INTO orders(id,event_id,status,type,currency,total_cents,subtotal_cents,organizer_fee_cents,promoter_id,promoter_code,promoter_commission_amount_cents,stripe_payment_intent_id) VALUES('${order2}',1,'paid','event_ticket','usd',11000,10000,500,'${promoter}','FIXTURE',1000,'pi_fixture_second'); INSERT INTO promoter_attributions(order_id,promoter_id,locked_promoter_commission_amount_cents) VALUES('${order2}','${promoter}',1000); INSERT INTO promoter_ledger_entries(id,promoter_id,event_id,order_id,entry_type,amount_cents) VALUES('${ledger2}','${promoter}',1,'${order2}','earning',1000);`});
  try {
    await rpc(db,'settlement_record_external_promoter_payment',recordArgs());
    const status=await rpc(db,'settlement_external_actor_status',{p_actor:'fixture-promoter',p_event_id:1});
    assert.equal(status.reported_pending_review,true);
    assert.equal(status.payments[0].amount_cents,1000);
    assert.equal((await db.query('SELECT paid_out_at FROM promoter_ledger_entries WHERE id=$1',[ledger2])).rows[0].paid_out_at,null);
    const unrelated=await rpc(db,'settlement_external_actor_status',{p_actor:'different-recipient',p_event_id:1});
    assert.deepEqual(unrelated,{reported_pending_review:false,payments:[]});
  } finally { await db.close(); }
});


test('independent audit: service cannot bypass server-bound sessions through raw bookkeeping RPCs', async () => {
  const db=await fixture();
  try {
    await db.exec('SET ROLE service_role');
    await assert.rejects(rpc(db,'settlement_record_external_promoter_payment',recordArgs()),/permission denied/);
    await assert.rejects(rpc(db,'settlement_report_external_payment',{p_actor:'fixture-operator',p_event_id:1,p_promoter_id:promoter,p_request_key:'00000000-0000-4000-8000-000000000041',p_report_reference:'fixture-report'}),/permission denied/);
    await assert.rejects(rpc(db,'settlement_record_external_promoter_payment_session',{p_session_id:'nonexistent-session',...recordArgs()}),/session required/);
    await db.exec('RESET ROLE');
    await db.exec(`INSERT INTO public.session(id,"userId","expiresAt","updatedAt") VALUES('fixture-session','different-actor',clock_timestamp()+interval '1 hour',clock_timestamp())`);
    await assert.rejects(rpc(db,'settlement_record_external_promoter_payment_session',{p_session_id:'fixture-session',...recordArgs()}),/session required/);
    await db.exec(`UPDATE public.session SET "userId"='fixture-operator',"expiresAt"=clock_timestamp()-interval '1 second'`);
    await assert.rejects(rpc(db,'settlement_record_external_promoter_payment_session',{p_session_id:'fixture-session',...recordArgs()}),/session required/);
    await db.exec(`UPDATE public.session SET "expiresAt"=clock_timestamp()+interval '1 hour'`);
    await db.exec('SET ROLE service_role');
    assert.equal((await rpc(db,'settlement_record_external_promoter_payment_session',{p_session_id:'fixture-session',...recordArgs()})).recorded,true);
  } finally { await db.close(); }
});

test('independent audit: reported-only dispute history survives status reset without fabricated receipt', async () => {
  const db=await fixture();
  try {
    await db.exec("UPDATE orders SET status='disputed'; UPDATE orders SET status='paid'");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM dvnt_settlement.external_reported_recovery_reviews WHERE reason='dispute'")).rows[0].n,1);
    await assert.rejects(db.exec('DELETE FROM dvnt_settlement.external_reported_recovery_reviews'),/immutable/);
    await assert.rejects(rpc(db,'settlement_record_external_promoter_payment',recordArgs()),/eligibility|review/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM dvnt_settlement.external_promoter_payments')).rows[0].n,0);
    assert.equal((await db.query('SELECT paid_out_at FROM promoter_ledger_entries')).rows[0].paid_out_at,null);
  } finally { await db.close(); }
});


test('independent audit: pre-install payout uncertainty cannot be erased after reporting', async () => {
  const db=await fixture({beforeInstall:"INSERT INTO payouts(event_id,status) VALUES(1,'paid')"});
  try {
    await db.exec("INSERT INTO events(id,host_id,payout_status) VALUES(2,'fixture-host','pending')");
    await assert.rejects(db.exec('UPDATE payouts SET event_id=2 WHERE event_id=1'),/exclud|quarantin|immutable|protected/);
    await assert.rejects(db.exec('DELETE FROM payouts WHERE event_id=1'),/exclud|quarantin|immutable|protected/);
    await assert.rejects(rpc(db,'settlement_record_external_promoter_payment',recordArgs()),/execution requires reconciliation/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM dvnt_settlement.external_promoter_payments')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM payouts WHERE event_id=1')).rows[0].n,1);
  } finally { await db.close(); }
});

test('independent audit: NULL legacy source promoter needs exact attribution; contradictory identity fails closed', async () => {
  for (const contradictory of [false,true]) {
    const db=await fixture({beforeReport: contradictory
      ? "INSERT INTO event_promoters(id,event_id,user_id) VALUES('00000000-0000-4000-8000-000000000099',1,'other-recipient'); UPDATE orders SET promoter_id='00000000-0000-4000-8000-000000000099'"
      : 'UPDATE orders SET promoter_id=NULL'});
    try {
      if (contradictory) {
        await assert.rejects(rpc(db,'settlement_record_external_promoter_payment',recordArgs()),/eligibility/);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM dvnt_settlement.external_promoter_payments')).rows[0].n,0);
        assert.equal((await db.query('SELECT paid_out_at FROM promoter_ledger_entries')).rows[0].paid_out_at,null);
      } else {
        assert.equal((await rpc(db,'settlement_record_external_promoter_payment',recordArgs())).recorded,true);
      }
    } finally { await db.close(); }
  }
});
