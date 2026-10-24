/** Pure, shared rules. Neither OS permission nor legacy proximity grants opt into map sharing. */
export interface LocationAccessSnapshot {
  locationEnabled: boolean;
  eventsMapEnabled: boolean;
  revision: number;
  shareUntil: string | null;
}
export function mapGrantActive(settings: LocationAccessSnapshot | null, now: number): boolean {
  return !!settings && settings.locationEnabled === true && settings.eventsMapEnabled === true &&
    typeof settings.shareUntil === "string" && Number.isFinite(Date.parse(settings.shareUntil)) && Date.parse(settings.shareUntil) > now;
}
/** Stable ~1km latitude grid; only this coarse coordinate leaves the device for the people map. */
export function coarseMapPoint(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) throw new Error("Location is outside the supported map area.");
  const lat = Math.round(latitude * 100) / 100;
  const step = 0.01 / Math.max(Math.cos(lat * Math.PI / 180), 0.1);
  return { latitude: lat, longitude: Math.max(-180, Math.min(180, Math.round(longitude / step) * step)) };
}
export function acceptSettings(current: LocationAccessSnapshot | null, incoming: LocationAccessSnapshot): boolean {
  return Number.isSafeInteger(incoming.revision) && incoming.revision >= 0 && (!current || incoming.revision >= current.revision);
}
