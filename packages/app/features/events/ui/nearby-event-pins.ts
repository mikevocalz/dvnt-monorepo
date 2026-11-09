import type { EventMapPin } from "../../../lib/events/event-map";

/** Rank public venues against a fresh, consented approximate area, never a saved
 * city or selected event. These are venue distances, not member distances. */
export function nearbyEventPins(
  pins: readonly EventMapPin[],
  area: { latitude: number; longitude: number; expiresAt: string } | null | undefined,
  now: number,
): EventMapPin[] {
  if (!area || !Number.isFinite(Date.parse(area.expiresAt)) || Date.parse(area.expiresAt) <= now ||
    !validPoint(area)) return [];
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const distance = (pin: EventMapPin) => {
    const dLat = radians(pin.latitude - area.latitude);
    const dLng = radians(pin.longitude - area.longitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(area.latitude)) *
      Math.cos(radians(pin.latitude)) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
  };
  return pins.filter(validPoint).map(pin => ({ pin, miles: distance(pin) }))
    .filter(item => item.miles <= 25)
    .sort((a, b) => a.miles - b.miles || a.pin.id.localeCompare(b.pin.id))
    .slice(0, 10).map(item => item.pin);
}
function validPoint(point: { latitude: number; longitude: number }) {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}
