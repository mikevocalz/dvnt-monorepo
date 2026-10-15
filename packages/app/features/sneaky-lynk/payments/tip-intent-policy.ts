/** No payments are made by this function. Processor approval is mandatory. */
export interface TipServerPolicy {
  processorApproved: boolean;
  verifiedAdult: boolean;
  inLiveRoom: boolean;
  creatorPayoutsEnabled: boolean;
  minCents: number;
  maxCents: number;
}
export interface TipDraft {
  amountCents: number;
  recipientHandle: string;
  operationId: string;
}
export type TipDecision = { allowed: true } | { allowed: false; reason: string };
export function decideTipDraft(policy: TipServerPolicy, draft: TipDraft): TipDecision {
  if (!policy.processorApproved) return {allowed:false,reason:"processor_not_approved"};
  if (!policy.verifiedAdult || !policy.inLiveRoom)
    return {allowed:false,reason:"admission_required"};
  if (!policy.creatorPayoutsEnabled)
    return {allowed:false,reason:"recipient_payout_unavailable"};
  if (!draft.recipientHandle || draft.recipientHandle.length > 128 ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(draft.operationId) ||
      !Number.isSafeInteger(draft.amountCents) ||
      !Number.isSafeInteger(policy.minCents) ||
      !Number.isSafeInteger(policy.maxCents) ||
      policy.minCents < 1 || policy.maxCents < policy.minCents)
    return {allowed:false,reason:"invalid_request"};
  if (draft.amountCents < policy.minCents || draft.amountCents > policy.maxCents)
    return {allowed:false,reason:"out_of_range"};
  return {allowed:true};
}
