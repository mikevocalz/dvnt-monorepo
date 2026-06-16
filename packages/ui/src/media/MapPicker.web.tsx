"use client";

import { useState } from "react";
import { APIProvider, Map, Marker } from "@vis.gl/react-google-maps";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapPickerProps {
  /** Google Maps JS API key. Falls back to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. */
  apiKey?: string;
  /** Controlled selected point. */
  value?: LatLng | null;
  /** Initial center if no value. Default NYC. */
  defaultCenter?: LatLng;
  /** Fires when the user taps the map (location picker mode). */
  onChange?: (point: LatLng) => void;
  /** Read-only: render a fixed marker, ignore taps. */
  readOnly?: boolean;
  zoom?: number;
  /** Height in px. Default 280. */
  height?: number;
}

/**
 * Interactive map / location picker (web) via `@vis.gl/react-google-maps` — the
 * React-equivalent of the native react-native-maps picker. For read-only display
 * an embed iframe is also acceptable; this gives tap-to-place. Native sibling
 * uses react-native-maps.
 */
export function MapPicker({
  apiKey,
  value,
  defaultCenter = { lat: 40.7128, lng: -74.006 },
  onChange,
  readOnly,
  zoom = 12,
  height = 280,
}: MapPickerProps) {
  const [point, setPoint] = useState<LatLng | null>(value ?? null);
  const key = apiKey ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const center = value ?? point ?? defaultCenter;

  return (
    <div className="w-full overflow-hidden rounded-2xl" style={{ height }}>
      <APIProvider apiKey={key}>
        <Map
          defaultCenter={center}
          defaultZoom={zoom}
          gestureHandling="greedy"
          disableDefaultUI
          onClick={(e) => {
            if (readOnly) return;
            const ll = e.detail.latLng;
            if (!ll) return;
            const next = { lat: ll.lat, lng: ll.lng };
            setPoint(next);
            onChange?.(next);
          }}
        >
          {(value ?? point) ? <Marker position={value ?? point ?? center} /> : null}
        </Map>
      </APIProvider>
    </div>
  );
}
