import { keyring, prepareIssue } from "./transport.mjs";
import { staffEmailIssuanceReady } from "./worker-runtime.mjs";
import type { StaffEmailRuntime } from "./routes";

type RuntimeEnv = Readonly<Record<string, string | undefined>>;
const keyIdPattern = /^[a-zA-Z0-9_-]{1,32}$/;
const hexKey = /^[a-f0-9]{64}$/;
const requestIdPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const addressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const authTimeoutMs = 5000;
const rpcTimeoutMs = 8000;
const bytea = (value: string) => "\\x" + value;

function exactOrigin(value: string | undefined, acceptLoopback: boolean): string | null {
  try {
    if (!value) return null;
    const url = new URL(value);
    const loopback = acceptLoopback && url.protocol === "http:" && url.hostname === "127.0.0.1";
    return (url.protocol === "https:" || loopback) && url.origin === value ? value : null;
  } catch { return null; }
}

function exact(input:unknown, keys:string[]): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).length === keys.length && keys.every(key=>Object.hasOwn(input,key));
}

async function boundedJson(request:Request):Promise<unknown> {
  if (request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== "application/json") return null;
  const reader=request.body?.getReader();
  if (!reader) return null;
  let size=0, raw="";
  const decoder=new TextDecoder("utf-8",{fatal:true});
  try {
    for (;;) {
      const part=await reader.read();
      if (part.done) break;
      size+=part.value.byteLength;
      if (size>2048) { await reader.cancel().catch(()=>{}); return null; }
      raw+=decoder.decode(part.value,{stream:true});
    }
    raw+=decoder.decode();
    return JSON.parse(raw);
  } catch { await reader.cancel().catch(()=>{}); return null; }
  finally { reader.releaseLock(); }
}

const outcome=(status:number,state:string)=>Response.json({state},{
  status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}
});

/**
 * Production calls this with the strict defaults below. Tests may inject an
 * isolated loopback auth/RPC transport, but no app setting enables HTTP.
 * No client-provided keys, paths, actor identifiers, or upstream URLs.
 */
export function selectStaffEmailRuntime(
  env:RuntimeEnv, requestFetch: typeof fetch=fetch, allowLoopback=false,
): StaffEmailRuntime | null {
  if (env.DVNT_STAFF_EMAIL_ENABLED !== "true") return null;
  const origin=exactOrigin(env.DVNT_STAFF_EMAIL_WEB_ORIGIN,allowLoopback);
  const supabase=exactOrigin(env.DVNT_STAFF_EMAIL_RPC_ORIGIN,allowLoopback);
  const key=env.DVNT_STAFF_EMAIL_RPC_SERVICE_KEY;
  if (!origin || !supabase || !key || /\s/.test(key) || key.length>4096) return null;

  // Issuance needs the sender and encryption keys; existing links only need
  // the authenticated claim and revoke RPCs, even while sending is paused.
  const issueConfig=(() => {
    if (!staffEmailIssuanceReady(env)) return null;
    const sender=env.DVNT_STAFF_EMAIL_FROM;
    const active=env.DVNT_STAFF_EMAIL_ACTIVE_KEY_ID;
    const encoded=env.DVNT_STAFF_EMAIL_KEYS;
    if (!sender || !active || !keyIdPattern.test(active) || !encoded || encoded.length>500) return null;
    const materials=new Map<string,Uint8Array>();
    for (const item of encoded.split(",")) {
      const [k,value,extra]=item.split(":");
      if (extra!==undefined || !keyIdPattern.test(k ?? "") || !hexKey.test(value ?? "") || materials.has(k!)) return null;
      materials.set(k!,Uint8Array.from(Buffer.from(value!,"hex")));
    }
    return materials.has(active) && materials.size<=4 ? {sender,active,materials} : null;
  })();
  let keysPromise: ReturnType<typeof keyring> | undefined;

  async function actor(request:Request) {
    const cookie=request.headers.get("cookie");
    if (!cookie || cookie.length>16384) return null;
    const response=await requestFetch(origin+"/api/auth/get-session",{
      headers:{cookie}, signal:AbortSignal.timeout(authTimeoutMs), cache:"no-store", redirect:"error",
    });
    if (!response.ok) throw new Error("Staff session check unavailable");
    const result=await response.json();
    const id=result?.user?.id;
    return typeof id==="string" && id.length>0 && id.length<=128 &&
      result?.session?.userId===id ? id : null;
  }

  async function rpc(name:string,input:Record<string,unknown>):Promise<unknown> {
    const response=await requestFetch(supabase+"/rest/v1/rpc/"+name,{
      method:"POST", headers:{apikey:key!,Authorization:"Bearer "+key!,"Content-Type":"application/json"},
      body:JSON.stringify(input),signal:AbortSignal.timeout(rpcTimeoutMs),cache:"no-store",redirect:"error",
    });
    if (!response.ok) throw new Error("Staff invitation storage unavailable");
    return response.json();
  }

  return {
    origin, actor,
    issuanceReady: issueConfig !== null,
    mayIssue:async(id,eventId)=>await rpc("can_issue_event_staff_email_invite",{p_event_id:eventId,p_actor:id})===true,
    async dispatch(request,operation,actorId) {
      if (operation.kind==="issue" && !issueConfig) return outcome(503,"unavailable");
      const permitted=await rpc("take_event_staff_email_budget",{p_actor:actorId,p_operation:operation.kind});
      if (permitted!==true) return outcome(429,"retry_later");
      const input=await boundedJson(request);
      if (operation.kind==="claim") {
        if (!exact(input,["token"]) || typeof input.token!=="string" || !tokenPattern.test(input.token)) return outcome(400,"invalid");
        const accepted=await rpc("claim_event_staff_email_invite",{p_claimant:actorId,p_token:input.token});
        return accepted===true?outcome(200,"accepted"):outcome(404,"not_available");
      }
      const requestFields = operation.kind==="revoke" ? ["eventId","requestId"] : ["eventId","requestId","email","role"];
      if (!exact(input,requestFields) || input.eventId!==operation.eventId || typeof input.requestId!=="string" ||
        !requestIdPattern.test(input.requestId)) return outcome(400,"invalid");
      if (operation.kind==="revoke") {
        const revoked=await rpc("revoke_event_staff_email_invite",{p_event_id:operation.eventId,p_actor:actorId,p_request_id:input.requestId});
        return revoked===true?outcome(200,"revoked"):outcome(404,"not_available");
      }
      const email=typeof input.email==="string"?input.email.trim(): "";
      if (email.length>254 || !addressPattern.test(email) || typeof input.role!=="string" ||
          !["admin","editor"].includes(input.role)) return outcome(400,"invalid");
      if (!issueConfig) return outcome(503,"unavailable");
      const {active,materials,sender}=issueConfig;
      const keys=await (keysPromise ??= keyring(active,materials));
      const envelope=await prepareIssue({
        eventId:operation.eventId,actor:actorId,requestId:input.requestId,email,role:input.role,from:sender,
        webOrigin:allowLoopback && origin!.startsWith("http:") ? "https://fixture.invalid" : origin!,
      },keys,claim=>({
        subject:"DVNT event staff invitation",
        html:`<p>You have been invited to help manage a DVNT event. Use the invited email and verify your account to accept the invitation.</p><p><a href="${claim}">Review invitation on DVNT</a></p>`,
      }));
      const id=await rpc("queue_event_staff_email_invite",{
        p_event:envelope.event_id,p_actor:envelope.issued_by,p_email:envelope.email,p_role:envelope.offered_role,
        p_request:envelope.request_id,p_token:envelope.token,p_intent:bytea(envelope.intent_digest),
        p_acceptable_intents:envelope.accept_intent_digests.map(bytea),p_key_id:envelope.key_id,
        p_nonce:bytea(envelope.nonce),p_ciphertext:bytea(envelope.ciphertext),
      });
      return typeof id==="string" && requestIdPattern.test(id)?outcome(202,"queued"):outcome(404,"not_available");
    },
  };
}

export function staffEmailRuntime():StaffEmailRuntime | null {
  return selectStaffEmailRuntime(process.env);
}
