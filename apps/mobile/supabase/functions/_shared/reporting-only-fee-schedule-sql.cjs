// Disposable socket-only PostgreSQL, fake Vault/net/cron. No real secret or HTTP.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,readFileSync,readdirSync,rmSync,existsSync}=require('node:fs');
const {execFileSync,spawnSync}=require('node:child_process');
const {tmpdir}=require('node:os'),path=require('node:path'),{Pool}=require('pg');
const migrations=path.resolve(__dirname,'../../migrations');
function serverBin(){for(const dir of [process.env.POSTGRES_BIN,'',...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined))if(['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(dir,n),['--version']).status===0))return dir;throw Error('No local PostgreSQL; reporting-only schedule SQL tests did NOT run');}
const schema=`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA vault;CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
CREATE SCHEMA net;CREATE TABLE net.requests(id bigserial PRIMARY KEY,url text,headers jsonb,body jsonb,timeout_milliseconds integer);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$INSERT INTO net.requests(url,headers,body,timeout_milliseconds) VALUES($1,$2,$3,$4) RETURNING id$$;
CREATE SCHEMA cron;CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text,schedule text,command text,active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid$$;
INSERT INTO cron.job(jobname,schedule,command) VALUES('reconcile-orders-every-15min','*/15 * * * *','select public.cron_reconcile_orders();');
CREATE FUNCTION public.cron_reconcile_orders() RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Recovery path must not run';END$$;
`;
test('reporting-only schedule capability contract',{timeout:120000},async t=>{
 const bin=serverBin(),data=mkdtempSync(path.join(tmpdir(),'fee-schedule-db-')),socket=mkdtempSync(path.join(tmpdir(),'fee-schedule-sock-'));
 const run=(n,args)=>execFileSync(path.join(bin,n),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});let pool;
 try{
 const args=['-D',data,'-U','harness','--auth=trust','--no-sync'];if(process.env.POSTGRES_SHARE)args.push('-L',process.env.POSTGRES_SHARE);run('initdb',args);
 if(process.env.POSTGRES_SINGLE_USER){
 const names=readdirSync(migrations).filter(n=>n.endsWith('_reporting_only_fee_schedule.sql'));assert.equal(names.length,1);
 const sql=readFileSync(path.join(migrations,names[0]),'utf8');
 const checks=`
CREATE FUNCTION fixture_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',message;END IF;END;$$;
SELECT fixture_assert((SELECT count(*)=2 FROM cron.job),'only one new reporting job');
SELECT fixture_assert((SELECT schedule='7 */4 * * *' AND command='select public.cron_refresh_platform_fees();' FROM cron.job WHERE jobname='refresh-platform-fees-reporting-only'),'four-hour reporting schedule');
SELECT fixture_assert((SELECT schedule='*/15 * * * *' AND command='select public.cron_reconcile_orders();' FROM cron.job WHERE jobname='reconcile-orders-every-15min'),'recovery untouched');
SELECT fixture_assert((SELECT count(*)=0 FROM net.requests),'migration sends no request');
INSERT INTO vault.decrypted_secrets VALUES('CRON_SECRET','synthetic-only-cron-value');
SET ROLE service_role; SELECT public.cron_refresh_platform_fees(); RESET ROLE;
SELECT fixture_assert((SELECT count(*)=1 FROM net.requests),'one reporting request');
SELECT fixture_assert((SELECT url='https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/refresh-platform-fees' AND headers->>'x-cron-secret'='synthetic-only-cron-value' AND body='{}'::jsonb AND timeout_milliseconds=120000 FROM net.requests),'existing secret only in reporting request');
TRUNCATE net.requests,vault.decrypted_secrets;
SELECT public.cron_refresh_platform_fees();
INSERT INTO vault.decrypted_secrets VALUES('CRON_SECRET',''); SELECT public.cron_refresh_platform_fees();
INSERT INTO vault.decrypted_secrets VALUES('CRON_SECRET','second-synthetic-value'); SELECT public.cron_refresh_platform_fees();
SELECT fixture_assert((SELECT count(*)=0 FROM net.requests),'missing empty ambiguous secret fails closed');
SELECT fixture_assert(NOT has_function_privilege('anon','public.cron_refresh_platform_fees()','EXECUTE') AND NOT has_function_privilege('authenticated','public.cron_refresh_platform_fees()','EXECUTE'),'no browser dispatcher access');
SELECT fixture_assert(NOT has_table_privilege('anon','vault.decrypted_secrets','SELECT') AND NOT has_table_privilege('authenticated','vault.decrypted_secrets','SELECT'),'no browser vault access');
SELECT 'PASS: four-hour reporting-only schedule SQL';
`;
 const result=spawnSync(path.join(bin,'postgres'),['--single','-j','-D',data,'postgres'],{encoding:'utf8',input:(schema+sql+checks).replace(/\n\s*\n/g,'\n')+'\n\n',maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout+result.stderr,/ERROR:|FATAL:/);assert.match(result.stdout,/PASS: four-hour reporting-only schedule SQL/);return;
 }
 try{run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off`,'-w','-l',path.join(data,'log'),'start']);}catch(error){if(existsSync(path.join(data,'log')))console.error(readFileSync(path.join(data,'log'),'utf8'));throw error;}
 pool=new Pool({host:socket,user:'harness',database:'postgres',max:2});await pool.query(schema);
 const names=readdirSync(migrations).filter(n=>n.endsWith('_reporting_only_fee_schedule.sql'));assert.equal(names.length,1,'Exactly one CLI-generated schedule migration');const sql=readFileSync(path.join(migrations,names[0]),'utf8');
 const old=(await pool.query("SELECT * FROM cron.job WHERE jobname='reconcile-orders-every-15min'")).rows[0];
 await pool.query(sql);
 await t.test('applying migration schedules only the four-hour UTC reporting job and performs no HTTP',async()=>{const jobs=(await pool.query('SELECT * FROM cron.job ORDER BY jobid')).rows;assert.equal(jobs.length,2);assert.deepEqual(jobs[0],old);assert.equal(jobs[1].jobname,'refresh-platform-fees-reporting-only');assert.equal(jobs[1].schedule,'7 */4 * * *');assert.equal(jobs[1].command,'select public.cron_refresh_platform_fees();');assert.equal((await pool.query('SELECT count(*)::int n FROM net.requests')).rows[0].n,0)});
 await t.test('existing Vault reference is read only at invocation and secret is only in request header',async()=>{await pool.query("INSERT INTO vault.decrypted_secrets VALUES('CRON_SECRET','synthetic-only-cron-value')");await pool.query('SET ROLE service_role');const result=await pool.query('SELECT public.cron_refresh_platform_fees()');await pool.query('RESET ROLE');assert.ok(!JSON.stringify(result.rows).includes('synthetic-only-cron-value'));const request=(await pool.query('SELECT * FROM net.requests')).rows[0];assert.equal(request.url,'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/refresh-platform-fees');assert.deepEqual(request.headers,{'Content-Type':'application/json','x-cron-secret':'synthetic-only-cron-value'});assert.deepEqual(request.body,{});assert.equal(request.timeout_milliseconds,120000);assert.equal((await pool.query('SELECT count(*)::int n FROM vault.decrypted_secrets')).rows[0].n,1)});
 await t.test('missing empty or ambiguous secret cannot dispatch',async()=>{await pool.query('TRUNCATE net.requests,vault.decrypted_secrets');await pool.query('SELECT public.cron_refresh_platform_fees()');await pool.query("INSERT INTO vault.decrypted_secrets VALUES('CRON_SECRET','')");await pool.query('SELECT public.cron_refresh_platform_fees()');await pool.query("INSERT INTO vault.decrypted_secrets VALUES('CRON_SECRET','second-synthetic-value')");await pool.query('SELECT public.cron_refresh_platform_fees()');assert.equal((await pool.query('SELECT count(*)::int n FROM net.requests')).rows[0].n,0)});
 await t.test('browser roles cannot invoke dispatcher or read Vault',async()=>{for(const role of ['anon','authenticated']){assert.equal((await pool.query("SELECT has_function_privilege($1,'public.cron_refresh_platform_fees()','EXECUTE') ok",[role])).rows[0].ok,false);assert.equal((await pool.query("SELECT has_table_privilege($1,'vault.decrypted_secrets','SELECT') ok",[role])).rows[0].ok,false)}const def=(await pool.query("SELECT pg_get_functiondef('public.cron_refresh_platform_fees()'::regprocedure) code")).rows[0].code;assert.match(def,/SECURITY DEFINER/);assert.match(def,/SET search_path TO ''/);assert.doesNotMatch(def,/cron_reconcile_orders|\/reconcile-orders|refunds|tickets|payouts|email/i)});
 await t.test('unexpected existing reporting job fails atomically without modifying recovery',async()=>{await pool.query('DROP FUNCTION public.cron_refresh_platform_fees()');await pool.query("UPDATE cron.job SET command='select 42;' WHERE jobname='refresh-platform-fees-reporting-only'");await assert.rejects(pool.query(sql),/Reporting job already exists/);await pool.query('ROLLBACK');assert.deepEqual((await pool.query("SELECT * FROM cron.job WHERE jobname='reconcile-orders-every-15min'")).rows[0],old);assert.equal((await pool.query("SELECT command FROM cron.job WHERE jobname='refresh-platform-fees-reporting-only'")).rows[0].command,'select 42;');assert.equal((await pool.query("SELECT to_regprocedure('public.cron_refresh_platform_fees()') value")).rows[0].value,null)});
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])}catch{}rmSync(data,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});}
});
