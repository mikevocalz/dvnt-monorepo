/**
 * Feature Flags
 *
 * Typed, safe feature flag system. Defaults OFF in production.
 * Reads from env vars (EXPO_PUBLIC_FF_*) with safe fallback.
 * Can be extended to read from Supabase remote config table later.
 */

export const FeatureFlags = {
  /** Events creation + listing + detail pages */
  events_enabled: "EXPO_PUBLIC_FF_EVENTS_ENABLED",
  /** 7-day NOAA weather on event detail */
  event_weather_enabled: "EXPO_PUBLIC_FF_EVENT_WEATHER_ENABLED",
  /** Stripe ticket purchase flow */
  ticketing_enabled: "EXPO_PUBLIC_FF_TICKETING_ENABLED",
  /** Organizer dashboard, scanner, ticket list */
  organizer_tools_enabled: "EXPO_PUBLIC_FF_ORGANIZER_TOOLS_ENABLED",
  /** Stripe Connect payouts to organizers */
  payouts_enabled: "EXPO_PUBLIC_FF_PAYOUTS_ENABLED",
  /** Sneaky Link $2.99 paywall after 10 participants */
  sneaky_paywall_enabled: "EXPO_PUBLIC_FF_SNEAKY_PAYWALL_ENABLED",
  /** NSA anonymous mode for Sneaky Link */
  nsa_enabled: "EXPO_PUBLIC_FF_NSA_ENABLED",
  /** Performance: use bootstrap-feed edge function */
  perf_bootstrap_feed: "EXPO_PUBLIC_FF_PERF_BOOTSTRAP_FEED",
  /** Performance: use bootstrap-profile edge function */
  perf_bootstrap_profile: "EXPO_PUBLIC_FF_PERF_BOOTSTRAP_PROFILE",
  /** Performance: use bootstrap-messages edge function */
  perf_bootstrap_messages: "EXPO_PUBLIC_FF_PERF_BOOTSTRAP_MESSAGES",
  /** Performance: use bootstrap-notifications edge function */
  perf_bootstrap_notifications: "EXPO_PUBLIC_FF_PERF_BOOTSTRAP_NOTIFICATIONS",
  /** Performance: use bootstrap-events edge function */
  perf_bootstrap_events: "EXPO_PUBLIC_FF_PERF_BOOTSTRAP_EVENTS",
  /** Performance: enable navigation-intent prefetching */
  perf_prefetch_router: "EXPO_PUBLIC_FF_PERF_PREFETCH_ROUTER",
  /** Performance: enable production perf logging */
  perf_instrumentation: "EXPO_PUBLIC_FF_PERF_INSTRUMENTATION",
  /** Maps view */
  maps_enabled: "EXPO_PUBLIC_FF_MAPS_ENABLED",
} as const;

export type FeatureFlagKey = keyof typeof FeatureFlags;

/**
 * Check if a feature flag is enabled.
 * Defaults to false (OFF) unless explicitly set to "true" or "1".
 */
export function isFeatureEnabled(flag: FeatureFlagKey): boolean {
  try {
    const envKey = FeatureFlags[flag];
    const value = process.env[envKey];
    if (!value) return false;
    const enabled = value === "true" || value === "1";
    if (__DEV__ && enabled) {
      console.log(`[FeatureFlags] ${flag} = ON`);
    }
    return enabled;
  } catch {
    return false;
  }
}

/**
 * React hook-friendly getter (same logic, named for clarity).
 * Import and call at component top level or in callbacks.
 */
export function useFeatureFlag(flag: FeatureFlagKey): boolean {
  return isFeatureEnabled(flag);
}

/**
 * Guard component: renders children only if flag is ON.
 * Usage: <FeatureGate flag="ticketing_enabled">{children}</FeatureGate>
 */
export function FeatureGate({
  flag,
  children,
  fallback = null,
}: {
  flag: FeatureFlagKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return isFeatureEnabled(flag) ? <>{children}</> : <>{fallback}</>;
}
