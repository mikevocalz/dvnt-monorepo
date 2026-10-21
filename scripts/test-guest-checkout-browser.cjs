// Browser interaction test: actual guest sheet/store/quote hook, explicit UI and
// unrelated-profile boundaries, real guest handler with fixture DB/Stripe only.
// This is not a real payment or a pixel-accurate device acceptance test.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const esbuild=require('esbuild');const {chromium}=require('playwright');
const {fixture,promo,promoter,TIER,EMAIL}=require('../apps/mobile/supabase/functions/guest-checkout/discounts-fixture.cjs');
const ROOT=path.resolve(__dirname,'..');
const f=fixture({promos:[promo(),promo({id:'slow',code:'SLOW',discount_value:50})],promoters:[promoter()]});
const TIER2='44444444-4444-4444-8444-444444444444';
f.tables.events.push({...f.tables.events[0],id:2});f.tables.ticket_types.push({...f.tables.ticket_types[0],id:TIER2,event_id:2,price_cents:4000});
const RSVP_TIER='55555555-5555-4555-8555-555555555555';
f.tables.events.push({...f.tables.events[0],id:3,ticketing_enabled:false});
f.tables.ticket_types.push({...f.tables.ticket_types[0],id:RSVP_TIER,event_id:3,name:'RSVP',price_cents:0});
const calls=[];
const boundaries={
 'react-native':`import React from 'react';const box=tag=>({children,accessibilityRole,accessibilityLabel,accessibilityLiveRegion,...props})=>React.createElement(tag,{...props,role:accessibilityRole,'aria-label':accessibilityLabel,'aria-live':accessibilityLiveRegion},children);export const View=box('div');export const Text=box('span');`,
 '@dvnt/app/components/ui/html':`import React from 'react';export const Section=({children,...p})=><section {...p}>{children}</section>;export const P=({children,accessibilityLiveRegion,...p})=><p aria-live={accessibilityLiveRegion} {...p}>{children}</p>;`,
 '@dvnt/app/components/ui/input':`import React from 'react';export const Input=({label,value,onChangeText,editable,accessibilityLabel,placeholder,maxLength})=><label>{label}<input aria-label={accessibilityLabel||label} value={value} onChange={e=>onChangeText(e.target.value)} disabled={editable===false} placeholder={placeholder} maxLength={maxLength}/></label>;`,
 '@dvnt/app/components/ui/button':`import React from 'react';export const Button=({children,onPress,disabled})=><button type="button" disabled={disabled} onClick={onPress}>{children}</button>;`,
 '@dvnt/app/components/bottom-sheet.web':`import React from 'react';export const BottomSheet=({open,onClose,title,children})=>open?<section role="dialog"><h1>{title}</h1><button aria-label="Close checkout" onClick={onClose}>Close</button>{children}</section>:null;`,
 '@dvnt/app/lib/hooks/use-events':`export const useEvent=()=>({data:null});`,
 '@dvnt/app/lib/events/event-time':`export const formatEventWhen=()=>'';`,
 './promoter-ref-store':`export const getPendingPromoterRef=()=>window.__tracked||null;`,
 '@dvnt/app/lib/supabase/client':`export const supabase={from:()=>({select:()=>({eq:()=>({single:()=>Promise.resolve({data:{attendee_name_requirement:'off',refund_policy:'none'}})})})}),functions:{invoke:async(_,options)=>{const response=await fetch('/fixture-api',{method:'POST',body:JSON.stringify(options.body),signal:options.signal});const data=await response.json();return {data,error:null};}}};`,
};
(async()=>{
 const build=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {GuestCheckoutSheet} from './packages/app/features/events/guest-checkout-sheet.web';import {useGuestCheckoutStore} from './packages/app/lib/stores/guest-checkout-store';window.begin=(args={})=>{useGuestCheckoutStore.getState().openSheet({eventId:'1',eventTitle:'Fixture',tierId:'${TIER}',tierName:'Admission',priceCents:3000,...args});useGuestCheckoutStore.getState().patch({email:'${EMAIL}'});};window.store=useGuestCheckoutStore;createRoot(document.getElementById('root')).render(<GuestCheckoutSheet/>);`,resolveDir:ROOT,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'explicit-boundaries',setup(build){
  build.onResolve({filter:/.*/},args=>{
   if(Object.hasOwn(boundaries,args.path))return{path:args.path,namespace:'fixture-boundary'};
   if(args.path.startsWith('@dvnt/app/'))return{path:path.join(ROOT,'packages/app',args.path.slice('@dvnt/app/'.length))+(/\.(tsx?|js)$/.test(args.path)?'':'.ts')};
  });
  build.onLoad({filter:/.*/,namespace:'fixture-boundary'},args=>({contents:boundaries[args.path],loader:'tsx',resolveDir:ROOT}));
 }}]});
 const bundle=build.outputFiles[0].contents;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end(bundle)}
  if(req.url==='/fixture-api'){
   let data='';for await(const part of req)data+=part;const body=JSON.parse(data);calls.push(body);
   const result=await f.call(body);
   if(body.quote_request?.discount_code==='SLOW')await new Promise(resolve=>setTimeout(resolve,1000));
   res.writeHead(result.status,{'Content-Type':'application/json'});return res.end(JSON.stringify(result.data));
  }
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#10121c;color:white;font:16px system-ui;margin:0}section{padding:16px}label,input,button{font:inherit}input{display:block;width:100%;box-sizing:border-box;min-width:0;margin:6px 0;padding:10px}button{padding:10px}p{margin:8px 0}button:disabled{opacity:.5}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:390,height:844}});const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  // A signed-out free RSVP must quote and issue without enabling paid sales.
  await page.evaluate(({tier})=>window.begin({eventId:'3',tierId:tier,tierName:'RSVP',priceCents:0}),{tier:RSVP_TIER});
  await page.getByRole('button',{name:'Get free tickets',exact:true}).waitFor();
  assert.equal(f.writes.length,0,'opening RSVP only requests a read-only quote');
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.waitForFunction(()=>window.store.getState().quote?.total_cents===0&&!window.store.getState().quoteLoading);
  await page.getByRole('button',{name:'Get free tickets',exact:true}).click();
  await page.getByRole('heading',{name:"You're in!",exact:true}).waitFor();
  assert.equal(f.tables.tickets.length,2);assert.equal(f.emails.length,1);assert.equal(f.stripe.length,0);
  const rsvp=calls.find(body=>body.action!=='quote');
  assert.equal(rsvp.event_id,3);assert.equal(rsvp.quantity,2);assert.match(rsvp.expected_quote_key,/^[a-f0-9]{64}$/);
  assert.deepEqual(f.profileCalls,[],'free RSVP does not create an account');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.evaluate(()=>window.begin());
  assert.equal(await page.getByRole('textbox',{name:/username|mobile number/i}).count(),0);
  await page.getByRole('textbox',{name:'Name (optional)',exact:true}).fill('Guest Buyer');
  const code=page.getByRole('textbox',{name:'Promo or promoter code'});
  await page.getByRole('button',{name:'Pay $31.75',exact:true}).waitFor();
  await code.fill('save10');await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('Pay $31.75')&&b.disabled),{},{timeout:5000});
  await page.getByRole('button',{name:'Apply code',exact:true}).click();await page.getByText('SAVE10 applied',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Pay $28.68',exact:true}).waitFor();
  await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Pay $57.35',exact:true}).waitFor();
  await code.fill('NOPE');await page.getByRole('button',{name:'Apply code',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'invalid'}).waitFor();assert.equal(f.stripe.length,0);
  await page.getByRole('button',{name:'Remove codes',exact:true}).click();await page.getByRole('button',{name:'Pay $63.50',exact:true}).waitFor();
  await code.fill('SLOW');await page.getByRole('button',{name:'Apply code',exact:true}).click();
  await page.waitForTimeout(400);await code.fill('SAVE10');await page.getByRole('button',{name:'Apply code',exact:true}).click();
  await page.getByRole('button',{name:'Pay $57.35',exact:true}).waitFor();await page.waitForTimeout(1100);
  assert.equal(await page.getByRole('button',{name:'Pay $57.35',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Close checkout',exact:true}).click();
  await page.evaluate(({tier})=>window.begin({eventId:'2',tierId:tier,priceCents:4000}),{tier:TIER2});
  await page.getByRole('button',{name:'Pay $42.00',exact:true}).waitFor();assert.equal(await code.inputValue(),'');
  await page.getByRole('button',{name:'Close checkout',exact:true}).click();await page.evaluate(()=>window.begin());
  await page.getByRole('button',{name:'Pay $31.75',exact:true}).waitFor();await code.fill('SAVE10');
  await page.getByRole('button',{name:'Apply code',exact:true}).click();await page.getByRole('button',{name:'Pay $28.68',exact:true}).waitFor();
  await page.route('https://checkout.stripe.com/**',route=>route.fulfill({body:'Fixture hosted checkout; no card charge.'}));
  await page.getByRole('button',{name:'Pay $28.68',exact:true}).click();await page.waitForURL('https://checkout.stripe.com/**');
  const payment=calls.find(body=>body.action!=='quote'&&body.event_id===1);assert.equal(payment.discount_code,'SAVE10');assert.match(payment.expected_quote_key,/^[a-f0-9]{64}$/);
  for(const field of ['username','full_name','phone'])assert.equal(Object.hasOwn(payment,field),false,field+' must not provision an account');
  assert.equal(f.tables.orders.at(-1).total_cents,2868);assert.equal(f.stripe.length,1);
  assert.deepEqual(pageErrors,[],'no unexpected browser errors');
  console.log('PASS: free RSVP with paid sales off, guest issuance without signup, visible mobile code field, apply/remove, quantity repricing, invalid code, stale quote, new-event reset, reviewed checkout payload and redirect (fixture Stripe).');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
