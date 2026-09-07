/**
 * KlipyAttribution — the visible credit Klipy requires wherever their content
 * is displayed. Access to the API is conditional on it, so callers must place
 * this outside any scroll container and hide it when content is not Klipy's.
 */

import React, { memo } from "react";
import { View, Text } from "react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { GLASS_SURFACE } from "@dvnt/app/lib/ui/glass";

const ATTRIBUTION_LABEL = "Powered by KLIPY";

interface KlipyAttributionProps {
  className?: string;
}

export const KlipyAttribution = memo(function KlipyAttribution({
  className,
}: KlipyAttributionProps) {
  const { colors } = useColorScheme();

  return (
    <View
      className={`flex-row items-center justify-center gap-2 px-4 py-2 ${className ?? ""}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={ATTRIBUTION_LABEL}
      // Near-opaque scrim: this bar sits on a glass panel over story media,
      // so the tray's own translucency cannot be trusted for text contrast.
      style={{
        backgroundColor: GLASS_SURFACE.androidSurface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <Text
        className="text-[11px] font-semibold"
        style={{ color: colors.mutedForeground, letterSpacing: 0.4 }}
      >
        {ATTRIBUTION_LABEL}
      </Text>
    </View>
  );
});
