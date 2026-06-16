/**
 * @dvnt/network — platform-neutral prewarm registry.
 *
 * Screens declare their prewarm plan ONCE here (or via `definePrewarm` at module
 * load) and both platforms' intent handlers call {@link prewarm}(routeName) to
 * execute it. This file is the single source of truth for "what gets warmed when
 * the user signals intent to navigate to X" — the composition described in
 * docs/architecture/runtime-topology.md §3.
 *
 * It is deliberately free of any platform import (no fetch, no expo-image, no
 * nitro) so it resolves identically on web and native. The platform clients
 * import {@link getPrewarmPlan} and supply the primitives.
 */
import type { PrewarmPlan, PrewarmPlanFactory } from "./types";

const PLANS = new Map<string, PrewarmPlanFactory>();

/**
 * Register (or replace) a route's prewarm plan. Pass a plain plan for static
 * routes, or a factory when the plan depends on call-site context (e.g. a
 * conversation id feeding the runtime name `chat-${id}`).
 *
 * @example
 * definePrewarm("chat", (ctx) => ({
 *   data: [{ key: `messages:${ctx?.id}`, url: `/conversations/${ctx?.id}/messages` }],
 *   runtime: { name: `chat-${ctx?.id}`, context: ctx },
 *   assets: [],
 * }));
 */
export function definePrewarm(
  routeName: string,
  plan: PrewarmPlan | PrewarmPlanFactory,
): void {
  const factory: PrewarmPlanFactory =
    typeof plan === "function" ? plan : () => plan;
  PLANS.set(routeName, factory);
}

/** Resolve a route's plan for the given context, or `null` if none is registered. */
export function getPrewarmPlan(
  routeName: string,
  context?: Record<string, unknown>,
): PrewarmPlan | null {
  const factory = PLANS.get(routeName);
  return factory ? factory(context) : null;
}

/** Every registered route name — useful for boot-time auto-prewarm of critical routes. */
export function registeredRoutes(): string[] {
  return Array.from(PLANS.keys());
}

/**
 * Routes whose data layer is cheap and universally hit (session, config, feed
 * page 1). The app auto-prewarms these at startup (layer 1 only). Margelo
 * measured this at ~hundreds of ms of TTI; verify with our own numbers in the
 * spike (docs/spikes/rn-runtimes.md §1).
 */
export const BOOT_CRITICAL_ROUTES = ["session", "config", "feed"] as const;

export type { PrewarmPlan, PrewarmPlanFactory, PrefetchSpec, RuntimeSpec } from "./types";
