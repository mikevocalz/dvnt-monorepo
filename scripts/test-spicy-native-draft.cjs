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
  let backs=0,options,request;
  const save=vm.runInNewContext(compiled,{id:'1',isDirty:true,captionOverLimit:false,isRotating:false,hasRotations:false,
    caption:'Unsent caption',originalCaption:'Original',location:null,originalLocation:null,isNSFW:true,originalIsNSFW:false,
    removal:{expectedIds:['a','b'],ids:['b']},
    Haptics:{impactAsync(){},ImpactFeedbackStyle:{Light:1}},
    updateMutation:{isPending:false,mutate(updates,next){request=updates;options=next;}},router:{back(){backs++;}},
  });
  await save();assert.equal(backs,0,'do not dismiss before knowing whether the server saved');
  assert.equal(request.removeMedia.ids[0],'b'); assert.equal(request.removeMedia.expectedCaption,'Original');
  assert.ok(options?.onSuccess);options.onSuccess();assert.equal(backs,1);
});

test('native prefill does not overwrite unsaved edits after a same-post refresh',()=>{
  const filename=path.join(ROOT,'packages/app/features/routes/screens/(protected)/edit-post/[id].tsx');
  const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback;
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(source)==='useEffect' && n.arguments[0].getText(source).includes('setOriginalCaption')) callback=n.arguments[0];ts.forEachChild(n,visit);}
  visit(source);assert.ok(callback);
  const compiled=ts.transpileModule('const prefill = '+callback.getText(source)+'; prefill;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText;
  let caption='';
  const context={id:'1',post:{id:'1',kind:'media',caption:'Original'},hydratedPostId:null,isDirty:false,isPlaceholderData:false,
    setHydratedPostId:v=>{context.hydratedPostId=v;},setRemoval(){},setCaption:v=>{caption=v;},setOriginalCaption(){},setLocation(){},setOriginalLocation(){},setIsNSFW(){},setOriginalIsNSFW(){}};
  const prefill=vm.runInNewContext(compiled,context);
  prefill();assert.equal(caption,'Original');caption='Unsent edit';context.isDirty=true;
  prefill();assert.equal(caption,'Unsent edit','server refresh must not rehydrate a dirty draft');
  context.id='2';prefill();assert.equal(caption,'Unsent edit');
  context.post={id:'2',kind:'media',caption:'Different post'};prefill();assert.equal(caption,'Different post');
});


test('native fresh server response replaces an untouched placeholder for the same post',()=>{
  const filename=path.join(ROOT,'packages/app/features/routes/screens/(protected)/edit-post/[id].tsx');
  const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback;
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(source)==='useEffect' && n.arguments[0].getText(source).includes('setOriginalCaption')) callback=n.arguments[0];ts.forEachChild(n,visit);}
  visit(source);assert.ok(callback);
  const compiled=ts.transpileModule('const prefill = '+callback.getText(source)+'; prefill;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText;
  let caption='',rating=false,location=null;
  const context={id:'1',post:{id:'1',kind:'media',caption:'Stale cache',location:'Old location',isNSFW:false},
    hydratedPostId:null,isDirty:false,isPlaceholderData:true,
    setHydratedPostId:v=>{context.hydratedPostId=v;},setRemoval(){},
    setCaption:v=>{caption=v;},setOriginalCaption(){},setLocation:v=>{location=v;},
    setOriginalLocation(){},setIsNSFW:v=>{rating=v;},setOriginalIsNSFW(){}};
  const prefill=vm.runInNewContext(compiled,context);
  prefill();assert.equal(caption,'','cached placeholder is not editable');
  context.isPlaceholderData=false;
  context.post={id:'1',kind:'media',caption:'Fresh from server',location:'Fresh location',isNSFW:true};
  prefill();assert.equal(caption,'Fresh from server');assert.equal(location.name,'Fresh location');assert.equal(rating,true);
  caption='Local draft';context.isDirty=true;
  context.post={id:'1',kind:'media',caption:'Concurrent update',location:'Remote location',isNSFW:false};
  prefill();assert.equal(caption,'Local draft');assert.equal(location.name,'Fresh location');assert.equal(rating,true);
});
