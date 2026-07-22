import { useEffect } from "react";
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import { ChevronRight } from "lucide-react-native";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import {
  computeProfileCompletion,
  useOnboardingV2Store,
} from "@dvnt/app/lib/stores/onboarding-v2-store";

const P = "rgb(62, 164, 229)";

/**
 * B2 completion mechanism — NATIVE. Weighted ring + the 3 highest-value
 * missing items with one-tap jumps into edit-profile. Hidden at 100%.
 * Mirror of the web ProfileCompletionCard; tokens per the B0 audit.
 */
export function ProfileCompletionCard() {
  const user = useAuthStore((s) => s.user);
  const requestNudge = useOnboardingV2Store((s) => s.requestNudge);
  const markStep = useOnboardingV2Store((s) => s.markStep);
  const { percent, missing } = computeProfileCompletion(user);

  // Session-capped nudge (the cap lives in the store, not here).
  useEffect(() => {
    if (percent < 60 && missing.length > 0) requestNudge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user || percent >= 100) return null;

  const R = 20;
  const C = 2 * Math.PI * R;
  const topMissing = missing.slice(0, 3);

  return (
    <View
      style={{
        marginTop: 16,
        marginHorizontal: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.1)",
        backgroundColor: "rgba(255,255,255,0.04)",
        padding: 16,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <View style={{ width: 56, height: 56 }}>
          <Svg width={56} height={56} viewBox="0 0 48 48" style={{ transform: [{ rotate: "-90deg" }] }}>
            <Circle cx={24} cy={24} r={R} fill="none" strokeWidth={4} stroke="rgba(255,255,255,0.1)" />
            <Circle
              cx={24}
              cy={24}
              r={R}
              fill="none"
              strokeWidth={4}
              strokeLinecap="round"
              stroke={percent >= 80 ? "#FF5BFC" : P}
              strokeDasharray={`${C}`}
              strokeDashoffset={C * (1 - percent / 100)}
            />
          </Svg>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{percent}%</Text>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>
            Finish your profile
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, marginTop: 2 }}>
            A complete profile gets you recognized at events.
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 12 }}>
        {topMissing.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => {
              markStep(`profile.${item.key}`, "done");
              router.push("/(protected)/edit-profile" as any);
            }}
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 10,
              borderTopWidth: 1,
              borderTopColor: "rgba(255,255,255,0.08)",
            }}
          >
            <Text
              style={{ flex: 1, color: "rgba(255,255,255,0.8)", fontSize: 14, paddingRight: 12 }}
              numberOfLines={1}
            >
              {item.label}
            </Text>
            <ChevronRight size={16} color="rgba(255,255,255,0.4)" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
