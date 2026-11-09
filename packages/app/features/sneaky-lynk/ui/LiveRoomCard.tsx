/** Native discovery card. Admission remains authoritative in the room, never this snapshot. */
import { discoveryRoomState } from "../discovery-room-state";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Video, Users, Globe, Lock, Headphones, ArrowUpRight } from "lucide-react-native";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import type { SneakyUser } from "../types";

interface LiveRoomCardProps {
  space: Parameters<typeof discoveryRoomState>[0] & {
    id: string;
    title: string;
    topic: string;
    isLive: boolean;
    presenceKnown?: boolean;
    endsAt?: string | null;
    hasVideo: boolean;
    isPublic?: boolean;
    listeners: number;
    maxParticipants?: number;
    host: SneakyUser;
    speakers: SneakyUser[];
    status?: "open" | "ended";
  };
  onPress: () => void;
}

export function LiveRoomCard({ space, onPress }: LiveRoomCardProps) {
  const { ended, live, countKnown, label, actionable, actionLabel } = discoveryRoomState(space);
  const hostName = space.host.displayName || space.host.username || "Host";
  return (
    <TouchableOpacity onPress={() => { if (discoveryRoomState(space).actionable) onPress(); }} disabled={!actionable} activeOpacity={0.85}
      accessibilityRole="button" accessibilityState={{ disabled: !actionable }}
      accessibilityLabel={`${space.title}. ${actionLabel || label}. ${space.isPublic === false ? "Private" : "Public"}. ${countKnown ? `${space.listeners} people` : "Participant count unavailable"}.`}
      style={[styles.card, !actionable && styles.ended]}>
      <View style={styles.header}>
        <View style={[styles.badge, live && styles.liveBadge]}>{live && <View style={styles.dot} />}<Text style={[styles.badgeText, live && styles.liveText]}>{label}</Text></View>
        <View style={styles.meta}>{space.isPublic === false ? <Lock size={12} color="#9CA3AF" /> : <Globe size={12} color="#9CA3AF" />}<Text style={styles.metaText}>{space.isPublic === false ? "Private" : "Public"}</Text></View>
        <View style={[styles.meta, { marginLeft: "auto" }]}>{space.hasVideo ? <Video size={13} color="#9CA3AF" /> : <Headphones size={13} color="#9CA3AF" />}<Text style={styles.metaText}>{space.hasVideo ? "Video" : "Audio"}</Text></View>
      </View>
      <View style={styles.content}><Text style={styles.title} numberOfLines={2}>{space.title}</Text>{!!space.topic && <Text style={styles.topic} numberOfLines={2}>{space.topic}</Text>}</View>
      <View style={styles.footer}>
        <Avatar uri={space.host.avatar} username={hostName} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.host} numberOfLines={1}>{hostName}</Text><View style={styles.meta}><Users size={12} color="#9CA3AF" /><Text style={styles.metaText}>{countKnown ? `${space.listeners.toLocaleString()}${!ended && space.maxParticipants ? ` / ${space.maxParticipants}` : ""} ${ended ? "joined" : "in room"}` : ended ? "Session ended" : label}</Text></View></View>
        {actionLabel && <View style={styles.meta}><Text style={styles.join}>{actionLabel}</Text><ArrowUpRight size={15} color="#3FDCFF" /></View>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.04)", padding: 16, gap: 16 },
  ended: { opacity: 0.6 },
  header: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  badge: { flexDirection: "row", alignItems: "center", borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, gap: 6, backgroundColor: "rgba(255,255,255,0.08)" },
  liveBadge: { backgroundColor: "rgba(252,37,58,0.15)" },
  badgeText: { fontSize: 11, fontWeight: "600", color: "#9CA3AF" },
  liveText: { color: "#FF8793" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FC253A" },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 11, color: "#9CA3AF" },
  content: { gap: 4 },
  title: { fontSize: 18, fontWeight: "700", lineHeight: 24, color: "#fff" },
  topic: { fontSize: 13, lineHeight: 20, color: "#9CA3AF" },
  footer: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", paddingTop: 12 },
  host: { fontSize: 12, fontWeight: "600", color: "#E5E7EB", marginBottom: 3 },
  join: { fontSize: 12, fontWeight: "600", color: "#3FDCFF" },
});
