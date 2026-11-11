/** Provider errors retain only the one reviewed compatibility discriminator.
 * Never retain provider messages, request URLs, raw bodies or account details. */
export class SettlementProviderError extends Error {
 readonly status:number;
 readonly code:'v1_account_instead_of_v2_account'|null;
 constructor(status:number,code:unknown) {
  const safeStatus=Number.isInteger(status)&&status>=100&&status<=599?status:0;
  super(`Stripe request failed (${safeStatus})`);
  this.name='SettlementProviderError';this.status=safeStatus;
  this.code=code==='v1_account_instead_of_v2_account'?code:null;
 }
}
export type LegacyRecipientLimitation='identity'|'ownership'|'capability'|'requirements'|'bank'|'currency'|'mode';
export class LegacyRecipientError extends Error {
 readonly limitation:LegacyRecipientLimitation;
 constructor(limitation:LegacyRecipientLimitation) {
  super(`Legacy recipient binding proof incomplete: ${limitation}`);
  this.name='LegacyRecipientError';this.limitation=limitation;
 }
}
export type RecipientProof={kind:'v2'}|{kind:'legacy_v1_test';destination:string;currency:'usd';livemode:false};
interface RecipientReader {get(path:string,connectedAccount?:string):Promise<any>}

/** Existing v2 readiness and frozen-owner checks are intentionally unchanged. */
export function verifyRecipient(account:any,destination:string,allocation?:any) {
 if(account?.id!==destination||account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status!=='active') {
  throw new Error('Recipient transfer capability is not active');
 }
 if(allocation) {
  const owner=account.metadata?.dvnt_host_id||account.metadata?.dvnt_user_id;
  const matches=allocation.role==='organizer' ? owner===allocation.recipient_id :
   allocation.recipient_user_id!=null ? owner===allocation.recipient_user_id : account.metadata?.dvnt_promoter_id===allocation.recipient_id;
  if(!matches)throw new Error('Recipient account ownership does not match frozen identity');
 }
}
const present=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
function verifyLegacyOwner(account:any,allocation:any) {
 const metadata=account.metadata;
 if(!metadata||!allocation||!present(allocation.recipient_id)||!['organizer','promoter'].includes(allocation.role))
  throw new LegacyRecipientError('ownership');
 const owners=[metadata.dvnt_host_id,metadata.dvnt_user_id].filter(value=>value!==undefined);
 const expected=allocation.role==='organizer'?allocation.recipient_id:allocation.recipient_user_id;
 if(expected!=null) {
  if(!present(expected)||owners.length===0||owners.some(value=>value!==expected))throw new LegacyRecipientError('ownership');
 }else if(owners.length!==0||metadata.dvnt_promoter_id!==allocation.recipient_id)throw new LegacyRecipientError('ownership');
 if(allocation.role==='promoter'&&metadata.dvnt_promoter_id!==undefined&&metadata.dvnt_promoter_id!==allocation.recipient_id)
  throw new LegacyRecipientError('ownership');
}
/** A deliberately narrower, independent v1 proof. It does not synthesize v2
 * configuration or infer permission from charges_enabled. Missing fields are
 * unknown, never null/empty/ready. Only a complete US/USD test-mode case is in
 * scope; actual legacy GET/bank evidence and live support remain release gates. */
export function verifyLegacyRecipient(account:any,destination:string,allocation:any,currency:string) {
 if(!/^acct_[A-Za-z0-9_]+$/.test(destination)||account?.object!=='account'||account.id!==destination||account.deleted===true)
  throw new LegacyRecipientError('identity');
 verifyLegacyOwner(account,allocation);
 if(account.capabilities?.transfers!=='active')throw new LegacyRecipientError('capability');
 if(currency!=='usd'||account.default_currency!=='usd'||account.country!=='US')throw new LegacyRecipientError('currency');
 const requirements=account.requirements;
 if(!requirements||requirements.disabled_reason!==null||
  ['currently_due','past_due','pending_verification','errors'].some(key=>!Array.isArray(requirements[key])||requirements[key].length!==0))
  throw new LegacyRecipientError('requirements');
 const external=account.external_accounts;
 if(account.payouts_enabled!==true||account.details_submitted!==true||account.controller?.is_controller!==true||
  external?.object!=='list'||external.has_more!==false||!Array.isArray(external.data)||
  external.url!==`/v1/accounts/${destination}/external_accounts`)throw new LegacyRecipientError('bank');
 const defaults=external.data.filter((bank:any)=>bank?.currency===currency&&bank.default_for_currency===true);
 const bank=defaults[0];
 if(defaults.length!==1||bank.object!=='bank_account'||!/^ba_[A-Za-z0-9_]+$/.test(bank.id)||
  bank.account!==destination||bank.country!=='US'||bank.deleted===true||
  !Array.isArray(bank.available_payout_methods)||!bank.available_payout_methods.includes('standard')||bank.status!=='new')throw new LegacyRecipientError('bank');
}
export async function readRecipientProof(provider:RecipientReader,destination:string,allocation:any,currency:string):Promise<RecipientProof> {
 let account:any;
 try {
  account=await provider.get(`/v2/core/accounts/${encodeURIComponent(destination)}?include[0]=configuration.recipient`);
 }catch(error) {
  // Only this typed HTTP 400 response to this exact v2 retrieve may select v1.
  // Capability/ownership validation is outside this catch. No retry or list.
  if(!(error instanceof SettlementProviderError)||error.status!==400||error.code!=='v1_account_instead_of_v2_account')throw error;
  const legacy=await provider.get(`/v1/accounts/${encodeURIComponent(destination)}`);
  verifyLegacyRecipient(legacy,destination,allocation,currency);
  // Account v1 has no documented livemode property. Read the balance in the
  // SAME connected-account context; never infer mode from account ID or data.
  const balance=await provider.get('/v1/balance',destination);
  if(balance?.object!=='balance'||balance.livemode!==false||!Array.isArray(balance.available)||!Array.isArray(balance.pending))throw new LegacyRecipientError('mode');
  return {kind:'legacy_v1_test',destination,currency:'usd',livemode:false};
 }
 verifyRecipient(account,destination,allocation);
 return {kind:'v2'};
}
export function verifyRecipientFundingMode(proof:RecipientProof,livemode:unknown) {
 if(proof.kind==='legacy_v1_test'&&livemode!==proof.livemode)throw new LegacyRecipientError('mode');
}
