/** Read-only current-month platform-fee aggregation, never a payout estimate. */
import { readAllRows } from "./read-all-rows.ts";
export const PLATFORM_FEE_TIME_ZONE = "America/New_York" as const;
export type PlatformFeeResult = {
  amountCents: number | null; currency: string | null; month: string;
  timeZone: typeof PLATFORM_FEE_TIME_ZONE; status: "ready" | "pending" | "unavailable"; reason?: string; asOf?: string;
};
export type PlatformFeeOrder = {
  id: string; event_id: number; status: string; type: string; currency: string | null;
  paid_at: string | null; total_cents: number | null; platform_fee_cents: number | null;
  dvnt_total_fee_cents: number | null; stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null; cart_id?: string | null; charge_model?: string | null;
};
export type PlatformFeeGroup = { paymentIntentId: string; orderIds: string[]; orders: PlatformFeeOrder[];
  recordedFeeCents: number; currency: string; monthStart: string; monthEnd: string; through: string };
export type PlatformFeeSnapshot = {status:"ready";amountCents:number;refundedCents:number;currency:string;verifiedAt:string}
  | {status:"pending"|"unavailable";reason?:string};
/** Authoritative whole-payment snapshot; never allocate a payment across excluded orders. */
export type PlatformFeeRefundResolver = (group: PlatformFeeGroup) => Promise<PlatformFeeSnapshot>;
const SELECT = "id,event_id,type,status,currency,paid_at,total_cents,platform_fee_cents,dvnt_total_fee_cents,stripe_payment_intent_id,stripe_checkout_session_id,cart_id,charge_model";
const statuses = ["paid", "partially_refunded", "refunded"];
const safeCents = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function nyMonthWindow(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid report date");
  const fmt = new Intl.DateTimeFormat("en-US", {timeZone: PLATFORM_FEE_TIME_ZONE,
    year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const parts = (d: Date) => Object.fromEntries(fmt.formatToParts(d).filter(p=>p.type!=="literal").map(p=>[p.type,Number(p.value)]));
  const current=parts(now), year=current.year, month=current.month;
  const midnight = (y: number,m: number) => {
    const target=Date.UTC(y,m-1,1);let utc=target;
    // Resolve local calendar midnight to its UTC instant without server TZ assumptions.
    for(let i=0;i<3;i++){const p=parts(new Date(utc));const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);utc+=target-represented;}
    return new Date(utc).toISOString();
  };
  return {month:`${year}-${String(month).padStart(2,"0")}`,start:midnight(year,month),
    end:midnight(month===12?year+1:year,month===12?1:month+1),through:now.toISOString()};
}

export async function loadMonthlyPlatformFees(
  db: any, ownedEventIds: number[], now: Date, refundResolver?: PlatformFeeRefundResolver,
): Promise<PlatformFeeResult> {
  let window: ReturnType<typeof nyMonthWindow>;
  try { window=nyMonthWindow(now); } catch { return {amountCents:null,currency:null,month:"",timeZone:PLATFORM_FEE_TIME_ZONE,status:"unavailable",reason:"invalid_period"}; }
  const base={month:window.month,timeZone:PLATFORM_FEE_TIME_ZONE};
  let currency: string | null=null;
  const unavailable=(reason:string):PlatformFeeResult=>({...base,amountCents:null,currency,status:"unavailable",reason});
  try {
    if(!Array.isArray(ownedEventIds)||ownedEventIds.some(id=>!Number.isSafeInteger(id)||id<=0))return unavailable("invalid_event_scope");
    const eventIds=[...new Set(ownedEventIds)],allowed=new Set(eventIds),seen=new Set<string>();
    const orders: {order:PlatformFeeOrder;fee:number}[]=[];
    let gross=0;
    for(let offset=0;offset<eventIds.length;offset+=100){
      const batch=eventIds.slice(offset,offset+100);
      const rows=await readAllRows(()=>db.from("orders").select(SELECT).in("event_id",batch)
        .eq("type","event_ticket").in("status",statuses).gte("paid_at",window.start).lt("paid_at",window.end).lte("paid_at",window.through));
      for(const row of rows as PlatformFeeOrder[]){
        if(typeof row.id!=="string"||seen.has(row.id)||!allowed.has(row.event_id)||!batch.includes(row.event_id))return unavailable("incomplete_source");
        seen.add(row.id);
        const paid=row.paid_at?Date.parse(row.paid_at):NaN;
        if(!Number.isFinite(paid)||paid<Date.parse(window.start)||paid>=Date.parse(window.end)||paid>now.getTime()||row.type!=="event_ticket"||!statuses.includes(row.status))return unavailable("invalid_source");
        if(!safeCents(row.total_cents))return unavailable("invalid_recorded_amount");
        const a=row.platform_fee_cents,b=row.dvnt_total_fee_cents;
        if((a!=null&&!safeCents(a))||(b!=null&&!safeCents(b))||(a!=null&&b!=null&&a!==b))return unavailable("inconsistent_recorded_fee");
        const fee=a??b??(row.total_cents===0?0:null);
        if(fee===null||!safeCents(fee)||(row.total_cents===0&&fee!==0))return unavailable("missing_recorded_fee");
        const code=typeof row.currency==="string"?row.currency.trim().toLowerCase():"";
        if(!/^[a-z]{3}$/.test(code))return unavailable("unknown_currency");
        if(currency!==null&&currency!==code){currency=null;return unavailable("mixed_currencies");}
        currency=code;
        if(!Number.isSafeInteger(gross+fee))return unavailable("amount_out_of_range");
        gross+=fee;orders.push({order:row,fee});
      }
    }
    if(orders.some(({order,fee})=>fee>0||(order.total_cents ?? 0)>0)&&!refundResolver)return unavailable("fee_refunds_unavailable");
    const groups=new Map<string,PlatformFeeGroup>();
    for(const {order,fee} of orders){
      const pi=order.stripe_payment_intent_id;
      if(fee===0&&order.total_cents===0&&!pi)continue;
      if(typeof pi!=="string"||!pi.startsWith("pi_")||pi.length<4)return unavailable("payment_reference_unavailable");
      let group=groups.get(pi);
      if(!group){group={paymentIntentId:pi,orderIds:[],orders:[],recordedFeeCents:0,currency:currency!,monthStart:window.start,monthEnd:window.end,through:window.through};groups.set(pi,group);}
      group.orderIds.push(order.id);group.orders.push(order);group.recordedFeeCents+=fee;
    }
    for(const group of groups.values())group.orderIds.sort();
    let refunds=0,oldestVerified=Infinity;const unique=[...groups.values()].filter(group=>group.recordedFeeCents>0||group.orders.some(order=>(order.total_cents ?? 0)>0));
    for(let start=0;start<unique.length;start+=4){
      const batch=unique.slice(start,start+4);
      const values=await Promise.all(batch.map(group=>refundResolver!(group)));
      for(let i=0;i<values.length;i++){
        const value=values[i];
        if(!value||value.status==="unavailable")return unavailable(value?.reason||"fee_refunds_unavailable");
        if(value.status==="pending")return {...base,amountCents:null,currency,status:"pending",reason:value.reason||"verification_pending"};
        const verified=Date.parse(value.verifiedAt);
        if(!Number.isFinite(verified)||verified<now.getTime()-24*60*60_000||verified>now.getTime()+60_000)return {...base,amountCents:null,currency,status:"pending",reason:"verification_stale"};
        if(!safeCents(value.amountCents)||value.amountCents!==batch[i].recordedFeeCents||value.currency.toLowerCase()!==currency
          ||!safeCents(value.refundedCents)||value.refundedCents>value.amountCents||!Number.isSafeInteger(refunds+value.refundedCents))return unavailable("fee_snapshot_mismatch");
        refunds+=value.refundedCents;oldestVerified=Math.min(oldestVerified,verified);
      }
    }
    return {...base,amountCents:gross-refunds,currency,status:"ready",...(Number.isFinite(oldestVerified)?{asOf:new Date(oldestVerified).toISOString()}: {})};
  } catch {return unavailable("source_unavailable");}
}
