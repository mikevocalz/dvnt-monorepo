// Historical scope from closed PR #28. Not human identities.
// The registry is inert; no account is created and no post is published.
export const DVNT_EDITORIAL_CHANNELS = [
  {slug:"hot-guys",name:"Hot Guys",category:"lifestyle"},
  {slug:"hot-girls",name:"Hot Girls",category:"lifestyle"},
  {slug:"black-queer-art",name:"Black Queer Art / Artistic Nudes",category:"art"},
  {slug:"astrology",name:"Astrology",category:"entertainment"},
  {slug:"supernatural-nature",name:"Supernatural Nature",category:"art"},
  {slug:"comics-gaming",name:"Comics & Gaming",category:"culture"},
  {slug:"black-queer-history",name:"Black Queer History",category:"history"},
  {slug:"black-queer-media",name:"Black Queer Media",category:"culture"},
  {slug:"headline-news",name:"Headline News",category:"news"},
  {slug:"cars-architecture-travel",name:"Cars / Architecture / Travel",category:"lifestyle"},
] as const;
export const EDITORIAL_DISCLOSURE="DVNT Editorial · AI-assisted";
export type EditorialStage="draft"|"review"|"approved"|"scheduled"|"published"|"paused"|"rejected";
export interface EditorialReviewGate {
 stage: EditorialStage;
 hasApprovedModerator: boolean;
 hasProvenance: boolean;
 agePolicyCleared: boolean;
 channelEnabled: boolean;
 publishAt?: string|null;
}
export function canPublishEditorial(v: EditorialReviewGate): boolean {
  // Enabling an editorial profile alone never publishes drafts or simulates
  // human engagement. Scheduled posts need human approval + valid source policy.
  return v.stage==="scheduled" &&
   v.hasApprovedModerator && v.hasProvenance && v.agePolicyCleared &&
   v.channelEnabled && Boolean(v.publishAt && Date.parse(v.publishAt)>0);
}
export function canAutoEngageEditorial(_channelSlug: string): false {
  // Disabled until explicit approved policy, audit and opt-out controls exist.
  return false;
}
