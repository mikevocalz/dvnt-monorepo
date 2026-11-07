#!/usr/bin/env node
// Actual event cards; local fixtures only. Native primitives adapted to DOM:
// native structure/semantics are tested, not iOS rendering or Dynamic Type.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..');
const paths = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), ROOT];
const resolve = n => require.resolve(n, {paths});
const load = n => require(resolve(n));
(async () => {
 const native = `import React from 'react';
 function adapt(tag,base=''){return ({children,className='',testID,accessibilityLabel,accessibilityRole,accessibilityState,accessibilityLiveRegion,onPress,style,disabled})=>React.createElement(tag,{'data-testid':testID,'aria-label':accessibilityLabel,role:accessibilityRole==='header'?'heading':accessibilityRole,'aria-level':accessibilityRole==='header'?3:undefined,'aria-live':accessibilityLiveRegion,'aria-busy':accessibilityState?.busy,disabled,onClick:onPress,className:base+' '+className,style},children)}
 export const View=adapt('div','flex flex-col');export const Text=adapt('span');export const Pressable=adapt('button','flex');export const ScrollView=adapt('div','overflow-y-auto');export const ActivityIndicator=()=>null;export const Switch=({value,onValueChange,accessibilityLabel})=><input type='checkbox' aria-label={accessibilityLabel} checked={value} onChange={e=>onValueChange(e.target.checked)}/>;`;
 const bundle = await load('esbuild').build({stdin:{resolveDir:ROOT,loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {EventLynkCard as Web} from './packages/app/features/events/ui/EventLynkCard.web';
 import {EventLynkCard as Native} from './packages/app/features/events/ui/EventLynkCard.tsx';
 import {EventLynkSetup as WebSetup} from './packages/app/features/events/ui/EventLynkSetup.web';
 import {EventLynkSetup as NativeSetup} from './packages/app/features/events/ui/EventLynkSetup.tsx';
 const f=window.fixture={calls:0,retries:0,rail:'web',props:{roomId:'exact-event-room',signedIn:true,mayHost:true,view:{state:'ready',count:30,waiting:Array.from({length:30},(_,i)=>({userId:'row-'+i,displayName:'SECRET NAME',username:'SECRET USERNAME',avatar:null,joinedAt:new Date(Date.now()-i*60000).toISOString()}))},isLoading:false,isError:false,isTerminal:false,isLive:false,isOpening:false}};
 const root=createRoot(document.getElementById('root'));f.render=(patch={})=>{Object.assign(f.props,patch);const C=f.rail==='web'?Web:Native;if(f.setup){const S=f.rail==='web'?WebSetup:NativeSetup;root.render(<S enabled={f.enabled} onChange={v=>{f.enabled=v;f.render()}}/>);return;}root.render(<C {...f.props} onOpen={()=>{f.calls++;f.render({isOpening:true})}} onRetry={()=>f.retries++}/>)};f.render();
 `},bundle:true,write:false,jsx:'automatic',platform:'browser',format:'iife',nodePaths:paths,alias:Object.fromEntries(['react','react-dom'].map(n=>[n,path.dirname(resolve(n+'/package.json'))])),plugins:[{name:'native-boundaries',setup(b){b.onResolve({filter:/^(react-native|lucide-react-native)$/},a=>({path:a.path,namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},a=>({contents:a.path==='react-native'?native:`export {Radio,ShieldCheck} from 'lucide-react';`,loader:'tsx',resolveDir:ROOT}));b.onResolve({filter:/^@dvnt\/app\//},a=>b.resolve(path.join(ROOT,'packages/app',a.path.slice(10)),{resolveDir:ROOT,kind:a.kind}));}}]});
 const tw=path.dirname(resolve('tailwindcss/package.json'));
 const css=await load('postcss')([load('@tailwindcss/postcss')({base:ROOT})]).process(`@import "${tw}/theme.css" layer(theme); @import "${tw}/preflight.css" layer(base); @import "${tw}/utilities.css" important; @theme {--color-primary:#8A40CF;--color-primary-foreground:#fff;--color-foreground:#fafafa;--color-muted-foreground:#a1a1aa;--color-secondary:#27272a;--color-card:#18181b;--color-border:#303036;} @source "${ROOT}/packages/app/features/events/ui";`,{from:path.join(ROOT,'event-card-fixture.css')});
 const browser=await load('playwright')[process.env.LYNK_BROWSER || 'chromium'].launch({headless:true});
 try {for(const rail of ['web','native'])for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="root" style="max-width:680px;margin:24px auto"></div>');await page.addStyleTag({content:'body{background:#09090b;color:white}'+css.css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(r=>{window.fixture.rail=r;window.fixture.render()},rail);
  const button=page.getByTestId('event-lynk-open');await button.waitFor();
  assert.match(await page.locator('body').innerText(),/30 people waiting/);assert.doesNotMatch(await page.locator('body').innerText(),/SECRET/);
  assert.equal(await page.getByText('Member waiting',{exact:true}).count(),30);
  const list=page.getByLabel('People waiting for this event Lynk');assert.ok(await list.evaluate(el=>el.scrollHeight>el.clientHeight));await list.evaluate(el=>el.scrollTop=el.scrollHeight);assert.ok(await list.evaluate(el=>el.scrollTop>0));
  if(process.env.LYNK_CARD_EVIDENCE){fs.mkdirSync(process.env.LYNK_CARD_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.LYNK_CARD_EVIDENCE,rail+'-'+width+'-waiting.png'),fullPage:true});}
  assert.ok((await button.boundingBox()).height>=44);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(rail==='web'){await button.focus();await page.keyboard.press('Enter')}else await button.click();
  await page.waitForFunction(()=>document.querySelector('[data-testid=event-lynk-open]').disabled);assert.equal(await button.isDisabled(),true);await button.evaluate(el=>el.click());assert.equal(await page.evaluate(()=>window.fixture.calls),1);
  await page.evaluate(()=>window.fixture.render({isOpening:false,isError:true}));await page.getByRole('button',{name:'Retry waiting room'}).click();assert.equal(await page.evaluate(()=>window.fixture.retries),1);assert.equal(await page.getByTestId('event-lynk-host-panel').count(),0);
  await page.evaluate(()=>window.fixture.render({isError:false,isTerminal:true}));await page.waitForTimeout(30);assert.equal(await button.isDisabled(),true);assert.match(await button.innerText(),/ended/);
  await page.evaluate(()=>window.fixture.render({isTerminal:false,isLoading:true,view:null}));await page.waitForTimeout(30);assert.equal(await button.isDisabled(),true);assert.match(await button.innerText(),/Checking/);
  await page.evaluate(()=>window.fixture.render({isLoading:false,isLive:true}));await page.waitForTimeout(30);assert.match(await button.innerText(),/Enter event Lynk/);
  await page.evaluate(()=>window.fixture.render({signedIn:false,mayHost:true,isLive:true}));await page.waitForTimeout(30);assert.match(await button.innerText(),/Sign in/);assert.equal(await page.getByTestId('event-lynk-host-panel').count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Live now|Host access/);
  await page.evaluate(()=>window.fixture.render({signedIn:true,mayHost:false}));await page.waitForTimeout(30);assert.match(await button.innerText(),/Enter/);assert.equal(await page.getByTestId('event-lynk-host-panel').count(),0);
  await page.evaluate(()=>window.fixture.render({mayHost:true,isLive:false,view:{state:'ready',count:0,waiting:[]}}));await page.waitForTimeout(30);assert.match(await page.locator('body').innerText(),/No one waiting yet/);
  await page.addStyleTag({content:'html{font-size:24px}'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'150% text has no horizontal overflow');assert.ok((await button.boundingBox()).height>=44);
  await page.addStyleTag({content:'html{font-size:16px}'});
  assert.deepEqual(errors,[]);
  if(process.env.LYNK_CARD_EVIDENCE){fs.mkdirSync(process.env.LYNK_CARD_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.LYNK_CARD_EVIDENCE,rail+'-'+width+'.png'),fullPage:true});}
  await page.evaluate(()=>{window.fixture.setup=true;window.fixture.enabled=false;window.fixture.render()});await page.getByRole('checkbox').check();await page.getByText('Created on publish · not live yet').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'setup fits viewport');await page.addStyleTag({content:'html{font-size:24px}'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'setup fits enlarged text');
  console.log('PASS '+rail+' '+width+': privacy, 30 bounded rows, focus/action, pending lock, error/retry, loading, terminal, live, signed out, guest and empty');await page.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
