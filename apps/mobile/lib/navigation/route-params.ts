/**
 * Shared Route Param Utilities
 * 
 * Production-grade param normalization to prevent infinite loops
 * caused by string|string[] type instability from Expo Router.
 * 
 * CRITICAL: All routed screens MUST normalize params once at mount
 * using these utilities to prevent render loops.
 */

/**
 * Normalize a single route param from string|string[] to string|undefined.
 * Handles Expo Router's type instability.
 */
export function normalizeParam(
  value: string | string[] | undefined
): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Normalize all route params in an object.
 * Use with useMemo to ensure stable references.
 * 
 * @example
 * const rawParams = useLocalSearchParams<{ id: string; name?: string }>();
 * const { id, name } = useMemo(
 *   () => normalizeRouteParams(rawParams),
 *   [rawParams.id, rawParams.name]
 * );
 */
export function normalizeRouteParams<T extends Record<string, any>>(
  rawParams: T
): { [K in keyof T]: string | undefined } {
  const normalized: any = {};
  for (const key in rawParams) {
    normalized[key] = normalizeParam(rawParams[key]);
  }
  return normalized;
}

/**
 * Type-safe param normalizer with required/optional distinction.
 * 
 * @example
 * const params = useSafeParams(rawParams, {
 *   required: ['id'],
 *   optional: ['username', 'avatar']
 * });
 * // params.id is string (guaranteed)
 * // params.username is string | undefined
 */
export function useSafeParams<
  R extends string,
  O extends string
>(
  rawParams: Record<string, string | string[] | undefined>,
  config: { required: readonly R[]; optional?: readonly O[] }
): Record<R, string> & Record<O, string | undefined> {
  const result: any = {};
  
  // Required params - throw if missing
  for (const key of config.required) {
    const normalized = normalizeParam(rawParams[key]);
    if (!normalized) {
      throw new Error(`[RouteParams] Required param "${key}" is missing`);
    }
    result[key] = normalized;
  }
  
  // Optional params
  if (config.optional) {
    for (const key of config.optional) {
      result[key] = normalizeParam(rawParams[key]);
    }
  }
  
  return result;
}

/**
 * Validate and normalize numeric ID params.
 * Returns null if invalid to allow error handling.
 */
export function normalizeIdParam(
  value: string | string[] | undefined
): string | null {
  const normalized = normalizeParam(value);
  if (!normalized) return null;
  
  // Accept both numeric IDs and string identifiers (usernames, etc)
  return normalized;
}

/**
 * Parse boolean param from string.
 * Expo Router passes booleans as strings "true"/"false".
 */
export function normalizeBooleanParam(
  value: string | string[] | undefined
): boolean {
  const normalized = normalizeParam(value);
  return normalized === "true";
}

/**
 * Parse numeric param from string.
 * Returns undefined if invalid.
 */
export function normalizeNumberParam(
  value: string | string[] | undefined
): number | undefined {
  const normalized = normalizeParam(value);
  if (!normalized) return undefined;
  const num = Number(normalized);
  return isNaN(num) ? undefined : num;
}
