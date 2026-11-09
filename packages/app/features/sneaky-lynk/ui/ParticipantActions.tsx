/**
 * ParticipantActions Component
 * Bottom sheet action menu for role-scoped participant moderation.
 * Long-press a participant tile → Mute / Make Co-Host / Remove
 */

import React, { useEffect, useRef, useState } from "react";
import { Alert, View, Text, Pressable, Modal, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mic, MicOff, Crown, UserMinus, X, EyeOff } from "lucide-react-native";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import type { SneakyUser } from "../types";
import { getSneakyUserLabel } from "./user-labels";
import { participantModeration } from "./moderation-permissions";

interface ParticipantActionsProps {
  visible: boolean;
  actorRole: string | null | undefined;
  actorId: string | undefined;
  participant: {
    userId: string;
    user: SneakyUser;
    role: string;
    isMicOn: boolean;
  } | null;
  onMute: (userId: string) => void | boolean | Promise<void | boolean>;
  onUnmute?: (userId: string) => void | boolean | Promise<void | boolean>;
  onMakeCoHost: (userId: string) => void | boolean | Promise<void | boolean>;
  onDemote: (userId: string) => void | boolean | Promise<void | boolean>;
  onRemove: (userId: string) => void | boolean | Promise<void | boolean>;
  onClose: () => void;
}

export function ParticipantActions({
  visible,
  actorRole,
  actorId,
  participant,
  onMute,
  onUnmute,
  onMakeCoHost,
  onDemote,
  onRemove,
  onClose,
}: ParticipantActionsProps) {
  const insets = useSafeAreaInsets();
  const latest = useRef({ visible, actorRole, actorId, participant, onRemove, onClose });
  latest.current = { visible, actorRole, actorId, participant, onRemove, onClose };
  const selection = JSON.stringify([visible, actorRole, actorId, participant?.userId, participant?.role]);
  const selectionRef = useRef({ key: selection, version: 0 });
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  if (selectionRef.current.key !== selection) {
    selectionRef.current = { key: selection, version: selectionRef.current.version + 1 };
  }
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; selectionRef.current.version += 1; };
  }, []);

  if (!participant) return null;

  const { userId, user, role, isMicOn } = participant;
  const permissions = participantModeration(actorRole, actorId, userId, role);
  if (!permissions.mute) return null;
  const isCoHost = role === "co-host";
  const isAnon = user.isAnonymous;
  const label = getSneakyUserLabel(user);
  const actionKey = JSON.stringify([actorId, userId]);
  const busy = pending.has(actionKey);
  const run = async (action: () => void | boolean | Promise<void | boolean>) => {
    if (!mounted.current || inFlight.current.has(actionKey)) return;
    const version = selectionRef.current.version;
    inFlight.current.add(actionKey);
    setPending(new Set(inFlight.current));
    setError(null);
    try {
      const result = await action();
      if (result !== false && mounted.current && latest.current.visible && selectionRef.current.version === version) latest.current.onClose();
    } catch {
      if (mounted.current && selectionRef.current.version === version) setError({ key: actionKey, message: "Couldn't update this Lynk. Check your connection and try again." });
    } finally {
      inFlight.current.delete(actionKey);
      setPending(new Set(inFlight.current));
    }
  };

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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close participant actions"
              onPress={onClose}
              hitSlop={12}
            >
              <X size={22} color="#6B7280" />
            </Pressable>
          </View>

          <View style={styles.divider} />

          {busy ? <Text accessibilityLiveRegion="polite" style={styles.actionDesc}>Updating participant…</Text> : null}
          {error?.key === actionKey ? <Text accessibilityRole="alert" style={[styles.actionDesc, { color: "#FCA5A5" }]}>{error.message}</Text> : null}
          {/* Actions */}
          {isMicOn ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Mute ${label}`}
              disabled={busy}
              accessibilityState={{ disabled: busy, busy }}
              style={[styles.action, busy && { opacity: 0.4 }]}
              onPress={() => {
                void run(() => onMute(userId));
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
              accessibilityRole="button"
              accessibilityLabel={`Let ${label} unmute`}
              disabled={busy}
              accessibilityState={{ disabled: busy, busy }}
              style={[styles.action, busy && { opacity: 0.4 }]}
              onPress={() => {
                void run(() => onUnmute(userId));
              }}
            >
              <View
                style={[styles.actionIcon, { backgroundColor: "#10B98120" }]}
              >
                <Mic size={20} color="#10B981" />
              </View>
              <View style={styles.actionText}>
                <Text style={styles.actionTitle}>Let them unmute</Text>
                <Text style={styles.actionDesc}>
                  They choose when to turn their microphone on
                </Text>
              </View>
            </Pressable>
          ) : null}

          {permissions.changeRole && isCoHost ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove co-host from ${label}`}
              disabled={busy}
              accessibilityState={{ disabled: busy, busy }}
              style={[styles.action, busy && { opacity: 0.4 }]}
              onPress={() => {
                void run(() => onDemote(userId));
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
          ) : null}
          {permissions.changeRole && !isCoHost ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Make ${label} a co-host`}
              disabled={busy}
              accessibilityState={{ disabled: busy, busy }}
              style={[styles.action, busy && { opacity: 0.4 }]}
              onPress={() => {
                void run(() => onMakeCoHost(userId));
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
          ) : null}

          {permissions.remove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${label} from the room`}
              disabled={busy}
              accessibilityState={{ disabled: busy, busy }}
              style={[styles.action, busy && { opacity: 0.4 }]}
              onPress={() => {
                const version = selectionRef.current.version;
                let consumed = false;
                Alert.alert(`Remove ${label}?`, "They will be removed from this Lynk.", [
                  { text: "Cancel", style: "cancel", onPress: () => { consumed = true; } },
                  { text: "Remove", style: "destructive", onPress: () => {
                    const current = latest.current;
                    if (consumed || !mounted.current || !current.visible || selectionRef.current.version !== version || current.actorId !== actorId ||
                      current.participant?.userId !== userId || !participantModeration(
                        current.actorRole, current.actorId, userId, current.participant.role,
                      ).remove) return;
                    consumed = true;
                    void run(() => current.onRemove(userId));
                  } },
                ], { cancelable: true, onDismiss: () => { consumed = true; } });
              }}
            >
              <View
                style={[styles.actionIcon, { backgroundColor: "#EF444420" }]}
              >
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
          ) : null}
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
