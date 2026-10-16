'use strict';

/** Disable every Sentry build transmission only for an explicit local build.
 * Normal production options are unchanged; release infrastructure rejects the
 * flag instead of accidentally deploying an artifact with runtime telemetry off.
 * These are documented @sentry/nextjs build options, not endpoint overrides.
 */
function localVerificationSentryOptions(env = process.env) {
  if (env.NEXT_PUBLIC_DVNT_LOCAL_BUILD_ONLY !== '1') return {};
  if (env.VERCEL === '1' || env.VERCEL_ENV) {
    throw new Error('NEXT_PUBLIC_DVNT_LOCAL_BUILD_ONLY is for local verification and must never be enabled on Vercel');
  }
  return {
    telemetry: false,
    sourcemaps: { disable: true },
    release: { create: false, finalize: false, setCommits: false },
  };
}

module.exports = { localVerificationSentryOptions };
