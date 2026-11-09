/** Match the profile's server-approved bands or versioned exact lease. Never derive member mileage from
 * public city centers, map pins, or device coordinates. */
const labels: Record<string, string> = {
  under_1: "Less than a mile away",
  "1_5": "A few miles away",
  "5_15": "Across town",
  "15_50": "Nearby area",
  far: "Far away",
};
export function memberDistanceLabel(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const result = value as { kind?: unknown; band?: unknown; consentVersion?: unknown; miles?: unknown; expiresAt?: unknown };
  if (result.kind === "distance" && result.consentVersion === 2 &&
      typeof result.miles === "number" && Number.isFinite(result.miles) && result.miles >= 0 &&
      typeof result.expiresAt === "string" && Date.parse(result.expiresAt) > Date.now()) {
    return `${result.miles.toFixed(2)} miles away`;
  }
  return result.kind === "distance" && typeof result.band === "string" &&
    Object.prototype.hasOwnProperty.call(labels, result.band) ? labels[result.band] : null;
}
