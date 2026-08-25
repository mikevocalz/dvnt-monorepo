/**
 * Sentry boot — NATIVE (dvnt-mobile). Imported first by the root layout.
 * All symbols verified against @sentry/react-native 8.23.0 (installed —
 * apps/mobile/package.json:69). Re-checked on the 8.22 -> 8.23 bump: every
 * citation below still holds at the same line.
 *   - expoRouterIntegration (dist/js/tracing/expoRouterIntegration.d.ts) —
 *     navigation transactions + TTID without a manual nav-container ref.
 *   - turboModuleContextIntegration (dist/js/integrations/exports.d.ts:30),
 *     TurboModuleContextOptions (turboModuleContext.d.ts:15-35).
 *   - enableAppHangTracking / enableUserInteractionTracing (dist/js/options.d.ts).
 * Session replay is gone (audit 2.3): mobileReplayIntegration is no longer
 * pushed here, and the SDK only adds its own when replaysSessionSampleRate /
 * replaysOnErrorSampleRate is set (default.js:117) — neither is.
 * The `.ts` sibling is the no-op web fork.
 */
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { initExpoSentry } from "@dvnt/observability/init/expo";
import { dvntTracesSampler } from "@dvnt/observability/sampling";

export { Sentry };

let booted = false;

export function bootSentry(): void {
  if (booted) return;
  booted = true;

  const dsn =
    process.env.EXPO_PUBLIC_SENTRY_DSN ||
    // DSN is a publishable client key (committed-fallback pattern, same as web).
    "https://8d9aa6e1efeafb58611a687fea5c8548@o4511776624541696.ingest.us.sentry.io/4511776736608256";

  initExpoSentry(Sentry, {
    dsn,
    environment: __DEV__ ? "development" : "production",
    enabled: !__DEV__,
    appVersion: Constants.expoConfig?.version ?? "1.0.0",
    buildNumber:
      (Platform.OS === "ios"
        ? Constants.expoConfig?.ios?.buildNumber
        : String(Constants.expoConfig?.android?.versionCode ?? "")) || "1",
    runtimeVersion:
      typeof Updates.runtimeVersion === "string" ? Updates.runtimeVersion : undefined,
    expoUpdateId: Updates.updateId ?? undefined,
    updateChannel: Updates.channel ?? undefined,
    platform: Platform.OS as "ios" | "android",
    // Off until the free-tier profile-hour allowance is read; see expo.ts.
    profilesSampleRate: 0,
    // 2.12: the shared policy, not a private copy. The inline sampler this
    // replaces had neither the chatty->0 bucket nor the Sneaky Lynk boost, so
    // mobile was paying for health/presence spans and dropping 85% of room
    // joins — the traces the room work needs. See @dvnt/observability/sampling.
    tracesSampler: dvntTracesSampler,
    // Stitch app → Supabase edge → DB traces.
    tracePropagationTargets: [/npfjanxturvmjyevoyfo\.supabase\.co/],
    integrations: [
      Sentry.expoRouterIntegration(),
      // 2.4 — the single largest quota item. The SDK installs this by default
      // (default.js:128) with enableAggregateStats on, which captureEvents
      // a billed `level:'info'` event every 30 s per session
      // (turboModuleContextFlush.js:66-68, DEFAULT_AGGREGATE_FLUSH_INTERVAL_MS
      // = 30000). 120 events/hour/session against a 5,000/month quota.
      // A non-default instance appended after the defaults wins the name
      // collision (@sentry/core integration.js:8-19 filterDuplicates), so the
      // wrapping stays — only the periodic billed flush and the slow-call
      // breadcrumbs go. Native-crash attribution (#6163) is unaffected.
      Sentry.turboModuleContextIntegration({
        enableAggregateStats: false,
        slowCallThresholdMs: 0,
      }),
    ],
  });
}

/** Wrap the root layout so touch + profiler instrumentation attach. */
export function wrapRoot<T>(component: T): T {
  return Sentry.wrap(component as any) as T;
}
