const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const read=p=>readFileSync(resolve(__dirname,'..',p),'utf8');
test('comms audit queries aggregate data without sending or disclosing recipient PII',()=>{
  const sql=read('scripts/audit-dvnt-comms-readonly.sql');
  assert.match(sql,/SELECT campaign, channel, state/);
  assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|TRUNCATE|CALL|PERFORM|CREATE|DROP|ALTER|COPY)\s+(INTO|TABLE|FROM|FUNCTION|public)/i);
  assert.doesNotMatch(sql,/recipient_email\s*(,|FROM|AS)|auth_id\s*(,|FROM|AS)/i);
});
test('brand worker retains an explicit send-enable and identity pair gate',()=>{
  const worker=read('apps/mobile/supabase/functions/brand-outbox-worker/index.ts');
  const sender=read('apps/mobile/supabase/functions/_shared/brand-sender.ts');
  assert.match(worker,/brandSendGate\(\)/);
  assert.match(worker,/verifyBrandSender\(/);
  assert.match(sender,/DVNT_BRAND_OUTBOX_ENABLED/);
  assert.match(sender,/DVNT_BRAND_USER_ID/);
  assert.match(sender,/DVNT_BRAND_AUTH_ID/);
});
test('marketing growth and ticket transactional delivery stay on separate rails',()=>{
  const worker=read('apps/mobile/supabase/functions/_shared/brand-outbox.ts');
  assert.match(worker,/Growth only/);
  assert.match(worker,/Tickets, receipts and order mail never enter this outbox/);
});
