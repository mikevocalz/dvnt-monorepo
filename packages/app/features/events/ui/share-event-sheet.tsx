/**
 * ShareEventSheet — send an event directly to a user's DM inbox.
 *
 * Opens a bottom sheet with a user search input. Selecting a user
 * creates/gets a DM conversation and sends the event as a message
 * (with metadata so the chat screen can render a rich preview).
 *
 * Private events: a DM card alone is a dead end — `can_view_event` refuses
 * anyone without an `event_invites` row, so selecting guests here first calls
 * `event-invite-guests` (one batched call, since the edge fn rate-limits at
 * 5 writes per 5 min per event) and then sends each member the DM card.
 * The invite is what makes the shared link open.
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
import { Check, Send, Search, X } from "lucide-react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";
import { inviteEventGuests } from "@dvnt/app/lib/api/privileged";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useDebounce } from "@dvnt/app/lib/hooks/use-debounce";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { LegendList } from "@dvnt/app/components/list";
import {
  useDetachedSheetMetrics,
  SHEET_BOTTOM_INSET,
} from "@dvnt/app/lib/ui/sheet-metrics";

interface ShareEventSheetProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  eventDate?: string;
  eventImage?: string;
  eventLocation?: string;
  /** "private" switches the sheet to guest-list invites (see header note). */
  visibility?: string | null;
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
  visibility,
}: ShareEventSheetProps) {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const sheet = useDetachedSheetMetrics();
  // Numeric, not "%": the shared metrics own the max-w-3xl cap and the 3:4
  // portrait ratio, clamped to clear the detached inset.
  const snapPoints = useMemo(() => [sheet.height], [sheet.height]);

  const isPrivate = visibility === "private";

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  // Private events: guests are picked first, then invited in ONE batch —
  // event-invite-guests rate-limits writes, so per-tap invites would cap out.
  const [selected, setSelected] = useState<Map<string, UserResult>>(new Map());
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.snapToIndex(0);
    } else {
      bottomSheetRef.current?.close();
      setQuery("");
      setResults([]);
      setSelected(new Map());
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

  const toggleSelect = useCallback((user: UserResult) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });
  }, []);

  /**
   * Private events: one batched guest-list invite (access + notification +
   * push/email from the edge fn), then a DM card per invited member so they
   * have a tappable route in. The DM is best-effort — the invite row and its
   * notification are what grant and announce access.
   */
  const handleInvite = useCallback(async () => {
    if (inviting || selected.size === 0) return;
    setInviting(true);
    try {
      const guests = [...selected.values()];
      const res = await inviteEventGuests(Number(eventId), [
        ...guests.map((g) => g.username),
      ]);
      // Members the edge fn skipped (e.g. resolved to the host) get no DM —
      // they have no invite row, so the card would open a refusal.
      const skippedNames = new Set(
        (res.skipped ?? []).map((s) => s.recipient.replace(/^@/, "").toLowerCase()),
      );
      const reachable = guests.filter(
        (g) => !skippedNames.has(g.username.toLowerCase()),
      );
      await Promise.allSettled(
        reachable.map(async (g) => {
          const conversationId = await messagesApi.getOrCreateConversation(
            g.authId || g.id,
          );
          await messagesApi.sendMessage({
            conversationId,
            content: `You're invited: ${eventTitle}`,
            metadata: {
              type: "event_share",
              event_id: eventId,
              event_title: eventTitle,
              event_date: eventDate ?? null,
              event_image: eventImage ?? null,
              event_location: eventLocation ?? null,
            },
          });
        }),
      );
      const skippedMsg = res.skipped?.length
        ? ` ${res.skipped.length} skipped (${res.skipped[0].reason}).`
        : "";
      showToast(
        "success",
        "Invites sent",
        `${reachable.length} guest${reachable.length === 1 ? "" : "s"} can now open this event.${skippedMsg}`,
      );
      onClose();
    } catch (err: any) {
      showToast("error", "Invite failed", err?.message || "Try again.");
    } finally {
      setInviting(false);
    }
  },
    [
      inviting,
      selected,
      eventId,
      eventTitle,
      eventDate,
      eventImage,
      eventLocation,
      showToast,
      onClose,
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
      enableDynamicSizing={false}
      detached
      bottomInset={SHEET_BOTTOM_INSET}
      style={{ marginHorizontal: sheet.marginHorizontal }}
    >
      <BottomSheetView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>
            {isPrivate ? "Invite guests" : "Send Event"}
          </Text>
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
          renderItem={({ item }) => {
            const isSelected = isPrivate && selected.has(item.id);
            return (
              <Pressable
                onPress={() =>
                  isPrivate ? toggleSelect(item) : handleSend(item)
                }
                disabled={!isPrivate && !!sendingTo}
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
                {isPrivate ? (
                  <View
                    style={[styles.check, isSelected && styles.checkActive]}
                  >
                    {isSelected && <Check size={14} color="#0b0d16" />}
                  </View>
                ) : sendingTo === item.id ? (
                  <ActivityIndicator size="small" color="#3FDCFF" />
                ) : (
                  <Send size={16} color="rgba(255,255,255,0.4)" />
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            debouncedQuery.length > 1 && !searching ? (
              <Text style={styles.emptyText}>No users found</Text>
            ) : null
          }
        />

        {isPrivate && (
          <Pressable
            onPress={handleInvite}
            disabled={inviting || selected.size === 0}
            style={({ pressed }) => [
              styles.inviteButton,
              (inviting || selected.size === 0) && { opacity: 0.45 },
              pressed && { opacity: 0.8 },
            ]}
          >
            {inviting ? (
              <ActivityIndicator size="small" color="#0b0d16" />
            ) : (
              <Text style={styles.inviteButtonText}>
                {selected.size === 0
                  ? "Select guests to invite"
                  : `Invite ${selected.size} guest${selected.size === 1 ? "" : "s"}`}
              </Text>
            )}
          </Pressable>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: "#111114",
    // All four corners: detached floats as a card, so a top-only radius
    // leaves square bottom corners hanging over the inset.
    borderRadius: 24,
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
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkActive: {
    backgroundColor: "#3FDCFF",
    borderColor: "#3FDCFF",
  },
  inviteButton: {
    backgroundColor: "#3FDCFF",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  inviteButtonText: {
    color: "#0b0d16",
    fontSize: 15,
    fontWeight: "700",
  },
});
