/**
 * NetworkQualityIndicator — three-bar signal strength for a call tile.
 *
 * Was co-located with a ConnectionBanner that has since been promoted to
 * `@dvnt/ui` (one banner for every call and room, code-standards §2). This is
 * the part that stayed: a per-peer quality readout is a different job from a
 * session-wide status strip, and only calls render it.
 */

import { View } from "react-native";
import { c } from "./styles";

export function NetworkQualityIndicator({ quality }: { quality: "good" | "fair" | "poor" }) {
  const bars = quality === "good" ? 3 : quality === "fair" ? 2 : 1;
  const color = quality === "good" ? "#22c55e" : quality === "fair" ? "#f59e0b" : "#ef4444";

  return (
    <View className="flex-row items-end gap-0.5">
      {[1, 2, 3].map((bar) => (
        <View
          key={bar}
          style={{
            width: 3,
            height: 4 + bar * 3,
            backgroundColor: bar <= bars ? color : "rgba(255,255,255,0.2)",
            borderRadius: 1,
          }}
        />
      ))}
    </View>
  );
}
