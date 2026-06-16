import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import BottomSheet, {
  BottomSheetModal,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import { Music, Send, X, ExternalLink, ImageIcon } from "lucide-react-native";
import { GlassSheetBackground } from "@/components/sheets/glass-sheet-background";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useSpotifyShareStore } from "@/lib/spotify/spotify-share-store";
import type { SpotifyContentType } from "@/lib/spotify/parse-spotify-link";

const TYPE_LABELS: Record<SpotifyContentType, string> = {
  track: "Song",
  album: "Album",
  artist: "Artist",
  playlist: "Playlist",
  episode: "Episode",
  show: "Podcast",
  unknown: "Link",
};

const TYPE_COLORS: Record<SpotifyContentType, string> = {
  track: "#1DB954",
  album: "#1DB954",
  artist: "#1DB954",
  playlist: "#1DB954",
  episode: "#8B5CF6",
  show: "#8B5CF6",
  unknown: "#666",
};

export const SpotifyShareSheet: React.FC = () => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["45%"], []);
  const router = useRouter();

  const { pendingLink, oEmbed, isLoading, sheetVisible, hideSheet, clear } =
    useSpotifyShareStore();

  useEffect(() => {
    if (sheetVisible && pendingLink) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [sheetVisible, pendingLink]);

  const handleDismiss = useCallback(() => {
    hideSheet();
  }, [hideSheet]);

  const handleShareToChat = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // TODO: Navigate to chat picker with Spotify link as shared content
    // For now, just dismiss
    clear();
  }, [clear]);

  const handleOpenInSpotify = useCallback(() => {
    if (pendingLink?.url) {
      Linking.openURL(pendingLink.url);
    }
  }, [pendingLink]);

  const handleShareToStory = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const thumbUrl = oEmbed?.thumbnail_url || pendingLink?.url;
    if (thumbUrl) {
      hideSheet();
      clear();
      router.push({
        pathname: "/(protected)/story/create",
        params: {
          sharedUri: encodeURIComponent(thumbUrl),
          sharedType: "image",
          openEditor: "0",
          sharedAt: String(Date.now()),
        },
      });
    }
  }, [oEmbed, pendingLink, hideSheet, clear, router]);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  if (!pendingLink) return null;

  const typeLabel = TYPE_LABELS[pendingLink.type] || "Link";
  const typeColor = TYPE_COLORS[pendingLink.type] || "#1DB954";

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      backgroundComponent={GlassSheetBackground}
      handleIndicatorStyle={{
        backgroundColor: "#555",
        width: 36,
        height: 4,
      }}
      style={{ zIndex: 9999, elevation: 9999 }}
    >
      <View className="flex-1 px-5 pt-2">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-5">
          <View className="flex-row items-center gap-2">
            <View
              className="w-8 h-8 rounded-xl items-center justify-center"
              style={{ backgroundColor: `${typeColor}20` }}
            >
              <Music size={16} color={typeColor} strokeWidth={2} />
            </View>
            <Text className="text-lg font-bold text-white">
              Spotify {typeLabel}
            </Text>
          </View>
          <Pressable
            onPress={handleDismiss}
            className="w-8 h-8 rounded-xl items-center justify-center"
            style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
          >
            <X size={16} color="#888" strokeWidth={2} />
          </Pressable>
        </View>

        {/* Content Card */}
        {isLoading ? (
          <View className="items-center justify-center py-12">
            <ActivityIndicator size="large" color={typeColor} />
            <Text className="text-sm text-neutral-500 mt-3">
              Loading preview...
            </Text>
          </View>
        ) : (
          <View
            className="rounded-2xl overflow-hidden mb-6"
            style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
          >
            {oEmbed?.thumbnail_url && (
              <Image
                source={{ uri: oEmbed.thumbnail_url }}
                style={{ width: "100%", height: 160 }}
                contentFit="cover"
                transition={0}
                cachePolicy="memory-disk"
              />
            )}
            <View className="p-4">
              <Text
                className="text-base font-bold text-white"
                numberOfLines={2}
              >
                {oEmbed?.title || `Spotify ${typeLabel}`}
              </Text>
              <View className="flex-row items-center gap-1.5 mt-1.5">
                <View
                  className="px-2 py-0.5 rounded-lg"
                  style={{ backgroundColor: `${typeColor}20` }}
                >
                  <Text
                    className="text-[11px] font-semibold"
                    style={{ color: typeColor }}
                  >
                    {typeLabel.toUpperCase()}
                  </Text>
                </View>
                <Text className="text-xs text-neutral-500">
                  open.spotify.com
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Action Buttons */}
        <View className="flex-row gap-3 mb-3">
          <Pressable
            onPress={handleShareToStory}
            disabled={isLoading || !oEmbed?.thumbnail_url}
            className="flex-1 flex-row items-center justify-center gap-2 py-3.5 rounded-2xl"
            style={{ backgroundColor: typeColor }}
          >
            <ImageIcon size={16} color="#fff" strokeWidth={2} />
            <Text className="text-base font-bold text-white">
              Share to Story
            </Text>
          </Pressable>
          <Pressable
            onPress={handleOpenInSpotify}
            className="flex-row items-center justify-center gap-2 px-5 py-3.5 rounded-2xl"
            style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
          >
            <ExternalLink size={16} color="#ccc" strokeWidth={2} />
          </Pressable>
        </View>
        <Pressable
          onPress={handleShareToChat}
          className="flex-row items-center justify-center gap-2 py-3.5 rounded-2xl"
          style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
        >
          <Send size={16} color="#ccc" strokeWidth={2} />
          <Text className="text-base font-semibold text-neutral-300">
            Share in Chat
          </Text>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
};
