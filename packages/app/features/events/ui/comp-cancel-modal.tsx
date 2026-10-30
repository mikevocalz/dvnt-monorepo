import React from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import {
  COMP_CANCEL_WARNING,
  compCancelHolder,
} from "@dvnt/app/lib/tickets/organizer-comp-cancel";
import { useCompCancel } from "./use-comp-cancel";
export function CompCancelModal({ eventId }: { eventId: number }) {
  const s = useCompCancel(eventId);
  const ticket = s.ticket;
  return (
    <Modal
      visible={!!ticket && ticket.event_id === eventId}
      transparent
      animationType="slide"
      onRequestClose={s.close}
    >
      <KeyboardAvoidingView
        behavior="padding"
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "#0009",
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{
            maxHeight: "90%",
            backgroundColor: "#171719",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
          }}
          contentContainerStyle={{ padding: 24, paddingBottom: 44, gap: 16 }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: "white", fontSize: 20, fontWeight: "700" }}
          >
            Cancel incorrectly issued free ticket
          </Text>
          {ticket ? (
            <>
              <View
                style={{
                  padding: 16,
                  backgroundColor: "#ffffff0a",
                  borderRadius: 12,
                  gap: 6,
                }}
              >
                <Text style={{ color: "white", fontWeight: "700" }}>
                  {ticket.event_title || `Event ${eventId}`}
                </Text>
                <Text style={{ color: "#ccc" }}>
                  {ticket.event_location ||
                    "Confirm this event before cancelling"}
                </Text>
                <Text style={{ color: "white" }}>
                  {compCancelHolder(ticket)} ·{" "}
                  {ticket.ticket_type_name || "General"}
                </Text>
                <Text style={{ color: "#999", fontSize: 11 }}>
                  Ticket {ticket.id}
                </Text>
              </View>
              <Text style={{ color: "#ccc", lineHeight: 21 }}>
                {COMP_CANCEL_WARNING}
              </Text>
              {!ticket.organizer_free_cancel?.eligible ? (
                <Text accessibilityRole="alert" style={{ color: "#fbbf24" }}>
                  {ticket.organizer_free_cancel?.reason ||
                    "This ticket cannot be cancelled here."}
                </Text>
              ) : null}
              <Text style={{ color: "white" }}>Reason for cancellation</Text>
              <TextInput
                accessibilityLabel="Reason for cancellation"
                editable={!s.busy}
                value={s.reason}
                onChangeText={s.setReason}
                maxLength={240}
                multiline
                placeholder="For example: issued the wrong event"
                placeholderTextColor="#888"
                style={{
                  color: "white",
                  borderColor: "#555",
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 12,
                  minHeight: 80,
                }}
              />
              {s.error ? (
                <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>
                  {s.error} Close and refresh the roster before another attempt.
                </Text>
              ) : null}
              <Pressable
                disabled={!s.valid || s.busy || !!s.error}
                onPress={s.submit}
                accessibilityRole="button"
                style={{
                  padding: 16,
                  borderRadius: 8,
                  backgroundColor: "#c42d40",
                  opacity: !s.valid || s.busy || s.error ? 0.4 : 1,
                }}
              >
                <Text
                  style={{
                    color: "white",
                    textAlign: "center",
                    fontWeight: "700",
                  }}
                >
                  {s.busy ? "Cancelling…" : "Cancel this free ticket"}
                </Text>
              </Pressable>
              <Pressable
                disabled={s.busy}
                onPress={s.close}
                accessibilityRole="button"
                style={{ padding: 16 }}
              >
                <Text style={{ color: "white", textAlign: "center" }}>
                  Keep ticket
                </Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
