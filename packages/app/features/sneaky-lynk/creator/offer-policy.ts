/**
 * Safe creator-offer eligibility contract. A plan never goes live because
 * someone entered a percentage in an admin form; signed approvals and a
 * bounded budget must be recorded explicitly.
 */
export interface CreatorOfferDecision {
  enabled: boolean;
  signedApprovalRef: string | null;
  approvedBy: string | null;
  processorApprovalRef: string | null;
  compensationPlanId: string | null;
  startsAt: string;
  endsAt: string;
  maxRedemptions: number;
  currentlyRedeemed: number;
}
export function canActivateCreatorOffer(p: CreatorOfferDecision): boolean {
  if(!p.enabled || !p.signedApprovalRef || !p.approvedBy ||
     !p.processorApprovalRef || !p.compensationPlanId) return false;
  const start=Date.parse(p.startsAt),end=Date.parse(p.endsAt);
  return Number.isFinite(start) && Number.isFinite(end) &&
    end>start && Number.isSafeInteger(p.maxRedemptions) &&
    p.maxRedemptions>0 && Number.isSafeInteger(p.currentlyRedeemed) &&
    p.currentlyRedeemed>=0 && p.currentlyRedeemed<p.maxRedemptions;
}
