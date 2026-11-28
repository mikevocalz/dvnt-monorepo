/** Source-accounted funding, not physical provider segregation.
 * All reads use platform context. Incomplete audit fails closed.
 */
type Provider = { get(path:string):Promise<any> };
const ref=(v:any)=>typeof v==='string'?v:v?.id??null;
const safe=(v:any)=>Number.isSafeInteger(v);
export function fundingTransaction(t:any,auditFrom:number) {
 if(!t||typeof t.id!=='string'||!/^txn_[A-Za-z0-9_]+$/.test(t.id)||t.object!=='balance_transaction'||
  typeof t.currency!=='string'||! /^[a-z]{3}$/.test(t.currency)||
  !safe(t.created)||t.created<auditFrom||!safe(t.amount)||!safe(t.fee)||!safe(t.net)||t.net!==t.amount-t.fee||
  !['available','pending'].includes(t.status)||typeof t.type!=='string'||!t.type||
  (t.source!=null&&typeof ref(t.source)!=='string'))throw Error('Invalid funding balance transaction');
 return {id:t.id,source:ref(t.source),currency:t.currency,type:t.type,created:t.created,
  amount:t.amount,fee:t.fee,net:t.net,status:t.status};
}
export function fundingSourceProof(charge:any,tax:number) {
 const tx=fundingTransaction(charge.balance_transaction,0);
 if(tx.source!==charge.id||tx.currency!==charge.currency||tx.amount!==charge.amount||
  tx.status!=='available'||!['charge','payment'].includes(tx.type)||!safe(tax)||tax<0||tx.net<tax)
  throw Error('Source-accounted funding proof mismatch');
 return {...tx,tax};
}
export async function auditFundingTransactions(provider:Provider,policy:any,{maxPages=100}={}) {
 if(!policy||typeof policy.platform_account!=='string'||!policy.platform_account.startsWith('acct_')||
  typeof policy.livemode!=='boolean'||!safe(policy.audit_from)||policy.audit_from<0||
  !safe(maxPages)||maxPages<1||maxPages>100)throw Error('Source-accounted funding policy missing');
 const path=`/v1/balance_transactions?created[gte]=${policy.audit_from}&limit=100`;
 const transactions:any[]=[];const seen=new Set<string>();let cursor:string|undefined;let head:string|undefined;let headHasMore:boolean|undefined;
 for(let page=0;page<maxPages;page++) {
  const result=await provider.get(path+(cursor?'&starting_after='+encodeURIComponent(cursor):''));
  if(result?.object!=='list'||!Array.isArray(result.data)||result.data.length>100||typeof result.has_more!=='boolean')throw Error('Incomplete funding pagination');
  const rows=result.data.map((t:any)=>fundingTransaction(t,policy.audit_from));
  if(page===0){head=JSON.stringify(rows);headHasMore=result.has_more;}
  for(const t of rows){if(seen.has(t.id))throw Error('Duplicate funding pagination');seen.add(t.id);transactions.push(t);}
  if(!result.has_more) {
   // No provider lock: a debit after this barrier remains an external risk.
   const tail=await provider.get(path);
   if(tail?.object!=='list'||!Array.isArray(tail.data)||tail.has_more!==headHasMore||
    JSON.stringify(tail.data.map((t:any)=>fundingTransaction(t,policy.audit_from)))!==head)
    throw Error('Funding audit changed during pagination');
   return transactions;
  }
  if(rows.length===0)throw Error('Funding pagination stalled');
  cursor=rows.at(-1).id;
 }
 throw Error('Funding reconciliation page limit reached');
}
