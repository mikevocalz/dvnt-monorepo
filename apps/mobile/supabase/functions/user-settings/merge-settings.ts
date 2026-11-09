/** Preserve sibling preferences when a settings screen sends one toggle. */
export function mergeSettings(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    // These keys are never preferences and must not change the result's prototype.
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const previous = existing[key];
    merged[key] = isSettingsObject(previous) && isSettingsObject(value)
      ? mergeSettings(previous, value)
      : value;
  }
  return merged;
}

export function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
