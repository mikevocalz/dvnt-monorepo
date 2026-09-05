/**
 * EjectModal Component
 * Blocking modal shown when user is kicked or banned
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { UserX, Ban, X } from "lucide-react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { c } from "./styles";
import type { EjectPayload } from "../types";

const SHEET_BG = {
  backgroundColor: "#1a1a2e",
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
};
const SHEET_HANDLE = { backgroundColor: "rgba(255,255,255,0.3)", width: 36 };

interface EjectModalProps {
  visible: boolean;
  ejectReason?: EjectPayload;
  onDismiss: () => void;
}

export function EjectModal({
  visible,
  ejectReason,
  onDismiss,
}: EjectModalProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const isKick = ejectReason?.action === "kick";
  const isBan = ejectReason?.action === "ban";

  const Icon = isBan ? Ban : UserX;
  const title = isBan ? "You've Been Banned" : "You've Been Removed";
  const description = isBan
    ? "You are no longer allowed to join this room."
    : "The host or a moderator has removed you from this room.";

  useEffect(() => {
    if (visible) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [visible]);

  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onDismiss();
    },
    [onDismiss],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        pressBehavior="none"
      />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      enableDynamicSizing
      enablePanDownToClose={false}
      backdropComponent={renderBackdrop}
      onChange={handleChange}
      backgroundStyle={SHEET_BG}
      handleIndicatorStyle={SHEET_HANDLE}
    >
      <BottomSheetView className="px-6 pb-10 pt-2 items-center">
        {/* Icon */}
        <View className="items-center mb-4">
          <View
            className={`w-16 h-16 rounded-full items-center justify-center ${isBan ? "bg-destructive/20" : "bg-amber-500/20"}`}
          >
            <Icon size={32} color={isBan ? "#ef4444" : "#f59e0b"} />
          </View>
        </View>

        {/* Title */}
        <Text className="text-xl font-bold text-foreground text-center mb-2">
          {title}
        </Text>

        {/* Description */}
        <Text className="text-muted-foreground text-center mb-4">
          {description}
        </Text>

        {/* Reason (if provided) */}
        {ejectReason?.reason && (
          <View className="bg-muted/50 rounded-xl p-3 mb-4">
            <Text className="text-sm text-muted-foreground text-center">
              Reason: {ejectReason.reason}
            </Text>
          </View>
        )}

        {/* Ban expiry (if applicable) */}
        {isBan && ejectReason?.expiresAt && (
          <Text className="text-xs text-muted-foreground text-center mb-4">
            Ban expires: {new Date(ejectReason.expiresAt).toLocaleString()}
          </Text>
        )}

        {/* Dismiss Button */}
        <Pressable className={c.btnPrimary} onPress={onDismiss}>
          <Text className="text-primary-foreground font-semibold">
            {isBan ? "I Understand" : "Leave Room"}
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}

interface ConfirmKickModalProps {
  visible: boolean;
  username: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmKickModal({
  visible,
  username,
  onConfirm,
  onCancel,
}: ConfirmKickModalProps) {
  const sheetRef = useRef<BottomSheet>(null);

  useEffect(() => {
    if (visible) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [visible]);

  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onCancel();
    },
    [onCancel],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onChange={handleChange}
      backgroundStyle={SHEET_BG}
      handleIndicatorStyle={SHEET_HANDLE}
    >
      <BottomSheetView className="px-6 pb-10 pt-2">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-bold text-foreground">Kick User</Text>
          <Pressable onPress={onCancel} hitSlop={12}>
            <X size={20} color="#999" />
          </Pressable>
        </View>

        <Text className="text-muted-foreground mb-6">
          Are you sure you want to kick{" "}
          <Text className="font-semibold text-foreground">{username}</Text> from
          the room? They can rejoin later.
        </Text>

        <View className="flex-row gap-3">
          <Pressable className={`${c.btnSecondary} flex-1`} onPress={onCancel}>
            <Text className="text-secondary-foreground font-semibold">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            className={`${c.btnDestructive} flex-1`}
            onPress={onConfirm}
          >
            <Text className="text-white font-semibold">Kick</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

interface ConfirmBanModalProps {
  visible: boolean;
  username: string;
  onConfirm: (durationMinutes?: number) => void;
  onCancel: () => void;
}

export function ConfirmBanModal({
  visible,
  username,
  onConfirm,
  onCancel,
}: ConfirmBanModalProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const [duration, setDuration] = useState<number | undefined>(undefined);

  const durations = [
    { label: "Permanent", value: undefined },
    { label: "1 hour", value: 60 },
    { label: "24 hours", value: 1440 },
    { label: "7 days", value: 10080 },
  ];

  useEffect(() => {
    if (visible) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [visible]);

  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onCancel();
    },
    [onCancel],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onChange={handleChange}
      backgroundStyle={SHEET_BG}
      handleIndicatorStyle={SHEET_HANDLE}
    >
      <BottomSheetView className="px-6 pb-10 pt-2">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-lg font-bold text-foreground">Ban User</Text>
          <Pressable onPress={onCancel} hitSlop={12}>
            <X size={20} color="#999" />
          </Pressable>
        </View>

        <Text className="text-muted-foreground mb-4">
          Ban <Text className="font-semibold text-foreground">{username}</Text>{" "}
          from this room? They won't be able to rejoin.
        </Text>

        {/* Duration Selection */}
        <View className="flex-row flex-wrap gap-2 mb-6">
          {durations.map((d) => (
            <Pressable
              key={d.label}
              className={`px-3 py-2 rounded-full ${duration === d.value ? "bg-primary" : "bg-muted"}`}
              onPress={() => setDuration(d.value)}
            >
              <Text
                className={
                  duration === d.value
                    ? "text-primary-foreground"
                    : "text-muted-foreground"
                }
              >
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="flex-row gap-3">
          <Pressable className={`${c.btnSecondary} flex-1`} onPress={onCancel}>
            <Text className="text-secondary-foreground font-semibold">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            className={`${c.btnDestructive} flex-1`}
            onPress={() => onConfirm(duration)}
          >
            <Text className="text-white font-semibold">Ban</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

interface EndRoomModalProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EndRoomModal({
  visible,
  onConfirm,
  onCancel,
}: EndRoomModalProps) {
  const sheetRef = useRef<BottomSheet>(null);

  useEffect(() => {
    if (visible) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [visible]);

  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onCancel();
    },
    [onCancel],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onChange={handleChange}
      backgroundStyle={SHEET_BG}
      handleIndicatorStyle={SHEET_HANDLE}
    >
      <BottomSheetView className="px-6 pb-10 pt-2">
        <Text className="text-lg font-bold text-foreground mb-2">
          End Room?
        </Text>
        <Text className="text-muted-foreground mb-6">
          This will end the call for everyone. This action cannot be undone.
        </Text>

        <View className="flex-row gap-3">
          <Pressable className={`${c.btnSecondary} flex-1`} onPress={onCancel}>
            <Text className="text-secondary-foreground font-semibold">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            className={`${c.btnDestructive} flex-1`}
            onPress={onConfirm}
          >
            <Text className="text-white font-semibold">End Room</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
