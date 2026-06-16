/**
 * LikesSheet — BottomSheetModal showing users who liked a post.
 *
 * Uses BottomSheetModal (NOT BottomSheet) so it portals through the
 * BottomSheetModalProvider at the app root (_layout.tsx). This ensures
 * the sheet renders full-screen regardless of where LikesSheet sits
 * in the component tree (e.g. inside a Fragment in the feed).
 *
 * - Snaps to 65% / 92%
 * - Sticky header with "Likes" title and close button
 * - Tappable rows navigate to user profile
 * - Uses usePostLikers TanStack Query hook
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import {
  BottomSheetModal,
  BottomSheetFlatList,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { X, Heart } from "lucide-react-native";
import { useRouter } from "expo-router";
import { Avatar } from "@/components/ui/avatar";
import { usePostLikers } from "@/lib/hooks/use-post-likers";
import { useColorScheme } from "@/lib/hooks";
import type { PostLiker } from "@/lib/api/likes";
import { useQueryClient } from "@tanstack/react-query";
import { screenPrefetch } from "@/lib/prefetch";
import { SHEET_SNAPS } from "@/lib/constants/sheets";

interface LikesSheetProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
}

function formatLikedAt(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

function LikerRow({
  liker,
  onPress,
}: {
  liker: PostLiker;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.likerRow}>
      <Avatar
        uri={liker.avatar}
        username={liker.username}
        size={44}
        variant="roundedSquare"
      />
      <View style={styles.likerInfo}>
        <Text style={styles.likerUsername} numberOfLines={1}>
          {liker.username}
        </Text>
        {liker.displayName !== liker.username && (
          <Text style={styles.likerDisplayName} numberOfLines={1}>
            {liker.displayName}
          </Text>
        )}
      </View>
      <Text style={styles.likerTime}>{formatLikedAt(liker.likedAt)}</Text>
    </Pressable>
  );
}

export function LikesSheet({ postId, isOpen, onClose }: LikesSheetProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useColorScheme();
  const modalRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => [...SHEET_SNAPS], []);

  // Always call hook — enabled guards the fetch (rules-of-hooks safe)
  const { data: likers = [], isLoading } = usePostLikers(postId, isOpen);

  // Present/dismiss the modal based on isOpen prop
  useEffect(() => {
    if (isOpen) {
      modalRef.current?.present();
    } else {
      modalRef.current?.dismiss();
    }
  }, [isOpen]);

  const handleProfilePress = useCallback(
    (username: string) => {
      screenPrefetch.profile(queryClient, username);
      onClose();
      router.push(`/(protected)/profile/${username}` as any);
    },
    [router, onClose, queryClient],
  );

  const handleDismiss = useCallback(() => {
    onClose();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: PostLiker }) => (
      <LikerRow
        liker={item}
        onPress={() => handleProfilePress(item.username)}
      />
    ),
    [handleProfilePress],
  );

  const keyExtractor = useCallback(
    (item: PostLiker) => String(item.userId),
    [],
  );

  return (
    <BottomSheetModal
      ref={modalRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableOverDrag={false}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: colors.card,
        borderRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: colors.mutedForeground,
        width: 40,
      }}
      style={{ zIndex: 9999, elevation: 9999 }}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Heart size={18} color="#FF5BFC" fill="#FF5BFC" />
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Likes
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
          <X size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.listContent}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.likerRow}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: "rgba(255,255,255,0.08)",
                }}
              />
              <View style={[styles.likerInfo, { gap: 6 }]}>
                <View
                  style={{
                    width: 100,
                    height: 14,
                    borderRadius: 4,
                    backgroundColor: "rgba(255,255,255,0.08)",
                  }}
                />
                <View
                  style={{
                    width: 70,
                    height: 12,
                    borderRadius: 4,
                    backgroundColor: "rgba(255,255,255,0.05)",
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      ) : likers.length === 0 ? (
        <View style={styles.centered}>
          <Heart size={32} color="rgba(255,255,255,0.2)" />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No likes yet
          </Text>
        </View>
      ) : (
        <BottomSheetFlatList
          data={likers}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  likerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  likerInfo: {
    flex: 1,
  },
  likerUsername: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  likerDisplayName: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    marginTop: 1,
  },
  likerTime: {
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
  },
  emptyText: {
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 16,
  },
});
