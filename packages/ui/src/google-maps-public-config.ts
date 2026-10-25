/** Browser-public Maps configuration only; never fall back to server/Places keys. */
export function resolveGoogleMapsPublicKey(nextKey?: string, expoKey?: string): string {
  return nextKey?.trim() || expoKey?.trim() || "";
}

export function getGoogleMapsPublicKey(): string {
  // Keep static references: Next/Expo substitute these at build time.
  return resolveGoogleMapsPublicKey(
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
  );
}
