/**
 * ShareEventSheet — send an event directly to a user's DM inbox.
 *
 * Opens a bottom sheet with a user search input. Selecting a user
 * creates/gets a DM conversation and sends the event as a message
 * (with metadata so the chat screen can render a rich preview).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Send, Search, X } from "lucide-react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { messagesApi } from "@/lib/api/messages-impl";
import { usersApi } from "@/lib/api/users";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useUIStore } from "@/lib/stores/ui-store";
import { LegendList } from "@/components/list";

interface ShareEventSheetProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  eventDate?: string;
  eventImage?: string;
  eventLocation?: string;
}

type UserResult = {
  id: string;
  authId: string;
  username: string;
  name: string;
  avatar: string;
};

export function ShareEventSheet({
  visible,
  onClose,
  eventId,
  eventTitle,
  eventDate,
  eventImage,
  eventLocation,
}: ShareEventSheetProps) {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["60%", "90%"], []);

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.snapToIndex(0);
    } else {
      bottomSheetRef.current?.close();
      setQuery("");
      setResults([]);
    }
  }, [visible]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    usersApi.searchUsers(debouncedQuery.trim(), 20).then(({ docs }) => {
      if (active) {
        setResults(docs as UserResult[]);
        setSearching(false);
      }
    });
    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  const handleSend = useCallback(
    async (user: UserResult) => {
      if (sendingTo) return;
      setSendingTo(user.id);
      try {
        const recipientId = user.authId || user.id;
        const conversationId = await messagesApi.getOrCreateConversation(recipientId);
        await messagesApi.sendMessage({
          conversationId,
          content: `Check out this event: ${eventTitle}`,
          metadata: {
            type: "event_share",
            event_id: eventId,
            event_title: eventTitle,
            event_date: eventDate ?? null,
            event_image: eventImage ?? null,
            event_location: eventLocation ?? null,
          },
        });
        showToast("success", "Sent!", `Event shared with @${user.username}`);
        onClose();
        router.push(`/(protected)/chat/${conversationId}` as any);
      } catch (err: any) {
        showToast("error", "Send failed", err?.message || "Try again.");
      } finally {
        setSendingTo(null);
      }
    },
    [
      sendingTo,
      eventId,
      eventTitle,
      eventDate,
      eventImage,
      eventLocation,
      showToast,
      onClose,
      router,
    ],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.55}
        onPress={onClose}
      />
    ),
    [onClose],
  );

  if (!visible) return null;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Send Event</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={20} color="rgba(255,255,255,0.5)" />
          </Pressable>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Search size={16} color="rgba(255,255,255,0.35)" />
          <BottomSheetTextInput
            style={styles.searchInput}
            placeholder="Search people..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searching && (
            <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" />
          )}
        </View>

        {/* Results */}
        <LegendList
          data={results}
          keyExtractor={(item) => item.id}
          estimatedItemSize={64}
          recycleItems
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handleSend(item)}
              disabled={!!sendingTo}
              style={({ pressed }) => [
                styles.userRow,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Image
                source={item.avatar ? { uri: item.avatar } : undefined}
                style={styles.avatar}
                contentFit="cover"
              />
              <View style={styles.userInfo}>
                <Text style={styles.username}>@{item.username}</Text>
                {item.name && item.name !== item.username && (
                  <Text style={styles.name}>{item.name}</Text>
                )}
              </View>
              {sendingTo === item.id ? (
                <ActivityIndicator size="small" color="#3FDCFF" />
              ) : (
                <Send size={16} color="rgba(255,255,255,0.4)" />
              )}
            </Pressable>
          )}
          ListEmptyComponent={
            debouncedQuery.length > 1 && !searching ? (
              <Text style={styles.emptyText}>No users found</Text>
            ) : null
          }
        />
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: "#111114",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    backgroundColor: "rgba(255,255,255,0.18)",
    width: 36,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    paddingVertical: 0,
  },
  listContent: {
    paddingBottom: 24,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  userInfo: {
    flex: 1,
  },
  username: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  name: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    marginTop: 1,
  },
  emptyText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 14,
    textAlign: "center",
    marginTop: 32,
  },
});
