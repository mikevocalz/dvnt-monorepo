const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const esbuild = require("esbuild");
const ROOT = path.resolve(__dirname, "../..");
const TIER = "11111111-1111-4111-8111-111111111111";
const boundaries = {
  "@dvnt/app/lib/mmkv-zustand": `export const mmkvStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`,
  "./checkout-phone-field.web": `export const CheckoutPhoneField=()=>null;`,
  "@dvnt/app/lib/hooks/use-events": `export const useEvent=()=>({data:null});`,
  "@dvnt/app/lib/events/event-time": `export const formatEventWhen=()=>'';`,
  "@dvnt/app/lib/api/promoters": `export const promotersApi={getClaim:async()=>null};`,
  "@dvnt/app/lib/api/addons": `export const addonsApi={getByEvent:async()=>[]};`,
  "@tanstack/react-query": `export const useQuery=options=>options.queryKey[0]==='cart'?{data:window.fixture.status,isLoading:false,isError:false,dataUpdatedAt:Date.now(),errorUpdatedAt:0,refetch:()=>{}}:({data:[{id:'22222222-2222-4222-8222-222222222222',name:'Coat Check',price_cents:1000,quantity_total:null,status:'on_sale',has_variants:false},{id:'33333333-3333-4333-8333-333333333333',name:'Shirt',price_cents:2000,quantity_total:null,status:'on_sale',has_variants:true,ticket_addon_variants:[{id:'44444444-4444-4444-8444-444444444444',name:'Large',price_cents:2000,quantity_total:null}]}]});export const useQueryClient=()=>({});`,
  "./first-post-offer-card.web": `export default function FirstPostOfferCard(){return null;}`,
  "@dvnt/app/lib/stores/auth-store": `export const useAuthStore=selector=>selector({user:{id:'fixture-buyer'}});`,
  "@dvnt/ui": `export const FormField=({label,children})=><label>{label}{children}</label>;`,
  "@dvnt/app/lib/stores/ui-store": `const state={showToast:(...args)=>window.fixture.toasts.push(args)};export const useUIStore=s=>s(state);`,
  "sonner-native": `export const toast={error:(...a)=>window.fixture.toasts.push(a),success:(...a)=>window.fixture.toasts.push(a)};`,
  "@dvnt/app/lib/diagnostics/app-trace": `export const AppTrace={trace:()=>{},error:()=>{},warn:()=>{}};`,
  "@stripe/stripe-js": `export const loadStripe=async()=>({});`,
  "@stripe/react-stripe-js": `const elements={submit:()=>window.boundary('submit',null,{})};const stripe={confirmPayment:args=>window.boundary('confirm',args,{})};export const Elements=({children,options})=><div data-payment-secret={options.clientSecret}>{children}</div>;export const PaymentElement=()=> <div data-payment-element/>;export const useElements=()=>elements;export const useStripe=()=>stripe;`,
  "@stripe/stripe-react-native": `export const initStripe=async()=>{};`,
  "@dvnt/app/lib/safe-native-modules": `const sdk={initPaymentSheet:args=>window.boundary('sheet-init',args,{}),presentPaymentSheet:()=>window.boundary('sheet-present',null,{})};export const useStripeSafe=()=>sdk;`,
  "@dvnt/app/lib/auth/identity": `export const requireBetterAuthToken=()=>window.boundary('token',null,'fixture-token');`,
  "@dvnt/app/lib/supabase/client": `export const supabase={functions:{invoke:(name,options)=>window.boundary(name,options,{data:{free:true,tickets:[{id:'fixture-ticket',qr_token:'not-a-real-ticket'}]},error:null})}};`,
  "solito/navigation": `const router={push:p=>window.navigate(p),replace:p=>window.navigate(p),back:()=>window.navigate('/event')};export const useRouter=()=>router;export const useSearchParams=()=>new URLSearchParams(window.fixture.search||'');`,
  "expo-router": `const router={replace:p=>window.fixture.navigation.push(p)};export const useRouter=()=>router;`,
  "@dvnt/app/lib/api/invoke-edge": `export async function invokeEdge(name,body){const value=name==='cart-create-hold'?{ok:true,cartId:body.cartId,holdExpiresAt:new Date(Date.now()+600000).toISOString()}:name==='cart-checkout'?{ok:true,cartId:body.cartId,paymentIntent:'pi_fixture_secret',ephemeralKey:'fixture',customer:'cus_fixture',paymentIntentId:'pi_fixture',clientSecret:'pi_fixture_secret',publishableKey:'pk_test_fixture',holdExpiresAt:new Date(Date.now()+600000).toISOString(),totals:{subtotalCents:3700,buyerFeeCents:293,discountCents:300,totalCents:3993,currency:'usd'}}:{};return window.boundary(name,body,{data:value,error:null});}`,
};
const entry = `
import React, {act} from 'react';import {createRoot} from 'react-dom/client';import {create} from 'zustand';
import {CheckoutReviewScreen} from './packages/app/features/events/checkout-review.web';
import {CheckoutSuccessScreen} from './packages/app/features/events/checkout-success.web';
import {useTicketCheckout} from './packages/app/lib/hooks/use-ticket-checkout';
import {useMixedCartCheckout} from './packages/app/lib/hooks/use-mixed-cart-checkout';
import {useCartStore} from '@dvnt/app/lib/stores/cart';
import {usePaymentsStore} from '@dvnt/app/lib/stores/payments-store';
import {useCheckoutPhoneStore} from '@dvnt/app/lib/stores/checkout-phone-store';
window.act=act;window.fixture={calls:[],toasts:[],navigation:[],gates:{},pending:{},responses:{}};
window.boundary=(name,payload,fallback)=>{const f=window.fixture;f.calls.push({name,payload});const result=f.responses[name]??fallback;if(f.gates[name])return new Promise((resolve,reject)=>{f.pending[name]={resolve,reject,result};});return Promise.resolve(result);};
window.release=(name,error)=>{const p=window.fixture.pending[name];delete window.fixture.gates[name];delete window.fixture.pending[name];error?p.reject(new Error(error)):p.resolve(p.result);};
const route=create(()=>({path:'/review',generation:0}));
window.navigate=p=>{window.fixture.navigation.push(p);route.setState({path:p});};
window.cart=useCartStore;window.payments=usePaymentsStore;window.phone=useCheckoutPhoneStore;
window.newCart=(quantity=2)=>{useCartStore.getState().startCart('1');useCartStore.getState().addLineItem('1',{category:'admission',tierId:'${TIER}',quantity,unitPriceCents:3000,metadata:{tierName:'General Admission'}});return useCartStore.getState().cart.cartId;};
window.showReview=()=>route.setState({path:'/review'});
window.showSuccess=cartId=>{window.fixture.search='cartId='+cartId;route.setState({path:'/status'});};
function Hooks(){window.ticket=useTicketCheckout();window.mixed=useMixedCartCheckout();return null;}
function App(){const r=route();return <><Hooks/>{r.path==='/review'?<CheckoutReviewScreen/>:r.path==='/status'?<CheckoutSuccessScreen/>:<div data-away>Away</div>}</>;}
window.newCart();const root=createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();const render=()=>root.render(<React.StrictMode><App/></React.StrictMode>);if(window.IS_REACT_ACT_ENVIRONMENT)act(render);else render();
`;
async function buildCheckoutFixture() {
  return esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, loader: "tsx" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    nodePaths: (process.env.NODE_PATH || "")
      .split(path.delimiter)
      .filter(Boolean),
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "test-boundaries",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (Object.hasOwn(boundaries, args.path))
              return { path: args.path, namespace: "boundary" };
            if (args.path.startsWith("@dvnt/app/")) {
              const stem = path.join(
                ROOT,
                "packages/app",
                args.path.slice("@dvnt/app/".length),
              );
              return {
                path: [stem, stem + ".ts", stem + ".tsx"].find(
                  (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
                ),
              };
            }
          });
          if (process.env.CHECKOUT_BASELINE_REF)
            build.onLoad(
              {
                filter:
                  /(checkout-review\.web\.tsx|use-ticket-checkout\.ts|use-mixed-cart-checkout\.ts)$/,
              },
              (args) => ({
                contents: execFileSync(
                  "git",
                  [
                    "show",
                    process.env.CHECKOUT_BASELINE_REF +
                      ":" +
                      path.relative(ROOT, args.path),
                  ],
                  { cwd: ROOT, encoding: "utf8" },
                ),
                loader: args.path.endsWith("tsx") ? "tsx" : "ts",
                resolveDir: path.dirname(args.path),
              }),
            );
          build.onLoad({ filter: /.*/, namespace: "boundary" }, (args) => ({
            contents: boundaries[args.path],
            loader: "tsx",
            resolveDir: ROOT,
          }));
        },
      },
    ],
  });
}
module.exports = { buildCheckoutFixture, TIER };
