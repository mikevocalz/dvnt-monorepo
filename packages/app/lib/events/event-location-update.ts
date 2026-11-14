/** Keep the free-text venue and its structured map data in the same revision. */
export function eventLocationUpdate(
  updates: {
    location?: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    locationLat?: number | null;
    locationLng?: number | null;
  },
  previousLocation: string | null | undefined,
): Record<string, string | number | null> {
  const patch: Record<string, string | number | null> = {};
  const changed = updates.location !== undefined &&
    (updates.location ?? "").trim() !== (previousLocation ?? "").trim();
  if (updates.location !== undefined) patch.location = (updates.location ?? "").trim();
  if (changed) {
    // The web editor accepts free text, not a selected/geocoded place. Never
    // keep the previous venue name/address or navigate to its old map pin.
    patch.location_name = null;
    patch.location_address = null;
    patch.location_lat = null;
    patch.location_lng = null;
  }
  if (updates.locationName !== undefined) patch.location_name = updates.locationName?.trim() || null;
  if (updates.locationAddress !== undefined) patch.location_address = updates.locationAddress?.trim() || null;
  if (updates.locationLat !== undefined) patch.location_lat = updates.locationLat;
  if (updates.locationLng !== undefined) patch.location_lng = updates.locationLng;
  return patch;
}
