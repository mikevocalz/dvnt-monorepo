/**
 * One place errors leave the device.
 *
 * Four modules used to report through `require("@sentry/react-native")` inside
 * a try/catch. `d00827b` removed the mobile SDK, and because those requires
 * still RESOLVE — `@sentry/react-native` stays in node_modules as an
 * auto-installed optional peer of `@dvnt/observability` — none of them threw
 * and none of them stopped. They call `addBreadcrumb`/`captureException` on an
 * SDK whose `init()` never ran, which is a silent no-op. Nothing errored,
 * nothing logged, and nothing was reported for five days.
 *
 * `analytics_events` is the sink the Sentry removal named as the replacement.
 * Write-only RLS for anon + authenticated, so this works before auth settles —
 * which matters, because the crashes worth catching happen at boot.
 *
 * Never throws or blocks the caller. The returned promise acknowledges Sentry
 * delivery so persisted crash reports are only removed after acceptance.
 */

/** Rows are diagnostics, not a data lake. Anything past this is truncated. */
export const MAX_METADATA_CHARS = 8_000;

/**
 * Serialize defensively: a crash payload can hold a cyclic native object, and
 * a throw here would be an error reporter that crashes the app it reports on.
 *
 * Exported for `report-issue.test.ts`. Nothing else should call it — the module
 * deliberately keeps `react-native` and the Supabase client behind lazy imports
 * so this logic stays reachable from `node --test`.
 */
export function safeMetadata(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const json = JSON.stringify(detail);
    if (json === undefined) return { unserializable: true };
    if (json.length <= MAX_METADATA_CHARS) return JSON.parse(json);
    return {
      truncated: true,
      originalChars: json.length,
      head: json.slice(0, MAX_METADATA_CHARS),
    };
  } catch {
    return { unserializable: true };
  }
}

/**
 * Record one issue.
 *
 * @param featureArea Coarse bucket — "crash", "error-boundary", "outbox", …
 *                    Lands in the `feature_area` column so a query can group
 *                    without parsing jsonb.
 * @param detail      Anything useful. Truncated at 8k of JSON.
 */
export async function reportIssue(
  featureArea: string,
  detail: Record<string, unknown>,
): Promise<boolean> {
  try {
    const metadata = safeMetadata(detail);
    // Keep native dependencies lazy so this module is safe to import at boot
    // and from pure node tests.
    const { Platform } = await import("react-native");
    const sentryDelivery = (async (): Promise<boolean> => {
      try {
        const { sendToSentry } = await import(
          "@dvnt/app/lib/analytics/sentry-envelope"
        );
        const reason = detail.reason ?? detail.message ?? detail.error ?? featureArea;
        return await sendToSentry(
          {
            name: typeof detail.name === "string" ? detail.name : null,
            message: String(reason),
            stack: typeof detail.stack === "string" ? detail.stack : null,
            featureArea,
            platform: Platform.OS,
            timestamp: typeof detail.timestamp === "string" ? detail.timestamp : undefined,
            level: detail.level === "fatal" || detail.level === "error" || detail.level === "warning"
              ? detail.level : undefined,
            handled: typeof detail.handled === "boolean" ? detail.handled : undefined,
            extra: metadata,
          },
          process.env.EXPO_PUBLIC_SENTRY_DSN,
        );
      } catch {
        return false;
      }
    })();

    // This sink is independent. An analytics insert does not acknowledge a
    // Sentry envelope, and a slow/failed database request must not block it.
    void (async () => {
      try {
        const { supabase } = await import("@dvnt/app/lib/supabase/client");
        await supabase.from("analytics_events").insert({
          event: "app_issue",
          feature_area: featureArea,
          platform: Platform.OS,
          metadata,
        });
      } catch {
        // Swallowed on purpose — see the module header.
      }
    })();
    return await sentryDelivery;
  } catch {
    return false;
  }
}
