import { useEffect,useRef,useState } from "react";
import { Modal,View,Text,Pressable,AppState } from "react-native";
import { usePathname,useRouter } from "expo-router";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { checkPayoutSetupReminder,type PayoutSetupReminderResponse } from "@dvnt/app/lib/api/payout-setup-reminder";
import { fetchNewMemberProgress } from "@dvnt/app/lib/profile/new-member-progress";
import { payoutReminderAllowed,payoutPromptCopy } from "@dvnt/app/lib/payments/payout-reminder-policy";
import { Button } from "@dvnt/app/components/ui/button";

const shown=new Set<string>();
export function PayoutSetupReminderNative(){
  const path=usePathname()||"/";
  const router=useRouter();
  const user=useAuthStore(s=>s.user);
  const authenticated=useAuthStore(s=>s.isAuthenticated);
  const hydrated=useAuthStore(s=>s._hasHydrated);
  const id=user?.authId||String(user?.id||"");
  const [reminder,setReminder]=useState<PayoutSetupReminderResponse|null>(null);
  const [visible,setVisible]=useState(false);
  const [revision,setRevision]=useState(0);
  const checked=useRef<string|null>(null);
  const normalized=path.startsWith("/feed")?path:`/feed${path==='/'?'':path}`;
  const permitted=payoutReminderAllowed(normalized);
  const key=`dvnt:payout-reminder:v1:${id}`;
  useEffect(()=>{
    const sub=AppState.addEventListener("change",state=>{if(state==="active")setRevision(n=>n+1);});
    return()=>sub.remove();
  },[]);
  useEffect(()=>{
    if(!authenticated||!hydrated||!id||!permitted){setVisible(false);return;}
    if(shown.has(key)||checked.current===key)return;
    let cancelled=false;checked.current=key;
    void (async()=>{
      try{
        const progress=await fetchNewMemberProgress();
        if(cancelled||progress.required)return;
        const result=await checkPayoutSetupReminder();
        if(cancelled||!result.eligible||!result.needsSetup||!result.route)return;
        setReminder(result);setVisible(true);
      }catch{checked.current=null;}
    })();
    return()=>{cancelled=true;};
  },[authenticated,hydrated,id,key,permitted,revision]);
  const close=()=>{setVisible(false);shown.add(key);};
  const setup=()=>{
    const route=reminder?.route||"";
    let path:string|null=null;
    if(reminder?.role==="organizer"&&route==="/feed/events/organizer-setup")path="/(protected)/events/organizer-setup";
    const promoter=/^\/feed\/events\/([1-9][0-9]*)\/promoter$/.exec(route);
    if(reminder?.role==="promoter"&&promoter)path=`/(protected)/events/${promoter[1]}/promoter`;
    if(!path)return;
    close();router.push(path as any);
  };
  if(!permitted||!authenticated||!reminder?.needsSetup)return null;
  const copy=payoutPromptCopy(reminder.state);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
    <View style={{flex:1,backgroundColor:"rgba(0,0,0,.78)",justifyContent:"center",padding:24}}>
      <View style={{backgroundColor:"#100D18",borderRadius:22,borderWidth:1,borderColor:"#ffffff26",padding:22,gap:15}}>
        <Text accessibilityRole="header" style={{color:"#3FDCFF",fontWeight:"700",letterSpacing:2,fontSize:12}}>DVNT · PAYOUTS</Text>
        <Text style={{fontWeight:"800",color:"#FFFFFF",fontSize:24}}>{copy.title}</Text>
        <Text style={{color:"#C5BECF",fontSize:15,lineHeight:23}}>{copy.message}</Text>
        <Button onPress={setup}>{copy.action}</Button>
        <Pressable accessibilityRole="button" accessibilityLabel="Remind me later" onPress={close} style={{minHeight:44,justifyContent:"center",alignItems:"center"}}>
          <Text style={{color:"#B8AEC7",fontWeight:"600"}}>Remind me later</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}
