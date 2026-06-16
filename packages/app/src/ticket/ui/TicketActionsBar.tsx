/**
 * TicketActionsBar — Sticky bottom actions
 * Calendar, Share, Transfer — respects ticket rules
 * Loading, success, error states for each action.
 */

import React, {
  memo,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CalendarPlus, Share2, Check, Send } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { addTicketToCalendar } from "@dvnt/app/src/ticket/helpers/add-to-calendar";
import { shareTicket } from "@dvnt/app/src/ticket/helpers/share-ticket";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { useSearchUsers } from "@dvnt/app/lib/hooks/use-search";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import type { Ticket, TicketTierLevel } from "@dvnt/app/lib/stores/ticket-store";

interface TicketActionsBarProps {
  ticket: Ticket;
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
}

const TIER_ACCENT: Record<TicketTierLevel, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#8A40CF",
  table: "#FF5BFC",
};

type ActionState = "idle" | "loading" | "success" | "error";

export const TicketActionsBar = memo(function TicketActionsBar({
  ticket,
  bottomInset,
  style,
}: TicketActionsBarProps) {
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);
  const tier = ticket.tier || "ga";
  const accent = TIER_ACCENT[tier];

  const isActive = ticket.status === "valid";

  const [calendarState, setCalendarState] = useState<ActionState>("idle");
  const [shareState, setShareState] = useState<ActionState>("idle");
  const [transferState, setTransferState] = useState<ActionState>("idle");

  // ── Calendar ──
  const handleCalendar = useCallback(async () => {
    if (calendarState === "loading") return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => {},
    );
    setCalendarState("loading");

    const result = await addTicketToCalendar(ticket);

    if (result.success) {
      setCalendarState("success");
      showToast(
        "success",
        result.alreadyAdded ? "Already Added" : "Added",
        result.alreadyAdded
          ? "Event is already in your calendar"
          : "Event added to calendar",
      );
      setTimeout(() => setCalendarState("idle"), 3000);
    } else {
      setCalendarState("error");
      const msg =
        result.error === "permission_denied"
          ? "Calendar permission required"
          : "Could not add to calendar";
      showToast("error", "Calendar", msg);
      setTimeout(() => setCalendarState("idle"), 3000);
    }
  }, [ticket, calendarState, showToast]);

  // ── Share ──
  const handleShare = useCallback(async () => {
    if (shareState === "loading") return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => {},
    );
    setShareState("loading");

    const result = await shareTicket(ticket);

    if (result.success) {
      setShareState("idle");
    } else {
      setShareState("error");
      showToast("error", "Share", "Could not share ticket");
      setTimeout(() => setShareState("idle"), 3000);
    }
  }, [ticket, shareState, showToast]);

  // ── Transfer ──
  const transferInputRef = useRef<TextInput>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferQuery, setTransferQuery] = useState("");
  const { data: transferSearchData, isFetching: isSearchingUsers } =
    useSearchUsers(transferQuery);
  const transferResults = transferSearchData?.docs ?? [];

  const handleTransfer = useCallback(() => {
    if (transferState === "loading") return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => {},
    );
    setTransferQuery("");
    setShowTransferModal(true);
  }, [transferState, ticket.id]);

  const handleTransferToUser = useCallback(
    async (recipientUsername: string) => {
      if (!recipientUsername) return;
      setShowTransferModal(false);
      setTransferState("loading");
      const result = await ticketsApi.initiateTransfer(
        ticket.id,
        recipientUsername,
      );
      if (result.error) {
        setTransferState("error");
        showToast("error", "Transfer Failed", result.error);
        setTimeout(() => setTransferState("idle"), 3000);
      } else {
        setTransferState("success");
        showToast(
          "success",
          "Transfer Initiated",
          `Waiting for @${recipientUsername} to accept (expires in 24h)`,
        );
        setTimeout(() => setTransferState("idle"), 3000);
      }
    },
    [ticket, showToast],
  );

  if (!isActive) return null;

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: bottomInset ?? insets.bottom + 8 },
        style,
      ]}
    >
      {/* Calendar */}
      <Pressable
        onPress={handleCalendar}
        style={[
          styles.actionButton,
          calendarState === "success" && styles.successButton,
        ]}
        disabled={calendarState === "loading"}
      >
        {calendarState === "loading" ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : calendarState === "success" ? (
          <Check size={16} color="#3FDCFF" />
        ) : (
          <CalendarPlus size={16} color="#fff" />
        )}
        <Text
          style={[
            styles.actionLabel,
            calendarState === "success" && styles.successLabel,
          ]}
          numberOfLines={1}
        >
          {calendarState === "success" ? "Added" : "Calendar"}
        </Text>
      </Pressable>

      {/* Share */}
      <Pressable
        onPress={handleShare}
        style={[styles.actionButton, { backgroundColor: `${accent}20` }]}
      >
        {shareState === "loading" ? (
          <ActivityIndicator size="small" color={accent} />
        ) : (
          <Share2 size={16} color={accent} />
        )}
        <Text style={[styles.actionLabel, { color: accent }]} numberOfLines={1}>
          Share
        </Text>
      </Pressable>

      {/* Transfer */}
      <Pressable
        onPress={handleTransfer}
        style={[
          styles.actionButton,
          transferState === "success" && styles.successButton,
        ]}
      >
        {transferState === "loading" ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : transferState === "success" ? (
          <Check size={16} color="#3FDCFF" />
        ) : (
          <Send size={16} color="#fff" />
        )}
        <Text
          style={[
            styles.actionLabel,
            transferState === "success" && styles.successLabel,
          ]}
          numberOfLines={1}
        >
          {transferState === "success" ? "Sent" : "Transfer"}
        </Text>
      </Pressable>

      {/* Transfer username modal */}
      <Modal
        visible={showTransferModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTransferModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowTransferModal(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalKAV}
          >
            <Pressable style={styles.sheetContent} onPress={() => {}}>
              <View style={styles.sheetHandle} />
              <Text style={styles.modalTitle}>Transfer Ticket</Text>
              <Text style={styles.modalSubtitle}>
                Search by username or name. Tap a result to send the ticket.
              </Text>
              <TextInput
                ref={transferInputRef}
                style={styles.modalInput}
                placeholder="Search users"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={transferQuery}
                onChangeText={setTransferQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                autoFocus
              />
              <View style={styles.resultsList}>
                {transferQuery.length === 0 ? (
                  <Text style={styles.resultsHint}>
                    Type to find a friend
                  </Text>
                ) : isSearchingUsers && transferResults.length === 0 ? (
                  <ActivityIndicator color={accent} />
                ) : transferResults.length === 0 ? (
                  <Text style={styles.resultsHint}>
                    No users matching “{transferQuery}”
                  </Text>
                ) : (
                  transferResults.slice(0, 6).map((u: any) => (
                    <Pressable
                      key={u.id}
                      onPress={() => handleTransferToUser(u.username)}
                      style={({ pressed }) => [
                        styles.userRow,
                        pressed && {
                          backgroundColor: "rgba(255,255,255,0.06)",
                        },
                      ]}
                    >
                      <Avatar
                        uri={u.avatar}
                        username={u.username}
                        size={40}
                        variant="roundedSquare"
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.userRowName} numberOfLines={1}>
                          {u.name}
                        </Text>
                        <Text
                          style={styles.userRowHandle}
                          numberOfLines={1}
                        >
                          @{u.username}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </View>
              <View style={styles.modalButtons}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setShowTransferModal(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "rgba(10,10,10,0.95)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  successButton: {
    backgroundColor: "rgba(63,220,255,0.1)",
  },
  actionLabel: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  successLabel: {
    color: "#3FDCFF",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalKAV: {
    justifyContent: "flex-end",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    alignSelf: "center",
    marginBottom: 20,
  },
  sheetContent: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  modalSubtitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  modalCancelText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
  },
  modalSubmitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  modalSubmitText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  resultsList: {
    maxHeight: 320,
    gap: 6,
    paddingVertical: 6,
    marginBottom: 12,
  },
  resultsHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 20,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  userRowName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  userRowHandle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2,
  },
});
