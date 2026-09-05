import * as Sentry from "@sentry/nextjs";
import { createBeforeSend, createBeforeSendTransaction } from "@dvnt/observability/sanitize";
import { dvntTracesSampler } from "@dvnt/observability/sampling";

// Node (server) runtime — App Router route handlers, RSC, API routes.
Sentry.init({
  // DSN is a publishable client key (same committed-fallback pattern as the
  // Supabase anon key) so a missing Vercel env var can't silently disable telemetry.
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ||
    "https://73060ee2cb8a7f7bad5807413342355f@o4511776624541696.ingest.us.sentry.io/4511776642170880",
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  release: process.env.SENTRY_RELEASE,
  // dist ties release-health to a specific artifact (the web analog of an EAS
  // Update id) so crash-free/session health breaks down per deploy. Metadata on
  // existing events — no new quota.
  dist: process.env.NEXT_PUBLIC_SENTRY_DIST || process.env.VERCEL_DEPLOYMENT_ID,
  sendDefaultPii: false,
  // Structured logging — Logs product (0/5 GB reserved). Webhook outcomes +
  // funnel logs land here (verified: enableLogs, @sentry/core options.d.ts:530).
  enableLogs: true,
  // Shared funnel sampler (money/onboarding/lynk/upload → 1.0, chatty → 0,
  // else 0.15). Map + span-math proof: packages/observability/src/sampling.ts.
  tracesSampler: dvntTracesSampler,
  // DVNT-WEB-A: Safari extension bridge noise. Dropped by
  // eventFiltersIntegration before any quota spend
  // (verified: @sentry/core build/types/types/options.d.ts:314).
  ignoreErrors: [/webkit\.messageHandlers/],
  beforeSend: createBeforeSend(),
  beforeSendTransaction: createBeforeSendTransaction(),
});
