// Real signed-in CheckoutSheet, its real onCheckout handoff, real Review screen,
// shared hook/stores/pricing/cart API. Auth, transport, unrelated UI and Stripe
// are explicit test boundaries. No live member session or card is used.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const ts=require('typescript'),esbuild=require('esbuild'),{chromium}=require('playwright');
const {fixture,promo,promoter,TIER}=require('../apps/mobile/supabase/functions/guest-checkout/discounts-fixture.cjs');
const ROOT=path.resolve(__dirname,'..');
const f=fixture({entrypoint:path.join(ROOT,'apps/mobile/supabase/functions/validate-promo-code/index.ts'),
 promos:[promo()],promoters:[promoter({code:'Coolin',promoter_commission_bps:1500}),promoter({id:'slow',code:'SLOW',customer_discount_bps:5000})]});
const calls=[];
const source=fs.readFileSync(path.join(ROOT,'packages/app/features/events/event-detail.web.tsx'),'utf8');
const ast=ts.createSourceFile('sheet.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const sheet=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CheckoutSheet');assert.ok(sheet);
let handoff;
function visit(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(ast)==='CheckoutSheet'){
 const attr=n.attributes.properties.find(a=>a.name?.text==='onCheckout');handoff=attr.initializer.expression.getText(ast);
}ts.forEachChild(n,visit)}visit(ast);assert.ok(handoff,'extract the actual parent checkout handoff');
const extracted=`import {useEffect} from 'react';import {Minus,Plus,Check} from 'lucide-react';
import {useCheckoutCode} from '@dvnt/app/features/events/use-checkout-code.web';
import {canContinueWithCheckoutCode} from '@dvnt/app/lib/payments/checkout-code';
import {useAddonUpsellStore} from '@dvnt/app/lib/stores/addon-upsell-store';
import {usePromoterRefStore} from '@dvnt/app/lib/stores/promoter-ref-store';
import {useEventDetailUiStore} from '@dvnt/app/lib/stores/event-detail-ui-store';
import {computeCheckoutSheetTotals} from '@dvnt/app/lib/payments/checkout-sheet-totals';
import {promoLabel} from '@dvnt/app/lib/payments/promo-discount';
import {BottomSheet} from '@dvnt/app/components/bottom-sheet.web';
const addonSelectionsTotalCents=()=>0;const AddonUpsellStrip=()=>null;const CheckoutPhoneField=()=>null;
export ${sheet.getText(ast)};`;
const boundaries={
 '@dvnt/app/lib/mmkv-zustand':`export const mmkvStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`,
 '@dvnt/app/components/bottom-sheet.web':`export const BottomSheet=({open,title,children})=>open?<section role="dialog"><h1>{title}</h1>{children}</section>:null;`,
 './checkout-phone-field.web':`export const CheckoutPhoneField=()=>null;`,
 '@dvnt/app/lib/hooks/use-events':`export const useEvent=()=>({data:null});`,
 '@dvnt/app/lib/api/promoters':`export const promotersApi={getClaim:async()=>null};`,
 '@dvnt/app/lib/api/addons':`export const addonsApi={list:async()=>[]};`,
 '@tanstack/react-query':`export const useQuery=()=>({data:[]});`,
 '@dvnt/ui':`export const FormField=({label,children})=><label>{label}{children}</label>;`,
 '@dvnt/app/lib/stores/ui-store':`const state={showToast:()=>{}};export const useUIStore=s=>s(state);`,
 '@dvnt/app/lib/diagnostics/app-trace':`export const AppTrace={trace:()=>{},error:()=>{}};`,
 '@stripe/stripe-js':`export const loadStripe=async()=>({});`,
 '@stripe/react-stripe-js':`export const Elements=({children})=><div>{children}</div>;export const PaymentElement=()=>null;export const useElements=()=>null;export const useStripe=()=>null;`,
 'solito/navigation':`export const useRouter=()=>({push:p=>window.__nav(p),replace:p=>window.__nav(p),back:()=>{}});`,
 '@dvnt/app/lib/api/invoke-edge':`export async function invokeEdge(name,body){const r=await fetch('/fixture/'+name,{method:'POST',body:JSON.stringify(body)});const data=await r.json();return{data,error:r.ok?null:{message:data.error||'Error'}};}`,
};
(async()=>{
 const entry=`import {createRoot} from 'react-dom/client';import {create} from 'zustand';
import {useRouter} from 'solito/navigation';import {CheckoutSheet} from 'extracted-sheet';
import {CheckoutReviewScreen} from './packages/app/features/events/checkout-review.web';
import {useEventDetailUiStore} from '@dvnt/app/lib/stores/event-detail-ui-store';
import {useCartStore} from '@dvnt/app/lib/stores/cart';import {useAddonUpsellStore} from '@dvnt/app/lib/stores/addon-upsell-store';
import {usePromoterRefStore} from '@dvnt/app/lib/stores/promoter-ref-store';
import {ticketPurchaseAllowance} from '@dvnt/app/lib/tickets/purchase-quantity';
import {eventSalesClosed} from '@dvnt/app/lib/events/event-time';
const route=create(()=>({path:'sheet'}));window.__nav=p=>{history.replaceState(null,'',p);route.setState({path:p});};
const tier={id:'${TIER}',price_cents:3000,name:'General Admission',category:'admission',quantity_total:100,quantity_sold:0,max_per_user:10};
window.refs=usePromoterRefStore;window.cart=useCartStore;window.ui=useEventDetailUiStore;
window.begin=()=>{useCartStore.getState().clearCart();usePromoterRefStore.setState({refs:{}});useEventDetailUiStore.getState().reset();useEventDetailUiStore.getState().setCheckoutOpen(true);useEventDetailUiStore.getState().setSelectedTierId(tier.id);window.__nav('/sheet');};
function App(){const s=useEventDetailUiStore();const routePath=route(st=>st.path);const router=useRouter();
 const liveTicketTypes=[tier],eventId='1',selectedTierId=tier.id,e={title:'MIAMI Moonlight',start_date:'2099-01-01T20:00:00Z',end_date:'2099-01-02T02:00:00Z'},eventAddons=[];
 const isCheckingOut=false,isCancelledEvent=false,selectedCheckoutTier=tier,ownedTickets=[];
 const selectedAllowance=ticketPurchaseAllowance(tier,ownedTickets);
 const {ticketQty,promoCode,setCheckoutOpen,setPromoCode}=s;const resetAddonSelections=()=>{};const showToast=()=>{};
 const onCheckout=${handoff};
 return routePath.includes('/checkout/review')?<CheckoutReviewScreen/>:<CheckoutSheet open={s.checkoutOpen} onClose={()=>s.setCheckoutOpen(false)} eventId={eventId} eventTitle={e.title} tier={tier} addons={[]} maxQuantity={selectedAllowance} qty={ticketQty} setQty={s.setTicketQty} promoCode={promoCode} setPromoCode={s.setPromoCode} isCheckingOut={false} onCheckout={onCheckout}/>;
}createRoot(document.getElementById('root')).render(<App/>);`;
 const result=await esbuild.build({stdin:{contents:entry,resolveDir:ROOT,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'boundaries',setup(build){
 build.onResolve({filter:/.*/},args=>{
 if(args.path==='extracted-sheet')return{path:args.path,namespace:'extracted'};
 if(Object.hasOwn(boundaries,args.path))return{path:args.path,namespace:'boundary'};
 if(args.path.startsWith('@dvnt/app/')){const stem=path.join(ROOT,'packages/app',args.path.slice('@dvnt/app/'.length));const file=[stem,stem+'.ts',stem+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());return{path:file};}
 });
 build.onLoad({filter:/.*/,namespace:'boundary'},args=>({contents:boundaries[args.path],loader:'tsx',resolveDir:ROOT}));
 build.onLoad({filter:/.*/,namespace:'extracted'},()=>({contents:extracted,loader:'tsx',resolveDir:ROOT}));
 }}]});
 if(process.argv.includes('--build-only')){console.log('PASS: member sheet/handoff/review browser fixture bundles');return;}
 const server=http.createServer(async(req,res)=>{
 try{
 if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end(result.outputFiles[0].contents)}
 if(req.url.startsWith('/fixture/')){
 let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);const name=req.url.split('/').pop();calls.push({name,body});let data;
 if(name==='validate-promo-code'){
 const response=await f.call(body);if(body.code==='SLOW')await new Promise(r=>setTimeout(r,700));res.writeHead(response.status,{'Content-Type':'application/json'});return res.end(JSON.stringify(response.data));
 }
 if(name==='cart-create-hold')data={ok:true,cartId:body.cartId,holdExpiresAt:new Date(Date.now()+600000).toISOString(),holdId:'hold-fixture'};
 else if(name==='cart-checkout')data={ok:true,cartId:body.cartId,paymentIntent:'pi_fixture',ephemeralKey:'fixture',customer:'cus_fixture',paymentIntentId:'pi_fixture',clientSecret:'pi_fixture_secret_fixture',publishableKey:'pk_test_fixture',holdExpiresAt:new Date(Date.now()+600000).toISOString(),totals:{totalCents:3993,subtotalCents:3700,buyerFeeCents:293,discountCents:300,currency:'usd'}};
 else throw Error('Unexpected boundary '+name);
 res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(data));
 }
 res.writeHead(200,{'Content-Type':'text/html'});res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#10121c;color:white;font:16px system-ui;padding:20px}input,button{font:inherit;padding:10px}input{max-width:90%}button:disabled{opacity:.4}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
 }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await chromium.launch({headless:true,channel:'chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>window.begin());
 let input=page.getByRole('textbox',{name:'Promo or promoter code'});
 await input.fill('COOLIN');assert.equal(await page.getByRole('button',{name:'Pay $31.75',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByRole('button',{name:'Pay $28.68',exact:true}).waitFor();
 assert.equal(await input.inputValue(),'');assert.equal(await page.evaluate(()=>window.refs.getState().getRef('1')),'COOLIN');
 await page.getByRole('button',{name:'Pay $28.68',exact:true}).click();await page.getByRole('button',{name:'Continue to payment',exact:true}).waitFor();
 assert.equal(new URL(page.url()).search,'');assert.equal(await page.evaluate(()=>window.cart.getState().cart.eventId),'1');
 assert.ok((await page.locator('body').innerText()).includes('28.68'));
 // Real cart API must carry the promoter separately, including after add-ons.
 await page.evaluate(()=>window.cart.getState().addLineItem('1',{category:'coat_check',tierId:'coat-fixture',quantity:1,unitPriceCents:1000,metadata:{name:'Coat Check'}}));
 await page.waitForFunction(()=>document.body.innerText.includes('39.93'));
 await page.getByRole('button',{name:'Continue to payment',exact:true}).click();
 await page.waitForTimeout(500);const payment=calls.find(c=>c.name==='cart-checkout');assert.ok(payment,JSON.stringify({errors,calls,text:await page.locator('body').innerText()}));
 assert.equal(payment.body.promoterCode,'COOLIN');assert.equal(payment.body.promoCode,undefined);
 assert.equal(f.writes.length,0,'Apply did not bind a claim or create an order');
 // Retry directly on review, not only via the event sheet.
 await page.reload();await page.evaluate(()=>{window.begin();window.cart.getState().startCart('1');window.cart.getState().addLineItem('1',{category:'admission',tierId:'11111111-1111-4111-8111-111111111111',quantity:1,unitPriceCents:3000,metadata:{tierName:'Admission'}});window.__nav('/feed/checkout/review');});
 input=page.getByRole('textbox').first();await input.fill('COOLIN');await page.getByRole('button',{name:'Apply',exact:true}).click();
 await page.waitForFunction(()=>document.body.innerText.includes('28.68'));assert.equal(await input.inputValue(),'');
 await input.fill('INVALID');await page.getByRole('button',{name:'Apply',exact:true}).click();
 await page.getByText('That promo or promoter code is invalid or no longer active.').waitFor();assert.equal(await page.getByRole('button',{name:'Continue to payment',exact:true}).isDisabled(),true);
 await input.fill('SLOW');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.waitForTimeout(150);await input.fill('SAVE10');
 await page.getByRole('button',{name:'Apply',exact:true}).click();await page.waitForTimeout(850);
 assert.equal(await page.evaluate(()=>window.refs.getState().getRef('1')),'COOLIN','late SLOW did not replace the applied promoter');
 assert.ok((await page.locator('body').innerText()).includes('25.91'),'normal promo stacks after promoter once');
 assert.deepEqual(errors,[]);console.log('PASS: actual signed-in sheet → actual parent handoff → actual review → actual cart API payload; direct review entry; admission-only promoter discount with add-on; invalid-code payment block; stale response protection. Provider/auth boundaries are mocked; no card charge.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
