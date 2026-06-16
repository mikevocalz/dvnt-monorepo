import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { GlassSheetBackground } from "@/components/sheets/glass-sheet-background";
import {
  MapPin,
  Globe,
  Moon,
  Calendar,
  Users,
  Lock,
  ArrowUpDown,
  Check,
  ChevronUp,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useEventsScreenStore } from "@/lib/stores/events-screen-store";
import { useEventsLocationStore } from "@/lib/stores/events-location-store";
import { useDeviceLocation } from "@/lib/hooks/use-device-location";
import {
  EVENT_CATEGORIES,
  type EventCategory,
} from "@/lib/constants/event-categories";
import type { EventFilter } from "@/components/events/filter-pills";
import type { EventSort } from "@/lib/hooks/use-events";

interface EventFilterSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

const QUICK_FILTERS: {
  id: EventFilter;
  label: string;
  icon: React.FC<any>;
  activeColor: string;
}[] = [
  { id: "in_city", label: "In City", icon: MapPin, activeColor: "#3EA4E5" },
  { id: "online", label: "Online", icon: Globe, activeColor: "#10B981" },
  { id: "tonight", label: "Tonight", icon: Moon, activeColor: "#8B5CF6" },
  {
    id: "this_weekend",
    label: "Weekend",
    icon: Calendar,
    activeColor: "#F59E0B",
  },
  {
    id: "friends_going",
    label: "Friends Going",
    icon: Users,
    activeColor: "#EC4899",
  },
  {
    id: "invite_only",
    label: "Invite-only",
    icon: Lock,
    activeColor: "#EF4444",
  },
];

const SORT_OPTIONS: { id: EventSort; label: string }[] = [
  { id: "soonest", label: "Soonest" },
  { id: "newest", label: "Newest" },
  { id: "popular", label: "Popular" },
  { id: "price_low", label: "Price ↑" },
  { id: "price_high", label: "Price ↓" },
];

export const EventFilterSheet: React.FC<EventFilterSheetProps> = ({
  visible,
  onDismiss,
}) => {
  const sheetRef = useRef<BottomSheetModal>(null);

  const activeFilters = useEventsScreenStore((s) => s.activeFilters);
  const toggleFilter = useEventsScreenStore((s) => s.toggleFilter);
  const activeCategories = useEventsScreenStore((s) => s.activeCategories);
  const toggleCategory = useEventsScreenStore((s) => s.toggleCategory);
  const activeSort = useEventsScreenStore((s) => s.activeSort);
  const setActiveSort = useEventsScreenStore((s) => s.setActiveSort);
  const clearAllFilters = useEventsScreenStore((s) => s.clearAllFilters);
  const { isAvailable: hasDeviceLocation, requestLocation } = useDeviceLocation();
  const activeCity = useEventsLocationStore((s) => s.activeCity);
  const setCityPickerVisible = useEventsScreenStore((s) => s.setCityPickerVisible);

  const snapPoints = useMemo(() => ["75%"], []);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onDismiss();
    },
    [onDismiss],
  );

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleApply = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDismiss();
  }, [onDismiss]);

  const handleClearAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearAllFilters();
  }, [clearAllFilters]);

  const handleToggleFilter = useCallback(
    async (filter: EventFilter) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (filter === "in_city" && !activeFilters.includes("in_city") && !hasDeviceLocation) {
        // Need GPS before activating — request permission now
        const granted = await requestLocation();
        if (!granted) return;
      }
      toggleFilter(filter);
    },
    [toggleFilter, activeFilters, hasDeviceLocation, requestLocation],
  );

  const handleToggleCategory = useCallback(
    (category: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      toggleCategory(category);
    },
    [toggleCategory],
  );

  const handleSetSort = useCallback(
    (sort: EventSort) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setActiveSort(sort);
    },
    [setActiveSort],
  );

  const handleOpenCityPicker = useCallback(() => {
    onDismiss();
    // Small delay so the filter sheet dismisses first
    const id = requestAnimationFrame(() => {
      setCityPickerVisible(true);
    });
    return () => cancelAnimationFrame(id);
  }, [onDismiss, setCityPickerVisible]);

  const totalActive =
    activeFilters.length +
    activeCategories.length +
    (activeSort !== "soonest" ? 1 : 0);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      detached={true}
      bottomInset={46}
      style={{ marginHorizontal: 16, zIndex: 9999, elevation: 9999 }}
      backgroundComponent={GlassSheetBackground}
      handleIndicatorStyle={{
        backgroundColor: "#555",
        width: 36,
        height: 4,
      }}
    >
      <BottomSheetScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Header */}
        <View className="px-5 pb-4">
          <Text className="text-xl font-bold text-white text-center">
            Filter Your Feed
          </Text>
        </View>

        {/* Quick Filters */}
        <View className="px-5 mb-5">
          <Text className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3">
            Quick Filters
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {QUICK_FILTERS.map((filter) => {
              const isActive = activeFilters.includes(filter.id);
              const Icon = filter.icon;
              const label =
                filter.id === "in_city" && isActive ? "Near Me" : filter.label;
              return (
                <Pressable
                  key={filter.id}
                  onPress={() => handleToggleFilter(filter.id)}
                  className="flex-row items-center gap-1.5 px-4 py-2.5 rounded-full"
                  style={{
                    backgroundColor: isActive
                      ? `${filter.activeColor}20`
                      : "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: isActive
                      ? `${filter.activeColor}50`
                      : "rgba(255,255,255,0.1)",
                  }}
                >
                  <Icon
                    size={14}
                    color={isActive ? filter.activeColor : "#888"}
                    strokeWidth={2}
                  />
                  <Text
                    className="text-[13px] font-semibold"
                    style={{
                      color: isActive ? filter.activeColor : "#999",
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Sort By */}
        <View className="px-5 mb-5">
          <View className="flex-row items-center gap-1.5 mb-3">
            <ArrowUpDown size={14} color="#888" strokeWidth={2} />
            <Text className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">
              Sort By
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {SORT_OPTIONS.map((option) => {
              const isActive = activeSort === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => handleSetSort(option.id)}
                  className="flex-row items-center gap-1.5 px-4 py-2.5 rounded-full"
                  style={{
                    backgroundColor: isActive
                      ? "rgba(255,255,255,0.15)"
                      : "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: isActive
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.1)",
                  }}
                >
                  {isActive && (
                    <Check size={13} color="#fff" strokeWidth={2.5} />
                  )}
                  <Text
                    className="text-[13px] font-semibold"
                    style={{ color: isActive ? "#fff" : "#999" }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Categories */}
        <View className="px-5 mb-5">
          <Text className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3">
            Categories
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {EVENT_CATEGORIES.map((cat: EventCategory) => {
              const isActive = activeCategories.includes(cat.value);
              return (
                <Pressable
                  key={cat.value}
                  onPress={() => handleToggleCategory(cat.value)}
                  className="px-4 py-2.5 rounded-full"
                  style={{
                    backgroundColor: isActive
                      ? "rgba(255,255,255,0.15)"
                      : "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: isActive
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.1)",
                  }}
                >
                  <Text
                    className="text-[13px] font-semibold"
                    style={{ color: isActive ? "#fff" : "#999" }}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Location */}
        <View className="px-5 mb-5">
          <Text className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3">
            Location
          </Text>
          <Pressable
            onPress={handleOpenCityPicker}
            className="flex-row items-center gap-3 px-4 py-3 rounded-2xl"
            style={{
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.1)",
            }}
          >
            <MapPin size={16} color="#3EA4E5" strokeWidth={2} />
            <Text className="flex-1 text-[15px] text-white font-medium">
              {activeCity?.name || "All Cities"}
            </Text>
            <ChevronUp
              size={16}
              color="#888"
              strokeWidth={2}
              style={{ transform: [{ rotate: "90deg" }] }}
            />
          </Pressable>
        </View>
      </BottomSheetScrollView>

      {/* Bottom Action Bar — fixed */}
      <View
        className="absolute bottom-0 left-0 right-0 flex-row items-center gap-3 px-5 pb-8 pt-4"
        style={{ backgroundColor: "#111" }}
      >
        <Pressable
          onPress={handleClearAll}
          className="px-5 py-3.5 rounded-2xl border"
          style={{ borderColor: "rgba(255,255,255,0.15)" }}
        >
          <Text className="text-sm font-semibold text-white">Clear All</Text>
        </Pressable>
        <Pressable
          onPress={handleApply}
          className="flex-1 py-3.5 rounded-2xl items-center"
          style={{ backgroundColor: "#fff" }}
        >
          <Text className="text-sm font-bold text-black">
            Apply{totalActive > 0 ? ` (${totalActive})` : ""}
          </Text>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
};
