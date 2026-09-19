/**
 * Send one error to Sentry with `fetch` and no SDK.
 *
 * Why not `@sentry/react-native`: it is a native module. Re-adding it means
 * `expo prebuild --clean` plus a new EAS build plus TestFlight review before a
 * single crash is visible, and the crashes we are chasing are happening right
 * now on 1.0.357. This module is plain JS, so it reaches devices through an OTA
 * update.
 *
 * It also sidesteps the reason the SDK was pulled in d00827b: `useNativeInit:
 * true` ran `RNSentrySDK.init` in `MainApplication.onCreate` / the iOS
 * AppDelegate, ahead of the JS bundle — the earliest place a crash can happen
 * and the hardest place to see one. There is no native init here at all.
 *
 * What this DOES catch: unhandled JS exceptions, which is the entire class of
 * both 1.0.357 crashes (each one is RCTExceptionsManager reportFatal ->
 * RCTFatal -> abort, i.e. a JS throw promoted to a native abort).
 * What it does NOT catch: a genuine native crash (SIGSEGV in a native module,
 * an NSException on a dispatch worker). Those still need the native SDK or the
 * NSSetUncaughtExceptionHandler plugin.
 *
 * Envelope format: https://develop.sentry.dev/sdk/envelopes/
 */

/** Parsed DSN pieces needed to address the envelope endpoint. */
interface DsnParts {
  endpoint: string;
  publicKey: string;
}

/**
 * A DSN looks like `https://<publicKey>@<host>/<projectId>`. The envelope
 * endpoint is `https://<host>/api/<projectId>/envelope/`.
 */
export function parseDsn(dsn: string | undefined | null): DsnParts | null {
  if (!dsn) return null;
  const m = /^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/i.exec(dsn.trim());
  if (!m) return null;
  const [, publicKey, host, projectId] = m;
  return {
    publicKey,
    endpoint: `https://${host}/api/${projectId}/envelope/`,
  };
}

let _warnedMissingDsn = false;
/** Once per session — this is called from error paths, which can be hot. */
function warnMissingDsnOnce(): void {
  if (_warnedMissingDsn) return;
  _warnedMissingDsn = true;
  console.warn(
    "[Sentry] EXPO_PUBLIC_SENTRY_DSN is missing or malformed — crash reports " +
      "are NOT reaching Sentry. Set it as an EAS environment variable for the " +
      "build's environment (it is gitignored in apps/mobile/.env and absent " +
      "from eas.json's env block).",
  );
}

/** 32 lowercase hex chars, the event_id shape Sentry requires. */
function eventId(): string {
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/**
 * Turn a stack string into Sentry frames. Best-effort: an unparseable stack
 * still ships as the raw string in `extra`, because a report with a bad
 * stacktrace beats no report.
 */
function framesFromStack(stack: string | null | undefined) {
  if (!stack) return undefined;
  const frames = stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // "at fn (file:line:col)" or "fn@file:line:col"
      const paren = /^at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/.exec(line);
      const at = /^(.+?)@(.+?):(\d+):(\d+)$/.exec(line);
      const m = paren ?? at;
      if (!m) return { function: line };
      return {
        function: m[1],
        filename: m[2],
        lineno: Number(m[3]) || undefined,
        colno: Number(m[4]) || undefined,
      };
    })
    // Sentry renders frames oldest-first; JS stacks are newest-first.
    .reverse();
  return frames.length > 0 ? { frames } : undefined;
}

export interface SentryReport {
  /** Exception class, e.g. "TypeError". */
  name?: string | null;
  /** The message. This is what groups issues, so keep it stable. */
  message: string;
  stack?: string | null;
  /** "crash", "error-boundary", … — becomes the `feature_area` tag. */
  featureArea: string;
  level?: "fatal" | "error" | "warning";
  platform?: string;
  release?: string;
  /** ISO timestamp of the original error, not the relaunch that sends it. */
  timestamp?: string;
  handled?: boolean;
  /** Extra context. Already truncated by the caller. */
  extra?: Record<string, unknown>;
}

/**
 * Resolve true only when Sentry accepts the envelope. Boot callers start this
 * without blocking startup, then clear their persisted report after success.
 * A missing DSN, timeout, HTTP rejection, or network error must retain it.
 */
export async function sendToSentry(
  report: SentryReport,
  dsn: string | undefined | null,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const parts = parseDsn(dsn);
    if (!parts) {
      // Say it once. `EXPO_PUBLIC_SENTRY_DSN` lives in apps/mobile/.env, which
      // is gitignored, so an EAS build only has it because it is also set as an
      // EAS environment variable — and eas.json's `env` block does NOT list
      // it. If that var is ever dropped, this function becomes a no-op and
      // crash reporting dies silently, which is the exact five-build blind
      // spot this file was written to end. Warn rather than return quietly.
      warnMissingDsnOnce();
      return false;
    }

    const id = eventId();
    const occurredAt = report.timestamp ? Date.parse(report.timestamp) : NaN;

    const header = {
      event_id: id,
      sent_at: new Date().toISOString(),
    };
    const itemHeader = { type: "event" };
    const event = {
      event_id: id,
      timestamp: (Number.isFinite(occurredAt) ? occurredAt : Date.now()) / 1000,
      platform: "javascript",
      // ErrorUtils also persists nonfatal errors; preserve their explicit
      // severity instead of counting every persisted record as a crash.
      level: report.level ?? (report.featureArea === "crash" ? "fatal" : "error"),
      logger: "dvnt.mobile",
      release: report.release,
      environment: "production",
      tags: {
        feature_area: report.featureArea,
        runtime: report.platform ?? "unknown",
      },
      exception: {
        values: [
          {
            type: report.name || "Error",
            value: report.message,
            stacktrace: framesFromStack(report.stack),
            mechanism: report.handled === undefined
              ? undefined
              : { type: "generic", handled: report.handled },
          },
        ],
      },
      extra: {
        ...report.extra,
        // Keep the raw stack even when frame parsing produced nothing useful.
        raw_stack: report.stack ?? null,
      },
    };

    const body = `${JSON.stringify(header)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(event)}\n`;

    const controller = typeof AbortController === "function"
      ? new AbortController()
      : undefined;
    return await Promise.race([
      fetch(`${parts.endpoint}?sentry_key=${parts.publicKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body,
        signal: controller?.signal,
      }).then((response) => response.ok, () => false),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
          controller?.abort();
        }, 5_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
