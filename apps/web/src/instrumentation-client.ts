import * as Sentry from "@sentry/nextjs";
import { createBeforeSend, createBeforeSendTransaction } from "@dvnt/observability/sanitize";

// Browser init — runs once per pageload (Next instrumentation-client convention).
Sentry.init({
  // DSN is a publishable client key (same committed-fallback pattern as the
  // Supabase anon key) so a missing Vercel env var can't silently disable telemetry.
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ||
    "https://73060ee2cb8a7f7bad5807413342355f@o4511776624541696.ingest.us.sentry.io/4511776642170880",
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "development",
  release: process.env.SENTRY_RELEASE,
  sendDefaultPii: false,
  integrations: [
    // §2.4: full masking, no unmask lists.
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  tracesSampler: (ctx) => {
    const name = ctx.name || "";
    if (/onboarding|welcome|verification|checkout|auth/.test(name)) return 1.0;
    return 0.15;
  },
  // Stitch browser → Supabase edge functions traces.
  tracePropagationTargets: [
    /^\//,
    /npfjanxturvmjyevoyfo\.supabase\.co/,
  ],
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,
  beforeSend: createBeforeSend(),
  beforeSendTransaction: createBeforeSendTransaction(),
});

// App Router navigation transactions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
