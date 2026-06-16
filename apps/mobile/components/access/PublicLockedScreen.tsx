import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Lock, ArrowRight } from "lucide-react-native";
import {
  getPublicGateConfig,
  type PublicGateReason,
} from "@/lib/access/public-gates";

export function PublicLockedScreen({
  reason,
  kicker,
}: {
  reason: PublicGateReason;
  kicker?: string;
}) {
  const router = useRouter();
  const config = getPublicGateConfig(reason);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.badge}>
          <Lock size={16} color="#fff" />
          <Text style={styles.badgeText}>{kicker || config.eyebrow}</Text>
        </View>

        <Text style={styles.title}>{config.title}</Text>
        <Text style={styles.description}>{config.description}</Text>

        <View style={styles.note}>
          <Text style={styles.noteText}>
            Browse stays open. Private, personal, and participation surfaces
            unlock after signup and, where needed, verification.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => router.push("/(auth)/signup" as any)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{config.primaryCta}</Text>
            <ArrowRight size={16} color="#000" />
          </Pressable>

          <Pressable
            onPress={() => router.push("/(auth)/login" as any)}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>
              {config.secondaryCta}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  card: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 22,
    backgroundColor: "rgba(32, 24, 48, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 14,
  },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
  },
  description: {
    color: "rgba(228,228,231,0.84)",
    fontSize: 15,
    lineHeight: 22,
  },
  note: {
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  noteText: {
    color: "#d4d4d8",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  actions: {
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  secondaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
