/**
 * DvntMap — Production Expo Maps component (iOS/Android)
 *
 * Renders Google Maps (Android) or Apple Maps (iOS) via expo-maps.
 *
 * Loading-state contract:
 * - Shows loading overlay ONLY on first mount (hasMountedRef).
 * - Subsequent cameraPosition changes animate smoothly without re-triggering
 *   the loading state, preventing the double-load flicker.
 *
 * Rounded corners:
 * - `overflow: "hidden"` on any ancestor KILLS the Apple Maps Metal surface.
 * - Instead, pass `cornerRadius` + `maskColor` to render corner-mask overlay
 *   Views that visually clip the map without touching the Metal layer.
 *
 * Pin colors:
 * - "event" pins use DVNT primary purple (#8A40CF).
 * - "user" pins use DVNT accent pink (#FF6DC1).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Locate, MapPin } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";

// Lazy-load expo-maps to avoid crashes if native module isn't linked
let GoogleMapsView: any = null;
let AppleMapsView: any = null;
try {
  if (Platform.OS === "android") {
    const { GoogleMaps } = require("expo-maps");
    GoogleMapsView = GoogleMaps.View;
  } else if (Platform.OS === "ios") {
    const { AppleMaps } = require("expo-maps");
    AppleMapsView = AppleMaps.View;
  }
} catch {
  // Not available (Expo Go or web)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DvntMapMarker {
  id: string;
  coordinate: [number, number]; // [lng, lat]
  title?: string;
  subtitle?: string;
  icon?: "pin" | "event" | "user";
}

export interface DvntMapProps {
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  markers?: DvntMapMarker[];
  onMarkerPress?: (id: string) => void;
  showUserLocation?: boolean;
  pitch?: number;
  bearing?: number;
  className?: string;
  showControls?: boolean;
  onMapReady?: () => void;
  /**
   * Corner radius for the map surface.
   * Cannot use overflow:hidden with Apple Maps — we render corner-mask overlay
   * Views instead. Requires `maskColor` to be set.
   */
  cornerRadius?: number;
  /**
   * Background color to fill the corner-mask overlay Views.
   * Should match the container background behind/around the map.
   */
  maskColor?: string;
}

// [lng, lat] → { latitude, longitude }
function toLatLng(coord: [number, number]) {
  return { latitude: coord[1], longitude: coord[0] };
}

// ── Pin color ─────────────────────────────────────────────────────────────────

function getMarkerColor(icon?: string): string {
  switch (icon) {
    case "event":
      return "#8A40CF"; // DVNT primary purple
    case "user":
      return "#FF6DC1"; // DVNT accent pink
    default:
      return "#8A40CF";
  }
}

// ── Fallback ──────────────────────────────────────────────────────────────────

function MapUnavailable({ reason }: { reason: string }) {
  const { colors } = useColorScheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 24, gap: 12 }}>
      <MapPin size={40} color={colors.mutedForeground} />
      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", textAlign: "center" }}>
        Map Unavailable
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center" }}>
        {reason}
      </Text>
    </View>
  );
}

// ── Loading overlay ───────────────────────────────────────────────────────────

function MapLoadingOverlay({ color }: { color: string }) {
  return (
    <View
      style={{
        ...StyleSheet.absoluteFill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(12,12,16,0.6)",
      }}
      pointerEvents="none"
    >
      <ActivityIndicator size="large" color={color} />
    </View>
  );
}

// Need StyleSheet for absoluteFillObject
import { StyleSheet } from "react-native";

// ── Corner mask overlay ───────────────────────────────────────────────────────
// Renders 4 corner pieces matching maskColor to simulate rounded corners
// without overflow:hidden (which blanks Apple Maps' Metal surface).

function CornerMasks({ radius, color }: { radius: number; color: string }) {
  const s = radius;
  return (
    <>
      <View style={{ position: "absolute", top: 0, left: 0, width: s, height: s, backgroundColor: color, borderBottomRightRadius: s }} pointerEvents="none" />
      <View style={{ position: "absolute", top: 0, right: 0, width: s, height: s, backgroundColor: color, borderBottomLeftRadius: s }} pointerEvents="none" />
      <View style={{ position: "absolute", bottom: 0, left: 0, width: s, height: s, backgroundColor: color, borderTopRightRadius: s }} pointerEvents="none" />
      <View style={{ position: "absolute", bottom: 0, right: 0, width: s, height: s, backgroundColor: color, borderTopLeftRadius: s }} pointerEvents="none" />
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function DvntMapInner({
  center = [-73.9857, 40.7484],
  zoom = 12,
  markers = [],
  onMarkerPress,
  showUserLocation = false,
  pitch = 0,
  bearing = 0,
  className,
  showControls = true,
  onMapReady,
  cornerRadius = 0,
  maskColor,
}: DvntMapProps) {
  const { colors } = useColorScheme();
  const mapRef = useRef<any>(null);
  const hasReportedReadyRef = useRef(false);
  const hasMountedRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

  // expo-maps' setCameraPosition rejects ~50ms after the native view is
  // recycled (tag-not-found). The Promise rejection bubbles to our global
  // handler and spams the JS-CRASH log. Wrap in try + skip-when-unmounted
  // and silently swallow the unmount-race rejection.
  const safeSetCameraPosition = useCallback((config: any) => {
    if (isUnmountedRef.current) return;
    const ref = mapRef.current;
    if (!ref?.setCameraPosition) return;
    try {
      const result = ref.setCameraPosition(config);
      if (result && typeof result.then === "function") {
        result.catch((err: any) => {
          const msg = String(err?.message || err || "");
          if (msg.includes("AppleMapsViewWrapper") || msg.includes("GoogleMapsViewWrapper")) {
            return;
          }
          if (__DEV__) console.warn("[DvntMap] setCameraPosition failed:", msg);
        });
      }
    } catch (err: any) {
      if (__DEV__) console.warn("[DvntMap] setCameraPosition threw:", err?.message);
    }
  }, []);

  const cameraPosition = useMemo(
    () => ({
      coordinates: toLatLng(center),
      zoom: zoom || 15,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [center[0], center[1], zoom],
  );

  const finishLoading = useCallback(() => {
    setIsLoading(false);
    if (!hasReportedReadyRef.current) {
      hasReportedReadyRef.current = true;
      onMapReady?.();
    }
  }, [onMapReady]);

  const handleMapLoaded = useCallback(() => finishLoading(), [finishLoading]);
  const handleCameraMove = useCallback(() => finishLoading(), [finishLoading]);

  // Loading state only on first mount. Subsequent camera updates animate
  // smoothly without re-triggering the loading overlay.
  useEffect(() => {
    if (!hasMountedRef.current) {
      // First mount: initialize camera with no animation, show loading overlay
      hasMountedRef.current = true;
      hasReportedReadyRef.current = false;
      setIsLoading(true);

      const config =
        Platform.OS === "android"
          ? { ...cameraPosition, duration: 0 }
          : cameraPosition;
      safeSetCameraPosition(config);

      // AppleMaps doesn't expose a reliable "loaded" callback — use timeout fallback
      const timeoutId = setTimeout(
        finishLoading,
        Platform.OS === "ios" ? 600 : 1200,
      );
      return () => clearTimeout(timeoutId);
    } else {
      // Subsequent camera updates: smooth animated move, no loading state
      const config =
        Platform.OS === "android"
          ? { ...cameraPosition, duration: 400 }
          : cameraPosition;
      safeSetCameraPosition(config);
    }
  }, [cameraPosition, finishLoading]);

  const handleRecenter = useCallback(() => {
    mapRef.current?.setCameraPosition?.(
      Platform.OS === "android"
        ? { ...cameraPosition, duration: 350 }
        : cameraPosition,
    );
  }, [cameraPosition]);

  const handleMarkerPress = useCallback(
    (e: any) => {
      const markerId = e.nativeEvent?.id;
      if (markerId && onMarkerPress) onMarkerPress(String(markerId));
    },
    [onMarkerPress],
  );

  const MapView = Platform.OS === "android" ? GoogleMapsView : AppleMapsView;
  if (!MapView) {
    return (
      <MapUnavailable reason="expo-maps native module is not linked. Use a development build." />
    );
  }

  return (
    <View style={{ flex: 1 }} className={className || ""}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        cameraPosition={cameraPosition}
        markers={markers.map((m) => ({
          id: m.id,
          coordinates: toLatLng(m.coordinate),
          title: m.title,
          subtitle: m.subtitle,
          color: getMarkerColor(m.icon),
        }))}
        onMarkerPress={handleMarkerPress}
        onCameraMove={handleCameraMove}
        {...(Platform.OS === "android" ? { onMapLoaded: handleMapLoaded } : {})}
        uiSettings={{
          myLocationButtonEnabled: false,
          compassEnabled: false,
          scaleControlsEnabled: false,
        }}
        properties={{
          showsUserLocation: showUserLocation,
        }}
      />

      {/* Loading overlay — only visible on initial mount */}
      {isLoading && <MapLoadingOverlay color={colors.primary} />}

      {/* Corner masks — simulate borderRadius without overflow:hidden */}
      {cornerRadius > 0 && maskColor ? (
        <CornerMasks radius={cornerRadius} color={maskColor} />
      ) : null}

      {/* Recenter control */}
      {showControls && (
        <View
          style={{ position: "absolute", right: 12, bottom: 24 }}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={handleRecenter}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            }}
          >
            <Locate size={18} color={colors.foreground} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

export const DvntMap = React.memo(DvntMapInner);
