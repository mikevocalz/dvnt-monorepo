/**
 * Event Staff Management Screen
 *
 * Host (or admin co-organizer) view. Lists owner + every row in
 * event_co_organizers. Lets the caller invite by @username + role,
 * accept-pending indicator, revoke. Uses the four privileged wrappers
 * in lib/api/privileged/index.ts (inviteCoOrganizer / acceptCoOrganizerInvite
 * / declineCoOrganizerInvite / revokeCoOrganizer) which call the
 * invite-co-organizer edge function deployed earlier this session.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserPlus, Shield, ShieldCheck, ScanLine, X } from "lucide-react-native";
import {
  getEventStaff,
  inviteCoOrganizer,
  revokeCoOrganizer,
  type StaffEntry,
  type CoOrgRole,
} from "@dvnt/app/lib/api/privileged";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { tierAccent } from "@dvnt/app/lib/theme/tier-colors";

const ROLE_OPTIONS: { value: CoOrgRole; label: string; description: string }[] = [
  {
    value: "scanner",
    label: "Scanner",
    description: "Check tickets in at the door. PII-redacted roster.",
  },
  {
    value: "editor",
    label: "Manager",
    description: "Scanner + full roster + refunds + analytics.",
  },
  {
    value: "admin",
    label: "Co-host",
    description: "Manager + invite other staff. Owner-only to grant.",
  },
];

function roleColor(role: StaffEntry["role"]): string {
  switch (role) {
    case "owner":
      return tierAccent("table"); // magenta
    case "admin":
      return tierAccent("vip"); // purple
    case "editor":
      return tierAccent("ga"); // primary cyan
    case "scanner":
      return tierAccent("free"); // bright cyan
  }
}

function roleLabel(role: StaffEntry["role"]): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Co-host";
    case "editor":
      return "Manager";
    case "scanner":
      return "Scanner";
  }
}

function RoleIcon({ role, size = 16 }: { role: StaffEntry["role"]; size?: number }) {
  const color = roleColor(role);
  if (role === "owner" || role === "admin") return <ShieldCheck size={size} color={color} />;
  if (role === "editor") return <Shield size={size} color={color} />;
  return <ScanLine size={size} color={color} />;
}

export default function EventStaffScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = parseInt(id || "0", 10);
  const router = useRouter();
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [roleInput, setRoleInput] = useState<CoOrgRole>("scanner");

  const staffQuery = useQuery({
    queryKey: ["event-staff", eventId],
    queryFn: () => getEventStaff(eventId),
    enabled: Number.isFinite(eventId) && eventId > 0,
    staleTime: 5_000,
  });

  const inviteMutation = useMutation({
    mutationFn: ({ username, role }: { username: string; role: CoOrgRole }) =>
      inviteCoOrganizer(eventId, username, role),
    onSuccess: (res) => {
      if ((res as any)?.error) {
        showToast("error", "Invite failed", String((res as any).error));
        return;
      }
      showToast(
        "success",
        (res as any).reinvited ? "Re-invited" : "Invite sent",
        `Pushed @${usernameInput}.`,
      );
      setUsernameInput("");
      setInviteOpen(false);
      queryClient.invalidateQueries({ queryKey: ["event-staff", eventId] });
    },
    onError: (err: any) => {
      showToast(
        "error",
        "Invite failed",
        err?.message || "Try a different username.",
      );
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revokeCoOrganizer(inviteId),
    onSuccess: () => {
      showToast("success", "Staff removed", "");
      queryClient.invalidateQueries({ queryKey: ["event-staff", eventId] });
    },
    onError: (err: any) => {
      showToast(
        "error",
        "Couldn't remove",
        err?.message || "Try again.",
      );
    },
  });

  const staff = staffQuery.data?.staff || [];
  const callerRole = staffQuery.data?.callerRole || null;
  const canManage = callerRole === "owner" || callerRole === "admin";

  const grouped = useMemo(() => {
    const accepted = staff.filter((s) => s.accepted);
    const pending = staff.filter((s) => !s.accepted);
    return { accepted, pending };
  }, [staff]);

  const onInviteSubmit = useCallback(() => {
    const u = usernameInput.trim().replace(/^@/, "");
    if (!u) {
      showToast("error", "Username required", "");
      return;
    }
    inviteMutation.mutate({ username: u, role: roleInput });
  }, [usernameInput, roleInput, inviteMutation, showToast]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Staff</Text>
        {canManage ? (
          <Pressable
            onPress={() => setInviteOpen((v) => !v)}
            hitSlop={12}
            style={styles.headerAction}
          >
            <UserPlus size={20} color="#fff" />
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
      </View>

      {inviteOpen && canManage && (
        <View style={styles.inviteCard}>
          <View style={styles.inviteRow}>
            <Text style={styles.inviteAt}>@</Text>
            <TextInput
              value={usernameInput}
              onChangeText={setUsernameInput}
              placeholder="username"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.inviteInput}
            />
          </View>

          <View style={styles.roleGrid}>
            {ROLE_OPTIONS.map((opt) => {
              const selected = roleInput === opt.value;
              const disabled =
                opt.value === "admin" && callerRole !== "owner";
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => !disabled && setRoleInput(opt.value)}
                  disabled={disabled}
                  style={[
                    styles.roleOption,
                    selected && {
                      borderColor: roleColor(opt.value),
                      backgroundColor: `${roleColor(opt.value)}22`,
                    },
                    disabled && styles.roleDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.roleLabel,
                      selected && { color: roleColor(opt.value) },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text style={styles.roleDesc}>{opt.description}</Text>
                  {disabled && (
                    <Text style={styles.roleDisabledNote}>
                      Owner only
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={onInviteSubmit}
            disabled={inviteMutation.isPending}
            style={[
              styles.sendBtn,
              inviteMutation.isPending && { opacity: 0.6 },
            ]}
          >
            {inviteMutation.isPending ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>Send invite</Text>
            )}
          </Pressable>
        </View>
      )}

      {staffQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
        </View>
      ) : staffQuery.isError ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.dim}>Couldn't load staff. Pull to retry.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          {grouped.pending.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>PENDING INVITES</Text>
              {grouped.pending.map((s) => (
                <StaffRow
                  key={s.inviteId ?? s.authId}
                  staff={s}
                  canManage={canManage && s.role !== "owner"}
                  onRevoke={() =>
                    s.inviteId && revokeMutation.mutate(s.inviteId)
                  }
                  pending
                />
              ))}
            </>
          )}

          <Text style={styles.sectionLabel}>STAFF</Text>
          {grouped.accepted.map((s) => (
            <StaffRow
              key={s.inviteId ?? s.authId}
              staff={s}
              canManage={
                canManage &&
                s.role !== "owner" &&
                (callerRole === "owner" || s.role !== "admin")
              }
              onRevoke={() =>
                s.inviteId && revokeMutation.mutate(s.inviteId)
              }
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StaffRow({
  staff,
  canManage,
  onRevoke,
  pending = false,
}: {
  staff: StaffEntry;
  canManage: boolean;
  onRevoke: () => void;
  pending?: boolean;
}) {
  const handle = staff.username
    ? `@${staff.username}`
    : staff.authId.slice(0, 8);
  const name = staff.displayName || handle;
  const accent = roleColor(staff.role);

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.avatar,
          { backgroundColor: staff.avatarUrl ? "transparent" : "#222" },
        ]}
      >
        {/* No avatar fetch on this screen for perf — just initial */}
        <Text style={styles.avatarText}>
          {name.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.rowHandle} numberOfLines={1}>
          {handle}
        </Text>
      </View>
      <View style={styles.rowMeta}>
        <View style={[styles.roleBadge, { borderColor: accent }]}>
          <RoleIcon role={staff.role} size={11} />
          <Text style={[styles.roleBadgeText, { color: accent }]}>
            {roleLabel(staff.role)}
          </Text>
        </View>
        {pending && (
          <Text style={styles.pendingText}>Awaiting accept</Text>
        )}
      </View>
      {canManage ? (
        <Pressable
          onPress={onRevoke}
          hitSlop={12}
          style={styles.removeBtn}
        >
          <X size={16} color="rgba(255,255,255,0.5)" />
        </Pressable>
      ) : (
        <View style={styles.removeBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  headerAction: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 16,
  },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
  },
  inviteAt: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 17,
    fontWeight: "600",
  },
  inviteInput: {
    flex: 1,
    color: "#fff",
    fontSize: 17,
  },
  roleGrid: {
    gap: 8,
  },
  roleOption: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  roleDisabled: {
    opacity: 0.4,
  },
  roleLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  roleDesc: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    marginTop: 4,
  },
  roleDisabledNote: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginTop: 6,
  },
  sendBtn: {
    backgroundColor: "#fff",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  sendBtnText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "600",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
  },
  sectionLabel: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  rowHandle: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    marginTop: 2,
  },
  rowMeta: {
    alignItems: "flex-end",
    gap: 4,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  pendingText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
  },
  removeBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
