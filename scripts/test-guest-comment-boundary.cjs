#!/usr/bin/env node
// Print a self-contained disposable PostgreSQL fixture, or execute it in PGlite.
// CI: node scripts/test-guest-comment-boundary.cjs --sql | psql ...
// Local: NODE_PATH=<fixture-only @electric-sql/pglite install>/node_modules node scripts/test-guest-comment-boundary.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const migrations=path.join(root,'apps/mobile/supabase/migrations');
const read=name=>fs.readFileSync(path.join(migrations,name),'utf8');
const baseline=read('20261003110000_event_hide_and_publish_at.sql');
const boundary=read('20261013220000_event_comments_member_boundary.sql');
function definition(sql,name,delimiter='function') {
  const escaped=delimiter?'\\$'+delimiter+'\\$':'\\$\\$';
  const found=sql.match(new RegExp('^CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?^'+escaped+';', 'm'));
  assert.ok(found,`missing actual function ${name}`);
  return found[0];
}
const oldDetail=definition(baseline,'get_event_detail');
assert.equal(definition(boundary,'get_event_detail'),oldDetail.replace(
  ') top_cmt ON true;', ') top_cmt ON public.can_read_event_comments(p_event_id);'
),'migration must preserve every existing event-detail field and unrelated access gate');
const viewer=definition(read('20261003170000_verified_admission_whole_membership.sql'),'viewer_user_id','');
let sql=fs.readFileSync(path.join(__dirname,'fixtures/guest-comment-boundary.sql'),'utf8');
for(const [marker,value] of [
  ['-- FIXTURE_BASE_FUNCTIONS',[definition(baseline,'can_view_event'),oldDetail,viewer].join('\n')],
  ['-- BOUNDARY_MIGRATION',boundary],
]){
  assert.equal(sql.split(marker).length,2,`fixture marker must be unique: ${marker}`);
  sql=sql.replace(marker,()=>value);
}
if(process.argv.includes('--sql')) process.stdout.write(sql);
else {
  const {PGlite}=require('@electric-sql/pglite');
  (async()=>{
    const db=new PGlite();
    try {
      const results=await db.exec(sql);
      console.log(results.at(-1).rows[0]);
    } finally { await db.close(); }
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
