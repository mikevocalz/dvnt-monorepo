// Run pure Deno-authored helpers under Node as well, without network/env access.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
global.Deno={test,env:{get:()=>undefined}};require('./event-followup.test.ts');
const {buildFollowupEmail,recipientsToEnqueue}=require('./event-followup.ts');
test('dark branded email and honest preview footer preserve exact ratings CTA',()=>{
 const mail=buildFollowupEmail({eventTitle:'Synthetic Night',subject:'How was it for you?',message:'Community beyond events is so important.',ctaLabel:'Rate the party',reviewUrl:'https://example.test/feed/events/7/reviews',unsubscribeUrl:'https://example.test/unsubscribe',profileUrl:'https://example.test/auth/login?returnTo=%2Ffeed%2Fevents%2F7%2Freviews',preview:true});
 assert.match(mail.html,/This is your requested preview/);assert.doesNotMatch(mail.html,/You got this because you had a ticket/);assert.match(mail.html,/href="https:\/\/example.test\/feed\/events\/7\/reviews"/);assert.match(mail.html,/#0[0-9a-f]{5}/i);assert.match(mail.html,/DVNT/);assert.match(mail.html,/Join the community/);assert.match(mail.html,/Community beyond events is so important/);assert.match(mail.html,/Rate the party/);
});
test('claimed member never receives mail at stale guest address',()=>{const r=recipientsToEnqueue([{id:'t',user_id:'member',guest_email:'old@example.test'}],new Map([['member','new@example.test']]),new Set());assert.deepEqual([...r.keys()],['new@example.test']);});
