/** A selected database city is a map viewport, never device/presence authority. */
export function savedMapArea(city: { id: number; name: string; state?: string | null; lat: number; lng: number } | null | undefined) {
  if (!city || city.id <= 0 || !Number.isFinite(city.lat) || !Number.isFinite(city.lng) || Math.abs(city.lat) > 85 || Math.abs(city.lng) > 180) return null;
  return { latitude: city.lat, longitude: city.lng, label: [city.name, city.state].filter(Boolean).join(", ") };
}
