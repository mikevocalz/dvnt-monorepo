import * as Sentry from "@sentry/nextjs";
import { createBeforeSend, createBeforeSendTransaction, isEventClamped } from "@dvnt/observability/sanitize";
import { dvntTracesSampler } from "@dvnt/observability/sampling";

// Noise that must never spend quota (DVNT-WEB-A: Safari extension bridge).
const IGNORED_ERROR_PATTERNS = [/webkit\.messageHandlers/];

// Logged-out visitors on the landing page produce the least actionable
// replays. Auth persists as the zustand `auth-storage` localStorage key
// (packages/app/lib/utils/storage.ts clearAuthStorage) — absence of the key,
// or a persisted state without isAuthenticated, means logged out.
function isLoggedOutLandingSession(): boolean {
  try {
    if (typeof window === "undefined" || window.location.pathname !== "/") return false;
    const raw = window.localStorage.getItem("auth-storage");
    return !raw || !raw.includes('"isAuthenticated":true');
  } catch {
    return false;
  }
}

// Browser init — runs once per pageload (Next instrumentation-client convention).
Sentry.init({
  // DSN is a publishable client key (same committed-fallback pattern as the
  // Supabase anon key) so a missing Vercel env var can't silently disable telemetry.
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ||
    "https://73060ee2cb8a7f7bad5807413342355f@o4511776624541696.ingest.us.sentry.io/4511776642170880",
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "development",
  release: process.env.SENTRY_RELEASE,
  // Web analog of an EAS Update id — per-deploy release-health breakdown.
  dist: process.env.NEXT_PUBLIC_SENTRY_DIST,
  sendDefaultPii: false,
  // Structured logging — funnel logs (logs.ts). Verified: enableLogs,
  // @sentry/core options.d.ts:530.
  enableLogs: true,
  integrations: [
    // §2.4: full masking, no unmask lists.
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
      // Gate which errors may trigger an error-replay at all; returning false
      // skips replaysOnErrorSampleRate for that error
      // (verified: @sentry-internal/replay build/npm/types/types/replay.d.ts:186).
      beforeErrorSampling: (event) => {
        if (isEventClamped(event)) return false;
        const msg = String(event.exception?.values?.[0]?.value ?? event.message ?? "");
        if (IGNORED_ERROR_PATTERNS.some((p) => p.test(msg))) return false;
        if (isLoggedOutLandingSession()) return false;
        return true;
      },
    }),
  ],
  // Shared funnel sampler (money/onboarding/lynk/upload → 1.0, chatty → 0,
  // else 0.15). Map + span-math proof: packages/observability/src/sampling.ts.
  tracesSampler: dvntTracesSampler,
  // Stitch browser → Supabase edge functions traces.
  tracePropagationTargets: [
    /^\//,
    /npfjanxturvmjyevoyfo\.supabase\.co/,
  ],
  replaysSessionSampleRate: 0.05,
  // 1.0 → 0.2: error-replays are the most expensive artifact; beforeErrorSampling
  // above already filters clamped/ignored/anonymous-landing errors before this
  // rate applies.
  replaysOnErrorSampleRate: 0.2,
  // Dropped by eventFiltersIntegration before any quota spend
  // (verified: @sentry/core build/types/types/options.d.ts:314).
  ignoreErrors: IGNORED_ERROR_PATTERNS,
  beforeSend: createBeforeSend(),
  beforeSendTransaction: createBeforeSendTransaction(),
});

// App Router navigation transactions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
