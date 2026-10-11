"use client";
import dynamic from "next/dynamic";

// Do not send Stripe-status and Dialog code to every unauthenticated visitor.
const Reminder=dynamic(()=>import("./payout-setup-reminder").then(m=>m.PayoutSetupReminder),{ssr:false});
export function PayoutSetupReminderHost(){return <Reminder/>;}
