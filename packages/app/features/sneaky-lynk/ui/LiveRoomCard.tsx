/**
 * Live Room Card Component
 * Gradient card displaying a private video room (live or ended)
 */

import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Video, Users } from "lucide-react-native";
import type { SneakyRoom, SneakyUser } from "../types";

interface LiveRoomCardProps {
  space: {
    id: string;
    title: string;
    topic: string;
    isLive: boolean;
    hasVideo: boolean;
    listeners: number;
    host: SneakyUser;
    speakers: SneakyUser[];
    status?: "open" | "ended";
  };
  onPress: () => void;
}

export function LiveRoomCard({ space, onPress }: LiveRoomCardProps) {
  const isEnded = space.status === "ended" || !space.isLive;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.card}>
      <LinearGradient
        colors={isEnded ? ["#3a3a3a", "#1a1a1a"] : ["#FF5BFC", "#FC253A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.gradient, isEnded && styles.gradientEnded]}
      >
        {/* Header with badges */}
        <View style={styles.header}>
          {isEnded ? (
            <View style={styles.endedBadge}>
              <Text style={styles.endedText}>Lynk Ended</Text>
            </View>
          ) : (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
          {!isEnded && space.hasVideo && (
            <View style={styles.videoBadge}>
              <Video size={12} color="#fff" />
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.content}>
          <Text
            style={[styles.title, isEnded && styles.titleEnded]}
            numberOfLines={2}
          >
            {space.title}
          </Text>
          <Text style={[styles.topic, isEnded && styles.topicEnded]}>
            {space.topic}
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          {isEnded ? (
            <View style={styles.listenersInfo}>
              <Users size={16} color="#888" />
              <Text style={styles.endedListenersText}>
                {space.listeners.toLocaleString()} listened
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.speakersRow}>
                <Image
                  source={{ uri: space.host.avatar }}
                  style={styles.hostAvatar}
                />
                {space.speakers.slice(0, 2).map((speaker) => (
                  <Image
                    key={speaker.id}
                    source={{ uri: speaker.avatar }}
                    style={styles.speakerAvatar}
                  />
                ))}
              </View>
              <View style={styles.listenersInfo}>
                <Users size={14} color="#fff" />
                <Text style={styles.listenersText}>
                  {space.listeners.toLocaleString()}
                </Text>
              </View>
            </>
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: "hidden",
  },
  gradient: {
    padding: 18,
    minHeight: 180,
  },
  gradientEnded: {
    minHeight: 140,
    opacity: 0.85,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  liveText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  endedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  endedText: {
    color: "#888",
    fontSize: 11,
    fontWeight: "700",
  },
  videoBadge: {
    backgroundColor: "rgba(255,255,255,0.25)",
    padding: 6,
    borderRadius: 10,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    marginVertical: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 6,
  },
  titleEnded: {
    color: "#aaa",
  },
  topic: {
    fontSize: 13,
    color: "rgba(255,255,255,0.8)",
    fontWeight: "500",
  },
  topicEnded: {
    color: "#666",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  speakersRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  hostAvatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#fff",
  },
  speakerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#fff",
    marginLeft: -10,
  },
  listenersInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  listenersText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  endedListenersText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#888",
  },
});
