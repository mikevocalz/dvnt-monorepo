// Execute the native editor's actual callbacks with explicit UI/cache stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');

test('native save waits for server success before dismissing the draft',async()=>{
  const filename=path.join(ROOT,'packages/app/features/routes/screens/(protected)/edit-post/[id].tsx');
  const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback;
  function visit(n){
    if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='handleSave') callback=n.initializer.arguments[0];
    ts.forEachChild(n,visit);
  }
  visit(source);assert.ok(callback);
  const compiled=ts.transpileModule('const save = '+callback.getText(source)+'; save;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText;
  let backs=0,options;
  const save=vm.runInNewContext(compiled,{id:'1',isDirty:true,captionOverLimit:false,isRotating:false,hasRotations:false,
    caption:'Unsent caption',location:null,isNSFW:true,originalIsNSFW:false,
    Haptics:{impactAsync(){},ImpactFeedbackStyle:{Light:1}},
    updateMutation:{isPending:false,mutate(_updates,next){options=next;}},router:{back(){backs++;}},
  });
  await save();assert.equal(backs,0,'do not dismiss before knowing whether the server saved');
  assert.ok(options?.onSuccess);options.onSuccess();assert.equal(backs,1);
});

test('native prefill does not overwrite unsaved edits on optimistic rollback',()=>{
  const filename=path.join(ROOT,'packages/app/features/routes/screens/(protected)/edit-post/[id].tsx');
  const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback;
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(source)==='useEffect' && n.arguments[0].getText(source).includes('setOriginalCaption')) callback=n.arguments[0];ts.forEachChild(n,visit);}
  visit(source);assert.ok(callback);
  const compiled=ts.transpileModule('const prefill = '+callback.getText(source)+'; prefill;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText;
  let caption='';const hydration={current:null};
  const context={post:{id:'1',kind:'media',caption:'Original'},hydratedPostId:hydration,
    setCaption:v=>{caption=v;},setOriginalCaption(){},setLocation(){},setOriginalLocation(){},setIsNSFW(){},setOriginalIsNSFW(){}};
  const prefill=vm.runInNewContext(compiled,context);
  prefill();assert.equal(caption,'Original');caption='Unsent edit';
  prefill();assert.equal(caption,'Unsent edit','cache rollback must not rehydrate this same post');
  context.post={id:'2',kind:'media',caption:'Different post'};prefill();assert.equal(caption,'Different post');
});
