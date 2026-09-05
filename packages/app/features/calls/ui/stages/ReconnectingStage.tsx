import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Wifi } from "lucide-react-native";

export interface ReconnectingStageProps {
  title: string;
  participantCount: number;
}

export function ReconnectingStage({
  title,
  participantCount,
}: ReconnectingStageProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 44 }]}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Wifi size={28} color="#8EDBFF" />
        </View>
        <Text style={styles.eyebrow}>Live call</Text>
        <Text style={styles.title}>Reconnecting…</Text>
        <Text style={styles.subtitle}>
          Restoring audio and video without dropping this room.
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>{title}</Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={styles.metaText}>
            {participantCount} participant{participantCount === 1 ? "" : "s"}
          </Text>
        </View>
        <ActivityIndicator size="small" color="#8EDBFF" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050505",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 32,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: "center",
    backgroundColor: "rgba(18,18,22,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 10,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(62,164,229,0.14)",
  },
  eyebrow: {
    color: "rgba(142,219,255,0.9)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "600",
  },
  metaDot: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 14,
  },
});
