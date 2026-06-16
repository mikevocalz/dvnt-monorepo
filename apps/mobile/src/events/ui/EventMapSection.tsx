/**
 * Event Map Section
 * Shows event location on an expo-maps map with directions CTA.
 * Nicely designed card with overlay location info + full-width directions button.
 */

import { View, Text, Pressable, Platform, StyleSheet } from "react-native";
import { MapPin, Navigation } from "lucide-react-native";
import { DvntMap } from "@/src/components/map";
import type { NormalizedLocation } from "@/lib/types/location";
import { openDirections, hasValidCoordinates } from "@/lib/utils/location";
import { useCallback, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";

interface EventMapSectionProps {
  location: NormalizedLocation | null;
  eventTitle?: string;
  fallbackAddress?: string;
}

export function EventMapSection({
  location,
  eventTitle,
  fallbackAddress,
}: EventMapSectionProps) {
  const [isOpeningDirections, setIsOpeningDirections] = useState(false);

  const hasCoords = hasValidCoordinates(location);
  const displayName = location?.name || eventTitle || "Event Location";
  const displayAddress = location?.formattedAddress || fallbackAddress || "";

  const handleGetDirections = useCallback(async () => {
    if (!location || !hasCoords) return;
    setIsOpeningDirections(true);
    try {
      await openDirections(location, { label: eventTitle });
    } finally {
      setIsOpeningDirections(false);
    }
  }, [location, hasCoords, eventTitle]);

  if (!location && !fallbackAddress) return null;

  if (!hasCoords) {
    return (
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <View style={styles.pinWrap}>
            <MapPin size={18} color="#3FDCFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.venueName}>{displayName}</Text>
            {displayAddress ? (
              <Text style={styles.venueAddress}>{displayAddress}</Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.mapWrap}>
        <DvntMap
          center={[location!.longitude, location!.latitude]}
          zoom={15}
          markers={[
            {
              id: "event-location",
              coordinate: [location!.longitude, location!.latitude],
              title: displayName,
              icon: "event",
            },
          ]}
          showControls={false}
          onMapReady={undefined}
        />
        <LinearGradient
          colors={["transparent", "rgba(14,14,18,0.85)", "rgba(14,14,18,0.98)"]}
          locations={[0.3, 0.7, 1]}
          style={styles.mapGradient}
          pointerEvents="none"
        />
        <View style={styles.mapOverlay}>
          <View style={styles.infoRow}>
            <View style={styles.pinWrap}>
              <MapPin size={16} color="#3FDCFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.venueName} numberOfLines={1}>
                {displayName}
              </Text>
              {displayAddress ? (
                <Text style={styles.venueAddress} numberOfLines={1}>
                  {displayAddress}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </View>

      <Pressable
        onPress={handleGetDirections}
        disabled={isOpeningDirections}
        style={({ pressed }) => [
          styles.directionsBtn,
          pressed && !isOpeningDirections && { opacity: 0.8 },
        ]}
      >
        {isOpeningDirections ? (
          <View style={styles.spinner} />
        ) : (
          <Navigation size={16} color="#0a0a0a" strokeWidth={2.5} />
        )}
        <Text style={styles.directionsBtnText}>
          {isOpeningDirections ? "Opening Maps..." : "Get Directions"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#0e0e12",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  mapWrap: {
    height: 200,
    position: "relative",
  },
  mapGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 100,
  },
  mapOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pinWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(63,220,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  venueName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  venueAddress: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 2,
  },
  directionsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    backgroundColor: "#3FDCFF",
    margin: 12,
    borderRadius: 14,
  },
  directionsBtnText: {
    color: "#0a0a0a",
    fontSize: 14,
    fontWeight: "700",
  },
  spinner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#0a0a0a",
    borderTopColor: "transparent",
  },
});

export function EventMapSectionSkeleton() {
  return (
    <View
      style={{
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: "#0e0e12",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
      }}
    >
      <View style={{ height: 200, backgroundColor: "rgba(255,255,255,0.04)" }} />
      <View
        style={{
          height: 48,
          margin: 12,
          borderRadius: 14,
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      />
    </View>
  );
}
