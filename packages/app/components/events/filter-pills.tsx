import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import {
  MapPin,
  Globe,
  Moon,
  Calendar,
  Users,
  Lock,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";

export type EventFilter =
  | "in_city"
  | "online"
  | "tonight"
  | "this_weekend"
  | "friends_going"
  | "invite_only";

interface FilterPillsProps {
  activeFilters: EventFilter[];
  onToggle: (filter: EventFilter) => void;
  /** Active city name — shown in place of "In City" when the pill is active */
  activeCityName?: string | null;
}

const FILTERS: {
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

export const FilterPills: React.FC<FilterPillsProps> = ({
  activeFilters,
  onToggle,
  activeCityName,
}) => {
  return (
    <View className="py-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {FILTERS.map((filter) => {
          const isActive = activeFilters.includes(filter.id);
          const Icon = filter.icon;
          const label =
            filter.id === "in_city" && isActive && activeCityName
              ? `In ${activeCityName}`
              : filter.label;
          return (
            <Pressable
              key={filter.id}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onToggle(filter.id);
              }}
              className="flex-row items-center gap-1.5 rounded-full px-4 py-2"
              style={{
                backgroundColor: isActive
                  ? `${filter.activeColor}18`
                  : "rgba(255,255,255,0.05)",
                borderWidth: 1,
                borderColor: isActive
                  ? `${filter.activeColor}40`
                  : "rgba(255,255,255,0.08)",
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
      </ScrollView>
    </View>
  );
};
