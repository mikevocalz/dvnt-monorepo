/**
 * Sentry for Supabase Deno edge functions (dvnt-edge).
 *
 * §2.4 rules enforced structurally: sendDefaultPii off, request bodies are
 * never attached, and callers may only pass ALLOWLISTED tags (webhook.source,
 * event.type, event.id, function) — there is no API here for attaching
 * payloads, so customer/subscriber objects can't leak by convenience.
 *
 * Edge isolates die fast: every capture path flushes (2s cap) before return.
 */
import * as Sentry from "npm:@sentry/deno@10";

const SENTRY_DSN =
  Deno.env.get("SENTRY_DSN") ||
  // Publishable client key (committed-fallback pattern shared with web/mobile).
  "https://6a715382e4a4d3f284fda763ace07763@o4511776624541696.ingest.us.sentry.io/4511776737722368";

let inited = false;
function ensureInit(): void {
  if (inited) return;
  inited = true;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Deno.env.get("SENTRY_ENVIRONMENT") || "production",
    release: Deno.env.get("SENTRY_RELEASE") || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0.15,
  });
}

/** The only tags an edge capture may carry. */
export interface EdgeTags {
  function: string;
  "webhook.source"?: string;
  "event.type"?: string;
  "event.id"?: string;
}

/** Capture + flush. Never throws — telemetry must not break the money path. */
export async function captureEdge(error: unknown, tags: EdgeTags): Promise<void> {
  try {
    ensureInit();
    Sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(tags)) {
        if (typeof v === "string") scope.setTag(k, v);
      }
      Sentry.captureException(error);
    });
    await Sentry.flush(2000);
  } catch (telemetryError) {
    console.error("[sentry] capture failed:", telemetryError);
  }
}

/**
 * Wrap a Deno.serve handler: uncaught exceptions are captured (with the
 * function tag only), flushed, and converted to a 500 instead of a dead isolate.
 */
export function withSentry(
  functionName: string,
  handler: (req: Request) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  ensureInit();
  return async (req: Request): Promise<Response> => {
    // A5: continue the caller's trace (app/web send sentry-trace + baggage via
    // tracePropagationTargets) so one user action = one stitched trace
    // app → edge → DB in the Sentry UI.
    return await Sentry.continueTrace(
      {
        sentryTrace: req.headers.get("sentry-trace") ?? undefined,
        baggage: req.headers.get("baggage"),
      },
      async () => {
        return await Sentry.startSpan(
          { name: `${functionName} ${req.method}`, op: "function.supabase" },
          async () => {
            try {
              return await handler(req);
            } catch (error) {
              console.error(`[${functionName}] uncaught:`, error);
              await captureEdge(error, { function: functionName });
              return new Response(
                JSON.stringify({
                  ok: false,
                  error: { code: "internal_error", message: "Internal error" },
                }),
                { status: 500, headers: { "Content-Type": "application/json" } },
              );
            }
          },
        );
      },
    );
  };
}
