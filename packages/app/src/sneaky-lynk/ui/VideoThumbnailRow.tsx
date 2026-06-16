/**
 * Video Thumbnail Row Component
 * Horizontal row of video speaker thumbnails
 */

import { View, Text, ScrollView, Pressable } from "react-native";
import { Image } from "expo-image";
import { Video } from "lucide-react-native";
import type { SneakyUser } from "../types";

interface VideoSpeaker {
  id: string;
  user: SneakyUser;
  isSpeaking: boolean;
  hasVideo: boolean;
}

interface VideoThumbnailRowProps {
  speakers: VideoSpeaker[];
  featuredSpeakerId: string | null;
  activeSpeakers: Set<string>;
  onSelectSpeaker: (userId: string) => void;
}

export function VideoThumbnailRow({
  speakers,
  featuredSpeakerId,
  activeSpeakers,
  onSelectSpeaker,
}: VideoThumbnailRowProps) {
  const videoSpeakers = speakers.filter((s) => s.hasVideo);
  
  if (videoSpeakers.length <= 1) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: 12, gap: 10, paddingHorizontal: 16 }}
    >
      {videoSpeakers.map((speaker) => (
        <Pressable
          key={speaker.id}
          onPress={() => onSelectSpeaker(speaker.user.id)}
          className={`w-[60px] h-[60px] rounded-xl overflow-hidden border-2 relative ${
            featuredSpeakerId === speaker.user.id
              ? "border-primary"
              : "border-transparent"
          }`}
        >
          {/* TODO: Replace with actual Fishjam video track render */}
          <Image
            source={{ uri: speaker.user.avatar }}
            className="w-full h-full"
          />

          {/* Speaking indicator */}
          {activeSpeakers.has(speaker.user.id) && (
            <View className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500 border border-background" />
          )}

          {/* Video icon */}
          <View className="absolute bottom-1 left-1 bg-black/60 p-0.5 rounded">
            <Video size={10} color="#fff" />
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
