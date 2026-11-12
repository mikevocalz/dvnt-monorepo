#!/usr/bin/env node
/** Actual web/native screens + shared hook, offline API and native host boundaries. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const deps = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const resolve = name => require.resolve(name, { paths: [ROOT, ...deps] });
const { build } = require(resolve('esbuild'));
const fixtures = {
  'fixture': `import {create} from 'zustand';
    export const route=create(()=>({id:'42'}));export const auth=create(()=>({user:{id:'member'},isAuthenticated:true}));
    export const state={me:null,status:null,calls:[],toasts:[],failMe:false,failStatus:false,deferMe:false,deferStart:false,releases:[],browser:[],close:null};
    export const router={back(){state.calls.push(['back'])}};`,
  'next/navigation': `import {route,router} from 'fixture';export const useParams=()=>route();export const useRouter=()=>router;`,
  'expo-router': `import {route,router} from 'fixture';export const useLocalSearchParams=()=>route();export const useRouter=()=>router;`,
  '@dvnt/app/lib/stores/auth-store': `export {auth as useAuthStore} from 'fixture';`,
  '@dvnt/app/lib/stores/ui-store': `import {state} from 'fixture';const ui={showToast:(...args)=>state.toasts.push(args)};export const useUIStore=select=>select(ui);`,
  '@dvnt/app/lib/api/promoters': `import {state,auth} from 'fixture';export const promotersApi={
    me:async id=>{state.calls.push(['me',id,auth.getState().user.id]);const result=state.me;if(state.deferMe)await new Promise(r=>state.releases.push(r));if(state.failMe)throw Error('Summary unavailable');return result;},
    connectStatus:async id=>{state.calls.push(['status',id]);if(state.failStatus)throw Error('Stripe unavailable');return state.status;},
    connectStart:async (id,platform)=>{state.calls.push(['start',id,platform]);if(state.deferStart)await new Promise(r=>state.releases.push(r));return {url:'https://connect.stripe.com/setup/test',accountId:'acct_test'};}
  };`,
  '@dvnt/app/lib/stripe/fee-calculator': `export const formatCents=c=>'$'+(c/100).toFixed(2);`,
  'expo-web-browser': `import {state} from 'fixture';export const openAuthSessionAsync=(...args)=>{state.browser.push(args);return new Promise(r=>state.close=r);};`,
  'react-native': `export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const ScrollView=View;export const Pressable=({children,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{children}</button>;export const ActivityIndicator=()=> <span>Loading</span>;export const StyleSheet={create:s=>s};`,
  'react-native-safe-area-context': `export const SafeAreaView=({children})=><div>{children}</div>;`,
};
fixtures['lucide-react'] = fixtures['lucide-react-native'] = ['Megaphone','ArrowLeft','Wallet','AlertCircle'].map(n=>`export const ${n}=()=>null;`).join('\n');
const entry = `import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {state,route,auth} from 'fixture';import Web from './packages/app/features/events/promoter-self.web';import Native from './packages/app/features/routes/screens/(protected)/events/[id]/promoter';
export {act,state,route,auth};export const mount=(node,platform)=>{const client=new QueryClient({defaultOptions:{queries:{retryDelay:0,gcTime:0},mutations:{retry:0}}});const root=createRoot(node);return {client,render:()=>root.render(<React.StrictMode><QueryClientProvider client={client}>{platform==='web'?<Web/>:<Native/>}</QueryClientProvider></React.StrictMode>),unmount:()=>{root.unmount();client.clear();}};};`;
(async () => {
  const { Window } = await import(resolve('happy-dom'));
  const window = new Window({url:'https://fixture.invalid/feed/events/42/promoter'});
  Object.assign(global, { window, document:window.document, HTMLElement:window.HTMLElement, IS_REACT_ACT_ENVIRONMENT:true });
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'promoter-payout-ui-'));
  let count=0;
  try {
    await build({stdin:{contents:entry,resolveDir:ROOT,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:path.join(dir,'test.cjs'),nodePaths:deps,tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},
      alias:Object.fromEntries(['react','react-dom','zustand','@tanstack/react-query'].map(n=>[n,path.dirname(resolve(n+'/package.json'))])),
      plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>{if(Object.hasOwn(fixtures,a.path))return {path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/')){const stem=path.join(ROOT,'packages/app',a.path.slice(10));for(const suffix of ['','.ts','.tsx'])if(fs.existsSync(stem+suffix))return {path:stem+suffix};}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:ROOT}));}}]});
    const f=require(path.join(dir,'test.cjs'));
    const flush=fn=>f.act(async()=>{await fn?.();await new Promise(r=>setTimeout(r,10));});
    const ready={connected:true,detailsSubmitted:true,payoutsEnabled:true,transfersEnabled:true};
    const payout={settledCents:100,unsettledCents:200,heldCents:0,hasRecordedTransfer:true,status:'pending'};
    const me=()=>({isPromoter:true,promoter:{id:'promoter',code:'EXAMPLE',customerDiscountBps:500,promoterCommissionBps:1500,attributedOrders:3,earnedCents:300,connect:{},payoutScope:"legacy",payout:{...payout}}});
    const btn=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
    const reset=()=>{f.route.setState({id:'42'});f.auth.setState({user:{id:'member'},isAuthenticated:true});Object.assign(f.state,{me:me(),status:ready,calls:[],toasts:[],failMe:false,failStatus:false,deferMe:false,deferStart:false,releases:[],browser:[],close:null});window.history.replaceState(null,'','/feed/events/42/promoter');};
    const scenario=async(platform,label,run)=>{reset();const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);try{await run(app,node);console.log(`ok ${++count} - ${platform}: ${label}`);}finally{f.state.releases.splice(0).forEach(r=>r());f.state.close?.({type:'cancel'});await flush(()=>app.unmount());node.remove();}};
    for(const platform of ['web','native']) {
      await scenario(platform,'ready setup is separate from earnings, settlement, and bank delivery',async(app,node)=>{
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Payout setup complete/);assert.match(node.textContent,/Awaiting settlement/);
        assert.match(node.textContent,/Settled in ledger/);assert.match(node.textContent,/Bank deposit status is not available/);
        assert.doesNotMatch(node.textContent,/Connected — payouts enabled|paid to your bank/i);
      });
      await scenario(platform,'verified empty new-ledger summary preserves legacy pending earnings',async(app,node)=>{
        f.state.me.promoter.settlement={verified:true,rows:[]};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Legacy commission status/);assert.match(node.textContent,/Awaiting settlement/);
        assert.match(node.textContent,/\$2\.00/);assert.match(node.textContent,/No tracked settlement transfers yet/);
      });
      await scenario(platform,'mixed legacy and new settlements stay disjoint with gross and bank net labels',async(app,node)=>{
        f.state.me.promoter.settlement={verified:true,rows:[{recipient_role:'promoter',currency:'usd',stage:'bank_paid',amount_cents:900,allocation_count:1,bank_net_contribution_cents:850}]};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Legacy commission status/);assert.match(node.textContent,/\$2\.00/);
        assert.match(node.textContent,/Tracked payment status/);assert.match(node.textContent,/9\.00 USD gross/);
        assert.match(node.textContent,/verified bank contribution 8\.50 USD/);assert.doesNotMatch(node.textContent,/\$11\.00/);
      });
      await scenario(platform,'new-only settlement does not claim there are no commissions',async(app,node)=>{
        f.state.me.promoter.payout={settledCents:0,unsettledCents:0,heldCents:0,hasRecordedTransfer:false,status:'no_earnings'};
        f.state.me.promoter.settlement={verified:true,rows:[{recipient_role:'promoter',currency:'usd',stage:'awaiting_settlement',amount_cents:900,allocation_count:1}]};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/No legacy commissions/);assert.doesNotMatch(node.textContent,/No commissions yet/);
        assert.match(node.textContent,/9\.00 USD/);
      });
      await scenario(platform,'older unpartitioned API response cannot display overlapping mixed totals',async(app,node)=>{
        delete f.state.me.promoter.payoutScope;
        f.state.me.promoter.settlement={verified:true,rows:[{recipient_role:'promoter',currency:'usd',stage:'awaiting_settlement',amount_cents:900,allocation_count:1}]};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Commission status unavailable/);assert.doesNotMatch(node.textContent,/Settled in ledger/);
      });
      await scenario(platform,'failed new-ledger summary preserves legacy and reports unverified bank status',async(app,node)=>{
        f.state.me.promoter.settlement={verified:false,rows:[]};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Bank payout status is not verified/);assert.match(node.textContent,/\$2\.00/);
      });
      await scenario(platform,'unknown partition never displays overlapping legacy totals',async(app,node)=>{
        f.state.me.promoter.payoutScope='unavailable';f.state.me.promoter.payout=null;
        f.state.me.promoter.settlement={verified:true,rows:[]};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Commission status unavailable/);assert.doesNotMatch(node.textContent,/Settled in ledger/);
        assert.match(node.textContent,/\$3\.00/);
      });
      await scenario(platform,'external legacy and new-model payments are distinct from remaining legacy dues',async(app,node)=>{
        f.state.me.promoter.settlement={verified:true,rows:[{recipient_role:'promoter',currency:'usd',stage:'paid_externally',amount_cents:900,allocation_count:2}]};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Paid externally \(receipt manually verified\): 9\.00 USD/);assert.match(node.textContent,/\$2\.00/);
        assert.doesNotMatch(node.textContent,/verified bank contribution/);
      });
      await scenario(platform,'external reversal and unsupported currency remain visible without USD fabrication',async(app,node)=>{
        f.state.me.promoter.earnedCents=null;f.state.me.promoter.payoutScope='unavailable';f.state.me.promoter.payout=null;
        f.state.me.promoter.settlement={verified:true,rows:[{recipient_role:'promoter',currency:'eur',stage:'external_needs_review',amount_cents:900,allocation_count:1}]};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Earnings unavailable in USD/);assert.match(node.textContent,/recovery needs review: 9\.00 EUR/);
        assert.match(node.textContent,/Commission status unavailable/);assert.doesNotMatch(node.textContent,/\$9\.00|\$0\.00/);
      });
      await scenario(platform,'former or reassigned promoter has history only and never starts onboarding',async(app,node)=>{
        f.state.me={isPromoter:false,paymentHistory:{verified:true,rows:[{recipient_role:'promoter',currency:'usd',stage:'paid_externally',amount_cents:1000,allocation_count:1}]}};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Your payment history/);assert.match(node.textContent,/10\.00 USD/);
        assert.doesNotMatch(node.textContent,/Your code|Payout setup|EXAMPLE/);assert.ok(!btn('Connect bank account'));
        assert.ok(!f.state.calls.some(c=>c[0]==='status'||c[0]==='start'));
        await flush(()=>btn('Refresh history').click());await flush();assert.ok(!f.state.calls.some(c=>c[0]==='status'||c[0]==='start'));
        f.state.me={isPromoter:false};await flush(()=>f.auth.setState({user:{id:'different'}}));await flush();await flush();
        assert.doesNotMatch(node.textContent,/10\.00 USD|Your payment history/);
      });
      await scenario(platform,'current reassigned promoter sees explicit unavailable totals rather than prior earnings',async(app,node)=>{
        f.state.me.promoter.earnedCents=null;f.state.me.promoter.attributedOrders=null;f.state.me.promoter.earningsScope='unverified_history';f.state.me.promoter.payoutScope='unavailable';f.state.me.promoter.payout=null;f.state.me.promoter.settlement={verified:true,rows:[]};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Historical total unavailable/);assert.match(node.textContent,/does not mean no earnings/);
        assert.doesNotMatch(node.textContent,/\$0\.00|\$3\.00|No legacy commissions/);
      });
      await scenario(platform,'reviewed legacy-only former history is currency-specific and never called paid',async(app,node)=>{
        f.state.me={isPromoter:false,legacyHistory:{verified:true,rows:[{recipient_role:'promoter',currency:'eur',stage:'legacy_ownership_verified',amount_cents:1200,allocation_count:1}]}};
        await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Reviewed legacy earnings: 12\.00 EUR/);assert.match(node.textContent,/Payment status is unverified/);
        assert.doesNotMatch(node.textContent,/bank_paid|Paid externally|Your code|Payout setup/);assert.ok(!f.state.calls.some(c=>c[0]==='status'||c[0]==='start'));
      });
      await scenario(platform,'changed reviewed legacy evidence withholds amounts and preserves review',async(app,node)=>{
        f.state.me.promoter.legacyHistory={verified:true,rows:[{recipient_role:'promoter',currency:'usd',stage:'legacy_ownership_needs_review',amount_cents:null,allocation_count:1}]};
        await flush(()=>app.render());await flush();await flush();assert.match(node.textContent,/history has changed and needs review; the amount is withheld/);
      });
      await scenario(platform,'summary failure has retry, never fabricated zero earnings',async(app,node)=>{
        f.state.failMe=true;await flush(()=>app.render());await flush();await flush();
        assert.match(node.textContent,/Couldn't load/);assert.ok(btn('Retry'));assert.doesNotMatch(node.textContent,/\$0\.00/);
        f.state.failMe=false;await flush(()=>btn('Retry').click());await flush();assert.match(node.textContent,/\$3\.00/);
      });
      await scenario(platform,'failed Stripe refresh hides previous ready status and retry recovers',async(app,node)=>{
        await flush(()=>app.render());await flush();await flush();f.state.failStatus=true;
        await flush(()=>btn('Refresh status').click());await flush();await flush();
        assert.match(node.textContent,/Payout setup status unavailable/);assert.doesNotMatch(node.textContent,/Payout setup complete/);
        f.state.failStatus=false;f.state.status={connected:true,currentlyDue:['identity']};
        await flush(()=>btn('Refresh status').click());await flush();assert.match(node.textContent,/Stripe needs more information/);assert.ok(btn('Continue Stripe setup'));
      });
      await scenario(platform,'held and unknown settlement remain distinct',async(app,node)=>{
        f.state.me.promoter.payout.status='held';await flush(()=>app.render());await flush();assert.match(node.textContent,/Awaiting payout review/);
        f.state.me=me();f.state.me.promoter.payout=null;await flush(()=>btn('Refresh status').click());await flush();
        assert.match(node.textContent,/Commission status unavailable/);assert.doesNotMatch(node.textContent,/Settled in ledger/);assert.match(node.textContent,/\$3\.00/);
      });
      await scenario(platform,'account switch cannot render another member cached earnings',async(app,node)=>{
        await flush(()=>app.render());await flush();f.state.deferMe=true;
        await flush(()=>f.auth.setState({user:{id:'other'}}));assert.doesNotMatch(node.textContent,/EXAMPLE|\$3\.00/);
        assert.ok(f.state.calls.some(c=>c[0]==='me'&&c[2]==='other'));
      });
      await scenario(platform,'invalid route suffix cannot load or onboard the wrong event',async(app,node)=>{
        f.route.setState({id:'42oops'});await flush(()=>app.render());assert.match(node.textContent,/Invalid event/);assert.equal(f.state.calls.length,0);
      });
      await scenario(platform,'late onboarding link cannot open after event change',async(app,node)=>{
        f.state.status={connected:false};f.state.deferStart=true;await flush(()=>app.render());await flush();await flush();
        await flush(()=>btn('Connect bank account').click());await flush(()=>f.route.setState({id:'43'}));
        await flush(()=>f.state.releases.splice(0).forEach(r=>r()));assert.equal(f.state.browser.length,0);assert.equal(window.location.hostname,'fixture.invalid');
      });
    }
    for (const platform of ['web','native']) {
      await scenario(platform,'unmount prevents a late Stripe onboarding navigation',async(app)=>{
        f.state.status={connected:false};f.state.deferStart=true;await flush(()=>app.render());await flush();await flush();
        await flush(()=>btn('Connect bank account').click());await flush(()=>app.unmount());
        await flush(()=>f.state.releases.splice(0).forEach(r=>r()));assert.equal(f.state.browser.length,0);assert.equal(window.location.hostname,'fixture.invalid');
      });
    }
    await scenario('native','double click opens once and cancel refreshes without false success',async(app,node)=>{
      f.state.status={connected:false};await flush(()=>app.render());await flush();await flush();
      await flush(()=>{btn('Connect bank account').click();btn('Connect bank account')?.click();});
      assert.equal(f.state.calls.filter(c=>c[0]==='start').length,1);assert.equal(f.state.browser.length,1);
      assert.equal(f.state.browser[0][1],'dvnt://stripe/connect');const before=f.state.calls.filter(c=>c[0]==='status').length;
      await flush(()=>f.state.close({type:'cancel'}));await flush();
      assert.ok(f.state.calls.filter(c=>c[0]==='status').length>before);assert.ok(btn('Connect bank account'));assert.doesNotMatch(node.textContent,/Payout setup complete/);
    });
    await scenario('web','return marker is consumed without claiming setup success',async(app,node)=>{
      window.history.replaceState({test:true},'','/feed/events/42/promoter?stripe_connect=return&keep=yes#section');f.state.status={connected:true,detailsSubmitted:true};
      await flush(()=>app.render());await flush();await flush();
      assert.equal(window.location.search,'?keep=yes');assert.equal(window.location.hash,'#section');assert.equal(window.history.state.test,true);
      assert.match(node.textContent,/Stripe review in progress/);assert.doesNotMatch(node.textContent,/Payout setup complete/);
    });
    console.log(`PASS: ${count} offline mounted payout scenarios; no live Stripe calls`);
  } finally { fs.rmSync(dir,{recursive:true,force:true});await window.happyDOM.abort(); }
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
