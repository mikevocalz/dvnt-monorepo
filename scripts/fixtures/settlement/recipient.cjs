/** Synthetic legacy proof, not a captured provider account or live-read claim. */
const {readFileSync}=require('node:fs');const {resolve}=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const recipient={};vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname,'../../../apps/mobile/supabase/functions/_shared/settlement-recipient.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:recipient,Error,Number,encodeURIComponent});
function legacyAccount(id='acct_promoter',metadata={dvnt_promoter_id:'00000000-0000-4000-8000-000000000002'}) {
 return {id,object:'account',metadata,capabilities:{transfers:'active'},country:'US',default_currency:'usd',payouts_enabled:true,details_submitted:true,
  controller:{is_controller:true},requirements:{disabled_reason:null,currently_due:[],past_due:[],pending_verification:[],errors:[]},
  external_accounts:{object:'list',has_more:false,url:`/v1/accounts/${id}/external_accounts`,data:[{id:'ba_synthetic',object:'bank_account',account:id,country:'US',currency:'usd',default_for_currency:true,status:'new',available_payout_methods:['standard']}]}};
}
function legacyProvider(provider,{mutate=()=>{},mode=false,error=null}={}) {
 const reads=[];const get=provider.get.bind(provider);
 provider.get=async(path,account)=>{
  reads.push([path,account]);
  if(path.startsWith('/v2/core/accounts/'))throw error||new recipient.SettlementProviderError(400,'v1_account_instead_of_v2_account');
  if(path.startsWith('/v1/accounts/')){const id=path.split('/').pop();const value=legacyAccount(id,id==='acct_host'?{dvnt_host_id:'fixture-host'}:undefined);mutate(value);return value;}
  if(path==='/v1/balance'&&account)return {object:'balance',livemode:mode,available:[],pending:[]};
  return get(path,account);
 };
 return reads;
}
module.exports={...recipient,legacyAccount,legacyProvider};
