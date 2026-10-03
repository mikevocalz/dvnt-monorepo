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
 * Never throws or blocks the caller. `deliverIssue` reports what each sink did
 * so persisted crash reports can be deduplicated per sink.
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

/** What each sink did with one report. */
export interface IssueDelivery {
  /** "unconfigured": this build has no usable EXPO_PUBLIC_SENTRY_DSN, so no
   *  retry on this build can ever succeed. "skipped": the caller said this
   *  sink already has the report. */
  sentry: "accepted" | "failed" | "unconfigured" | "skipped";
  /** "accepted" means the insert returned no error. */
  analytics: "accepted" | "failed" | "skipped";
}

/**
 * Send one issue to the sinks the caller asks for, and say what each one did.
 *
 * Crash replay (native-exception-log.ts) needs the per-sink answer: it must
 * write the analytics_events row once per crash, keep retrying Sentry only
 * while Sentry can accept, and stop when the build has no DSN at all.
 */
export async function deliverIssue(
  featureArea: string,
  detail: Record<string, unknown>,
  sinks: { sentry: boolean; analytics: boolean } = { sentry: true, analytics: true },
): Promise<IssueDelivery> {
  const result: IssueDelivery = {
    sentry: sinks.sentry ? "failed" : "skipped",
    analytics: sinks.analytics ? "failed" : "skipped",
  };
  try {
    const metadata = safeMetadata(detail);
    // Keep native dependencies lazy so this module is safe to import at boot
    // and from pure node tests.
    const { Platform } = await import("react-native");
    const sentryDelivery = sinks.sentry
      ? (async (): Promise<IssueDelivery["sentry"]> => {
          try {
            const { sendToSentry, parseDsn } = await import(
              "@dvnt/app/lib/analytics/sentry-envelope"
            );
            const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
            const reason = detail.reason ?? detail.message ?? detail.error ?? featureArea;
            const accepted = await sendToSentry(
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
              dsn,
            );
            if (accepted) return "accepted";
            return parseDsn(dsn) ? "failed" : "unconfigured";
          } catch {
            return "failed";
          }
        })()
      : Promise.resolve<IssueDelivery["sentry"]>("skipped");

    // The two sinks run in parallel; a slow database insert does not delay
    // the Sentry envelope, and neither acknowledges the other.
    const analyticsDelivery = sinks.analytics
      ? (async (): Promise<IssueDelivery["analytics"]> => {
          try {
            const { supabase } = await import("@dvnt/app/lib/supabase/client");
            const { error } = await supabase.from("analytics_events").insert({
              event: "app_issue",
              feature_area: featureArea,
              platform: Platform.OS,
              metadata,
            });
            return error ? "failed" : "accepted";
          } catch {
            return "failed";
          }
        })()
      : Promise.resolve<IssueDelivery["analytics"]>("skipped");

    [result.sentry, result.analytics] = await Promise.all([sentryDelivery, analyticsDelivery]);
    return result;
  } catch {
    return result;
  }
}

/**
 * Record one issue in both sinks.
 *
 * @param featureArea Coarse bucket: "crash", "error-boundary", "outbox", ...
 *                    Lands in the `feature_area` column so a query can group
 *                    without parsing jsonb.
 * @param detail      Anything useful. Truncated at 8k of JSON.
 * @returns           true when Sentry accepted the envelope.
 */
export async function reportIssue(
  featureArea: string,
  detail: Record<string, unknown>,
): Promise<boolean> {
  return (await deliverIssue(featureArea, detail)).sentry === "accepted";
}
