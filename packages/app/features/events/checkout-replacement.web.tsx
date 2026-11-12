'use client';
import { takeRecoveryCapability } from '@dvnt/observability/recovery-privacy';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'solito/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';
import { createReplacementController, replacementMoney, type ReplacementPayment } from '@dvnt/app/lib/api/checkout-replacement';

function PaymentForm({result,isCurrent}:{result:ReplacementPayment;isCurrent:()=>boolean}) {
  const stripe=useStripe(),elements=useElements(),busy=useRef(false);
  const [message,setMessage]=useState('Payment is not complete. Confirm below to pay for this replacement.');
  const [locked,setLocked]=useState(false);
  async function pay(){
    if(!stripe||!elements||busy.current||!isCurrent())return;
    busy.current=true;setLocked(true);
    try {
      const submission=await elements.submit();
      if(!isCurrent())return;
      if(submission.error){setMessage('Check your payment details before continuing.');busy.current=false;setLocked(false);return;}
      const response=await stripe.confirmPayment({elements,redirect:'if_required',confirmParams:{return_url:window.location.origin+'/checkout/replacement-return?orderId='+encodeURIComponent(result.order_id)}});
      if(!isCurrent())return;
      setMessage(response.error?'Payment needs verification. Do not start another purchase. Check your order or contact support.':'Confirming payment and fulfillment. Check My Tickets for your order.');
    } catch {if(isCurrent())setMessage('Payment outcome is unknown. Do not start another purchase. Check your order or contact support.');}
  }
  return <div><PaymentElement/><p role="status">{message}</p><button className="rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-black disabled:opacity-50" disabled={!stripe||locked} onClick={()=>void pay()}>Confirm payment</button></div>;
}
function Payment({result,isCurrent}:{result:ReplacementPayment;isCurrent:()=>boolean}) {
  const key=result.payment.kind==='payment_sheet'?result.payment.publishable_key:null;
  const stripe=useMemo(()=>key?loadStripe(key):null,[key]);
  if(result.payment.kind==='pending')return <p>Your existing replacement is being checked. Do not pay again. Check My Tickets or your original email.</p>;
  if(result.payment.kind==='hosted')return <div><p>Continue to Stripe to review the final total and confirm payment. Your order is not paid yet.</p><button className="rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-black disabled:opacity-50" onClick={()=>{if(isCurrent()&&result.payment.kind==='hosted')window.location.assign(result.payment.url);}}>Continue to secure payment</button></div>;
  return <Elements stripe={stripe} options={{clientSecret:result.payment.client_secret}}><PaymentForm result={result} isCurrent={isCurrent}/></Elements>;
}
export function CheckoutReplacementScreen({recovery=false}:{recovery?:boolean}) {
  const params=useSearchParams();const orderId=params?.get('order_id')||'';
  const actor=useAuthStore(s=>s.user?.id||'');
  const enabled=process.env.NEXT_PUBLIC_CHECKOUT_REPLACEMENT_ENABLED==='true';
  // Capture and remove the fragment even when the feature is unavailable.
  // Exchange is explicit: merely opening an email link never consumes it.
  const token=useRef<string|null>(null),captured=useRef(false);
  const [hasToken,setHasToken]=useState(false);
  const [email,setEmail]=useState(''),[requestOrder,setRequestOrder]=useState('');
  const identityKey=actor+'|'+orderId+'|'+String(recovery);
  const live=useRef({key:identityKey,mounted:true,epoch:0});
  if(live.current.key!==identityKey){live.current.key=identityKey;live.current.epoch++;}
  const generation=live.current.epoch;
  const controller=useMemo(()=>createReplacementController({identity:recovery?{kind:'guest'}:{kind:'member',actor},orderId,
    isCurrent:()=>live.current.mounted&&live.current.epoch===generation&&live.current.key===identityKey&&(!recovery||!actor)}),[identityKey,generation]);
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  useEffect(()=>{live.current.mounted=true;return()=>{live.current.mounted=false;};},[]);
  useEffect(()=>{
    if(!recovery||captured.current)return;captured.current=true;
    const candidate=takeRecoveryCapability();
    if(!actor&&candidate&&/^[a-f0-9]{64}$/.test(candidate)){token.current=candidate;setHasToken(true);}
  },[recovery,actor]);
  useEffect(()=>{if(actor){token.current=null;setHasToken(false);}},[actor]);
  const current=()=>live.current.mounted&&live.current.epoch===generation&&live.current.key===identityKey&&(!recovery||!actor);
  if(!enabled)return <main className="mx-auto max-w-xl space-y-4 p-6"><h1>Checkout replacement unavailable</h1><p>Check your existing order or contact support. Do not start another purchase while its outcome is unknown.</p></main>;
  if(recovery&&actor)return <main className="mx-auto max-w-xl space-y-4 p-6"><h1>Use the original guest session</h1><p>Open the recovery link in a signed-out browser. A member account cannot replace a guest order.</p></main>;
  if(!recovery&&!actor)return <main className="mx-auto max-w-xl space-y-4 p-6"><h1>Sign in as the original buyer</h1><p>Guest buyers can recover their order through the email link.</p><a href="/checkout/recovery">Recover a guest checkout</a></main>;
  const busy=['recovering','reviewing','accepting'].includes(state.phase);
  const quote=state.quote;
  return <main className="mx-auto max-w-xl space-y-4 p-6"><h1>Review replacement checkout</h1><p>Your original order is kept unchanged. A replacement is available only after its canceled payment is verified.</p>
    {state.message&&<p role="status">{state.message}</p>}
    {recovery&&!state.recovered&&<section>{hasToken?<button className="rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-black disabled:opacity-50" disabled={busy} onClick={()=>{const t=token.current;token.current=null;setHasToken(false);if(t)void controller.exchange(t);}}>Recover this guest order</button>:<form onSubmit={e=>{e.preventDefault();void controller.request(requestOrder,email);}}><label>Original order reference<input className="my-2 block w-full rounded-lg border border-white/20 bg-black p-3 text-white" value={requestOrder} onChange={e=>setRequestOrder(e.target.value)} autoComplete="off"/></label><label>Email used for this order<input className="my-2 block w-full rounded-lg border border-white/20 bg-black p-3 text-white" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></label><button className="rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-black disabled:opacity-50" disabled={busy}>Send recovery link</button></form>}</section>}
    {(!recovery||state.recovered)&&['idle','quoted'].includes(state.phase)&&!quote?.resume_only&&<button className="rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-black disabled:opacity-50" disabled={busy} onClick={()=>void controller.review()}>Review current price and availability</button>}
    {quote&&<section><h2>{quote.resume_only?'Existing replacement total: ':'Replacement total: '}{replacementMoney(quote.total_cents,quote.currency)}</h2>{!quote.resume_only&&quote.total_cents!==quote.previous_total_cents&&<p role="alert">The total changed from {replacementMoney(quote.previous_total_cents,quote.currency)}. Review the new amount before accepting.</p>}{quote.lines?.map((line,i)=><p key={i}>{line.name} × {line.quantity}: {replacementMoney(line.unit_price_cents,quote.currency)} each</p>)}{quote.tax_mode==='at_checkout'&&<p>This is the base total. Tax is calculated at Stripe checkout, where you must review and confirm the final amount before payment.</p>}<p>Unpaid replacements may be canceled after 60 minutes. A timeout does not mean payment failed; check this order before trying again.</p>{quote.resume_only?<p>This quote was already accepted. Continue only this existing replacement; no new checkout will be created.</p>:<p>Quote expires {new Date(quote.expires_at).toLocaleString()}.</p>}{state.phase==='quoted'&&<button className="rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-black disabled:opacity-50" onClick={()=>void controller.accept()}>{quote.resume_only?'Continue existing replacement':`Accept ${replacementMoney(quote.total_cents,quote.currency)}${quote.tax_mode==='at_checkout'?' before tax':''} and continue`}</button>}</section>}
    {state.phase==='unknown'&&<button className="rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-black disabled:opacity-50" onClick={()=>void controller.accept()}>Resume this same request</button>}
    {busy&&<p role="status">{state.phase==='accepting'?'Saving your accepted quote…':'Checking…'}</p>}
    {state.phase==='payment'&&state.payment&&<Payment key={state.payment.order_id} result={state.payment} isCurrent={current}/>}
    <a href="/feed/events/my-tickets">Check My Tickets</a>
  </main>;
}
export default CheckoutReplacementScreen;
