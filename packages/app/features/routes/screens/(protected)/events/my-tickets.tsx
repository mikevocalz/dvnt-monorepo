/**
 * My Tickets Screen
 *
 * Lists all tickets the current user has (purchased or RSVP).
 * Tapping a ticket navigates to the ticket detail/QR view.
 * Always enabled — viewing tickets should never be gated.
 */

import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  ArrowLeft,
  Ticket,
  QrCode,
  Calendar,
  MapPin,
  Send,
  Shirt,
} from "lucide-react-native";
import { Image } from "expo-image";
import { LegendList } from "@dvnt/app/components/list";
import { ticketKeys, useMyTickets } from "@dvnt/app/lib/hooks/use-tickets";
import type { TicketRecord } from "@dvnt/app/lib/api/tickets";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@dvnt/app/components/ui/skeleton";

const STATUS_COLORS: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  active: { bg: "rgba(34, 197, 94, 0.15)", text: "#22C55E", label: "Active" },
  scanned: { bg: "rgba(59, 130, 246, 0.15)", text: "#3B82F6", label: "Used" },
  refunded: {
    bg: "rgba(239, 68, 68, 0.15)",
    text: "#EF4444",
    label: "Refunded",
  },
  void: { bg: "rgba(107, 114, 128, 0.15)", text: "#6B7280", label: "Void" },
  transfer_pending: {
    bg: "rgba(138, 64, 207, 0.15)",
    text: "#8A40CF",
    label: "Transfer Pending",
  },
  payment_pending: {
    bg: "rgba(234, 179, 8, 0.15)",
    text: "#EAB308",
    label: "Payment Pending",
  },
};

function TicketCardSkeleton({ index }: { index: number }) {
  return (
    <Animated.View
      entering={FadeInDown.delay(index * 45)
        .duration(240)
        .springify()
        .damping(18)}
      className="mx-4 mb-3"
    >
      <View className="bg-card rounded-2xl border border-border overflow-hidden">
        <View className="flex-row">
          <Skeleton style={{ width: 80, height: 100, borderRadius: 0 }} />
          <View className="flex-1 p-3 justify-between">
            <View style={{ gap: 8 }}>
              <Skeleton style={{ width: "62%", height: 16, borderRadius: 6 }} />
              <Skeleton style={{ width: "32%", height: 12, borderRadius: 6 }} />
            </View>
            <View className="flex-row items-center gap-3 mt-2">
              <Skeleton style={{ width: 54, height: 12, borderRadius: 6 }} />
              <Skeleton style={{ width: 72, height: 12, borderRadius: 6 }} />
            </View>
          </View>
          <View className="items-center justify-center px-3 gap-2">
            <Skeleton style={{ width: 48, height: 20, borderRadius: 999 }} />
            <Skeleton style={{ width: 18, height: 18, borderRadius: 4 }} />
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

function TicketCard({
  ticket,
  index,
}: {
  ticket: TicketRecord;
  index: number;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = STATUS_COLORS[ticket.status] || STATUS_COLORS.void;
  const eventId = String(ticket.event_id || "");
  const isCoatCheck = ticket.category === "coat_check";
  const cardHeight = isCoatCheck ? 78 : 100;
  const imageWidth = isCoatCheck ? 60 : 80;

  const handlePress = useCallback(() => {
    if (!eventId) return;

    queryClient.setQueryData(ticketKeys.myTicketForEvent(eventId), ticket);
    router.push(`/(protected)/ticket/${eventId}` as any);
  }, [eventId, queryClient, router, ticket]);

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 60)
        .duration(300)
        .springify()
        .damping(18)}
    >
      <Pressable
        onPress={handlePress}
        className={`mx-4 mb-3 rounded-2xl border overflow-hidden ${
          isCoatCheck
            ? "bg-slate-950 border-purple-500/20"
            : "bg-card border-border"
        }`}
      >
        <View className="flex-row">
          {/* Event image */}
          {ticket.event_image && !isCoatCheck ? (
            <View
              style={{
                width: imageWidth,
                height: cardHeight,
                overflow: "hidden",
              }}
            >
              <Image
                source={{ uri: ticket.event_image }}
                style={{ width: imageWidth, height: cardHeight }}
                contentFit="cover"
              />
            </View>
          ) : (
            <View
              style={{ width: imageWidth, height: cardHeight }}
              className="bg-muted items-center justify-center"
            >
              {isCoatCheck ? (
                <Shirt size={22} color="#A78BFA" />
              ) : (
                <Ticket size={24} color="#666" />
              )}
            </View>
          )}

          {/* Info */}
          <View className="flex-1 p-3 justify-between">
            <View>
              <Text
                className="text-sm font-sans-bold text-foreground"
                numberOfLines={1}
              >
                {ticket.event_title || "Event"}
              </Text>
              <Text
                className="text-xs text-muted-foreground mt-0.5"
                numberOfLines={1}
              >
                {isCoatCheck
                  ? `Coat Check · ${ticket.ticket_type_name || "Pass"}`
                  : ticket.ticket_type_name}
              </Text>
            </View>

            <View className="flex-row items-center gap-3 mt-2">
              {ticket.event_date && (
                <View className="flex-row items-center gap-1">
                  <Calendar size={10} color="#999" />
                  <Text className="text-[10px] text-muted-foreground">
                    {new Date(ticket.event_date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                </View>
              )}
              {ticket.event_location && (
                <View className="flex-row items-center gap-1">
                  <MapPin size={10} color="#999" />
                  <Text
                    className="text-[10px] text-muted-foreground"
                    numberOfLines={1}
                  >
                    {ticket.event_location}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Status + QR */}
          <View className="items-center justify-center px-3 gap-2">
            <View
              style={{ backgroundColor: status.bg }}
              className="rounded-full px-2 py-0.5"
            >
              <Text
                style={{ color: status.text }}
                className="text-[10px] font-sans-semibold"
              >
                {status.label}
              </Text>
            </View>
            {ticket.status === "active" &&
              (isCoatCheck ? (
                <Shirt size={18} color="#A78BFA" />
              ) : (
                <QrCode size={20} color="#8A40CF" />
              ))}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function PendingTransferCard({
  transfer,
  onAction,
}: {
  transfer: any;
  onAction: () => void;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const [isActing, setIsActing] = useState(false);

  const eventTitle = transfer.tickets?.events?.title || "Event";
  const tierName = transfer.tickets?.ticket_types?.name || "Ticket";

  const handleAccept = async () => {
    setIsActing(true);
    const result = await ticketsApi.acceptTransfer(transfer.id);
    if (result.error) {
      showToast("error", "Error", result.error);
    } else {
      showToast(
        "success",
        "Accepted",
        `Ticket for ${eventTitle} is now yours!`,
      );
      onAction();
    }
    setIsActing(false);
  };

  const handleDecline = () => {
    Alert.alert("Decline Transfer", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Decline",
        style: "destructive",
        onPress: async () => {
          setIsActing(true);
          const result = await ticketsApi.declineTransfer(transfer.id);
          if (result.error) {
            showToast("error", "Error", result.error);
          } else {
            showToast("info", "Declined", "Transfer declined");
            onAction();
          }
          setIsActing(false);
        },
      },
    ]);
  };

  return (
    <View className="mx-4 mb-3 bg-card rounded-2xl border border-border overflow-hidden p-3">
      <View className="flex-row items-center gap-2 mb-2">
        <Send size={14} color="#8A40CF" />
        <Text className="text-xs font-sans-semibold text-purple-400">
          Incoming Transfer
        </Text>
      </View>
      <Text
        className="text-sm font-sans-bold text-foreground"
        numberOfLines={1}
      >
        {eventTitle}
      </Text>
      <Text className="text-xs text-muted-foreground mt-0.5">{tierName}</Text>
      <Text className="text-[10px] text-muted-foreground mt-1">
        Expires{" "}
        {new Date(transfer.expires_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </Text>
      <View className="flex-row gap-2 mt-3">
        <Pressable
          onPress={handleAccept}
          disabled={isActing}
          className="flex-1 bg-primary rounded-lg py-2 items-center"
        >
          {isActing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-primary-foreground font-sans-semibold text-xs">
              Accept
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={handleDecline}
          disabled={isActing}
          className="flex-1 rounded-lg py-2 items-center border border-border"
        >
          <Text className="text-muted-foreground font-sans-semibold text-xs">
            Decline
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function MyTicketsContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: tickets, isLoading, isError, refetch } = useMyTickets();
  const [pendingTransfers, setPendingTransfers] = useState<any[]>([]);

  const loadTransfers = useCallback(async () => {
    try {
      const { incoming } = await ticketsApi.getPendingTransfers();
      setPendingTransfers(incoming ?? []);
    } catch (e) {
      console.warn("[MyTickets] loadTransfers failed:", e);
    }
  }, []);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  const handleTransferAction = useCallback(() => {
    loadTransfers();
    refetch();
  }, [loadTransfers, refetch]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 gap-3">
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Text className="text-lg font-sans-bold text-foreground flex-1">
          My Tickets
        </Text>
      </View>

      {isLoading && (
        <View className="flex-1 pt-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <TicketCardSkeleton key={index} index={index} />
          ))}
        </View>
      )}

      {isError && (
        <View className="flex-1 items-center justify-center px-8">
          <Ticket size={48} color="rgba(255,255,255,0.15)" />
          <Text className="text-muted-foreground mt-3 text-center">
            Failed to load tickets. Pull down to retry.
          </Text>
        </View>
      )}

      {!isLoading && !isError && (!tickets || tickets.length === 0) && (
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 items-center justify-center px-8"
        >
          <Ticket size={56} color="rgba(255,255,255,0.1)" />
          <Text className="text-lg font-sans-semibold text-foreground mt-4">
            No tickets yet
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Your purchased tickets will appear here
          </Text>
          <Pressable
            onPress={() => router.push("/(protected)/(tabs)/events" as any)}
            className="mt-6 bg-primary rounded-full px-6 py-3"
          >
            <Text className="text-primary-foreground font-sans-semibold">
              Browse Events
            </Text>
          </Pressable>
        </Animated.View>
      )}

      {!isLoading && (tickets?.length || pendingTransfers.length > 0) ? (
        <LegendList
          data={[
            ...pendingTransfers.map((t: any) => ({ ...t, _isTransfer: true })),
            ...(tickets || []),
          ]}
          keyExtractor={(item: any) =>
            item._isTransfer ? `transfer-${item.id}` : item.id
          }
          renderItem={({ item, index }: { item: any; index: number }) =>
            item._isTransfer ? (
              <PendingTransferCard
                transfer={item}
                onAction={handleTransferAction}
              />
            ) : (
              <TicketCard ticket={item} index={index} />
            )
          }
          estimatedItemSize={110}
          contentContainerStyle={{
            paddingTop: 8,
            paddingBottom: insets.bottom + 20,
          }}
          onRefresh={() => {
            refetch();
            loadTransfers();
          }}
          refreshing={false}
        />
      ) : null}
    </View>
  );
}

export default function MyTicketsScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="MyTickets" onGoBack={() => router.back()}>
      <MyTicketsContent />
    </ErrorBoundary>
  );
}
