import { pathToFileURL } from 'node:url';

const WORKER_PATH = '/staff-email/worker';
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

/** One tick for an external private staging scheduler; intentionally not enabled by a deploy. */
export async function runPrivateStaffEmailTick(env, requestFetch = fetch) {
  if (env.DVNT_PRIVATE_STAFF_EMAIL_SCHEDULER !== 'true') return 'disabled';
  const origin = env.DVNT_STAFF_EMAIL_WORKER_ORIGIN;
  const secret = env.DVNT_STAFF_EMAIL_WORKER_TOKEN;
  let url;
  try { url = new URL(origin); } catch { return 'misconfigured'; }
  if (env.DVNT_ENVIRONMENT !== 'private-staging' || url.protocol !== 'https:' ||
      url.origin !== origin || origin !== env.DVNT_STAFF_EMAIL_WEB_ORIGIN ||
      /(^|\.)(dvntapp|deviant)\.live$/i.test(url.hostname) ||
      !TOKEN.test(secret ?? '')) return 'misconfigured';

  try {
    const response = await requestFetch(origin + WORKER_PATH, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + secret },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });
    // Keep body contents/headers, recipient data and error text out of scheduler logs.
    await response.body?.cancel();
    return response.status === 204 ? 'completed' : 'failed';
  } catch {
    return 'failed';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runPrivateStaffEmailTick(process.env);
  console.log('Private staff email tick: ' + result);
  if (result !== 'completed' && result !== 'disabled') process.exitCode = 1;
}
