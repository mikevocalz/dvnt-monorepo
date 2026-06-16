/**
 * DvntMap — Web fallback
 *
 * Native maps aren't rendered on web. This shows a graceful placeholder
 * card instead of failing. The events screen still works.
 */

import React from "react";
import { View, Text, Pressable, Linking } from "react-native";
import { MapPin, ExternalLink } from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";

export interface DvntMapMarker {
  id: string;
  coordinate: [number, number];
  title?: string;
  subtitle?: string;
  icon?: "pin" | "event" | "user";
}

export interface DvntMapProps {
  center?: [number, number];
  zoom?: number;
  markers?: DvntMapMarker[];
  onMarkerPress?: (id: string) => void;
  showUserLocation?: boolean;
  pitch?: number;
  bearing?: number;
  className?: string;
  showControls?: boolean;
  onMapReady?: () => void;
  cornerRadius?: number;
  maskColor?: string;
}

function DvntMapWeb({
  center = [-73.9857, 40.7484],
  markers = [],
  className,
}: DvntMapProps) {
  const { colors } = useColorScheme();

  const openInBrowser = () => {
    const [lng, lat] = center;
    const url = `https://www.google.com/maps/@${lat},${lng},14z`;
    Linking.openURL(url);
  };

  return (
    <View
      className={`flex-1 items-center justify-center bg-card rounded-2xl px-6 gap-4 ${className || ""}`}
    >
      <View
        className="w-16 h-16 rounded-full items-center justify-center"
        style={{ backgroundColor: `${colors.primary}20` }}
      >
        <MapPin size={28} color={colors.primary} />
      </View>

      <Text className="text-base font-semibold text-foreground text-center">
        Map View
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        Interactive maps are available on the mobile app.
        {markers.length > 0 &&
          ` ${markers.length} event${markers.length === 1 ? "" : "s"} in this area.`}
      </Text>

      <Pressable
        onPress={openInBrowser}
        className="flex-row items-center gap-2 bg-primary px-5 py-2.5 rounded-full"
      >
        <ExternalLink size={14} color="#fff" />
        <Text className="text-sm font-semibold text-primary-foreground">
          Open in Google Maps
        </Text>
      </Pressable>
    </View>
  );
}

export const DvntMap = React.memo(DvntMapWeb);
