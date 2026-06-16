// ============================================================
// Instagram Stories Editor - Sticker Picker
// ============================================================

import React, { useMemo } from "react";
import {
  View,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { LegendList } from "@/components/list";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Search } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useEditorStore } from "../../stores/editor-store";
import { IMAGE_STICKER_PACKS } from "../../constants";
import {
  stickerPacks,
  type StickerPackKey,
} from "@/lib/constants/sticker-packs";
import {
  getItemImageUri,
  getItemPreviewUri,
  klipySearch,
  type KlipyItem,
} from "@/src/stickers/api/klipy";
import { GLASS_SURFACE, GLASS_TEXT_COLORS } from "@/lib/ui/glass";
import type { StickerInsertOptions } from "../../types";

interface StickerPickerProps {
  onSelectSticker: (source: string, options?: StickerInsertOptions) => void;
  onSelectImageSticker?: (source: number, id: string) => void;
  onClose: () => void;
}

type PackKey = keyof typeof stickerPacks;
type StickerTab = "dvnt" | "ballroom" | PackKey | "all" | "gif";

const TWEMOJI_TABS: { id: StickerTab; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "✨" },
  { id: "faces", label: "Faces", icon: "😂" },
  { id: "gestures", label: "Gestures", icon: "👍" },
  { id: "hearts", label: "Hearts", icon: "❤️" },
  { id: "symbols", label: "Symbols", icon: "🔥" },
  { id: "food", label: "Food", icon: "🍕" },
  { id: "animals", label: "Animals", icon: "🦋" },
  { id: "nature", label: "Nature", icon: "🌈" },
  { id: "flags", label: "Flags", icon: "🚩" },
];

const ALL_TWEMOJI = Object.values(stickerPacks).flat();
const GIF_SKELETONS = Array.from({ length: 12 }, (_, index) => `gif-${index}`);

export const StickerPicker: React.FC<StickerPickerProps> = ({
  onSelectSticker,
  onSelectImageSticker,
  onClose,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const imageStickerSize = (screenWidth - 64) / 3;
  const twemojiStickerSize = (screenWidth - 64) / 5;

  const activeTab = useEditorStore((s) => s.stickerActiveTab) as StickerTab;
  const setActiveTab = useEditorStore((s) => s.setStickerActiveTab);
  const searchQuery = useEditorStore((s) => s.stickerSearchQuery);
  const setSearchQuery = useEditorStore((s) => s.setStickerSearchQuery);

  const tabs: { id: StickerTab; label: string; icon: string }[] = [
    ...IMAGE_STICKER_PACKS.map((pack) => ({
      id: pack.id as StickerTab,
      label: pack.name,
      icon: pack.icon,
    })),
    ...TWEMOJI_TABS,
    { id: "gif", label: "GIFs", icon: "🎞️" },
  ];

  const activeImagePack = IMAGE_STICKER_PACKS.find((p) => p.id === activeTab);
  const isGifTab = activeTab === "gif";
  const activeImageStickers = useMemo(() => {
    if (!activeImagePack) return [];
    if (!searchQuery.trim()) return activeImagePack.stickers;

    const q = searchQuery.trim().toLowerCase();
    return activeImagePack.stickers.filter((sticker) =>
      sticker.label.toLowerCase().includes(q),
    );
  }, [activeImagePack, searchQuery]);

  const twemojiStickers = useMemo(() => {
    if (activeImagePack || activeTab === "gif") return [];
    const packKey = activeTab as PackKey;
    const items =
      activeTab === "all" ? ALL_TWEMOJI : (stickerPacks[packKey] ?? []);
    if (!searchQuery.trim()) return items;
    return ALL_TWEMOJI;
  }, [activeTab, searchQuery, activeImagePack]);

  const isTwemojiTab = !activeImagePack && activeTab !== "gif";
  const gifQuery = useQuery({
    queryKey: [
      "story-editor",
      "stickers",
      "klipy",
      "gifs",
      searchQuery.trim().toLowerCase(),
    ],
    queryFn: ({ signal }) => klipySearch("gifs", searchQuery, { signal }),
    enabled: isGifTab,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    placeholderData: (previous) => previous,
  });
  const gifItems = gifQuery.data?.results ?? [];
  const isGifFallback = gifQuery.data?.source === "fallback";
  const gifFallbackCopy = useMemo(() => {
    switch (gifQuery.data?.fallbackReason) {
      case "restricted_key":
        return "Klipy is returning 204 with the current key, so this tab is showing bundled animated reactions instead.";
      case "missing_api_key":
        return "No Klipy key is configured in this build, so this tab is using bundled animated reactions.";
      case "request_failed":
        return "Klipy search is temporarily unavailable, so this tab is using bundled animated reactions.";
      default:
        return "Showing bundled animated reactions while GIF search is unavailable.";
    }
  }, [gifQuery.data?.fallbackReason]);

  const renderEmptyState = (title: string, body: string) => (
    <View className="items-center gap-2 px-8 pt-5">
      <Text
        className="text-base font-semibold text-center"
        style={{ color: GLASS_TEXT_COLORS.primary }}
      >
        {title}
      </Text>
      <Text
        className="text-xs text-center"
        style={{ color: GLASS_TEXT_COLORS.muted }}
      >
        {body}
      </Text>
    </View>
  );

  const pickerHeader = (
    <>
      <View
        className="flex-row justify-between items-center px-5 py-3"
        style={{
          borderBottomWidth: 1,
          borderBottomColor: "rgba(255,255,255,0.08)",
        }}
      >
        <View style={{ gap: 2 }}>
          <Text
            style={{
              color: GLASS_TEXT_COLORS.primary,
              fontSize: 22,
              fontWeight: "700",
            }}
          >
            Stickers
          </Text>
          <Text
            style={{
              color: GLASS_TEXT_COLORS.muted,
              fontSize: 12,
              fontWeight: "500",
            }}
          >
            Add local packs, emoji, or GIF reactions
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.1)",
            borderWidth: 1,
            borderColor: GLASS_SURFACE.border,
          }}
        >
          <Text
            style={{
              color: GLASS_TEXT_COLORS.primary,
              fontSize: 14,
              fontWeight: "700",
            }}
          >
            Done
          </Text>
        </Pressable>
      </View>

      <View className="px-5 pt-3 pb-3">
        <View
          className="flex-row items-center px-4 py-3 gap-2"
          style={{
            borderRadius: 16,
            backgroundColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderColor: GLASS_SURFACE.border,
          }}
        >
          <Search size={16} color={GLASS_TEXT_COLORS.muted} strokeWidth={2} />
          <TextInput
            className="flex-1 text-[15px]"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={isGifTab ? "Search GIFs..." : "Search stickers..."}
            placeholderTextColor={GLASS_TEXT_COLORS.muted}
            style={{ color: GLASS_TEXT_COLORS.primary }}
            returnKeyType="search"
          />
        </View>
      </View>

      {isGifTab && isGifFallback ? (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: 16,
            backgroundColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderColor: GLASS_SURFACE.border,
            gap: 4,
          }}
        >
          <Text
            style={{
              color: GLASS_TEXT_COLORS.primary,
              fontSize: 13,
              fontWeight: "700",
            }}
          >
            Animated emoji fallback
          </Text>
          <Text
            style={{
              color: GLASS_TEXT_COLORS.secondary,
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {gifFallbackCopy}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                className="flex-row items-center rounded-full gap-1"
                style={{
                  minHeight: 38,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  backgroundColor: isActive
                    ? "rgba(255,255,255,0.18)"
                    : "rgba(255,255,255,0.08)",
                  borderWidth: 1,
                  borderColor: isActive
                    ? "rgba(255,255,255,0.18)"
                    : GLASS_SURFACE.border,
                }}
                onPress={() => setActiveTab(tab.id)}
              >
                {tab.icon ? <Text className="text-[13px]">{tab.icon}</Text> : null}
                <Text
                  className="text-xs font-semibold"
                  style={{
                    color: isActive
                      ? GLASS_TEXT_COLORS.primary
                      : GLASS_TEXT_COLORS.secondary,
                  }}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );

  return (
    <View className="flex-1" style={{ minHeight: 0 }}>
      {activeImagePack ? (
        <LegendList
          key={`image-${activeImagePack.id}`}
          data={activeImageStickers}
          style={{ flex: 1 }}
          numColumns={3}
          recycleItems
          estimatedItemSize={imageStickerSize}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              className="items-center justify-center p-2"
              style={{ width: imageStickerSize }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (onSelectImageSticker) {
                  onSelectImageSticker(item.source, item.id);
                } else {
                  onSelectSticker(String(item.source));
                }
              }}
            >
              <Image
                source={item.source}
                style={{
                  width: imageStickerSize - 24,
                  height: imageStickerSize - 24,
                  borderRadius: 12,
                }}
                contentFit="contain"
              />
              <Text
                className="text-neutral-400 text-[11px] font-semibold mt-1 text-center"
                numberOfLines={1}
              >
                {item.label}
              </Text>
            </Pressable>
          )}
          ListHeaderComponent={pickerHeader}
          ListEmptyComponent={renderEmptyState(
            "No stickers found",
            "Try another search term.",
          )}
          ListFooterComponent={<View style={{ height: 28 }} />}
          contentContainerStyle={{ paddingBottom: 20, paddingHorizontal: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />
      ) : isTwemojiTab ? (
        <LegendList
          key={`emoji-${activeTab}`}
          data={twemojiStickers}
          style={{ flex: 1 }}
          numColumns={5}
          recycleItems
          estimatedItemSize={twemojiStickerSize}
          keyExtractor={(item: string, index: number) => `${item}-${index}`}
          renderItem={({ item }: { item: string }) => (
            <Pressable
              className="justify-center items-center p-2"
              style={{
                width: twemojiStickerSize,
                height: twemojiStickerSize,
              }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelectSticker(item);
              }}
            >
              <Image
                source={{ uri: item }}
                style={{ width: "100%", height: "100%" }}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            </Pressable>
          )}
          ListHeaderComponent={pickerHeader}
          ListEmptyComponent={renderEmptyState(
            "No stickers found",
            "Try another tab or clear your search.",
          )}
          ListFooterComponent={<View style={{ height: 28 }} />}
          contentContainerStyle={{ paddingBottom: 20, paddingHorizontal: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />
      ) : (
        <LegendList
          key="gif"
          style={{ flex: 1 }}
          data={
            gifQuery.isLoading && gifItems.length === 0
              ? GIF_SKELETONS
              : gifItems
          }
          numColumns={3}
          recycleItems
          estimatedItemSize={imageStickerSize}
          keyExtractor={(item: string | KlipyItem, index: number) =>
            typeof item === "string" ? item : `${item.id}-${index}`
          }
          renderItem={({ item }: { item: string | KlipyItem }) =>
            typeof item === "string" ? (
              <GifSkeletonItem width={imageStickerSize} />
            ) : (
              <GifGridItem
                item={item}
                width={imageStickerSize}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const uri = getItemImageUri(item, "gifs");
                  if (uri) {
                    onSelectSticker(uri, { category: "gif" });
                  }
                }}
              />
            )
          }
          ListHeaderComponent={pickerHeader}
          ListEmptyComponent={
            gifQuery.isError
              ? renderEmptyState(
                  "GIF search is unavailable right now",
                  "Klipy didn't return results. Try again in a moment.",
                )
              : renderEmptyState(
                  isGifFallback ? "No fallback GIFs found" : "No GIFs found",
                  isGifFallback
                    ? "Try happy, party, fire, love, wow, or dance."
                    : "Try another search term.",
                )
          }
          ListFooterComponent={
            <View className="items-center pt-4 pb-10">
              <Text
                className="text-[11px] font-medium"
                style={{ color: GLASS_TEXT_COLORS.muted }}
              >
                {isGifFallback
                  ? "Bundled animated reactions"
                  : "Powered by Klipy"}
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 20, paddingHorizontal: 4 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />
      )}
    </View>
  );
};

const GifSkeletonItem = ({ width }: { width: number }) => (
  <View
    style={{
      width,
      height: width * 1.2,
      borderRadius: 18,
      backgroundColor: "rgba(255,255,255,0.08)",
      borderWidth: 1,
      borderColor: GLASS_SURFACE.border,
      marginBottom: 10,
    }}
  />
);

const GifGridItem = ({
  item,
  width,
  onPress,
}: {
  item: KlipyItem;
  width: number;
  onPress: () => void;
}) => {
  const previewUri = getItemPreviewUri(item, "gifs");

  return (
    <Pressable
      onPress={onPress}
      style={{
        width,
        marginBottom: 10,
      }}
    >
      <View
        style={{
          height: width * 1.2,
          borderRadius: 18,
          overflow: "hidden",
          backgroundColor: "rgba(255,255,255,0.08)",
          borderWidth: 1,
          borderColor: GLASS_SURFACE.border,
        }}
      >
        <Image
          source={{ uri: previewUri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          autoplay
          transition={120}
          cachePolicy="memory-disk"
        />
      </View>
      <Text
        className="text-[11px] font-semibold mt-1"
        style={{ color: GLASS_TEXT_COLORS.secondary }}
        numberOfLines={1}
      >
        {item.title || item.content_description || "GIF"}
      </Text>
    </Pressable>
  );
};
