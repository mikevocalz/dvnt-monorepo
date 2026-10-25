// Synthetic public values only: exercise the actual Next env bridge and browser bundle.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {buildSync} = require('esbuild');
const {getNextConfigEnv} = require('next/dist/lib/static-env');
const root = path.resolve(__dirname, '..');
const configSource = fs.readFileSync(path.join(root,'apps/web/next.config.ts'),'utf8');
const ast = ts.createSourceFile('next.config.ts',configSource,ts.ScriptTarget.Latest,true);
let envSource;
function visit(node) {
 if(ts.isPropertyAssignment(node) && node.name.getText(ast)==='env') envSource=node.initializer.getText(ast);
 ts.forEachChild(node,visit);
}
visit(ast);
assert.ok(envSource,'test uses the real Next configuration env block');
function browserKey(nextKey,expoKey) {
 const env={EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:expoKey,GOOGLE_MAPS_API_KEY:'server-must-not-leak',GOOGLE_PLACES_API_KEY:'places-must-not-leak'};
 const config={env:vm.runInNewContext(`(${envSource})`,{process:{env}})};
 const mapped=getNextConfigEnv(config);
 assert.equal(mapped['process.env.GOOGLE_MAPS_API_KEY'],undefined);
 assert.equal(mapped['process.env.GOOGLE_PLACES_API_KEY'],undefined);
 const define=Object.fromEntries(Object.entries(mapped).map(([k,v])=>[k,JSON.stringify(v)]));
 define['process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY']=JSON.stringify(nextKey)||'undefined';
 define['process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY']??='undefined';
 const out=buildSync({entryPoints:[path.join(root,'packages/ui/src/google-maps-public-config.ts')],bundle:true,write:false,format:'iife',globalName:'mapsConfig',platform:'browser',define}).outputFiles[0].text;
 assert.ok(!out.includes('server-must-not-leak')&&!out.includes('places-must-not-leak'));
 return vm.runInNewContext(`${out};mapsConfig.getGoogleMapsPublicKey()`);
}
test('Next bridge carries existing public Expo config into browser without process global',()=>assert.equal(browserKey(undefined,' expo-public-fixture '),'expo-public-fixture'));
test('Next public value wins when both names exist',()=>assert.equal(browserKey(' next-public-fixture ','expo-public-fixture'),'next-public-fixture'));
test('blank Next alias falls back to trimmed Expo value',()=>assert.equal(browserKey(' \t ',' expo-public-fixture '),'expo-public-fixture'));
test('missing and whitespace-only configuration remain safely unavailable',()=>{
 assert.equal(browserKey(undefined,undefined),'');assert.equal(browserKey(' ','\n'),'');
});
test('all browser consumers use one resolver; explicit picker prop remains authoritative',()=>{
 for(const file of ['packages/app/features/events/ui/member-map.web.tsx','packages/app/features/settings/ui/LocationControls.web.tsx','packages/ui/src/media/MapPicker.web.tsx']){
  const source=fs.readFileSync(path.join(root,file),'utf8');assert.match(source,/getGoogleMapsPublicKey\(\)/);assert.doesNotMatch(source,/process\.env\./);
 }
 assert.match(fs.readFileSync(path.join(root,'packages/ui/src/media/MapPicker.web.tsx'),'utf8'),/apiKey \?\? getGoogleMapsPublicKey\(\)/);
});
