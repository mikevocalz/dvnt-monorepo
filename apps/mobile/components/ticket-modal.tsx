import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, ScrollView, Image } from "react-native";
import {
  X,
  Calendar,
  MapPin,
  Clock,
  CheckCircle,
  AlertCircle,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Motion } from "@legendapp/motion";
import { useColorScheme } from "@/lib/hooks";
import { Ticket } from "@/lib/stores/ticket-store";
import Logo from "@/components/logo";
import QRCode from "@/components/qr-code";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

interface TicketModalProps {
  visible: boolean;
  onClose: () => void;
  ticket: Ticket | null;
  event: {
    title: string;
    eventDate: string;
    location: string;
    image?: string;
  };
  userAvatar?: string;
}

export function TicketModal({
  visible,
  onClose,
  ticket,
  event,
  userAvatar,
}: TicketModalProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const snapPoints = useMemo(() => ["92%"], []);

  useEffect(() => {
    if (visible) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [visible]);

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
        opacity={0.7}
        pressBehavior="close"
      />
    ),
    [],
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getStatusInfo = () => {
    switch (ticket?.status) {
      case "checked_in":
        return {
          label: "Checked In",
          color: "#22c55e",
          icon: CheckCircle,
        };
      case "revoked":
        return {
          label: "Revoked",
          color: "#ef4444",
          icon: AlertCircle,
        };
      default:
        return {
          label: "Valid",
          color: "#22c55e",
          icon: CheckCircle,
        };
    }
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  const logoUrl =
    userAvatar ||
    "https://images.unsplash.com/photo-1614680376593-902f74cf0d41?w=100&h=100&fit=crop";

  const renderQRCode = () => {
    return (
      <QRCode
        value={ticket?.qrToken || ""}
        size={200}
        backgroundColor="#FFFFFF"
        foregroundColor="#000000"
        logo={true}
        logoSize={48}
        logoBackgroundColor="#FFFFFF"
      />
    );
  };

  if (!ticket) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onChange={handleSheetChange}
      backgroundStyle={{
        backgroundColor: colors.background,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: "rgba(255,255,255,0.3)",
        width: 36,
      }}
    >
      <View className="flex-row items-center justify-between px-5 py-3">
        <Text className="text-xl font-bold text-foreground">Your Ticket</Text>
        <Pressable
          onPress={onClose}
          className="w-10 h-10 bg-card rounded-full items-center justify-center"
        >
          <X size={24} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <BottomSheetScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20 }}
      >
        <View className="rounded-2xl overflow-hidden shadow-lg">
          <LinearGradient colors={["#1A1A28", "#252538"]} className="p-5">
            <View className="mb-4">
              <View className="gap-3">
                <Text
                  className="text-2xl font-extrabold text-foreground leading-tight"
                  numberOfLines={2}
                >
                  {event?.title}
                </Text>
                <View
                  className={`flex-row items-center self-start px-3 py-1.5 rounded-full bg-[${statusInfo.color}20] gap-1.5`}
                >
                  <StatusIcon size={14} color={statusInfo.color} />
                  <Text
                    className={`text-sm font-semibold`}
                    style={{ color: statusInfo.color }}
                  >
                    {statusInfo.label}
                  </Text>
                </View>
              </View>
            </View>

            <View className="flex-row items-center my-5 relative">
              <View className="absolute -left-8 w-5 h-5 bg-background rounded-full" />
              {[...Array(20)].map((_, i) => (
                <View
                  key={i}
                  className="flex-1 h-0.5 bg-border mx-0.5 rounded-full"
                />
              ))}
              <View className="absolute -right-8 w-5 h-5 bg-background rounded-full" />
            </View>

            <View className="items-center mb-5">
              <View className="p-4 bg-white rounded-2xl shadow-md">
                {renderQRCode()}
              </View>
              <Text className="mt-3 text-sm text-muted-foreground font-medium">
                Scan this QR code at the venue
              </Text>
            </View>

            <View className="bg-surface-light rounded-2xl p-4 gap-3 mb-4">
              <View className="flex-row gap-3">
                <View className="flex-1 flex-row items-start gap-2.5">
                  <Calendar size={16} color="#3b82f6" />
                  <View>
                    <Text className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Date
                    </Text>
                    <Text className="text-sm text-foreground font-semibold mt-0.5">
                      {formatDate(event?.eventDate || "")}
                    </Text>
                  </View>
                </View>
                <View className="flex-1 flex-row items-start gap-2.5">
                  <Clock size={16} color="#3b82f6" />
                  <View>
                    <Text className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Time
                    </Text>
                    <Text className="text-sm text-foreground font-semibold mt-0.5">
                      {formatTime(event?.eventDate || "")}
                    </Text>
                  </View>
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1 flex-row items-start gap-2.5">
                  <MapPin size={16} color="#3b82f6" />
                  <View className="flex-1">
                    <Text className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                      Location
                    </Text>
                    <Text
                      className="text-sm text-foreground font-semibold mt-0.5"
                      numberOfLines={1}
                    >
                      {event?.location}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View className="items-center">
              <View className="items-center">
                <Text className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Ticket ID
                </Text>
                <Text className="text-sm text-muted-foreground font-bold tracking-widest font-mono">
                  {ticket.id.slice(0, 8).toUpperCase()}
                </Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {ticket.status === "checked_in" && ticket.checkedInAt && (
          <View className="flex-row items-center gap-2.5 mt-4 p-3.5 bg-success/15 rounded-2xl">
            <CheckCircle size={18} color="#22c55e" />
            <Text className="flex-1 text-sm text-success font-medium">
              Checked in on {formatDate(ticket.checkedInAt)} at{" "}
              {formatTime(ticket.checkedInAt)}
            </Text>
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
