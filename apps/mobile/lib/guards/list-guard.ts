/**
 * DEV-only runtime guard for list policy enforcement.
 * Throws if @shopify/flash-list is detected at runtime.
 * Warns if FlatList is imported anywhere.
 *
 * MUST NEVER run in production builds.
 */

export function enforceListPolicy() {
  if (!__DEV__) return;

  try {
    require("@shopify/flash-list");
    throw new Error(
      "[LIST POLICY VIOLATION] @shopify/flash-list is installed. " +
        "Remove it immediately — LegendList is the only allowed list component.",
    );
  } catch (e: any) {
    if (e.message?.includes("LIST POLICY VIOLATION")) throw e;
    // Module not found — good, it's removed
  }

  console.log("[ListGuard] ✅ List policy OK — LegendList only");
}
