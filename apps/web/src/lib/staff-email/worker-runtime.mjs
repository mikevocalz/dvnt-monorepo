import { keyring } from "./transport.mjs";
import { createStaffEmailWorker } from "./worker.mjs";

const noCache = {"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
const dark = () => new Response(null,{status:404,headers:noCache});
const validId=/^[A-Za-z0-9_-]{1,32}$/;
const validKey=/^[a-f0-9]{64}$/;

/** Route wiring only. The hosting environment must opt in and schedule POST. */
export function selectStaffEmailWorker(env, requestFetch=fetch) {
  const workerOrigin = env.DVNT_STAFF_EMAIL_WORKER_ORIGIN;
  const webOrigin = env.DVNT_STAFF_EMAIL_WEB_ORIGIN;
  if (env.DVNT_STAFF_EMAIL_ENABLED !== "true" ||
      env.DVNT_STAFF_EMAIL_WORKER_ENABLED !== "true" ||
      env.DVNT_STAFF_EMAIL_TRACKING_VERIFIED_OFF !== "true" ||
      !webOrigin || !workerOrigin || webOrigin !== workerOrigin) return dark;
  const active = env.DVNT_STAFF_EMAIL_ACTIVE_KEY_ID;
  const encoded = env.DVNT_STAFF_EMAIL_KEYS;
  if (!validId.test(active ?? "") || !encoded || encoded.length > 500) return dark;
  const materials = new Map();
  for (const entry of encoded.split(",")) {
    const [id,value,extra] = entry.split(":");
    if (extra !== undefined || !validId.test(id ?? "") ||
        !validKey.test(value ?? "") || materials.has(id)) return dark;
    materials.set(id, Uint8Array.from(Buffer.from(value,"hex")));
  }
  if (!materials.has(active) || materials.size > 4) return dark;

  let handler;
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.origin !== workerOrigin || url.pathname !== "/staff-email/worker" ||
          request.method !== "POST") return dark();
      handler ??= keyring(active, materials).then((keys) => createStaffEmailWorker({
        enabled: true,
        trackingVerifiedOff: true,
        keys,
        workerOrigin,
        rpcOrigin: env.DVNT_STAFF_EMAIL_RPC_ORIGIN,
        rpcKey: env.DVNT_STAFF_EMAIL_RPC_SERVICE_KEY,
        schedulerToken: env.DVNT_STAFF_EMAIL_WORKER_TOKEN,
        resendKey: env.DVNT_STAFF_EMAIL_WORKER_RESEND_KEY,
        approvedSenderDomain: env.DVNT_STAFF_EMAIL_WORKER_SENDER_DOMAIN,
        requestFetch,
      }));
      return await (await handler)(request);
    } catch { return dark(); }
  };
}
