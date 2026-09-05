/**
 * @dvnt/observability — Traces sampler (funnels via tracesSampler)
 *
 * A single, shared `tracesSampler` for the web rail (server + edge + client),
 * so the funnel-sampling policy lives in ONE place and both apps import it.
 * Web configs pass `dvntTracesSampler` straight into `Sentry.init`.
 *
 * ─── Verified SDK surface (installed @sentry/nextjs 10.69.0 → @sentry/core) ───
 *   tracesSampler?: (samplingContext: TracesSamplerSamplingContext) => number | boolean
 *     — node_modules/@sentry/core/build/types/types/options.d.ts:585
 *   TracesSamplerSamplingContext extends SamplingContext:
 *     { name: string; attributes?: SpanAttributes; parentSampled?: boolean;
 *       parentSampleRate?: number; location?: WorkerLocation;
 *       normalizedRequest?: RequestEventData;
 *       inheritOrSampleWith: (fallbackSampleRate: number) => number }
 *     — node_modules/@sentry/core/build/types/types/samplingcontext.d.ts
 *   We consume only `name` + `inheritOrSampleWith` (a structural subset — see
 *   DvntSamplingContext below), so `dvntTracesSampler` stays assignable to the
 *   SDK's tracesSampler slot. tsc in apps/web verifies that assignment against
 *   the real @sentry/nextjs typing at the Sentry.init call site.
 *
 * ─── Policy (per Observability WS-5 / sentry-budget.md §4) ───
 *   money paths (checkout end-to-end), signup/onboarding steps, Sneaky Lynk
 *   join-to-first-frame, media upload  → 1.0 (never drop a revenue/funnel trace)
 *   chatty routes (feed polling, presence/heartbeat, health probes) → 0
 *   everything else → 0.15 (via inheritOrSampleWith so a sampled parent trace
 *   stays coherent across services)
 *
 * ─── Span-math proof: fits 5M reserved with ≥3× headroom (budget §4) ─────────
 *   Reserved: 5,000,000 spans/mo. Policy target ≤2.5M (≤50%). Live burn today:
 *   ~9k spans/mo (0.18%). Worst-case model at ~120× today's session volume
 *   (assumption, not a measurement — 10,000 sessions/mo, where DVNT hopes to be):
 *
 *   | bucket                                   | sess/mo | tx/sess | rate | spans/tx | spans/mo |
 *   | high-value (checkout,signup,lynk,upload) | 2,000   | 3       | 1.0  | 40       | 240,000  |
 *   | default navigation/API                   | 10,000  | 20      | 0.15 | 20       | 600,000  |
 *   | chatty routes + probes                   | —       | —       | ~0   | —        | ~0       |
 *   |                                          |         |         |      | TOTAL    | ≈840,000 |
 *
 *   ≈840,000 = 16.8% of 5M → 5.9× headroom (≥3× required). Even doubling every
 *   assumption (40 tx/sess, 40 spans/tx) lands ≈3.4M — still < 5M. The ~0
 *   chatty bucket is load-bearing: db-health alone (every-minute cron) would be
 *   ~43k tx/mo at 1.0. Spans are not the constraint; errors/replays are.
 */

/** Structural subset of the SDK's TracesSamplerSamplingContext we actually read.
 *  Kept local so this package stays dependency-free; the real signature is
 *  enforced by tsc where the fn is handed to Sentry.init (see header). */
export interface DvntSamplingContext {
  /** Transaction/span name. Client: pathname (`/checkout`). Server: `METHOD /route`
   *  (`POST /api/checkout/session`). Edge middleware: the matched route. */
  name?: string;
  attributes?: Record<string, unknown>;
  /** Returns a rate matching the incoming trace's decision, else the fallback. */
  inheritOrSampleWith?: (fallbackSampleRate: number) => number;
}

export const HIGH_VALUE_RATE = 1.0;
export const CHATTY_RATE = 0;
export const DEFAULT_RATE = 0.15;

interface SampleRule {
  test: RegExp;
  rate: number;
  label: string;
}

/**
 * Route → rate table. FIRST match wins, so order matters: chatty probes are
 * listed before the high-value block only where their paths could otherwise be
 * caught by a broader pattern (they can't here, but keep the ordering explicit).
 * Matched against a normalized name (METHOD prefix stripped, lowercased).
 */
export const SAMPLE_RULES: readonly SampleRule[] = [
  // ── chatty / operational → 0 (never spend span quota on these) ──
  { test: /(^|\/)(api\/observability|health|healthz|readyz|db-health|cdn-probe)\b/, rate: CHATTY_RATE, label: 'health-probe' },
  { test: /\.well-known/, rate: CHATTY_RATE, label: 'well-known' },
  { test: /(^|\/)(api\/)?(feed\/poll|feed\/stream|presence|heartbeat|ping)\b/, rate: CHATTY_RATE, label: 'polling-presence' },

  // ── money path: checkout end-to-end → 1.0 ──
  { test: /(^|\/)(api\/)?checkout\b/, rate: HIGH_VALUE_RATE, label: 'checkout' },
  { test: /(^|\/)(api\/)?(billing|stripe|purchases|orders)\b/, rate: HIGH_VALUE_RATE, label: 'money' },

  // ── signup / onboarding / verification / auth steps → 1.0 ──
  { test: /(onboarding|welcome|signup|sign-up|register)\b/, rate: HIGH_VALUE_RATE, label: 'onboarding' },
  { test: /(^|\/)(api\/)?verification\b/, rate: HIGH_VALUE_RATE, label: 'verification' },
  { test: /(^|\/)(api\/)?auth\b/, rate: HIGH_VALUE_RATE, label: 'auth' },

  // ── Sneaky Lynk join-to-first-frame → 1.0 ──
  { test: /(sneaky|lynk|sneaky-link|sneaky_link)\b/, rate: HIGH_VALUE_RATE, label: 'sneaky-lynk' },

  // ── media upload → 1.0 (uploads are the expensive, failure-prone media op) ──
  { test: /(^|\/)(api\/)?media\/upload\b/, rate: HIGH_VALUE_RATE, label: 'media-upload' },
  { test: /media[._]upload\b/, rate: HIGH_VALUE_RATE, label: 'media-upload' },
];

/** Strip a leading HTTP method token and lowercase — normalizes both the
 *  server `"POST /api/checkout/session"` and client `"/checkout"` name shapes. */
export function normalizeTransactionName(name: string): string {
  return name.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i, '').toLowerCase();
}

/** Pure, testable core: resolve the sample rate for a transaction name.
 *  Returns null when no rule matches (caller applies the default). */
export function sampleRateForName(name: string | undefined): number | null {
  if (!name) return null;
  const normalized = normalizeTransactionName(name);
  for (const rule of SAMPLE_RULES) {
    if (rule.test.test(normalized)) return rule.rate;
  }
  return null;
}

/**
 * The shared web tracesSampler. Explicit rules win; unmatched routes fall back
 * to 0.15 via `inheritOrSampleWith` so a parent-sampled distributed trace stays
 * coherent across browser → server → edge → Supabase edge fn.
 */
export function dvntTracesSampler(ctx: DvntSamplingContext): number {
  const matched = sampleRateForName(ctx.name);
  if (matched !== null) return matched;
  return ctx.inheritOrSampleWith ? ctx.inheritOrSampleWith(DEFAULT_RATE) : DEFAULT_RATE;
}
