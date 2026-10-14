import { PLANS } from "./plans.ts";
import type { Entitlements } from "./types.ts";

/** Presentation only: room creation still enforces admission on the server. */
export function lynkCreateSummary({ entitlements, isLoading, isError }: {
  entitlements: Entitlements;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return { title: "Your Lynk benefits", description: "Loading your membership benefits…", benefits: [] as string[] };
  if (isError) return { title: "Your Lynk benefits", description: "Membership benefits are temporarily unavailable. Your plan has not been changed.", benefits: [] as string[] };
  const plan = PLANS[entitlements.planKey];
  return {
    title: entitlements.planKey === "free" ? "Free Lynk access" : `${plan.name} · Lynk included`,
    description: entitlements.planKey === "free" ? "Host a room with your current free benefits." : "Your current membership includes these hosting benefits. No additional Lynk subscription is needed.",
    benefits: [
      entitlements.sessionMinutes === null ? "Unlimited session duration" : `${entitlements.sessionMinutes}-minute sessions`,
      `Up to ${entitlements.maxParticipants} people per room`,
      entitlements.monthlyHostSessions === null ? "No monthly hosting limit" : `${entitlements.monthlyHostSessions} hosting sessions per month`,
    ],
  };
}
