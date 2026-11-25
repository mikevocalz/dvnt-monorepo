import { timingSafeEqual } from "node:crypto";
import { deliverOne } from "./transport.mjs";

const POST_EMAIL = "https://api.resend.com/emails";
const schedulerTokenPattern = /^[A-Za-z0-9_-]{43,128}$/;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const bareAddress = /^[^\s@<>]+@[^\s@<>]+$/;
const noCache = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const status = (code) => new Response(null, { status:code, headers:noCache });

function origin(value) {
  try {
    const url=new URL(value);
    return url.protocol==="https:" && url.origin===value ? value : null;
  } catch { return null; }
}
function matchingBearer(header, token) {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied=header.slice(7);
  if (!schedulerTokenPattern.test(supplied) || supplied.length!==token.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}
function senderDomain(value) {
  if (typeof value!=="string" || value.length>320 || /[\r\n]/.test(value)) return null;
  const address=value.match(/^.* <([^<>]+)>$/)?.[1] ?? value;
  return bareAddress.test(address) ? address.split("@")[1].toLowerCase() : null;
}

/**
 * One authenticated tick for the separately scheduled invitation worker.
 * There is intentionally no Next route, environment selector, or scheduler
 * here. Deployment must provide a dedicated endpoint and validated config.
 */
export function createStaffEmailWorker({enabled=false, schedulerToken, keys, workerOrigin, rpcOrigin,
  rpcKey, resendKey, approvedSenderDomain, trackingVerifiedOff=false, requestFetch}={}) {
  const web=origin(workerOrigin), db=origin(rpcOrigin);
  if (!enabled || !trackingVerifiedOff || !web || !db || !schedulerTokenPattern.test(schedulerToken ?? "") ||
      !keys?.active || !keys?.keys?.has(keys.active) || typeof requestFetch!=="function" ||
      typeof approvedSenderDomain!=="string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(approvedSenderDomain) ||
      ![rpcKey,resendKey].every(value=>typeof value==="string" && value.length>0 && value.length<=4096 && !/\s/.test(value))) {
    return async () => status(404);
  }

  async function rpc(name, body) {
    const response=await requestFetch(db+"/rest/v1/rpc/"+name,{
      method:"POST",headers:{"Content-Type":"application/json",apikey:rpcKey,Authorization:"Bearer "+rpcKey},
      body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:"error",cache:"no-store",
    });
    if (!response.ok) throw new Error("Staff email worker unavailable");
    return response.json();
  }
  const repo={
    async lease(){
      const rows=await rpc("lease_staff_email_delivery",{});
      if (!Array.isArray(rows) || rows.length>1) throw new Error("Unexpected staff email lease shape");
      const row=rows[0];
      if (row && (!uuid.test(row.delivery_id) || !uuid.test(row.lease_token))) throw new Error("Invalid staff email lease");
      return row ?? null;
    },
    async authorized(id,lease){
      return await rpc("staff_email_delivery_authorized",{p_delivery:id,p_lease:lease})===true;
    },
    async finish(id,lease,outcome) {
      return await rpc("finish_staff_email_delivery",{
        p_delivery:id,p_lease:lease,p_state:outcome.state,p_receipt:outcome.receipt??null,
      })===true;
    },
  };
  async function provider({from,to,subject,html,idempotencyKey,timeoutMs}) {
    if (senderDomain(from)!==approvedSenderDomain || typeof to!=="string" || !bareAddress.test(to) ||
        !idempotencyKey.startsWith("dvnt-staff-invite:v1:") || !uuid.test(idempotencyKey.split(":").at(-1))) {
      throw new Error("Staff email provider guard refused delivery");
    }
    const response=await requestFetch(POST_EMAIL,{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+resendKey,"Idempotency-Key":idempotencyKey},
      body:JSON.stringify({from,to:[to],subject,html}),signal:AbortSignal.timeout(timeoutMs),
      redirect:"error",cache:"no-store",
    });
    if (!response.ok) throw new Error("Staff email delivery not acknowledged");
    const result=await response.json();
    return result?.id;
  }
  return async request => {
    const url=new URL(request.url);
    if (url.origin!==web || request.method!=="POST" || !matchingBearer(request.headers.get("authorization"),schedulerToken)) return status(404);
    if (request.body!==null) return status(400); // no work selection or target data from the caller
    try {
      const result=await deliverOne({repo,keys,provider});
      return status(result==="retry" ? 503 : 204);
    } catch {
      // Provider or SQL failures may include PII. Never serialize or log them here.
      return status(503);
    }
  };
}
