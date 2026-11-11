import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {View,Text,Pressable,Linking,ScrollView} from 'react-native';
import {useLocalSearchParams} from 'expo-router';
import {initStripe,useStripe} from '@stripe/stripe-react-native';
import {useAuthStore} from '@dvnt/app/lib/stores/auth-store';
import {createReplacementController,replacementMoney,type ReplacementPayment} from '@dvnt/app/lib/api/checkout-replacement';

function Payment({result,isCurrent}:{result:ReplacementPayment;isCurrent:()=>boolean}){
 const {initPaymentSheet,presentPaymentSheet}=useStripe();const flight=useRef(false);
 const [message,setMessage]=useState('Payment is not complete. Continue to review and confirm it.');
 const [locked,setLocked]=useState(false);
 async function pay(){
  if(flight.current||!isCurrent())return;flight.current=true;setLocked(true);
  try{
   if(result.payment.kind==='pending')return;
   if(result.payment.kind==='hosted'){await Linking.openURL(result.payment.url);if(isCurrent())setMessage('Check your order after finishing at Stripe. Opening checkout does not confirm payment.');return;}
   await initStripe({publishableKey:result.payment.publishable_key});if(!isCurrent())return;
   const init=await initPaymentSheet({merchantDisplayName:'DVNT',paymentIntentClientSecret:result.payment.client_secret,allowsDelayedPaymentMethods:true,returnURL:'dvnt://checkout/replacement-return'});
   if(!isCurrent())return;if(init.error){setMessage('Payment form unavailable. Resume this same payment later; do not start another purchase.');flight.current=false;setLocked(false);return;}
   const resultOfSheet=await presentPaymentSheet();if(!isCurrent())return;
   if(resultOfSheet.error?.code==='Canceled'){setMessage('Payment confirmation was closed. You can reopen this same payment.');flight.current=false;setLocked(false);return;}
   setMessage(resultOfSheet.error?'Payment outcome needs verification. Check your order or contact support. Do not start another purchase.':'Confirming payment and fulfillment. Check My Tickets for your order.');
  }catch{if(isCurrent())setMessage('Payment outcome is unknown. Check your order or contact support. Do not start another purchase.');}
 }
 if(result.payment.kind==='pending')return <Text className="text-foreground">Your existing replacement is being checked. Do not pay again. Check My Tickets or your original email.</Text>;
 return <View className="gap-4 p-4"><Text className="text-foreground">{message}</Text><Pressable className="rounded-xl bg-card p-4" accessibilityRole="button" disabled={locked} onPress={()=>void pay()}><Text className="text-foreground">Continue to secure payment</Text></Pressable></View>;
}
export default function CheckoutReplacementScreen(){
 const params=useLocalSearchParams<{order_id?:string}>();const orderId=typeof params.order_id==='string'?params.order_id:'';
 const actor=useAuthStore(s=>s.user?.id||'');const enabled=process.env.EXPO_PUBLIC_CHECKOUT_REPLACEMENT_ENABLED==='true';
 const key=actor+'|'+orderId;const live=useRef({key,mounted:true,epoch:0});if(live.current.key!==key){live.current.key=key;live.current.epoch++;}const generation=live.current.epoch;
 const controller=useMemo(()=>createReplacementController({identity:{kind:'member',actor},orderId,isCurrent:()=>live.current.mounted&&live.current.epoch===generation&&live.current.key===key&&!!actor}),[key,generation]);
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 useEffect(()=>{live.current.mounted=true;return()=>{live.current.mounted=false;};},[]);
 if(!enabled)return <View className="gap-4 p-4"><Text className="text-foreground">Checkout replacement unavailable</Text><Text className="text-foreground">Check your existing order or contact support. Do not start another purchase while its outcome is unknown.</Text></View>;
 if(!actor)return <View className="gap-4 p-4"><Text className="text-foreground">Sign in as the original buyer</Text><Text className="text-foreground">For guest orders, use the recovery link in a signed-out browser.</Text><Pressable className="rounded-xl bg-card p-4" onPress={()=>void Linking.openURL('https://dvntapp.live/checkout/recovery')}><Text className="text-foreground">Recover a guest checkout</Text></Pressable></View>;
 const quote=state.quote;
 return <ScrollView className="flex-1 bg-background" contentContainerStyle={{padding:20,gap:16}}><Text className="text-foreground text-xl font-bold" accessibilityRole="header">Review replacement checkout</Text><Text className="text-foreground">Your original order is kept unchanged. Canceled payment must be verified before replacement.</Text>{state.message&&<Text className="text-foreground text-xl font-bold" accessibilityRole="alert">{state.message}</Text>}
 {['idle','quoted'].includes(state.phase)&&!quote?.resume_only&&<Pressable className="rounded-xl bg-card p-4" accessibilityRole="button" onPress={()=>void controller.review()}><Text className="text-foreground">Review current price and availability</Text></Pressable>}
 {quote&&<View className="gap-4 p-4"><Text className="text-foreground">{quote.resume_only?'Existing replacement total: ':'Replacement total: '}{replacementMoney(quote.total_cents,quote.currency)}</Text>{!quote.resume_only&&quote.total_cents!==quote.previous_total_cents&&<Text className="text-foreground">The total changed from {replacementMoney(quote.previous_total_cents,quote.currency)}. Review the new amount before accepting.</Text>}{quote.lines?.map((line,i)=><Text className="text-foreground" key={i}>{line.name} × {line.quantity}: {replacementMoney(line.unit_price_cents,quote.currency)} each</Text>)}{quote.tax_mode==='at_checkout'&&<Text className="text-foreground">This is the base total. Tax is calculated at Stripe checkout. Review and confirm the final amount there before payment.</Text>}<Text className="text-foreground">Unpaid replacements may be canceled after 60 minutes. A timeout does not mean payment failed; check this order before trying again.</Text>{quote.resume_only?<Text className="text-foreground">This quote was already accepted. Continue only this existing replacement; no new checkout will be created.</Text>:<Text className="text-foreground">Quote expires {new Date(quote.expires_at).toLocaleString()}.</Text>}{state.phase==='quoted'&&<Pressable className="rounded-xl bg-card p-4" accessibilityRole="button" onPress={()=>void controller.accept()}><Text className="text-foreground">{quote.resume_only?'Continue existing replacement':`Accept ${replacementMoney(quote.total_cents,quote.currency)}${quote.tax_mode==='at_checkout'?' before tax':''} and continue`}</Text></Pressable>}</View>}
 {state.phase==='unknown'&&<Pressable className="rounded-xl bg-card p-4" accessibilityRole="button" onPress={()=>void controller.accept()}><Text className="text-foreground">Resume this same request</Text></Pressable>}
 {['reviewing','accepting'].includes(state.phase)&&<Text className="text-foreground">Checking…</Text>}
 {state.phase==='payment'&&state.payment&&<Payment key={state.payment.order_id} result={state.payment} isCurrent={()=>live.current.mounted&&live.current.epoch===generation&&live.current.key===key}/>}
 </ScrollView>;
}
