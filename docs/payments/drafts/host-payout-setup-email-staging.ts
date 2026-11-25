import { timingSafeEqual } from "node:crypto";
import { dispatchHostPayoutSetupEmail, type HostEvidence, type HostPayoutSetupEmailPorts } from "./host-payout-setup-email.ts";
import type { LiveConnectState } from "../../../apps/mobile/supabase/functions/_shared/payout-setup-reminder.ts";

type Query = <T extends Record<string, unknown>>(sql: string, args: unknown[], signal: AbortSignal) => Promise<{ rows: T[] }>;
type Source = { host_id: number | string; event_id: number | string; app_auth_id: string; auth_id: string;
  email: string; email_verified: boolean; stripe_account_id: string | null };
type StripeEvidence = LiveConnectState & { accountId: string; platformAccountId: string; mode: "test" | "live" };
type Config = { enabled?: boolean; environment: string; path: string; bearer: string; hostId: number; eventId: number;
  stagingInbox: string; testPlatformAccountId: string };
type Adapters = { query: Query; readStripeTestAccount: (id: string, signal: AbortSignal) => Promise<StripeEvidence | null>;
  isSuppressed: (verifiedAddress: string, signal: AbortSignal) => Promise<boolean>;
  sendPrivate: (input: Parameters<HostPayoutSetupEmailPorts["send"]>[0], signal: AbortSignal) => ReturnType<HostPayoutSetupEmailPorts["send"]> };

const accountPattern = /^acct_[A-Za-z0-9]{12,}$/;
const numericMatch = (actual: unknown, expected: number) => actual === expected || actual === String(expected);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function positive(id: number) { return Number.isSafeInteger(id) && id > 0; }
function authorized(header: string | null, bearer: string) {
  const value = header ?? "";
  if (!/^Bearer [A-Za-z0-9_-]{43,128}$/.test(value)) return false;
  const a = Buffer.from(value.slice(7)), b = Buffer.from(bearer);
  return a.length === b.length && timingSafeEqual(a,b);
}

// If a write acknowledges late, the ledger reservation remains durable and
// the handler must not try a second provider request.
async function bounded<T>(call: (signal:AbortSignal) => Promise<T>): Promise<T> {
  const controller=new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{ controller.abort(); reject(Error("adapter deadline")); },6000);
  });
  try { return await Promise.race([deadline,call(controller.signal)]); }
  finally { clearTimeout(timer); }
}

export function createPrivateHostSetupReminder(input: Config, deps: Adapters) {
  const config={...input};
  const allowed = config.enabled === true && config.environment === "private-staging" &&
    /^\/[A-Za-z0-9/_-]{1,120}$/.test(config.path) && /^[A-Za-z0-9_-]{43,128}$/.test(config.bearer) &&
    positive(config.hostId) && positive(config.eventId) && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(config.stagingInbox) &&
    accountPattern.test(config.testPlatformAccountId);
  const host = config.hostId;
  const key = `host-payout-setup:v1:${host}`;
  const ports: HostPayoutSetupEmailPorts = {
    async readFresh(id): Promise<HostEvidence | null> {
      if (id !== host) return null;
      const { rows } = await bounded(signal=>deps.query<Source>(
        "select * from dvnt_host_setup_email.staging_source($1, $2)", [host, config.eventId],signal));
      if (rows.length !== 1) return null;
      const row = rows[0];
      if (!numericMatch(row.host_id, host) || !numericMatch(row.event_id, config.eventId) ||
        !row.app_auth_id || row.app_auth_id !== row.auth_id || row.email_verified !== true ||
        row.email !== config.stagingInbox) return null;
      // Provider/account failure is unknown, never interpreted as not configured.
      if (await bounded(signal=>deps.isSuppressed(row.email,signal)) !== false) return null;
      let stripe: StripeEvidence | null = null;
      if (row.stripe_account_id !== null) {
        if (typeof row.stripe_account_id !== "string" || !accountPattern.test(row.stripe_account_id)) return null;
        const accountId=row.stripe_account_id;
        stripe = await bounded(signal=>deps.readStripeTestAccount(accountId,signal));
        if (!stripe || stripe.mode !== "test" || stripe.platformAccountId !== config.testPlatformAccountId ||
          stripe.accountId !== row.stripe_account_id) return null;
      }
      return { hostId:host, organizerEventId:config.eventId, organizerAccountId:row.stripe_account_id,
        accountEvidence: stripe ? "verified_current" : "missing", stripe,
        verifiedDvntUserId:host, verifiedEmail:row.email, emailSuppressed:false };
    },
    async reserveOnce(requestedKey) {
      if (requestedKey !== key) throw Error("reservation scope mismatch");
      const { rows } = await bounded(signal=>deps.query<{ delivery_key:string; claim_token:string }>(
        "select * from dvnt_host_setup_email.staging_reserve($1)", [host],signal));
      if (!rows.length) return null;
      if (rows.length !== 1 || rows[0].delivery_key !== key || !UUID.test(rows[0].claim_token)) throw Error("reservation contract");
      return { key, token: rows[0].claim_token };
    },
    async record(claim,outcome,provider) {
      if (claim.key !== key || !UUID.test(claim.token)) throw Error("record scope mismatch");
      const { rows } = await bounded(signal=>deps.query<{ recorded:boolean }>(
        "select dvnt_host_setup_email.staging_record($1,$2,$3,$4) as recorded", [host,claim.token,outcome,provider ?? null],signal));
      if (rows.length !== 1 || rows[0].recorded !== true) throw Error("record unavailable");
    },
    async send(message) {
      if (message.to !== config.stagingInbox || message.idempotencyKey !== key) throw Error("send scope mismatch");
      return bounded(signal=>deps.sendPrivate(message,signal));
    },
  };
  const respond = (status: number, outcome: string) => Response.json({ outcome }, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  return async (request: Request) => {
    const url = new URL(request.url);
    if (!allowed || url.pathname !== config.path || url.search) return respond(404,"unavailable");
    if (request.method !== "POST") return respond(405,"method_not_allowed");
    if (!authorized(request.headers.get("Authorization"), config.bearer)) return respond(401,"unauthorized");
    if (request.body !== null) return respond(400,"body_not_allowed");
    try {
      const result=await dispatchHostPayoutSetupEmail({enabled:true},host,ports);
      return respond(result === "uncertain" ? 503 : 200,result);
    } catch {
      return respond(503,"unavailable");
    }
  };
}
