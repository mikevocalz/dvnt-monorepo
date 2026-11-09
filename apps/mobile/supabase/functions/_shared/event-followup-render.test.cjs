// Run pure Deno-authored helpers under Node as well, without network/env access.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
global.Deno={test,env:{get:()=>undefined}};require('./event-followup.test.ts');
const {buildFollowupEmail,recipientsToEnqueue}=require('./event-followup.ts');
for(const guest of [false,true])test('dark branded single-CTA '+(guest?'guest signup':'member event review'),()=>{
 const review='https://example.test/feed/events/7?section=reviews',join='https://example.test/auth/signup?returnTo=%2Ffeed%2Fevents%2F7%3Fsection%3Dreviews';
 const mail=buildFollowupEmail({eventTitle:'Synthetic Night',subject:'How was it for you?',message:guest?'Make a profile and connect.':'Tell us how the party was.',ctaLabel:'Rate the party',reviewUrl:review,unsubscribeUrl:'https://example.test/unsubscribe',joinUrl:guest?join:undefined,preview:true});
 assert.match(mail.html,/This is your requested preview/);assert.doesNotMatch(mail.html,/You got this because you had a ticket/);assert.match(mail.html,/#0[0-9a-f]{5}/i);assert.match(mail.html,/DVNT/);assert.match(mail.html,/Synthetic Night/);assert.match(mail.html,/If the app opens instead, copy this link into your browser’s address bar/);assert.match(mail.html,/Unsubscribe from event follow-up emails/);
 if(guest){assert.match(mail.html,/Join the platform/);assert.doesNotMatch(mail.html,/Rate the party/);assert.ok(mail.html.includes(join));assert.ok(!mail.html.includes(review));}else{assert.match(mail.html,/Rate the party/);assert.doesNotMatch(mail.html,/Join the platform|auth\/signup/);assert.ok(mail.html.includes(review));}
});
test('claimed member never receives mail at stale guest address',()=>{const r=recipientsToEnqueue([{id:'t',user_id:'member',guest_email:'old@example.test'}],new Map([['member','new@example.test']]),new Set());assert.deepEqual([...r.keys()],['new@example.test']);});
