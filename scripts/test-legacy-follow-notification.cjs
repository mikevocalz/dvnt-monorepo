const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('packages/app/lib/activity/notification-semantic-type.ts','utf8'),out={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:out});
test('semantic normalization is allowlisted and never rewrites unrelated notice types',()=>{
 for(const type of ['follow_request','follow_request_approved'])assert.equal(out.notificationSemanticType('system',{semantic_type:type}),type);
 for(const payload of [null,{},'follow_request',{semantic_type:'follow'},{semantic_type:'event_invite'}])assert.equal(out.notificationSemanticType('system',payload),'system');
 assert.equal(out.notificationSemanticType('like',{semantic_type:'follow_request'}),'like');
});
test('released pre-weekly native renders fallback title instead of blank unknown-type copy',()=>{
 const fn=fs.readFileSync('scripts/fixtures/legacy-activity-text.txt','utf8');
 const ctx={};vm.runInNewContext(ts.transpileModule(fn,{compilerOptions:{module:ts.ModuleKind.None}}).outputText,ctx);
 assert.equal(ctx.getActivityText({type:'system',payload:{title:'New follow request'}}),'New follow request');
 assert.equal(ctx.getActivityText({type:'follow_request'}),'');
});
