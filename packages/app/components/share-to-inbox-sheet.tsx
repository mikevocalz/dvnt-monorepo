import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetFlatList,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { X, Send, Search } from "lucide-react-native";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { useChatStore, type SharedPostContext } from "@dvnt/app/lib/stores/chat-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useConversations } from "@dvnt/app/lib/hooks/use-messages";
import { useShareSheetStore } from "@dvnt/app/lib/stores/share-sheet-store";
import { GlassSheetBackground } from "@dvnt/app/components/sheets/glass-sheet-background";
import type { Conversation } from "@dvnt/app/lib/api/messages";

interface ShareToInboxSheetProps {
  visible: boolean;
  onClose: () => void;
  post: {
    id: string;
    authorUsername: string;
    authorAvatar: string;
    caption?: string;
    mediaUrl?: string;
    mediaType?: import("@dvnt/app/lib/media/types").MediaKind;
  } | null;
}

export function ShareToInboxSheet({
  visible,
  onClose,
  post,
}: ShareToInboxSheetProps) {
  const { colors } = useColorScheme();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["60%"], []);

  // Conversations live in React Query — already prefetched at app boot
  // (see lib/hooks/use-boot-prefetch.ts) so the sheet opens with cached
  // data on the very first open. No more spinner-on-open.
  const {
    data: conversations = [],
    isPending: isLoadingInitial,
  } = useConversations();
  // Only show the spinner when there is NO cached data at all. If we have
  // any cached list from the boot prefetch, render it immediately and let
  // React Query silently refresh in the background.
  const isLoading = isLoadingInitial && conversations.length === 0;

  // Transient view state — Zustand (project policy) scoped to this sheet.
  const searchQuery = useShareSheetStore((s) => s.searchQuery);
  const setSearchQuery = useShareSheetStore((s) => s.setSearchQuery);
  const sendingTo = useShareSheetStore((s) => s.sendingTo);
  const setSendingTo = useShareSheetStore((s) => s.setSendingTo);
  const resetShareSheet = useShareSheetStore((s) => s.reset);

  const sendSharedPost = useChatStore((s) => s.sendSharedPost);
  const showToast = useUIStore((s) => s.showToast);

  // Drive the native sheet open/close from `visible`. Reset transient
  // view state only on CLOSE — never on open, so cached search text isn't
  // wiped between opens of the same share action.
  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.snapToIndex(0);
    } else {
      bottomSheetRef.current?.close();
      resetShareSheet();
    }
  }, [visible, resetShareSheet]);

  const filtered = useMemo(() => {
    if (!searchQuery) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) =>
      c.user.username.toLowerCase().includes(q),
    );
  }, [conversations, searchQuery]);

  const handleSend = useCallback(
    async (conversation: Conversation) => {
      if (!post || sendingTo) return;
      setSendingTo(conversation.id);

      const sharedPost: SharedPostContext = {
        postId: post.id,
        authorUsername: post.authorUsername,
        authorAvatar: post.authorAvatar,
        caption: post.caption,
        mediaUrl: post.mediaUrl,
        mediaType: post.mediaType,
      };

      try {
        await sendSharedPost(conversation.id, sharedPost);
        showToast(
          "success",
          "Sent",
          `Post shared with ${conversation.user.username}`,
        );
        onClose();
      } catch {
        showToast("error", "Error", "Failed to share post");
      } finally {
        setSendingTo(null);
      }
    },
    [post, sendSharedPost, showToast, onClose, sendingTo],
  );

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

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
    ({ item }: { item: Conversation }) => (
      <Pressable
        onPress={() => handleSend(item)}
        disabled={!!sendingTo}
        style={[styles.conversationRow, { borderBottomColor: colors.border }]}
      >
        <Avatar
          uri={item.user.avatar}
          username={item.user.username}
          size={44}
          variant="roundedSquare"
        />
        <View style={styles.conversationInfo}>
          <Text
            style={[styles.conversationUsername, { color: colors.foreground }]}
          >
            {item.user.username}
          </Text>
          <Text
            style={[
              styles.conversationLastMsg,
              { color: colors.mutedForeground },
            ]}
            numberOfLines={1}
          >
            {item.lastMessage || "No messages yet"}
          </Text>
        </View>
        {sendingTo === item.id ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <View
            style={[styles.sendButton, { backgroundColor: colors.primary }]}
          >
            <Send size={16} color="#fff" />
          </View>
        )}
      </Pressable>
    ),
    [handleSend, sendingTo, colors],
  );

  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  if (!visible) return null;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableOverDrag={false}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      detached={true}
      bottomInset={46}
      backgroundComponent={GlassSheetBackground}
      handleIndicatorStyle={{
        backgroundColor: colors.mutedForeground,
        width: 40,
      }}
      style={[styles.sheetContainer, { zIndex: 9999, elevation: 9999 }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Share to...
        </Text>
        <Pressable
          onPress={() => bottomSheetRef.current?.close()}
          hitSlop={12}
          style={styles.closeButton}
        >
          <X size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={[styles.searchContainer, { backgroundColor: colors.muted }]}>
        <Search size={16} color={colors.mutedForeground} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search conversations..."
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Content */}
      {isLoading ? (
        <BottomSheetView style={styles.centered}>
          <ActivityIndicator size="small" color={colors.primary} />
        </BottomSheetView>
      ) : filtered.length === 0 ? (
        <BottomSheetView style={styles.centered}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {searchQuery ? "No conversations found" : "No conversations yet"}
          </Text>
        </BottomSheetView>
      ) : (
        <BottomSheetFlatList
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </BottomSheet>
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
  headerTitle: {
    fontSize: 18,
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
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  conversationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  conversationInfo: {
    flex: 1,
  },
  conversationUsername: {
    fontSize: 15,
    fontWeight: "600",
  },
  conversationLastMsg: {
    fontSize: 12,
    marginTop: 2,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetContainer: {
    marginHorizontal: 16,
    overflow: "hidden",
    borderRadius: 24,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
  },
});
