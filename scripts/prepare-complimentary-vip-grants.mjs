/** Prepare reviewable SQL only; this script cannot connect to a database. */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function literal(value) {return `'${String(value).replaceAll("'","''")}'`;}
function identity(value) {
  if(!value || !Number.isSafeInteger(value.id) || value.id<=0 ||
    typeof value.username!=='string' || !value.username.trim() ||
    typeof value.authId!=='string' || !value.authId.trim()) {
    throw new Error('Every recipient and actor requires an exact verified id, username, and authId snapshot.');
  }
  return value;
}
export function prepareComplimentaryVipSql(manifest) {
  const actor=identity(manifest.actor);
  if(manifest.expiresAt!==null) throw new Error('This approved batch must explicitly have expiresAt: null (no expiry).');
  if(typeof manifest.reason!=='string' || !manifest.reason.trim() || manifest.reason.trim().length>1000)
    throw new Error('An approval reason is required.');
  if(!Array.isArray(manifest.recipients) || !manifest.recipients.length) throw new Error('An explicit recipient snapshot is required.');
  const seen=new Set(), requests=new Set(), staffIds=new Set();
  const recipients=manifest.recipients.map(value=>{
    const person=identity(value);
    if(seen.has(person.id)||!UUID.test(person.requestId)||requests.has(person.requestId)) throw new Error('Unique recipients and stable UUID requestIds are required.');
    const basis=person.eligibility;
    if(!basis || !['named_recipient','payload_staff'].includes(basis.kind)) throw new Error('Each recipient needs the reviewed eligibility basis.');
    if(basis.kind==='payload_staff' && (!Number.isSafeInteger(basis.adminUserId) || basis.adminUserId<=0 ||
      !['super_admin','admin','moderator'].includes(basis.expectedRole))) throw new Error('Staff requires an exact Payload ID and role snapshot.');
    if(basis.kind==='payload_staff') {
      if(staffIds.has(basis.adminUserId)) throw new Error('Unique Payload staff IDs are required.');
      staffIds.add(basis.adminUserId);
    }
    seen.add(person.id);requests.add(person.requestId);return person;
  });
  for(const recipient of recipients) {
    if(recipient.id===actor.id && (recipient.username!==actor.username || recipient.authId!==actor.authId))
      throw new Error('Conflicting actor and recipient identity snapshots.');
  }
  const identities=[actor,...recipients].filter((p,i,a)=>a.findIndex(q=>q.id===p.id)===i);
  // Parameter values are SQL literals, including usernames/reasons with quotes.
  // The entire snapshot is checked in the same transaction before any grant.
  const identityChecks=identities.map(p=>`PERFORM 1 FROM public.users WHERE id=${p.id} AND username=${literal(p.username)} AND auth_id=${literal(p.authId)} FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Identity snapshot changed for profile ${p.id}'; END IF;
  PERFORM 1 FROM public."user" WHERE id=${literal(p.authId)} AND banned IS NOT TRUE FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Login unavailable or banned for profile ${p.id}'; END IF;
  PERFORM 1 FROM payload.members WHERE app_user_id=${literal(p.id)} FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.users WHERE id=${p.id} AND banned_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM payload.members WHERE app_user_id=${literal(p.id)} AND status IN ('suspended','banned','shadow_banned'))
    THEN RAISE EXCEPTION 'Moderation restriction for profile ${p.id}'; END IF;`);
  const staffChecks=recipients.filter(p=>p.eligibility.kind==='payload_staff').map(p=>`PERFORM 1 FROM payload.admin_users a JOIN public.users u ON lower(u.email)=lower(a.email)
    WHERE a.id=${p.eligibility.adminUserId} AND u.id=${p.id} AND a.role::text=${literal(p.eligibility.expectedRole)}
      AND (SELECT count(*) FROM public.users matched WHERE lower(matched.email)=lower(a.email))=1
    FOR SHARE OF a,u; IF NOT FOUND THEN RAISE EXCEPTION 'Payload staff snapshot changed for profile ${p.id}'; END IF;`);
  const checks=[`IF current_setting('transaction_isolation') <> 'serializable' THEN RAISE EXCEPTION 'Run the reviewed batch in a fresh serializable transaction'; END IF;`,...identityChecks,...staffChecks].join('\n  ');
  let delimiter='$snapshot$';
  while(checks.includes(delimiter)) delimiter=delimiter.replace('$','$_');
  const readback=`SELECT u.id AS profile_user_id,u.username,g.id AS grant_id,g.expires_at,t.plan_key AS effective_plan
FROM public.membership_grants g JOIN public.users u ON u.id=g.profile_user_id AND u.auth_id=g.user_id
JOIN public.effective_membership_tiers t ON t.user_id=g.user_id
WHERE g.id IN (SELECT grant_id FROM public.membership_grant_events WHERE request_id IN (${recipients.map(p=>literal(p.requestId)+'::uuid').join(',')}))
  AND g.revoked_at IS NULL AND g.expires_at IS NULL AND t.rank >= 5`;
  return `-- REVIEW BEFORE EXECUTING. Exact snapshot only; no automatic role expansion.\n`+
    `-- Contains private identity snapshots. Do not commit or share this output.\nBEGIN ISOLATION LEVEL SERIALIZABLE;\n`+
    `-- Preflight runs in the existing approved administrative SQL context.\n`+
    `DO ${delimiter} BEGIN\n  ${checks}\nEND ${delimiter};\n`+
    `-- Transaction locks survive this role switch; no privileges are granted.\n`+
    `SET LOCAL ROLE service_role;\nSET LOCAL request.jwt.claims = '{"role":"service_role"}';\n`+
    recipients.map(p=>`SELECT public.grant_complimentary_vip(${p.id},${actor.id},${literal(manifest.reason.trim())},NULL,${literal(p.requestId)}::uuid);`).join('\n')+
    `\nDO $verified$ BEGIN IF (SELECT count(*) FROM (${readback}) verified) <> ${recipients.length} THEN RAISE EXCEPTION 'Grant readback failed; batch rolled back'; END IF; END $verified$;\n`+
    `${readback};\nCOMMIT;\n`;

}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [manifestPath,outputPath]=process.argv.slice(2);
  if(!manifestPath||!outputPath) throw new Error('Usage: node scripts/prepare-complimentary-vip-grants.mjs private-manifest.json private-grants.sql');
  writeFileSync(outputPath,prepareComplimentaryVipSql(JSON.parse(readFileSync(manifestPath,'utf8'))),{flag:'wx',mode:0o600});
  console.log('Prepared SQL only. No database connection or grants were made.');
}
