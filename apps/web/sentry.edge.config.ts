import * as Sentry from "@sentry/nextjs";
import { createBeforeSend, createBeforeSendTransaction } from "@dvnt/observability/sanitize";

// Next.js edge runtime (middleware/proxy).
Sentry.init({
  // DSN is a publishable client key (same committed-fallback pattern as the
  // Supabase anon key) so a missing Vercel env var can't silently disable telemetry.
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ||
    "https://73060ee2cb8a7f7bad5807413342355f@o4511776624541696.ingest.us.sentry.io/4511776642170880",
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  release: process.env.SENTRY_RELEASE,
  sendDefaultPii: false,
  tracesSampleRate: 0.15,
  beforeSend: createBeforeSend(),
  beforeSendTransaction: createBeforeSendTransaction(),
});
