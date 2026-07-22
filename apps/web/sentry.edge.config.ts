import * as Sentry from "@sentry/nextjs";
import { createBeforeSend, createBeforeSendTransaction } from "@dvnt/observability/sanitize";

// Next.js edge runtime (middleware/proxy).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  release: process.env.SENTRY_RELEASE,
  sendDefaultPii: false,
  tracesSampleRate: 0.15,
  beforeSend: createBeforeSend(),
  beforeSendTransaction: createBeforeSendTransaction(),
});
