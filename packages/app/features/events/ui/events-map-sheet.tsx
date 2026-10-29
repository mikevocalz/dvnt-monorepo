/** One map surface for public event flyers and consented member avatars. */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable} from "react-native";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import { MapPin, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import MemberMap from "./member-map";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import type { Event } from "@dvnt/app/lib/hooks/use-events";

interface EventsMapSheetProps {
  onDismiss: () => void;
  events: Event[];
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
    return "Events & People";
  }, [activeCity]);

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
          }}
        >
          <MemberMap events={events} onOpenEvent={handleMarkerPress} />
        </View>
      </View>
    </BottomSheetModal>
  );
};
