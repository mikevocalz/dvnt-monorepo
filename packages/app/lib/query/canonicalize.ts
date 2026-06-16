/**
 * Canonicalization Helpers for Query Keys
 *
 * Ensures query keys are stable across renders by sorting object keys
 * and producing deterministic string representations.
 *
 * Usage:
 *   stableStringify({ b: 2, a: 1 }) => '{"a":1,"b":2}'
 *   canonicalizeEventFilters(filters) => stable string for queryKey
 */

/**
 * JSON.stringify with sorted keys — produces identical output
 * regardless of property insertion order.
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`)
    .join(",");
  return "{" + sorted + "}";
}

/**
 * Canonical key from any object — stable string for use in queryKey arrays.
 */
export function keyFromCanonical(obj: unknown): string {
  return stableStringify(obj);
}

/**
 * Canonicalize event filters into a stable queryKey segment.
 */
export function canonicalizeEventFilters(filters: {
  online?: boolean;
  tonight?: boolean;
  weekend?: boolean;
  search?: string;
  sort?: string;
  cityId?: number | string;
  categories?: string[];
  category?: string;
}): string {
  return stableStringify({
    online: filters.online || false,
    tonight: filters.tonight || false,
    weekend: filters.weekend || false,
    search: filters.search || "",
    sort: filters.sort || "soonest",
    cityId: filters.cityId || null,
    categories: (filters.categories || []).sort(),
    category: filters.category || null,
  });
}

/**
 * Canonicalize search state into a stable queryKey segment.
 */
export function canonicalizeSearchState(state: {
  query: string;
  tab?: string;
  filters?: Record<string, unknown>;
}): string {
  return stableStringify({
    query: state.query.trim().toLowerCase(),
    tab: state.tab || "all",
    filters: state.filters || {},
  });
}
