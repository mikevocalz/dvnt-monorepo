/**
 * EventsMapSheet
 *
 * Detached BottomSheetModal presenting the events map.
 *
 * Architecture:
 * - useEventMapController owns all data: geocoding, nearest-event sorting,
 *   viewport settling. The map is NOT rendered until isReady=true, so it
 *   mounts exactly once at the correct viewport (no double-load, no flicker).
 * - EventsMapView is a pure render component — stable props only.
 * - Corner radius is achieved via CornerMasks in DvntMap (no overflow:hidden).
 *
 * Initialization sequence:
 *   1. Sheet opens → controller starts resolving
 *   2. Skeleton shown while isReady=false
 *   3. isReady=true (events + location settled, or 900ms timeout)
 *   4. Map mounts ONCE at correct viewport
 *   5. Map remains stable — no camera jumps after settle
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import { MapPin, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useColorScheme } from "@/lib/hooks";
import { useEventMapController } from "@/lib/hooks/use-event-map-controller";
import { EventsMapView } from "@/components/events/events-map-view";
import { useEventsLocationStore } from "@/lib/stores/events-location-store";
import type { Event } from "@/lib/hooks/use-events";

interface EventsMapSheetProps {
  onDismiss: () => void;
  events: Event[];
}

// ── Skeleton shown while controller is resolving ──────────────────────────────

function MapSkeleton({ color }: { color: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
      <ActivityIndicator size="large" color={color} />
      <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: "500" }}>
        Finding events near you…
      </Text>
    </View>
  );
}

// ── Sheet ─────────────────────────────────────────────────────────────────────

export const EventsMapSheet: React.FC<EventsMapSheetProps> = ({
  onDismiss,
  events,
}) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const { colors } = useColorScheme();
  const router = useRouter();
  const activeCity = useEventsLocationStore((s) => s.activeCity);

  const controller = useEventMapController(events);

  // Present sheet on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => sheetRef.current?.present());
    return () => cancelAnimationFrame(id);
  }, []);

  const safeDismiss = useCallback(() => onDismiss(), [onDismiss]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) safeDismiss();
    },
    [safeDismiss],
  );

  const handleMarkerPress = useCallback(
    (id: string) => {
      safeDismiss();
      router.push(`/(protected)/events/${id}` as any);
    },
    [safeDismiss, router],
  );

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.55}
        pressBehavior="close"
      />
    ),
    [],
  );

  const snapPoints = useMemo(() => ["62%", "92%"], []);

  const headerLabel = useMemo(() => {
    if (activeCity?.state) return `Near ${activeCity.name}, ${activeCity.state}`;
    if (activeCity?.name) return `Near ${activeCity.name}`;
    return "Nearby Events";
  }, [activeCity]);

  // maskColor for corner masks must match the card background around the map
  const maskColor = colors.card;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      enableDynamicSizing={false}
      enablePanDownToClose
      detached
      bottomInset={46}
      style={{ marginHorizontal: 12 }}
      backgroundStyle={{
        backgroundColor: colors.card,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: 1,
        borderColor: colors.border,
      }}
      handleIndicatorStyle={{
        backgroundColor: colors.mutedForeground,
        width: 36,
        height: 4,
      }}
    >
      <View style={{ flex: 1 }}>
        {/* ── Header ── */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                backgroundColor: `${colors.primary}22`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MapPin size={15} color={colors.primary} />
            </View>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 15,
                fontWeight: "700",
                flexShrink: 1,
              }}
              numberOfLines={1}
            >
              {headerLabel}
            </Text>
            {controller.nearestCount > 0 && (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 20,
                  backgroundColor: `${colors.primary}20`,
                }}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 11,
                    fontWeight: "700",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {controller.nearestCount}
                </Text>
              </View>
            )}
          </View>

          <Pressable
            onPress={safeDismiss}
            hitSlop={12}
            accessibilityLabel="Close map"
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              backgroundColor: "rgba(255,255,255,0.08)",
              alignItems: "center",
              justifyContent: "center",
              marginLeft: 12,
            }}
          >
            <X size={15} color={colors.foreground} />
          </Pressable>
        </View>

        {/* ── Map card ── */}
        <View
          style={{
            flex: 1,
            marginHorizontal: 12,
            marginBottom: 12,
            borderRadius: 12,
            // NO overflow:hidden — that would blank Apple Maps' Metal surface.
            // Visual rounded corners are achieved by the CornerMasks rendered
            // inside DvntMap, which overlay the map corners with maskColor
            // (matching colors.card) to create the illusion of clipping.
          }}
        >
          {controller.isReady ? (
            <EventsMapView
              viewport={controller.viewport}
              markers={controller.markers}
              onMarkerPress={handleMarkerPress}
              maskColor={maskColor}
            />
          ) : (
            <MapSkeleton color={colors.primary} />
          )}
        </View>
      </View>
    </BottomSheetModal>
  );
};
