"use client";
import { useEffect,useRef,useState } from "react";
import { usePathname,useRouter } from "next/navigation";
import { Wallet,ArrowUpRight } from "lucide-react";
import { Dialog } from "@dvnt/ui";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVerifiedOnlyPromptStore } from "@dvnt/app/lib/auth/verified-only-prompt";
import { fetchNewMemberProgress } from "@dvnt/app/lib/profile/new-member-progress";
import { checkPayoutSetupReminder,type PayoutSetupReminderResponse } from "@dvnt/app/lib/api/payout-setup-reminder";
import { payoutReminderAllowed,payoutPromptCopy } from "@dvnt/app/lib/payments/payout-reminder-policy";

// A reminder can be dismissed for the current tab; a future session will
// re-evaluate fresh Stripe status, including accounts created after launch.
const shown=new Set<string>();
export function PayoutSetupReminder(){
  const path=usePathname()||"";
  const router=useRouter();
  const authenticated=useAuthStore(s=>s.isAuthenticated);
  const hydrated=useAuthStore(s=>s._hasHydrated);
  const member=useAuthStore(s=>s.user);
  const verifying=useVerifiedOnlyPromptStore(s=>s.open);
  const [prompt,setPrompt]=useState<PayoutSetupReminderResponse|null>(null);
  const [open,setOpen]=useState(false);
  const checked=useRef<string|null>(null);
  const id=member?.authId||String(member?.id||"");
  const eligiblePath=payoutReminderAllowed(path);
  const key=`dvnt:payout-reminder:v1:${id}`;

  useEffect(()=>{
    if(!authenticated||!hydrated||!id||!eligiblePath||verifying){setOpen(false);return;}
    if(shown.has(key)||checked.current===key)return;
    try{if(sessionStorage.getItem(key)==='dismissed'){shown.add(key);return;}}catch{}
    let cancelled=false;
    checked.current=key;
    void (async()=>{
      try{
        const admission=await fetchNewMemberProgress();
        if(cancelled||admission.required)return;
        const status=await checkPayoutSetupReminder();
        if(cancelled||!status.eligible||!status.needsSetup||!status.route)return;
        // Avoid overlaying the mandatory profile gate or another modal.
        if(document.querySelector('[data-testid="profile-completion-popup"]')){checked.current=null;return;}
        setPrompt(status);
        setOpen(true);
      }catch{
        // A failed Stripe status read never becomes a false accusation.
        checked.current=null;
      }
    })();
    return()=>{cancelled=true;};
  },[authenticated,hydrated,id,key,eligiblePath,verifying,path]);
  const close=()=>{
    setOpen(false);
    shown.add(key);
    try{sessionStorage.setItem(key,'dismissed');}catch{}
  };
  const navigate=()=>{
    const route=prompt?.route;
    if(!route||!(/^\/feed\/events\/organizer-setup$/.test(route)||/^\/feed\/events\/[1-9][0-9]*\/promoter$/.test(route)))return;
    close();
    router.push(route);
  };
  if(!authenticated||!hydrated||!eligiblePath||verifying||!prompt?.needsSetup)return null;
  const copy=payoutPromptCopy(prompt.state);
  return <Dialog open={open} onClose={close} maxWidth={460} hideClose>
    <div data-testid="payout-setup-reminder" className="flex flex-col gap-5 py-2 text-white">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#3FDCFF]/25 bg-[#3FDCFF]/10"><Wallet size={25} color="#3FDCFF" aria-hidden="true"/></div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[.19em] text-[#3FDCFF]">DVNT · Payouts</p>
        <h2 className="text-2xl font-bold leading-tight">{copy.title}</h2>
        <p className="text-sm leading-6 text-white/70">{copy.message}</p>
      </div>
      <button type="button" onClick={navigate} className="flex min-h-12 items-center justify-between rounded-xl bg-[#3FDCFF] px-4 py-3 text-left font-semibold text-[#06070d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        <span>{copy.action}</span><ArrowUpRight size={20} aria-hidden="true"/>
      </button>
      <button type="button" onClick={close} className="min-h-11 rounded-xl px-3 py-2 text-sm font-medium text-white/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Remind me later</button>
      <p className="text-center text-xs text-white/45">We’ll remind you on a later visit if Stripe still needs your information.</p>
    </div>
  </Dialog>;
}
