/**
 * EventsMapView — pure render component.
 *
 * Accepts a pre-computed viewport and markers from useEventMapController.
 * Does NO data fetching, NO center computation, NO geocoding.
 * Stabilizes the center array so DvntMap's cameraPosition memo doesn't
 * fire on reference-equal values.
 */

import { useRef } from "react";
import { DvntMap } from "@/src/components/map";
import type { DvntMapMarker } from "@/src/components/map";
import type { MapViewport } from "@/lib/hooks/use-event-map-controller";

interface EventsMapViewProps {
  viewport: MapViewport;
  markers: DvntMapMarker[];
  onMarkerPress?: (id: string) => void;
  maskColor?: string;
}

export function EventsMapView({
  viewport,
  markers,
  onMarkerPress,
  maskColor,
}: EventsMapViewProps) {
  // Stabilize the center tuple — prevents a new array reference on every render
  // from triggering DvntMap's cameraPosition useMemo and the subsequent effect.
  const centerRef = useRef<[number, number]>([viewport.centerLng, viewport.centerLat]);
  if (
    centerRef.current[0] !== viewport.centerLng ||
    centerRef.current[1] !== viewport.centerLat
  ) {
    centerRef.current = [viewport.centerLng, viewport.centerLat];
  }

  return (
    <DvntMap
      center={centerRef.current}
      zoom={viewport.zoom}
      markers={markers}
      onMarkerPress={onMarkerPress}
      showUserLocation
      showControls={false}
      cornerRadius={12}
      maskColor={maskColor}
    />
  );
}
