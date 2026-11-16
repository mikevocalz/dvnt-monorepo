const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require });
  return exports;
}
const root = path.join(__dirname,'../..');
const pricing = load(path.join(root,'lib/tickets/pricing.ts'),()=>{throw Error('unexpected import');});
function fixture(overrides={}) {
  const calls=[], created=[], persisted=[], removed=[]; let active=true;
  const api={
    create: async p => { calls.push(['create',p]); return { id:'created',ticket_addon_variants:[{id:'v-created'}] }; },
    update: async (...args) => { calls.push(['update',...args]); return true; },
    syncVariants: async (...args) => { calls.push(['sync',...args]); return true; },
    remove: async id => { calls.push(['remove',id]); return true; }, ...overrides,
  };
  const apiModule = { addonsApi:api, REDEEMABLE_DEFAULTS:{merch:false},VARIANT_ADDON_TYPES:new Set(['merch']) };
  const form=load(path.join(root,'features/events/create/addon-form.ts'),name=>name.includes('pricing')?pricing:apiModule);
  const {saveAddonCatalog}=load(path.join(__dirname,'save-addon-catalog.ts'),name=>name.includes('addon-form')?form:apiModule);
  const options={ eventId:'42',addons:[],originalIds:[], current:()=>active,
    assertCurrent:()=>{if(!active)throw Error('stale');},
    onCreated:(...args)=>created.push(args),onVariantPersisted:(...args)=>persisted.push(args),onRemoved:id=>removed.push(id),
  };
  const draft=extra=>({...form.newDraftAddon(),name:'Shirt',priceDollars:'12',...extra});
  return {calls,created,persisted,removed,api,options,draft,save:()=>saveAddonCatalog(options),deactivate:()=>{active=false;}};
}
const row=extra=>({size:'',color:'',priceDollars:'',quantity:'',...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('creates, updates, removes once and skips unnamed drafts with exact serializer pricing',async()=>{
  const f=fixture();f.options.addons=[f.draft(),f.draft({dbId:'old'}),f.draft({name:''})];f.options.originalIds=['old','removed','removed'];
  await f.save();
  assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
  assert.equal(f.calls.find(c=>c[0]==='update')[2].price_cents,1200);
  assert.deepEqual(f.removed,['removed']);assert.equal(f.created[0][1],'created');assert.equal(f.created[0][2][0].id,'v-created');
});
test('filtered variant indexes map to original draft, including zero-price override',async()=>{
  const f=fixture();f.options.addons=[f.draft({dbId:'addon',variants:[row(),row({size:'S',priceDollars:'0'}),row(),row({color:'Red',dbId:'existing'})]})];
  f.api.syncVariants=async(id,variants,onPersisted)=>{
    assert.equal(variants.length,2);assert.equal(variants[0].priceCents,0);assert.equal(variants[1].id,'existing');
    onPersisted(0,{id:'new-small'});return true;
  };
  await f.save();assert.equal(f.persisted[0][0],0);assert.equal(f.persisted[0][1],1);assert.equal(f.persisted[0][2].id,'new-small');
});
test('non-variant addon types clear variant matrix via the same serialization rules',async()=>{
  const f=fixture();f.options.addons=[f.draft({dbId:'addon',addonType:'parking',variants:[row({size:'S'})]})];
  await f.save();assert.equal(f.calls.find(c=>c[0]==='sync')[2].length,0);
});
test('partial parent creation records confirmed ID before propagating failure',async()=>{
  const error=Object.assign(new Error('variant failed'),{addonId:'persisted-parent'});
  const f=fixture({create:async()=>{throw error;}});f.options.addons=[f.draft()];
  await assert.rejects(f.save(),e=>e===error);assert.equal(f.created[0][1],'persisted-parent');
});
test('failure waits for all sibling creates and removals, retaining successful IDs',async()=>{
  const create=deferred(),remove=deferred();let complete=false;
  const f=fixture({update:async()=>{throw Error('update failed');},create:()=>create.promise,remove:()=>remove.promise});
  f.options.addons=[f.draft({dbId:'old'}),f.draft()];f.options.originalIds=['old','gone'];
  const saving=f.save();saving.then(()=>{complete=true;},()=>{complete=true;});
  await new Promise(r=>setImmediate(r));assert.equal(complete,false);
  create.resolve({id:'created'});await new Promise(r=>setImmediate(r));assert.equal(complete,false);assert.equal(f.created[0][1],'created');
  remove.resolve(true);await assert.rejects(saving,/update failed/);assert.deepEqual(f.removed,['gone']);
});
test('stale operation drains work without mutating new draft or starting next sync',async()=>{
  const update=deferred();const f=fixture({update:()=>update.promise});f.options.addons=[f.draft({dbId:'old'})];
  const saving=f.save();f.deactivate();update.resolve(true);await assert.rejects(saving,/stale/);
  assert.equal(f.calls.some(c=>c[0]==='sync'),false);assert.equal(f.persisted.length,0);
  const create=deferred();const other=fixture({create:()=>create.promise});other.options.addons=[other.draft()];
  const pending=other.save();other.deactivate();create.resolve({id:'late'});await assert.rejects(pending,/stale/);assert.equal(other.created.length,0);
});
test('partial variant sync preserves successful ID before surfacing sibling failure',async()=>{
  const f=fixture({syncVariants:async(id,variants,onPersisted)=>{onPersisted(0,{id:'persisted-v'});throw Error('later failure');}});
  f.options.addons=[f.draft({dbId:'addon',variants:[row(),row({size:'M'})]})];
  await assert.rejects(f.save(),/later failure/);assert.equal(f.persisted[0][1],1);assert.equal(f.persisted[0][2].id,'persisted-v');
});
test('unconfirmed create or mutation success is never reported as saved',async()=>{
  for(const overrides of [{create:async()=>null},{update:async()=>false},{syncVariants:async()=>false}]) {
    const f=fixture(overrides);f.options.addons=[f.draft(overrides.create?{}:{dbId:'addon'})];await assert.rejects(f.save(),/not confirmed/);
  }
});
