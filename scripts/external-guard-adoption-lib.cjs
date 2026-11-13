/* Offline assembly helpers. No network, credentials or production connection. */
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
function publicFunctionNames(sql){return [...new Set([...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)].map(x=>x[1]))].sort();}
function catalogExpression(names){
 const nameList=names.map(quote).join(',')||"''";
 return `jsonb_build_object(
 'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid)) ORDER BY k.conname COLLATE "C"),'[]'::jsonb) FROM pg_constraint k WHERE k.conrelid=c.oid),'indexes',(SELECT coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY ci.relname COLLATE "C"),'[]'::jsonb) FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=c.oid),'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'roles',p.polroles::text,'command',p.polcmd,'qual',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname COLLATE "C"),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid),'client_privileges',(SELECT jsonb_agg(jsonb_build_object('role',r,'select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE'),'truncate',has_table_privilege(r,c.oid,'TRUNCATE'),'references',has_table_privilege(r,c.oid,'REFERENCES'),'trigger',has_table_privilege(r,c.oid,'TRIGGER')) ORDER BY r COLLATE "C") FROM unnest(ARRAY['anon','authenticated','service_role']) r)) ORDER BY c.relname COLLATE "C"),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dvnt_settlement' AND c.relkind IN ('r','p','v','m','S','f')),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'execute',(SELECT jsonb_agg(jsonb_build_object('role',r,'allowed',has_function_privilege(r,p.oid,'EXECUTE')) ORDER BY r COLLATE "C") FROM unnest(ARRAY['anon','authenticated','service_role']) r)) ORDER BY p.oid::regprocedure::text COLLATE "C"),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dvnt_settlement' OR (n.nspname='public' AND p.proname IN (${nameList}))),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY c.oid::regclass::text COLLATE "C",t.tgname COLLATE "C"),'[]'::jsonb) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE NOT t.tgisinternal AND n.nspname='dvnt_settlement'),
 'ledger_marker',(SELECT jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'constraints',(SELECT coalesce(jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname COLLATE "C"),'[]'::jsonb) FROM pg_constraint k WHERE k.conrelid=a.attrelid AND a.attnum=ANY(k.conkey))) FROM pg_attribute a WHERE a.attrelid='public.promoter_ledger_entries'::regclass AND a.attname='external_settlement_id' AND NOT a.attisdropped),
 'schema_privileges',(SELECT jsonb_agg(jsonb_build_object('role',r,'usage',has_schema_privilege(r,'dvnt_settlement','USAGE'),'create',has_schema_privilege(r,'dvnt_settlement','CREATE')) ORDER BY r COLLATE "C") FROM unnest(ARRAY['anon','authenticated','service_role']) r)
 )`;
}
async function expectedCatalog(guardSql){
 const db=new PGlite();
 try{
  for(const file of ['scripts/fixtures/settlement/schema.sql','scripts/fixtures/settlement/external-schema.sql'])await db.exec(fs.readFileSync(path.join(root,file),'utf8'));
  await db.exec('CREATE TABLE public.session(id text PRIMARY KEY,\"userId\" text NOT NULL,\"expiresAt\" timestamptz NOT NULL,\"updatedAt\" timestamptz)');
  await db.exec(guardSql);
  return (await db.query('SELECT '+catalogExpression(publicFunctionNames(guardSql))+' value')).rows[0].value;
 }finally{await db.close();}
}
function compatibilityPreflight(guardSql,expected){
 const lockedTables=['public.events','public.orders','public.promoter_ledger_entries','public.promoter_attributions','public.payouts','public.event_promoters',...expected.relations.filter(x=>x.kind==='r').map(x=>'dvnt_settlement.'+x.name)];
 return `-- Exact reviewed standalone guard contract. Unknown objects/code/ACLs fail closed.\nDO $adoption$ DECLARE actual jsonb; BEGIN\n IF to_regclass('dvnt_settlement.external_promoter_payments') IS NULL THEN\n  RAISE EXCEPTION 'standalone external receipt guard is required for this adoption artifact';\n END IF;\n LOCK TABLE ${lockedTables.join(',')} IN ACCESS EXCLUSIVE MODE;\n SELECT ${catalogExpression(publicFunctionNames(guardSql))} INTO actual;\n IF actual IS DISTINCT FROM ${quote(JSON.stringify(expected))}::jsonb THEN\n  RAISE EXCEPTION 'external receipt guard catalog mismatch; reviewed adoption required';\n END IF;\nEND $adoption$;\n`;
}
module.exports={root,quote,publicFunctionNames,catalogExpression,expectedCatalog,compatibilityPreflight};
function functionDefinition(sql,name){
 const escaped=name.replaceAll('.','\\.');
 const match=sql.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${escaped}\\([\\s\\S]*?AS \\$\\$[\\s\\S]*?\\$\\$;`));
 if(!match)throw Error('Required function missing: '+name);
 return match[0].replace(/^CREATE (?:OR REPLACE )?FUNCTION/,'CREATE OR REPLACE FUNCTION');
}
function replaceOnce(source,needle,replacement){if(source.split(needle).length!==2)throw Error('Expected one adoption patch site: '+needle.slice(0,100));return source.replace(needle,()=>replacement);}
const identityProof=`
DO $proof$ BEGIN
 IF EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_payments p
  LEFT JOIN dvnt_settlement.external_recipients r ON r.id=p.recipient_binding_id
  LEFT JOIN dvnt_settlement.external_event_exclusions e ON e.event_id=p.event_id
  LEFT JOIN dvnt_settlement.external_event_quarantines q ON q.event_id=p.event_id AND q.promoter_id=p.promoter_id
  WHERE r.id IS NULL OR e.event_id IS NULL OR q.event_id IS NULL
   OR ROW(r.promoter_id,r.recipient_user_id,r.provider) IS DISTINCT FROM ROW(p.promoter_id,p.recipient_user_id,p.provider)
   OR ROW(q.promoter_id,q.recipient_user_id) IS DISTINCT FROM ROW(p.promoter_id,p.recipient_user_id)
   OR (SELECT array_agg(x.ledger_entry_id ORDER BY x.ledger_entry_id) FROM dvnt_settlement.external_promoter_rows x WHERE x.settlement_id=p.id) IS DISTINCT FROM p.ledger_entry_ids
   OR (SELECT sum(x.amount_cents) FROM dvnt_settlement.external_promoter_rows x WHERE x.settlement_id=p.id) IS DISTINCT FROM p.amount_cents)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows x
  JOIN dvnt_settlement.external_promoter_payments p ON p.id=x.settlement_id
  LEFT JOIN public.promoter_ledger_entries l ON l.id=x.ledger_entry_id
  LEFT JOIN public.orders o ON o.id=x.order_id
  LEFT JOIN public.promoter_attributions a ON a.order_id=x.order_id
  WHERE l.id IS NULL OR o.id IS NULL OR a.order_id IS NULL
   OR ROW(l.order_id,l.promoter_id,l.event_id,l.amount_cents,l.currency,l.entry_type,l.external_settlement_id,l.paid_out_at,l.payout_status)
   IS DISTINCT FROM ROW(x.order_id,x.promoter_id,p.event_id,x.amount_cents::integer,x.currency,'earning'::text,p.id,p.paid_at,'paid'::text)
   OR l.stripe_transfer_id IS NOT NULL OR x.currency IS DISTINCT FROM p.currency
   OR x.recipient_user_id IS DISTINCT FROM p.recipient_user_id
   OR o.event_id IS DISTINCT FROM p.event_id OR a.promoter_id IS DISTINCT FROM x.promoter_id)

 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_reported_rows r
  LEFT JOIN dvnt_settlement.external_event_quarantines q ON q.event_id=r.event_id AND q.promoter_id=r.promoter_id
  LEFT JOIN public.promoter_ledger_entries l ON l.id=r.ledger_entry_id
  LEFT JOIN public.orders o ON o.id=r.order_id
  LEFT JOIN public.event_promoters p ON p.id=r.promoter_id
  WHERE q.event_id IS NULL OR l.id IS NULL OR o.id IS NULL OR p.id IS NULL
   OR ROW(l.order_id,l.event_id,l.promoter_id,l.amount_cents,l.currency,l.entry_type)
    IS DISTINCT FROM ROW(r.order_id,r.event_id,r.promoter_id,r.amount_cents::integer,r.currency,'earning'::text)
   OR r.recipient_user_id IS DISTINCT FROM q.recipient_user_id
   OR p.user_id IS DISTINCT FROM q.recipient_user_id OR p.event_id IS DISTINCT FROM r.event_id
   OR o.event_id IS DISTINCT FROM r.event_id)
 THEN RAISE EXCEPTION 'external receipt adoption evidence linkage mismatch'; END IF;
END $proof$;
`;
function adoptionOverrides(guardSql,fullExternalSql){
 let record=functionDefinition(guardSql,'public.settlement_record_external_promoter_payment');
 if(record.split("OR to_regclass('dvnt_settlement.controls') IS NOT NULL").length!==3)throw Error('Runtime refusal contract changed');
 record=record.replaceAll("OR to_regclass('dvnt_settlement.controls') IS NOT NULL",'');
 const eligibility=fullExternalSql.match(/ AND NOT EXISTS\(SELECT 1 FROM dvnt_settlement\.holds h[\s\S]*?(?= AND NOT EXISTS\(SELECT 1 FROM dvnt_settlement\.external_promoter_rows)/)?.[0];
 if(!eligibility)throw Error('Runtime eligibility contract missing');
 record=replaceOnce(record,' AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows',eligibility+' AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows');
 record=replaceOnce(record,' PERFORM 1 FROM dvnt_settlement.external_recording_controls WHERE singleton FOR UPDATE;', ' PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;\n PERFORM 1 FROM dvnt_settlement.external_recording_controls WHERE singleton FOR UPDATE;');
 record=replaceOnce(record," RETURN jsonb_build_object('id',sid,'recorded',true,'status','paid_externally','replayed',false);"," UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;\n RETURN jsonb_build_object('id',sid,'recorded',true,'status','paid_externally','replayed',false);");
 let claim=functionDefinition(guardSql,'public.settlement_claim_legacy_event');
 claim=replaceOnce(claim,' OR EXISTS(SELECT 1 FROM dvnt_settlement.legacy_execution_claims WHERE event_id=e.id)'," OR EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id WHERE o.event_id=e.id)\n OR EXISTS(SELECT 1 FROM dvnt_settlement.legacy_execution_claims WHERE event_id=e.id)");
 let report=functionDefinition(guardSql,'public.settlement_report_external_payment');
 report=replaceOnce(report,"OR to_regclass('dvnt_settlement.controls') IS NOT NULL",'');
 // Once runtime is installed, a report must conservatively demand in-flight
 // review even when its historical legacy table has no claim. No false all-clear.
 report=replaceOnce(report,"'in_flight_review_required',EXISTS", "'in_flight_review_required',true OR EXISTS");
 return '\n-- Preserve stronger narrow guards; installing runtime is not payout approval.\n'
  +[...guardSql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ((?:public|dvnt_settlement)\.[a-z0-9_]+)\(/g)].map(x=>x[1]).filter(n=>!['public.settlement_record_external_promoter_payment','public.settlement_claim_legacy_event','public.settlement_report_external_payment','public.settlement_legacy_event_eligible'].includes(n)).map(n=>functionDefinition(guardSql,n)).join('\n')+'\n'+record+'\n'+claim+'\n'+report+'\n'+`
CREATE OR REPLACE FUNCTION public.settlement_legacy_event_eligible(p_event_id int) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('eligible',
  NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id WHERE o.event_id=p_event_id)
  AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=p_event_id)
  AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_event_reviews WHERE event_id=p_event_id)
  AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_event_quarantines WHERE event_id=p_event_id));
$$;
-- Close BOTH independent operator gates. Existing evidence/operators/bindings
-- remain intact; a later approved activation is separate from this migration.
UPDATE dvnt_settlement.external_recording_controls SET enabled=false,reporting_enabled=false;
CREATE FUNCTION dvnt_settlement.assert_no_external_event_quarantine(p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eid int; locked_eid int;
BEGIN
 SELECT event_id INTO STRICT eid FROM public.orders WHERE id=p_order_id;
 -- Fast rejection avoids taking an event lock behind an existing recorder,
 -- whose order lock order begins with that already-quarantined event.
 IF EXISTS(SELECT 1 FROM dvnt_settlement.external_event_quarantines WHERE event_id=eid)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=eid)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_reviews WHERE event_id=eid)
 THEN RAISE EXCEPTION 'external payment event quarantine blocks runtime funding'; END IF;
 -- A report takes FOR UPDATE on this same event. Hold our share until COMMIT,
 -- then report either observes the prior intent or later execution is rejected.
 PERFORM 1 FROM public.events WHERE id=eid FOR SHARE;
 SELECT event_id INTO STRICT locked_eid FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF locked_eid IS DISTINCT FROM eid THEN RAISE EXCEPTION 'external quarantine source event changed while locking'; END IF;
 IF EXISTS(SELECT 1 FROM dvnt_settlement.external_event_quarantines WHERE event_id=eid)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=eid)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_reviews WHERE event_id=eid)
 THEN RAISE EXCEPTION 'external payment event quarantine blocks runtime funding'; END IF;
END $$;
CREATE FUNCTION dvnt_settlement.guard_external_event_runtime() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oid uuid;
BEGIN
 IF TG_TABLE_NAME='deliveries' THEN
  -- Bank status updates cannot dispatch money and must remain reconcilable.
  IF TG_OP='UPDATE' AND (NEW.state IS DISTINCT FROM 'reserved' OR OLD.state='reserved') THEN RETURN NEW; END IF;
  IF NEW.state='held' AND NEW.stripe_transfer_id IS NULL THEN RETURN NEW; END IF;
  SELECT order_id INTO STRICT oid FROM dvnt_settlement.allocations WHERE id=NEW.allocation_id;
 ELSE oid:=NEW.order_id; END IF;
 PERFORM dvnt_settlement.assert_no_external_event_quarantine(oid);
 RETURN NEW;
END $$;
CREATE TRIGGER external_event_runtime_checkout BEFORE INSERT ON dvnt_settlement.checkouts FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_external_event_runtime();
CREATE TRIGGER external_event_runtime_enrollment BEFORE INSERT ON dvnt_settlement.orders FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_external_event_runtime();
CREATE TRIGGER external_event_runtime_allocation BEFORE INSERT ON dvnt_settlement.allocations FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_external_event_runtime();
CREATE TRIGGER external_event_runtime_delivery BEFORE INSERT OR UPDATE ON dvnt_settlement.deliveries FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_external_event_runtime();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dvnt_settlement FROM PUBLIC,anon,authenticated,service_role;
`;
}
function validateBuildContract(contract,guardSql){
 const crypto=require('node:crypto');
 if(!contract || crypto.createHash('sha256').update(guardSql).digest('hex')!==contract.guard_sql_sha256)throw Error('Reviewed guard SQL digest mismatch');
 for(const [key,suffix] of [['guard_migration','external_receipt_guard'],['adoption_migration','external_guard_runtime_adoption']]){
  if(typeof contract[key]!=='string'||!new RegExp('^apps/mobile/supabase/migrations/[0-9]{14}_'+suffix+'\\.sql$').test(contract[key]))throw Error('Invalid exact migration path: '+key);
 }
 if(!Array.isArray(contract.retired_unapplied_versions)||JSON.stringify(contract.retired_unapplied_versions)!==JSON.stringify(['20261111010000','20261111040111']))throw Error('Retired migration exclusions cannot change');
 const h=contract.guard_history;
 if(!h || (h.name!=='external_receipt_guard'||h.statement_count!==1||h.sql_bytes!==Buffer.byteLength(guardSql,'utf8')||h.sql_sha256!==contract.guard_sql_sha256))throw Error('Exact applied guard content evidence mismatch');
 const guardVersion=path.basename(contract.guard_migration).split('_')[0];
 const adoptionVersion=path.basename(contract.adoption_migration).split('_')[0];
 if(adoptionVersion<=guardVersion)throw Error('Adoption must be chronologically later than standalone guard');
 return {guardVersion,adoptionVersion};
}
async function buildAdoption(guardSql,buildContract){
 const expected=await expectedCatalog(guardSql);
 let runtime=fs.readFileSync(path.join(root,'docs/payments/drafts/settlement-runtime-pristine.sql'),'utf8');
 const contract=buildContract??JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures/external-guard-adoption/contract.json'),'utf8'));
 const {guardVersion,adoptionVersion}=validateBuildContract(contract,guardSql);
 const h=contract.guard_history;
 const appliedContent=h?`
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name=${quote(h.name)})<>1
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(guardVersion)} AND name=${quote(h.name)} AND array_lower(statements,1)=1 AND array_upper(statements,1)=1 AND cardinality(statements)=1 AND octet_length(statements[1])=${h.sql_bytes} AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')=${quote(h.sql_sha256)})`:'';
 const historyGuard=`DO $history$ BEGIN
 IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'reviewed Supabase migration history required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(guardVersion)})
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN (${[...contract.retired_unapplied_versions,adoptionVersion].map(quote).join(',')}))
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version>${quote(adoptionVersion)})${appliedContent}
 THEN RAISE EXCEPTION 'external guard adoption migration history mismatch'; END IF;
END $history$;\n`;
 const fullExternal=fs.readFileSync(path.join(root,'docs/payments/drafts/settlement-external.sql'),'utf8');
 if((runtime.match(/^BEGIN;$/gm)||[]).length!==1 || (runtime.match(/^COMMIT;$/gm)||[]).length!==1)throw Error('Runtime must be one atomic artifact');
 const known=expected.relations.map(x=>x.name);
 runtime=runtime.replace(/^CREATE TABLE dvnt_settlement\.(\w+)\s*\(/gm,(m,n)=>known.includes(n)?m.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'):m);
 for(const bareName of expected.functions.map(x=>x.name.split('(')[0])){
  const name=bareName.includes('.')?bareName:'public.'+bareName;
  const escaped=name.replaceAll('.','\\.');
  runtime=runtime.replace(new RegExp('CREATE FUNCTION '+escaped+'\\(','g'),'CREATE OR REPLACE FUNCTION '+name+'(');
 }
 runtime=replaceOnce(runtime,'ALTER TABLE public.promoter_ledger_entries ADD COLUMN external_settlement_id uuid','ALTER TABLE public.promoter_ledger_entries ADD COLUMN IF NOT EXISTS external_settlement_id uuid');
 // Exact catalog proof precedes these replacements; never silently tolerate an
 // unrelated same-name trigger. Existing evidence and tables are not dropped.
 const immutableList=fullExternal.match(/FOREACH t IN ARRAY ARRAY\[([^\]]+)\] LOOP\s+EXECUTE format\('CREATE TRIGGER immutable_external/)?.[1];
 if(!immutableList)throw Error('Runtime immutable trigger contract missing');
 const recreatedImmutable=[...immutableList.matchAll(/'([^']+)'/g)].map(x=>'dvnt_settlement.'+x[1]);
 const dropTriggers=expected.triggers.filter(t=>(t.name!=='immutable_external'&&fullExternal.includes('CREATE TRIGGER '+t.name+' '))||(t.name==='immutable_external'&&recreatedImmutable.includes(t.table))).map(t=>`DROP TRIGGER IF EXISTS "${t.name}" ON ${t.table};`).join('\n');
 runtime=replaceOnce(runtime,'-- SOURCE: docs/payments/drafts/settlement-external.sql',dropTriggers+'\n-- SOURCE: docs/payments/drafts/settlement-external.sql');
 runtime=replaceOnce(runtime,'BEGIN;', 'BEGIN;\nSET LOCAL search_path=public,pg_catalog;\nSET LOCAL lock_timeout=5000;\n'+historyGuard+compatibilityPreflight(guardSql,expected)+identityProof);
 const restoreTriggers=expected.triggers.map(t=>'DROP TRIGGER IF EXISTS \"'+t.name+'\" ON '+t.table+';\n'+t.definition+';').join('\n');
 const restoreAcl=expected.functions.filter(x=>!x.name.startsWith('dvnt_settlement.')).map(f=>{
  if(f.execute.some(x=>x.role!=='service_role'&&x.allowed))throw Error('Unexpected client grant in narrow contract');
  const name=f.name.startsWith('public.')?f.name:'public.'+f.name;
  return 'REVOKE ALL ON FUNCTION '+name+' FROM PUBLIC,anon,authenticated,service_role;'+(f.execute.some(x=>x.role==='service_role'&&x.allowed)?'\nGRANT EXECUTE ON FUNCTION '+name+' TO service_role;':'');
 }).join('\n');
 runtime=replaceOnce(runtime,"\nNOTIFY pgrst, 'reload schema';\nCOMMIT;",fs.readFileSync(path.join(root,'docs/payments/drafts/payout-readiness-observability.sql'),'utf8')+'\n'+adoptionOverrides(guardSql,fullExternal)+'\n'+fs.readFileSync(path.join(root,'docs/payments/drafts/settlement-external-adoption-wrappers.sql'),'utf8')+'\n'+restoreTriggers+'\n'+restoreAcl+"\nNOTIFY pgrst, 'reload schema';\nCOMMIT;");
 return '-- FUTURE ADOPTION DRAFT: not standalone guard deployment; no financial execution.\n'+runtime;
}
module.exports={...module.exports,functionDefinition,replaceOnce,adoptionOverrides,buildAdoption,validateBuildContract,identityProof};
