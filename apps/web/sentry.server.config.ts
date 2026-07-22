import * as Sentry from "@sentry/nextjs";
import { createBeforeSend, createBeforeSendTransaction } from "@dvnt/observability/sanitize";

// Node (server) runtime — App Router route handlers, RSC, API routes.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  release: process.env.SENTRY_RELEASE,
  sendDefaultPii: false,
  tracesSampler: (ctx) => {
    const name = ctx.name || "";
    if (/onboarding|welcome|verification|checkout|auth/.test(name)) return 1.0;
    return 0.15;
  },
  beforeSend: createBeforeSend(),
  beforeSendTransaction: createBeforeSendTransaction(),
});
