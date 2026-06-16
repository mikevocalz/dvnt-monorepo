/**
 * Decellus Ad Slot — scaffold component
 *
 * Accepts a placement key, fetches config from ads_config table,
 * renders placeholder content if no active ad is configured.
 * No ad network integration required now.
 */

import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import Animated, { FadeIn } from "react-native-reanimated";
import { Megaphone } from "lucide-react-native";
import { supabase } from "@dvnt/app/lib/supabase/client";
import * as Linking from "expo-linking";

interface AdConfig {
  id: string;
  placement_key: string;
  title: string | null;
  image_url: string | null;
  tap_url: string | null;
  active: boolean;
}

interface DeccellusAdSlotProps {
  placementKey: string;
  style?: any;
}

export function DeccellusAdSlot({ placementKey, style }: DeccellusAdSlotProps) {
  const [ad, setAd] = useState<AdConfig | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("ads_config")
          .select("*")
          .eq("placement_key", placementKey)
          .eq("active", true)
          .single();

        if (mounted && data) {
          setAd(data);
        }
      } catch {
        // No ad configured — silent
      }
    })();
    return () => {
      mounted = false;
    };
  }, [placementKey]);

  // No active ad — render nothing or placeholder
  if (!ad) return null;

  return (
    <Animated.View entering={FadeIn.duration(400)} style={style}>
      <Pressable
        onPress={() => {
          if (ad.tap_url) {
            Linking.openURL(ad.tap_url).catch(() => {});
          }
        }}
        className="rounded-xl overflow-hidden border border-border bg-card"
      >
        {ad.image_url ? (
          <Image
            source={{ uri: ad.image_url }}
            style={{ width: "100%", height: 80 }}
            contentFit="cover"
          />
        ) : (
          <View className="h-16 items-center justify-center flex-row gap-2 px-4">
            <Megaphone size={16} color="#8A40CF" />
            <Text className="text-sm text-muted-foreground">
              {ad.title || "Sponsored"}
            </Text>
          </View>
        )}
        <View className="absolute bottom-1 right-2">
          <Text className="text-[8px] text-muted-foreground/50">Ad</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
