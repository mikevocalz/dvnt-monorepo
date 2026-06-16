/**
 * ParticipantActions Component
 * Bottom sheet action menu for host controls on a participant.
 * Long-press a participant tile → Mute / Make Co-Host / Remove
 */

import React from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mic, MicOff, Crown, UserMinus, X, EyeOff } from "lucide-react-native";
import { Avatar } from "@/components/ui/avatar";
import type { SneakyUser } from "../types";
import { getSneakyUserLabel } from "./user-labels";

interface ParticipantActionsProps {
  visible: boolean;
  participant: {
    userId: string;
    user: SneakyUser;
    role: string;
    isMicOn: boolean;
  } | null;
  onMute: (userId: string) => void;
  onUnmute?: (userId: string) => void;
  onMakeCoHost: (userId: string) => void;
  onDemote: (userId: string) => void;
  onRemove: (userId: string) => void;
  onClose: () => void;
}

export function ParticipantActions({
  visible,
  participant,
  onMute,
  onUnmute,
  onMakeCoHost,
  onDemote,
  onRemove,
  onClose,
}: ParticipantActionsProps) {
  const insets = useSafeAreaInsets();

  if (!participant) return null;

  const { userId, user, role, isMicOn } = participant;
  const isCoHost = role === "co-host";
  const isAnon = user.isAnonymous;
  const label = getSneakyUserLabel(user);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {isAnon ? (
                <View style={styles.anonAvatar}>
                  <EyeOff size={20} color="#6B7280" />
                </View>
              ) : (
                <Avatar
                  uri={user.avatar}
                  username={user.username}
                  size={44}
                  variant="roundedSquare"
                />
              )}
              <View style={styles.headerInfo}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {label}
                </Text>
                <Text style={styles.headerRole}>
                  {isCoHost ? "Co-Host" : "Participant"}
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <X size={22} color="#6B7280" />
            </Pressable>
          </View>

          <View style={styles.divider} />

          {/* Actions */}
          {isMicOn ? (
            <Pressable
              style={styles.action}
              onPress={() => {
                onMute(userId);
                onClose();
              }}
            >
              <View
                style={[styles.actionIcon, { backgroundColor: "#EF444420" }]}
              >
                <MicOff size={20} color="#EF4444" />
              </View>
              <View style={styles.actionText}>
                <Text style={styles.actionTitle}>Mute</Text>
                <Text style={styles.actionDesc}>Turn off their microphone</Text>
              </View>
            </Pressable>
          ) : onUnmute ? (
            <Pressable
              style={styles.action}
              onPress={() => {
                onUnmute(userId);
                onClose();
              }}
            >
              <View
                style={[styles.actionIcon, { backgroundColor: "#10B98120" }]}
              >
                <Mic size={20} color="#10B981" />
              </View>
              <View style={styles.actionText}>
                <Text style={styles.actionTitle}>Unmute</Text>
                <Text style={styles.actionDesc}>
                  Turn their microphone back on
                </Text>
              </View>
            </Pressable>
          ) : null}

          {isCoHost ? (
            <Pressable
              style={styles.action}
              onPress={() => {
                onDemote(userId);
                onClose();
              }}
            >
              <View
                style={[styles.actionIcon, { backgroundColor: "#F59E0B20" }]}
              >
                <Crown size={20} color="#F59E0B" />
              </View>
              <View style={styles.actionText}>
                <Text style={styles.actionTitle}>Remove Co-Host</Text>
                <Text style={styles.actionDesc}>
                  Demote back to participant
                </Text>
              </View>
            </Pressable>
          ) : (
            <Pressable
              style={styles.action}
              onPress={() => {
                onMakeCoHost(userId);
                onClose();
              }}
            >
              <View
                style={[styles.actionIcon, { backgroundColor: "#8A40CF20" }]}
              >
                <Crown size={20} color="#8A40CF" />
              </View>
              <View style={styles.actionText}>
                <Text style={styles.actionTitle}>Make Co-Host</Text>
                <Text style={styles.actionDesc}>
                  Give them moderator controls
                </Text>
              </View>
            </Pressable>
          )}

          <Pressable
            style={styles.action}
            onPress={() => {
              onRemove(userId);
              onClose();
            }}
          >
            <View style={[styles.actionIcon, { backgroundColor: "#EF444420" }]}>
              <UserMinus size={20} color="#EF4444" />
            </View>
            <View style={styles.actionText}>
              <Text style={[styles.actionTitle, { color: "#EF4444" }]}>
                Remove from Room
              </Text>
              <Text style={styles.actionDesc}>
                Kick this user out of the room
              </Text>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  anonAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  headerRole: {
    color: "#6B7280",
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: "#2a2a2a",
    marginBottom: 8,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 14,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    flex: 1,
  },
  actionTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  actionDesc: {
    color: "#6B7280",
    fontSize: 12,
    marginTop: 2,
  },
});
