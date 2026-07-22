/**
 * Sentry boot — NATIVE (dvnt-mobile). Imported first by the root layout.
 * All symbols verified against @sentry/react-native 8.14.0:
 *   - expoRouterIntegration (dist/js/tracing/expoRouterIntegration.d.ts) —
 *     navigation transactions + TTID without a manual nav-container ref.
 *   - mobileReplayIntegration (dist/js/replay/mobilereplay.d.ts) — §2.4 full
 *     masking (maskAllText + maskAllImages + maskAllVectors are its defaults;
 *     set explicitly anyway so a default change can't unmask us).
 *   - enableAppHangTracking / enableUserInteractionTracing (dist/js/options.d.ts).
 * The `.ts` sibling is the no-op web fork.
 */
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { initExpoSentry } from "@dvnt/observability/init/expo";

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
    profilesSampleRate: 0.1,
    // A1: boost the product-question flows to 1.0, 0.15 elsewhere.
    tracesSampler: (ctx) => {
      const name = ctx.name || "";
      if (/onboarding|welcome|verification|checkout|auth/i.test(name)) return 1.0;
      return 0.15;
    },
    // Stitch app → Supabase edge → DB traces.
    tracePropagationTargets: [/npfjanxturvmjyevoyfo\.supabase\.co/],
    integrations: [
      Sentry.expoRouterIntegration(),
      Sentry.mobileReplayIntegration({
        maskAllText: true,
        maskAllImages: true,
        maskAllVectors: true,
      }),
    ],
  });
}

/** Wrap the root layout so touch + profiler instrumentation attach. */
export function wrapRoot<T>(component: T): T {
  return Sentry.wrap(component as any) as T;
}
