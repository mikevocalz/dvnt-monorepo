import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  StatusBar,
  Platform,
  Alert,
  TextInput,
} from "react-native";
// Galeria → MediaLightbox temporary swap (iOS 26 gesture issue, no native dep)
import { MediaLightbox as Galeria } from "@dvnt/app/components/media/MediaLightbox";
import { LegendList } from "@dvnt/app/components/list";
import React, { useEffect, useCallback, useMemo } from "react";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import { eventKeys, useToggleEventLike } from "@dvnt/app/lib/hooks/use-events";
import { useEventRealtime } from "@dvnt/app/lib/hooks/use-event-realtime";
import {
  getCurrentUserIdSync,
  getCurrentUserAuthId,
} from "@dvnt/app/lib/api/auth-helper";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Share2,
  Heart,
  MapPin,
  Star,
  MessageCircle,
  ChevronRight,
  BadgeCheck,
  Trash2,
  QrCode,
  LayoutDashboard,
  ScanLine,
  CalendarPlus,
  Zap,
  Pencil,
  MoreHorizontal,
  Send,
  Ticket,
} from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Motion } from "@legendapp/motion";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  useAnimatedStyle,
  interpolate,
} from "react-native-reanimated";
import { useEventViewStore } from "@dvnt/app/lib/stores/event-store";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { useTicketStore } from "@dvnt/app/lib/stores/ticket-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { eventsApi } from "@dvnt/app/lib/api/events";
import { useEventDetailScreenStore } from "@dvnt/app/lib/stores/event-detail-screen-store";
import { normalizeRouteParams } from "@dvnt/app/lib/navigation/route-params";
import { routeToProfile } from "@dvnt/app/lib/utils/route-to-profile";
import {
  loopDetection,
  useRenderLoopDetector,
} from "@dvnt/app/lib/diagnostics/loop-detection";
import {
  normalizeEvent,
  normalizeArray,
} from "@dvnt/app/lib/normalization/safe-entity";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { ticketKeys } from "@dvnt/app/lib/hooks/use-tickets";
import * as WebBrowser from "expo-web-browser";
import {
  deleteEvent as deleteEventPrivileged,
  cancelEvent as cancelEventPrivileged,
} from "@dvnt/app/lib/api/privileged";
import { propagateEntity } from "@dvnt/app/lib/cache/propagate";
import { useCreateEventReview } from "@dvnt/app/lib/hooks/use-event-reviews";
import { EventRatingModal } from "@dvnt/app/components/event-rating-modal";
import { StarRatingDisplay } from "react-native-star-rating-widget";
import { shareEvent } from "@dvnt/app/lib/utils/sharing";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useSaleNotifyStore } from "@dvnt/app/lib/stores/sale-notify-store";
import { SafeCalendar as Calendar } from "@dvnt/app/lib/safe-native-modules";
import { useOfflineCheckinStore } from "@dvnt/app/lib/stores/offline-checkin-store";
import { useTicketCheckout } from "@dvnt/app/lib/hooks/use-ticket-checkout";
import { MENTION_COLOR } from "@dvnt/app/src/constants/mentions";
import { usePromotionStore } from "@dvnt/app/lib/stores/promotion-store";
import { PromoteEventSheet } from "@dvnt/app/components/events/promote-event-sheet";
import {
  CountdownTimer,
  GoingAccordion,
  WhoAllOverThere,
  CollapsibleRow,
  TicketTierCard,
  StickyCTA,
  EventDetailSkeleton,
  WeatherModule,
  EventMapSection,
  TicketsOpeningSoonCard,
  OrganizerCard,
} from "@dvnt/app/src/events/ui";
import type {
  TicketTier,
  EventAttendee,
  EventDetail,
} from "@dvnt/app/src/events/types";
import { YouTubeEmbed } from "@dvnt/app/components/youtube-embed";
import { EventActionSheet } from "@dvnt/app/components/events/event-action-sheet";
import { EventEditSheet } from "@dvnt/app/components/events/event-edit-sheet";
import { ShareEventSheet } from "@dvnt/app/components/events/share-event-sheet";
import { DVNTLiquidGlassIconButton } from "@dvnt/app/components/media/DVNTLiquidGlass";
import { DVNTAnimatedVideoView } from "@dvnt/app/components/media/DVNTAnimatedVideoView";
import { TranslateButton } from "@dvnt/app/components/ui/translate-button";
import { useContentTranslation } from "@dvnt/app/lib/stores/translation-store";
import { useTranslation } from "react-i18next";
import { shouldShowTranslateButton } from "@dvnt/app/lib/utils/language-detection";
import { UpgradeTierCard } from "@dvnt/app/components/events/UpgradeTierCard";
import { UpgradeConfirmationSheet } from "@dvnt/app/components/events/UpgradeConfirmationSheet";
import {
  useTicketUpgradeOptions,
  useInitiateUpgrade,
  type UpgradeTierOption,
} from "@dvnt/app/lib/hooks/use-ticket-upgrade";
import { useMyTicketForEvent } from "@dvnt/app/lib/hooks/use-tickets";
import { useTicketTypes } from "@dvnt/app/lib/hooks/use-tickets";
import {
  useEventWaitlistStatus,
  useJoinWaitlist,
  useLeaveWaitlist,
} from "@dvnt/app/lib/hooks/use-event-waitlist";
import { ensureOnlineOrToast } from "@dvnt/app/lib/connectivity/guard";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const HERO_HEIGHT = 420;
const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────

function buildCalendarWindow(
  startValue?: string | null,
  endValue?: string | null,
) {
  const fallbackStart = new Date();
  const parsedStart = startValue ? new Date(startValue) : fallbackStart;
  const startDate = Number.isFinite(parsedStart.getTime())
    ? parsedStart
    : fallbackStart;
  const parsedEnd = endValue ? new Date(endValue) : null;
  const endDate =
    parsedEnd &&
    Number.isFinite(parsedEnd.getTime()) &&
    parsedEnd.getTime() > startDate.getTime()
      ? parsedEnd
      : new Date(startDate.getTime() + DEFAULT_EVENT_DURATION_MS);

  return { startDate, endDate };
}

type CalendarRecord = {
  id: string;
  allowsModifications?: boolean;
  source?: { name?: string };
};

// Brand-aligned default glow per tier level. Used only when the DB
// row has no glow_color override.
const DEFAULT_TIER_GLOW: Record<string, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#8A40CF",
  table: "#FF5BFC",
};

const VALID_TIER_LEVELS = new Set(["free", "ga", "vip", "table"]);
const VALID_CATEGORIES = new Set(["admission", "product", "service"]);

function buildTicketTiers(event: EventDetail): TicketTier[] {
  // PREFERRED PATH: use the authoritative ticket_types rows the server
  // returned via get_event_detail. Each row carries the real UUID id
  // that create-payment-intent expects.
  const dbTiers = (event as any).ticketTiers as
    | Array<Record<string, any>>
    | undefined;

  if (Array.isArray(dbTiers) && dbTiers.length > 0) {
    return dbTiers
      .filter((t) => t.is_active !== false)
      .map((t) => {
        const level = VALID_TIER_LEVELS.has(t.tier) ? t.tier : "ga";
        const category = VALID_CATEGORIES.has(t.category)
          ? t.category
          : "admission";
        const priceCents = Number(t.price_cents ?? 0);
        const originalCents = t.original_price_cents
          ? Number(t.original_price_cents)
          : null;
        const remaining =
          typeof t.remaining === "number"
            ? t.remaining
            : Math.max(
                0,
                Number(t.quantity_total ?? 0) - Number(t.quantity_sold ?? 0),
              );
        const perks = Array.isArray(t.perks)
          ? t.perks
              .map((p: any) =>
                typeof p === "string" ? p : (p?.label ?? p?.text ?? ""),
              )
              .filter(Boolean)
          : [];
        return {
          id: String(t.id),
          name: String(t.name ?? "").trim() || "General Admission",
          description: t.description || undefined,
          price: priceCents / 100,
          originalPrice:
            originalCents != null && originalCents > priceCents
              ? originalCents / 100
              : undefined,
          perks,
          category: category as TicketTier["category"],
          remaining,
          maxPerOrder: Number(t.max_per_order ?? 4),
          isSoldOut: !!t.is_sold_out || remaining === 0,
          tier: level as TicketTier["tier"],
          glowColor: t.glow_color || DEFAULT_TIER_GLOW[level] || "#34A2DF",
        };
      })
      .sort((a, b) => a.price - b.price);
  }

  // LEGACY FALLBACK: event has no DB tiers configured (older row, or
  // a free event). Synthesize a single tier from the event's base price
  // so the UI still functions. Do NOT fabricate VIP/Table here — those
  // would have fake ids that fail at checkout. The "Tickets unavailable"
  // guard in handleGetTickets catches the mismatch upstream.
  const price = event.price || 0;
  const maxAttendees = event.maxAttendees || 200;
  const currentAttendees = event.attendees || 0;
  const remaining = Math.max(0, maxAttendees - currentAttendees);

  return [
    {
      id: price === 0 ? "free" : "ga",
      name: price === 0 ? "Free Entry" : "General Admission",
      price,
      perks:
        price === 0
          ? ["General admission", "Access to all areas"]
          : ["Standard entry", "Access to main floor"],
      category: "admission",
      remaining,
      maxPerOrder: price === 0 ? 4 : 6,
      isSoldOut: remaining === 0,
      tier: price === 0 ? "free" : "ga",
      glowColor: price === 0 ? "#3FDCFF" : "#34A2DF",
    },
  ];
}

function buildPlaceholderAttendees(count: number): EventAttendee[] {
  const colors = [
    "#22c55e",
    "#f97316",
    "#06b6d4",
    "#14b8a6",
    "#f59e0b",
    "#8b5cf6",
    "#ef4444",
    "#ec4899",
    "#3b82f6",
    "#10b981",
  ];
  return Array.from({ length: Math.min(count, 8) }, (_, i) => ({
    id: String(i),
    avatar: "",
    color: colors[i % colors.length],
  }));
}

function formatEventDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d
      .toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
      .toUpperCase();
  } catch {
    return dateStr;
  }
}

function formatEventTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

function EventDetailScreenContent() {
  // DEV-only loop detection
  useRenderLoopDetector("EventDetail");

  const rawParams = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // FIX: Normalize params once to prevent string|string[] instability loops
  const normalizedParams = useMemo(
    () => normalizeRouteParams(rawParams),
    [rawParams.id],
  );
  const eventId = normalizedParams.id || "";

  // Live updates for this event: a host editing the title/date/price on
  // another device, or another buyer claiming the last tier, reflects
  // here without a manual refresh.
  useEventRealtime(eventId);

  loopDetection.log("EventDetail", "mount", { eventId });
  const { isRsvped, toggleRsvp } = useEventViewStore();
  const deviceLat = useEventsLocationStore(
    (s) => s.activeCity?.lat ?? s.deviceLat,
  );
  const deviceLng = useEventsLocationStore(
    (s) => s.activeCity?.lng ?? s.deviceLng,
  );
  const { hasValidTicket, setTicket, clearTicket } = useTicketStore();
  const showToast = useUIStore((s) => s.showToast);
  const isSubscribedToSale = useSaleNotifyStore((s) => s.isSubscribed);
  const toggleSaleSubscription = useSaleNotifyStore((s) => s.toggle);
  const notifyOnSaleOpen = isSubscribedToSale(eventId);
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const offlineCheckin = useOfflineCheckinStore();
  const offlineTokenCount = (offlineCheckin.tokensByEvent[eventId] || [])
    .length;
  const { checkout: nativeCheckout, isLoading: isNativeCheckoutLoading } =
    useTicketCheckout();

  const handleDownloadOffline = useCallback(async () => {
    if (!eventId) return;
    showToast("info", "Downloading...", "Fetching ticket data for offline use");
    try {
      const tokens = await ticketsApi.downloadOfflineTokens(eventId);
      if (tokens.length === 0) {
        showToast(
          "warning",
          "No Tickets",
          "No active tickets found for this event",
        );
        return;
      }
      offlineCheckin.setTokensForEvent(eventId, tokens);
      showToast(
        "success",
        "Downloaded",
        `${tokens.length} tickets cached for offline check-in`,
      );
    } catch (err) {
      console.error("[EventDetail] Offline download error:", err);
      showToast("error", "Error", "Failed to download offline data");
    }
  }, [eventId, offlineCheckin, showToast]);

  // Selector-per-field. Destructuring the whole store subscribed the
  // entire event-detail screen to every field change — opening the rating
  // modal, tapping like, or picking a tier each forced a full-screen
  // re-render, which is why the screen felt laggy during checkout.
  const selectedTier = useEventDetailScreenStore((s) => s.selectedTier);
  const setSelectedTier = useEventDetailScreenStore((s) => s.setSelectedTier);
  const showRatingModal = useEventDetailScreenStore((s) => s.showRatingModal);
  const setShowRatingModal = useEventDetailScreenStore(
    (s) => s.setShowRatingModal,
  );
  const ticketQty = useEventDetailScreenStore((s) => s.ticketQty);
  const setTicketQty = useEventDetailScreenStore((s) => s.setTicketQty);
  const resetEventDetailScreen = useEventDetailScreenStore(
    (s) => s.resetEventDetailScreen,
  );

  // ── Ticket upgrade state ──────────────────────────────────────────────
  const upgradeSheetOption = useEventDetailScreenStore(
    (s) => s.upgradeSheetOption,
  );
  const setUpgradeSheetOption = useEventDetailScreenStore(
    (s) => s.setUpgradeSheetOption,
  );
  const showShareSheet = useEventDetailScreenStore((s) => s.showShareSheet);
  const setShowShareSheet = useEventDetailScreenStore(
    (s) => s.setShowShareSheet,
  );
  const showActionSheet = useEventDetailScreenStore((s) => s.showActionSheet);
  const setShowActionSheet = useEventDetailScreenStore(
    (s) => s.setShowActionSheet,
  );

  const { data: myTicketData } = useMyTicketForEvent(eventId);
  const { data: liveTicketTypes = [] } = useTicketTypes(eventId);
  // upgradeOptions computed after upgradeSourceTiers is defined below
  const { mutate: initiateUpgrade, isPending: isUpgradePending } =
    useInitiateUpgrade(eventId);

  const handleUpgradePress = useCallback(
    (option: UpgradeTierOption) => {
      setUpgradeSheetOption(option);
    },
    [setUpgradeSheetOption],
  );

  const handleUpgradeConfirm = useCallback(() => {
    if (!upgradeSheetOption || !myTicketData) return;
    // Route to the dedicated upgrade screen which uses native PaymentSheet.
    // The old `initiateUpgrade()` path opened a Stripe Checkout URL in
    // Safari, briefly exposing the Supabase function URL on a white loading
    // screen before payment. The native flow keeps everything in-app.
    setUpgradeSheetOption(null);
    router.push(`/(protected)/ticket/upgrade/${eventId}` as any);
  }, [
    upgradeSheetOption,
    myTicketData,
    eventId,
    router,
    setUpgradeSheetOption,
  ]);

  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const headerBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [HERO_HEIGHT - 150, HERO_HEIGHT - 80],
      [0, 1],
    ),
  }));

  const headerTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [HERO_HEIGHT - 120, HERO_HEIGHT - 60],
      [0, 1],
    ),
  }));

  const heroParallaxStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [-200, 0, HERO_HEIGHT],
          [-100, 0, 80],
        ),
      },
    ],
  }));

  // ── Fetch event data via single batch RPC ─────────────────────────
  const createReview = useCreateEventReview();

  const {
    data: eventData,
    isLoading,
    isPending,
    isError: hasError,
    refetch: fetchEvent,
  } = useQuery({
    queryKey: eventKeys.detail(eventId),
    queryFn: () => eventsApi.getEventById(eventId),
    enabled: !!eventId,
    // Always background-revalidate on mount. The detail page is the
    // surface where a cancelled/deleted event would do the most damage
    // (showing a fake "Get Tickets" CTA, a stale countdown, etc.) so we
    // explicitly trust the server over any persisted MMKV cache.
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Server-side RSVP status persists across app restarts
  const serverHasTicket = !!(
    eventData?.userRsvpStatus && eventData.userRsvpStatus !== "none"
  );

  // When the server tells us the ticket is refunded/cancelled, clear the
  // stale Zustand entry so hasValidTicket() no longer returns true.
  useEffect(() => {
    if (
      myTicketData &&
      myTicketData.status !== "active" &&
      myTicketData.status !== "scanned"
    ) {
      clearTicket(eventId);
    }
  }, [myTicketData?.status, eventId, clearTicket]);

  // myTicketData is the DB source of truth for paid Stripe tickets.
  // When present, treat it as authoritative — a refunded ticket must
  // not show "View Ticket" even if the Zustand store still says "valid".
  const hasTicket = myTicketData
    ? myTicketData.status === "active" || myTicketData.status === "scanned"
    : hasValidTicket(eventId) || isRsvped[eventId] || serverHasTicket;

  // Fall back to eventData.ticketTiers when the standalone ticket_types query returns empty
  const upgradeSourceTiers =
    useMemo((): import("@dvnt/app/lib/api/ticket-types").TicketTypeRecord[] => {
      if (liveTicketTypes.length > 0) return liveTicketTypes;
      const raw: any[] = eventData?.ticketTiers || [];
      return raw.map((t: any) => ({
        id: t.id,
        event_id: parseInt(String(eventId), 10),
        name: t.name,
        category: t.category || "admission",
        description: t.description || null,
        price_cents: t.price_cents || 0,
        currency: "usd",
        quantity_total: t.quantity_total ?? 0,
        quantity_sold: t.quantity_sold ?? 0,
        max_per_user: t.max_per_user || 4,
        sale_start: t.sale_start || null,
        sale_end: t.sale_end || null,
        is_active: t.is_active !== false,
        created_at: t.created_at || "",
      }));
    }, [liveTicketTypes, eventData?.ticketTiers, eventId]);
  const upgradeOptions = useTicketUpgradeOptions(
    upgradeSourceTiers,
    myTicketData ?? null,
  );

  // Read like state DIRECTLY from the cached event payload. The
  // useToggleEventLike mutation already patches `eventKeys.detail(id)`
  // + every `eventKeys.all` list on onMutate (optimistic) and re-patches
  // on onSuccess with the authoritative server result, so the cache is
  // the single source of truth. Mirroring it into a Zustand store +
  // syncing via useEffect (the previous approach) creates a race when
  // the user likes from the feed card while the detail screen is
  // mounted — the mirror lags one render behind the cache. See
  // CLAUDE.md PREVENTION.md (banned pattern: cache-mirror useState/store).
  const isLiked = eventData?.isLiked ?? false;

  const toggleLikeMutation = useToggleEventLike();
  const handleToggleLike = useCallback(() => {
    if (!eventId) return;
    const wasLiked = eventData?.isLiked ?? false;
    toggleLikeMutation.mutate(
      { eventId, isLiked: wasLiked },
      {
        onSuccess: (result) => {
          if (result.liked && !wasLiked) {
            showToast("success", "Saved", "Event added to your liked events");
          }
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err || "");
          if (msg.includes("Not authenticated")) {
            showToast(
              "error",
              "Session expired",
              "Please log out and log back in",
            );
          } else {
            showToast("error", "Like failed", msg || "Failed to update like");
          }
        },
      },
    );
  }, [eventId, eventData?.isLiked, toggleLikeMutation, showToast]);

  // NORMALIZATION: Create safeEvent with guaranteed non-null values
  // This prevents crashes if TanStack Query updates eventData to null during render
  const safeEvent = useMemo(() => normalizeEvent(eventData), [eventData]);

  // Derive reviews + comments from batch payload
  const reviews = normalizeArray(safeEvent?.topReviews);
  const comments = normalizeArray(safeEvent?.topComments);
  const isLoadingReviews = isLoading;
  const isLoadingComments = isLoading;

  // ── Derived data ────────────────────────────────────────────────────
  // Use real ticket tiers from DB when available, fall back to synthetic
  const ticketTiers = useMemo(() => {
    if (!eventData) return [];
    const dbTiers = eventData.ticketTiers;
    const hasDbTiers = Array.isArray(dbTiers) && dbTiers.length > 0;
    // If the organizer turned ticketing ON but never configured tiers, don't
    // fabricate a synthetic GA card — it can't actually be sold (no real
    // ticket_type_id for Stripe) and tapping Get Tickets would just toast an
    // error. Better: show an empty state and disable the CTA.
    if (eventData.ticketingEnabled && !hasDbTiers) return [];
    // If the organizer set a price but ticketing is OFF, also don't
    // fabricate synthetic tiers — sales aren't open yet (NOLA Red Dress Run
    // case: event 44 with price=30 + ticketing_enabled=false). Showing a
    // synthetic $30 card invited the user to "Get Tickets" only to hit a
    // guardrail toast. Show "Coming Soon" via the CTA instead.
    const eventPriceForSale = Number((eventData as any).price) || 0;
    if (!eventData.ticketingEnabled && eventPriceForSale > 0) return [];
    if (hasDbTiers) {
      const glowColors = ["#34A2DF", "#8A40CF", "#FF5BFC", "#f59e0b"];
      return dbTiers.map((t: any, i: number) => {
        // remaining may be pre-computed by RPC or we derive it from qty fields
        const remaining =
          t.remaining != null
            ? t.remaining
            : t.quantity_total != null
              ? Math.max(0, (t.quantity_total || 0) - (t.quantity_sold || 0))
              : 999; // unknown — treat as available
        const isSoldOut =
          t.is_sold_out != null
            ? t.is_sold_out
            : t.quantity_total != null && remaining === 0;
        return {
          id: t.id,
          name: t.name,
          price: (t.price_cents || 0) / 100,
          originalPrice: t.original_price_cents
            ? t.original_price_cents / 100
            : undefined,
          description: t.description,
          perks: t.perks || [],
          category: t.category || "admission",
          remaining,
          maxPerOrder: t.max_per_order || t.max_per_user || 4,
          isSoldOut,
          tier: t.tier || (i === 0 ? "ga" : i === 1 ? "vip" : "table"),
          glowColor: t.glow_color || glowColors[i % glowColors.length],
        };
      });
    }
    // Fall back to synthetic tiers derived from event price/capacity
    return buildTicketTiers(eventData);
  }, [safeEvent]);

  // Use real attendee avatars from batch payload, fall back to mock
  const realAttendees = useMemo(() => {
    const avatars = safeEvent?.attendeeAvatars;
    if (Array.isArray(avatars) && avatars.length > 0) {
      return avatars.map((a: any) => ({
        id: String(a.id || ""),
        avatar: a.avatar || "",
        username: a.username || "",
        color: "#3b82f6",
      }));
    }
    return [];
  }, [safeEvent]);

  const handleAttendeePress = useCallback(
    (attendee: EventAttendee) => {
      const viewerId = String(getCurrentUserIdSync() ?? "");
      routeToProfile({
        targetUserId: attendee.id,
        targetUsername: attendee.username,
        targetAvatar: attendee.avatar,
        viewerId,
        router,
        queryClient,
      });
    },
    [router, queryClient],
  );

  // Auto-select first paid tier when paid tiers exist; fall back to first tier
  useEffect(() => {
    if (ticketTiers.length > 0 && !selectedTier) {
      const firstPaid = ticketTiers.find((t: any) => (t.price ?? 0) > 0);
      setSelectedTier(firstPaid || ticketTiers[0]);
    }
  }, [ticketTiers, selectedTier]);

  const handleSelectTier = useCallback((tier: TicketTier) => {
    setSelectedTier(tier);
  }, []);

  // ── Waitlist (visible only when the selected tier is sold out) ──
  const waitlistTierId = selectedTier?.id ? String(selectedTier.id) : null;
  const { data: waitlistStatus } = useEventWaitlistStatus(
    eventId,
    waitlistTierId,
  );
  const waitlistJoined = !!waitlistStatus?.joined;
  const joinWaitlistMutation = useJoinWaitlist();
  const leaveWaitlistMutation = useLeaveWaitlist();
  const isWaitlistBusy =
    joinWaitlistMutation.isPending || leaveWaitlistMutation.isPending;

  const handleJoinWaitlist = useCallback(() => {
    if (!eventId || isWaitlistBusy) return;
    joinWaitlistMutation.mutate(
      { eventId, ticketTypeId: waitlistTierId },
      {
        onSuccess: () => {
          showToast(
            "success",
            "You're on the waitlist",
            selectedTier?.name
              ? `We'll let you know if a ${selectedTier.name} spot opens up.`
              : "We'll let you know if a spot opens up.",
          );
        },
        onError: (err: any) => {
          showToast(
            "error",
            "Couldn't join waitlist",
            err?.message || "Try again in a moment.",
          );
        },
      },
    );
  }, [
    eventId,
    isWaitlistBusy,
    joinWaitlistMutation,
    selectedTier?.name,
    showToast,
    waitlistTierId,
  ]);

  const handleLeaveWaitlist = useCallback(() => {
    if (!eventId || isWaitlistBusy) return;
    leaveWaitlistMutation.mutate(
      { eventId, ticketTypeId: waitlistTierId },
      {
        onError: (err: any) => {
          showToast(
            "error",
            "Couldn't leave waitlist",
            err?.message || "Try again in a moment.",
          );
        },
      },
    );
  }, [
    eventId,
    isWaitlistBusy,
    leaveWaitlistMutation,
    showToast,
    waitlistTierId,
  ]);

  // Selector-per-field — typing a promo code should NOT re-render the
  // whole event detail screen on every keystroke.
  const isCheckingOut = useEventDetailScreenStore((s) => s.isCheckingOut);
  const setIsCheckingOut = useEventDetailScreenStore((s) => s.setIsCheckingOut);
  const promoCode = useEventDetailScreenStore((s) => s.promoCode);
  const setPromoCode = useEventDetailScreenStore((s) => s.setPromoCode);

  // FIX: Cleanup effect - reset all screen state on unmount
  useEffect(() => {
    return () => {
      loopDetection.log("EventDetail", "unmount", { eventId });
      resetEventDetailScreen();
    };
  }, [eventId, resetEventDetailScreen]);

  const handleGetTickets = useCallback(async () => {
    if (!eventData || isCheckingOut) return;
    loopDetection.log("EventDetail", "checkout:start", { eventId });
    // Block ticket purchase for cancelled events. The UI already hides
    // the CTA when cancelled, but a stale render or a deep-link tap
    // could still fire this — fail loudly instead of silently charging.
    if ((eventData as any).status === "cancelled") {
      showToast(
        "warning",
        "Event Cancelled",
        "This event has been cancelled. Tickets are no longer available.",
      );
      return;
    }
    // Block ticket purchase for past events
    const now = new Date();
    if (eventData.endDate && new Date(eventData.endDate) < now) {
      showToast("warning", "Event Ended", "This event has already ended.");
      return;
    }
    if (!eventData.endDate && eventData.fullDate) {
      const dayEnd = new Date(eventData.fullDate);
      dayEnd.setHours(23, 59, 59, 999);
      if (dayEnd < now) {
        showToast("warning", "Event Ended", "This event has already ended.");
        return;
      }
    }

    // ── Stripe checkout path (only when real DB ticket tiers exist) ──
    const hasDbTiers =
      Array.isArray(eventData.ticketTiers) && eventData.ticketTiers.length > 0;

    // Price floor for this event — used to distinguish "free RSVP event"
    // (legitimate without tier rows) from "paid event without tiers
    // configured" (a configuration gap that must block checkout).
    const eventPriceNum = Number((eventData as any).price) || 0;

    // GUARD: paid event with ticketing flag on but no tier rows OR no
    // tier selected. Without this guard we used to fall through to the
    // legacy free-RSVP path and issue a free ticket on a paid event —
    // a real revenue bug. Free events bypass this guard so a $0 RSVP
    // event still issues an RSVP ticket without forcing the organizer
    // to set up tier rows just to say "free".
    if (
      eventData.ticketingEnabled &&
      eventPriceNum > 0 &&
      (!hasDbTiers || !selectedTier?.id)
    ) {
      showToast(
        "error",
        "Tickets unavailable",
        !hasDbTiers
          ? "This event has no ticket tiers configured yet."
          : "Pick a ticket tier first.",
      );
      return;
    }

    // GUARD: organizer set a price but never enabled ticketing/created tiers.
    // The legacy RSVP path would silently issue a free ticket — also a real
    // revenue bug. NOLA Red Dress Run (event 44) hit this in production:
    // price="30", ticketing_enabled=false, no tier rows.
    if (!eventData.ticketingEnabled && eventPriceNum > 0) {
      showToast(
        "error",
        "Tickets unavailable",
        "Ticket sales aren't open for this event yet.",
      );
      return;
    }

    if (eventData.ticketingEnabled && hasDbTiers && selectedTier?.id) {
      // Billable action — never fire while confirmed offline. The
      // PaymentSheet would open, the card confirm would fail, and the
      // user would be left wondering if they were charged.
      if (
        ensureOnlineOrToast(
          "Reconnect to finish your ticket purchase.",
          "No connection",
        )
      ) {
        return;
      }
      setIsCheckingOut(true);
      try {
        // Use native PaymentSheet for in-app checkout
        const result = await nativeCheckout({
          eventId,
          ticketTypeId: selectedTier?.id || "",
          quantity: ticketQty,
          ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
        });

        if (result.error) {
          if (result.error !== "Payment cancelled") {
            showToast("error", "Checkout Failed", result.error);
          }
          return;
        }

        // Free ticket — issued server-side, store locally
        if (result.free && result.tickets?.length) {
          const t = result.tickets[0];
          const qty = result.tickets.length;
          setTicket(eventId, {
            id: t.id,
            eventId,
            userId: user?.id || "",
            paid: false,
            status: "valid",
            qrToken: t.qr_token,
            tier: selectedTier?.tier || "ga",
            tierName: selectedTier?.name || undefined,
            transferable: false,
            eventTitle: eventData.title,
            eventDate: eventData.fullDate || eventData.date,
            eventEndDate: eventData.endDate,
            eventLocation: eventData.location,
            eventImage: eventData.image,
          });
          queryClient.invalidateQueries({ queryKey: ticketKeys.myTickets() });
          toggleRsvp(eventId);
          queryClient.setQueryData(eventKeys.detail(eventId), (old: any) =>
            old ? { ...old, attendees: (old.attendees || 0) + qty } : old,
          );
          queryClient.setQueriesData(
            { queryKey: eventKeys.all },
            (old: any) => {
              if (!Array.isArray(old)) return old;
              return old.map((e: any) =>
                String(e.id) === String(eventId)
                  ? {
                      ...e,
                      attendees: (e.attendees || 0) + qty,
                      totalAttendees: (e.totalAttendees || 0) + qty,
                    }
                  : e,
              );
            },
          );
          queryClient.invalidateQueries({ queryKey: eventKeys.all });
          showToast(
            "success",
            qty > 1 ? `${qty} Tickets Confirmed` : "Confirmed",
            `You're going to ${eventData.title}!`,
          );
          return;
        }

        // Paid ticket succeeded — webhook will finalize tickets
        if (result.success) {
          // Poll for ticket creation (webhook may take a moment)
          let newTicket: any = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise((r) => setTimeout(r, 1500));
            const myTickets = await ticketsApi.getMyTickets();
            newTicket = myTickets.find(
              (t) =>
                String(t.event_id) === String(eventId) && t.status === "active",
            );
            if (newTicket) break;
          }

          if (newTicket) {
            setTicket(eventId, {
              id: newTicket.id,
              eventId,
              userId: user?.id || "",
              paid: true,
              status: "valid",
              qrToken: newTicket.qr_token,
              tier: selectedTier?.tier || "ga",
              tierName: newTicket.ticket_type_name || selectedTier?.name,
              transferable: false,
              eventTitle: eventData.title,
              eventDate: eventData.fullDate || eventData.date,
              eventEndDate: eventData.endDate,
              eventLocation: eventData.location,
              eventImage: eventData.image,
            });
            queryClient.invalidateQueries({ queryKey: ticketKeys.myTickets() });
            toggleRsvp(eventId);
            queryClient.setQueryData(eventKeys.detail(eventId), (old: any) =>
              old ? { ...old, attendees: (old.attendees || 0) + 1 } : old,
            );
            queryClient.setQueriesData(
              { queryKey: eventKeys.all },
              (old: any) => {
                if (!Array.isArray(old)) return old;
                return old.map((e: any) =>
                  String(e.id) === String(eventId)
                    ? {
                        ...e,
                        attendees: (e.attendees || 0) + 1,
                        totalAttendees: (e.totalAttendees || 0) + 1,
                      }
                    : e,
                );
              },
            );
            queryClient.invalidateQueries({ queryKey: eventKeys.all });
          }
          showToast(
            "success",
            "Ticket Purchased",
            `You're going to ${eventData.title}!`,
          );
          return;
        }
      } catch (err: any) {
        console.error("[EventDetail] Checkout error:", err);
        showToast("error", "Error", err.message || "Checkout failed");
      } finally {
        setIsCheckingOut(false);
      }
      return;
    }

    // ── Legacy RSVP path (ticketing OFF) ──
    toggleRsvp(eventId);

    // Optimistically update local attendee count + RSVP status
    queryClient.setQueryData(eventKeys.detail(eventId), (old: any) =>
      old
        ? {
            ...old,
            attendees: (old.attendees || 0) + 1,
            rsvpCount: (old.rsvpCount || 0) + 1,
            userRsvpStatus: "going",
          }
        : old,
    );
    queryClient.setQueriesData({ queryKey: eventKeys.all }, (old: any) => {
      if (!Array.isArray(old)) return old;
      return old.map((e: any) =>
        String(e.id) === String(eventId)
          ? {
              ...e,
              attendees: (e.attendees || 0) + 1,
              totalAttendees: (e.totalAttendees || 0) + 1,
            }
          : e,
      );
    });

    // Persist RSVP to database (increments total_attendees via RPC)
    eventsApi.rsvpEvent(eventId, "going").catch((err) => {
      console.error("[EventDetail] rsvpEvent error:", err);
    });

    // Invalidate event queries so lists refresh
    queryClient.invalidateQueries({ queryKey: eventKeys.all });

    // Issue a real ticket with crypto-random token via server RPC
    const tierLevel = selectedTier?.tier || "ga";
    const resolvedAuthId =
      (await getCurrentUserAuthId()) || user?.authId || user?.id || "";
    const rsvpTicket = await ticketsApi.issueRsvpTicket({
      eventId,
      userId: resolvedAuthId,
    });

    setTicket(eventId, {
      id: rsvpTicket?.id ? String(rsvpTicket.id) : `tkt_${Date.now()}`,
      eventId,
      userId: user?.id || "",
      paid: false,
      status: "valid",
      qrToken:
        rsvpTicket?.qr_token ||
        btoa(JSON.stringify({ eid: eventId, uid: user?.id })),
      tier: tierLevel,
      tierName: selectedTier?.name || undefined,
      transferable: tierLevel === "vip" || tierLevel === "table",
      eventTitle: eventData.title,
      eventDate: eventData.fullDate || eventData.date,
      eventEndDate: eventData.endDate,
      eventLocation: eventData.location,
      eventImage: eventData.image,
      dressCode: eventData.dressCode,
      doorPolicy: eventData.doorPolicy,
      entryWindow: eventData.entryWindow,
      perks: selectedTier?.perks || eventData.perks,
    });
    queryClient.invalidateQueries({ queryKey: ticketKeys.myTickets() });

    showToast("success", "Confirmed", `You're going to ${eventData.title}!`);
  }, [
    eventId,
    eventData,
    selectedTier,
    user?.id,
    isCheckingOut,
    toggleRsvp,
    setTicket,
    showToast,
    queryClient,
  ]);

  const handleViewTicket = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey: ticketKeys.myTicketForEvent(eventId),
      queryFn: () => ticketsApi.getMyTicketForEvent(eventId),
    });
    router.push(`/ticket/${eventId}` as any);
  }, [eventId, queryClient, router]);

  const isHost = useMemo(() => {
    if (!user?.id || !eventData?.host?.id) return false;
    const hostId = String(eventData.host.id);
    // Compare against all possible user ID formats
    if (String(user.id) === hostId) return true;
    const intId = getCurrentUserIdSync();
    if (intId != null && String(intId) === hostId) return true;
    // Also check auth_id (host_id in DB is auth_id text)
    const authId = (user as any)?.authId || (user as any)?.auth_id;
    if (authId && String(authId) === hostId) return true;
    return false;
  }, [user?.id, eventData?.host?.id]);

  const handleDeleteEvent = useCallback(() => {
    // V2-EVT-01: route through cancel-event when tickets exist; the
    // server cascades Stripe refunds + notifies attendees + marks the
    // event status='cancelled' (preserves the row). delete-event is
    // only safe for never-sold events and the server enforces that
    // with a `tickets_exist` 409 guard.
    Alert.alert(
      "Cancel Event",
      "All ticket holders will be refunded and notified. The event will be marked Cancelled. This can't be undone.",
      [
        { text: "Keep Event", style: "cancel" },
        {
          text: "Cancel Event",
          style: "destructive",
          onPress: async () => {
            try {
              const result = await cancelEventPrivileged(parseInt(eventId));

              if (result.affectedTickets === 0) {
                // No buyers → safe to hard-delete the row + remove from
                // every list cache. Nothing to communicate to attendees
                // because there are none.
                queryClient.setQueriesData<any[]>(
                  { queryKey: eventKeys.all },
                  (old) => {
                    if (!old || !Array.isArray(old)) return old;
                    return old.filter(
                      (e: any) => String(e?.id) !== String(eventId),
                    );
                  },
                );
                try {
                  await deleteEventPrivileged(parseInt(eventId));
                } catch (delErr) {
                  console.warn(
                    "[EventDetail] follow-up delete refused (race):",
                    delErr,
                  );
                }
                queryClient.removeQueries({
                  queryKey: eventKeys.detail(eventId),
                });
              } else {
                // BUYERS EXIST — keep the row visible in every list with
                // a status='cancelled' label so ticket holders see the
                // cancellation in context (instead of the event quietly
                // disappearing from their feed). The cancel-event edge
                // function already issued refunds + push notifications
                // to attendees server-side.
                propagateEntity(queryClient, "event", eventId, {
                  status: "cancelled",
                  cancelled_at: new Date().toISOString(),
                });
              }

              // Background invalidate so next list focus refetches
              // authoritative server state (in case anything else changed
              // server-side as part of the cancel cascade).
              queryClient.invalidateQueries({ queryKey: eventKeys.all });

              const refundLine =
                result.refundsIssued > 0
                  ? `${result.refundsIssued} refund${result.refundsIssued === 1 ? "" : "s"} issued.`
                  : "";
              const failedLine =
                result.refundsFailed > 0
                  ? ` ${result.refundsFailed} refund${result.refundsFailed === 1 ? "" : "s"} still processing — check host dashboard.`
                  : "";
              showToast(
                result.refundsFailed > 0 ? "warning" : "success",
                "Event cancelled",
                `${refundLine}${failedLine}`.trim() || "Done.",
              );
              router.back();
            } catch (err: any) {
              console.error("[EventDetail] Cancel error:", err);
              showToast(
                "error",
                "Couldn't cancel",
                err?.message || "Try again in a moment.",
              );
            }
          },
        },
      ],
    );
  }, [eventId, queryClient, showToast, router]);

  const handleShare = useCallback(async () => {
    try {
      await shareEvent(eventId, eventData?.title || "Event");
      showToast("success", "Link Shared", "Event link has been shared!");
    } catch (error) {
      console.error("[EventDetail] Share error:", error);
      showToast("error", "Share Failed", "Unable to share event link.");
    }
  }, [eventId, eventData?.title, showToast]);

  const handleAddToCalendar = useCallback(async () => {
    if (!eventData) return;
    if (
      !Calendar?.requestCalendarPermissionsAsync ||
      !Calendar?.getCalendarsAsync ||
      !Calendar?.createEventAsync
    ) {
      showToast(
        "error",
        "Calendar Unavailable",
        "Calendar support is not available in this build",
      );
      return;
    }

    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        showToast(
          "error",
          "Permission Denied",
          "Calendar access is required to add events",
        );
        return;
      }

      // Get default calendar
      const calendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes?.EVENT,
      );
      const defaultCal =
        calendars.find(
          (c: CalendarRecord) =>
            c.allowsModifications && c.source?.name === "iCloud",
        ) ||
        calendars.find((c: CalendarRecord) => c.allowsModifications) ||
        calendars[0];

      if (!defaultCal) {
        showToast(
          "error",
          "No Calendar",
          "No writable calendar found on this device",
        );
        return;
      }

      const { startDate, endDate } = buildCalendarWindow(
        eventData.fullDate || eventData.date,
        eventData.endDate,
      );

      await Calendar.createEventAsync(defaultCal.id, {
        title: eventData.title || "Event",
        startDate,
        endDate,
        location: eventData.location || eventData.locationName || "",
        notes: eventData.description || "",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      showToast(
        "success",
        "Added to Calendar",
        `${eventData.title} has been added to your calendar`,
      );
    } catch (err) {
      console.error("[EventDetail] Calendar error:", err);
      showToast("error", "Error", "Failed to add event to calendar");
    }
  }, [eventData, showToast]);

  // Toggle sale-open notification subscription. Flip local store first
  // for snappy UX, then sync to the backend so the cron dispatcher
  // (notify-sale-open) can deliver an Expo push at sale_start. Rolls
  // back local state if the backend call fails so the on-device truth
  // never disagrees with what the server will actually deliver on.
  const handleToggleSaleNotify = useCallback(async () => {
    if (!eventData) return;
    const nowSubscribed = toggleSaleSubscription(eventId);
    if (nowSubscribed) {
      showToast(
        "success",
        "Reminder set",
        "We'll notify you the moment tickets go on sale.",
      );
    } else {
      showToast(
        "info",
        "Reminder removed",
        "You won't be notified when sales open.",
      );
    }
    try {
      const { supabase: sb } = await import("@dvnt/app/lib/supabase/client");
      const { getAuthToken } = await import("@dvnt/app/lib/auth-client");
      const token = await getAuthToken();
      if (!token) return; // local-only is fine if signed out
      const { error } = await sb.functions.invoke("toggle-sale-notify", {
        body: { event_id: Number(eventId), enabled: nowSubscribed },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) {
        console.error("[EventDetail] sale-notify sync error:", error);
        toggleSaleSubscription(eventId); // roll back
        showToast(
          "error",
          "Reminder failed",
          "Couldn't save your reminder. Try again.",
        );
      }
    } catch (e) {
      console.error("[EventDetail] sale-notify sync exception:", e);
      toggleSaleSubscription(eventId); // roll back
      showToast(
        "error",
        "Reminder failed",
        "Couldn't save your reminder. Try again.",
      );
    }
  }, [eventData, eventId, toggleSaleSubscription, showToast]);

  // Add the sale-open moment to the user's calendar (a 5-min event so it
  // shows up as a glanceable reminder, not an all-day block).
  const handleAddSaleToCalendar = useCallback(async () => {
    const saleStart = (eventData as any)?.ticketSaleStart;
    if (!saleStart || !eventData) return;
    if (
      !Calendar?.requestCalendarPermissionsAsync ||
      !Calendar?.getCalendarsAsync ||
      !Calendar?.createEventAsync
    ) {
      showToast(
        "error",
        "Calendar Unavailable",
        "Calendar support is not available in this build",
      );
      return;
    }
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        showToast(
          "error",
          "Permission Denied",
          "Calendar access is required to add reminders",
        );
        return;
      }
      const calendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes?.EVENT,
      );
      const cal =
        calendars.find(
          (c: CalendarRecord) =>
            c.allowsModifications && c.source?.name === "iCloud",
        ) ||
        calendars.find((c: CalendarRecord) => c.allowsModifications) ||
        calendars[0];
      if (!cal) {
        showToast("error", "No Calendar", "No writable calendar found");
        return;
      }
      const start = new Date(saleStart);
      const end = new Date(start.getTime() + 5 * 60 * 1000);
      await Calendar.createEventAsync(cal.id, {
        title: `🎟️ Sales open: ${eventData.title || "Event"}`,
        startDate: start,
        endDate: end,
        location: eventData.location || eventData.locationName || "",
        notes: `Ticket sales open for ${eventData.title}.`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      showToast(
        "success",
        "Saved to Calendar",
        "We'll remind you when sales open.",
      );
    } catch (err) {
      console.error("[EventDetail] Sale-calendar error:", err);
      showToast("error", "Error", "Failed to add sale reminder");
    }
  }, [eventData, showToast]);

  // CRITICAL: ALL hooks must be called before any early returns (React hooks rules)
  // Translation hooks here — cannot be after early returns
  const { i18n } = useTranslation();
  const _targetLang = i18n.language;

  // Title translation
  const {
    displayText: translatedTitle,
    isTranslated: isTitleTranslated,
    translate: translateTitleFn,
    showOriginal: showOriginalTitle,
    isCapable: isTranslationCapable,
  } = useContentTranslation(
    `event-${eventId}-title`,
    safeEvent?.title || "",
    _targetLang,
  );

  // Description translation
  const {
    displayText: translatedDescription,
    isTranslated: isDescriptionTranslated,
    translate: translateDescriptionFn,
    showOriginal: showOriginalDescription,
  } = useContentTranslation(
    `event-${eventId}-description`,
    safeEvent?.description || "",
    _targetLang,
  );

  // Lineup translation — normalize array or string to plain text
  const lineupText = Array.isArray(safeEvent?.lineup)
    ? (safeEvent!.lineup as string[]).join("\n")
    : typeof safeEvent?.lineup === "string"
      ? safeEvent.lineup
      : "";
  const {
    displayText: translatedLineup,
    isTranslated: isLineupTranslated,
    translate: translateLineupFn,
    showOriginal: showOriginalLineup,
  } = useContentTranslation(`event-${eventId}-lineup`, lineupText, _targetLang);

  // Dress code translation
  const {
    displayText: translatedDressCode,
    isTranslated: isDressCodeTranslated,
    translate: translateDressCodeFn,
    showOriginal: showOriginalDressCode,
  } = useContentTranslation(
    `event-${eventId}-dressCode`,
    safeEvent?.dressCode || "",
    _targetLang,
  );

  // Door policy translation
  const {
    displayText: translatedDoorPolicy,
    isTranslated: isDoorPolicyTranslated,
    translate: translateDoorPolicyFn,
    showOriginal: showOriginalDoorPolicy,
  } = useContentTranslation(
    `event-${eventId}-doorPolicy`,
    safeEvent?.doorPolicy || "",
    _targetLang,
  );

  // Combined: translate all authored text fields together
  const isEventTranslated =
    isDescriptionTranslated ||
    isTitleTranslated ||
    isLineupTranslated ||
    isDressCodeTranslated ||
    isDoorPolicyTranslated;

  const handleTranslateEvent = useCallback(async () => {
    // Use void-casting to satisfy Promise<void>[] typing
    const jobs: Promise<unknown>[] = [
      translateDescriptionFn().catch(() => {}),
      translateTitleFn().catch(() => {}),
    ];
    if (lineupText) jobs.push(translateLineupFn().catch(() => {}));
    if (safeEvent?.dressCode) jobs.push(translateDressCodeFn().catch(() => {}));
    if (safeEvent?.doorPolicy)
      jobs.push(translateDoorPolicyFn().catch(() => {}));
    await Promise.all(jobs);
  }, [
    translateDescriptionFn,
    translateTitleFn,
    translateLineupFn,
    translateDressCodeFn,
    translateDoorPolicyFn,
    lineupText,
    safeEvent?.dressCode,
    safeEvent?.doorPolicy,
  ]);

  const showOriginalEvent = useCallback(() => {
    showOriginalDescription();
    showOriginalTitle();
    showOriginalLineup();
    showOriginalDressCode();
    showOriginalDoorPolicy();
  }, [
    showOriginalDescription,
    showOriginalTitle,
    showOriginalLineup,
    showOriginalDressCode,
    showOriginalDoorPolicy,
  ]);

  // Show translate button when native capability confirmed AND any authored field is foreign
  const showTranslateButton =
    shouldShowTranslateButton(safeEvent?.description || "", _targetLang) ||
    shouldShowTranslateButton(safeEvent?.title || "", _targetLang) ||
    shouldShowTranslateButton(lineupText, _targetLang) ||
    shouldShowTranslateButton(safeEvent?.dressCode || "", _targetLang) ||
    shouldShowTranslateButton(safeEvent?.doorPolicy || "", _targetLang);

  const isPast = useMemo(() => {
    if (!eventData) return false;
    try {
      const now = new Date();
      if (eventData.endDate) return new Date(eventData.endDate) < now;
      if (eventData.fullDate) {
        const start = new Date(eventData.fullDate);
        start.setHours(23, 59, 59, 999);
        return start < now;
      }
      return false;
    } catch {
      return false;
    }
  }, [eventData]);

  // Server flips events.status to "cancelled" via the cancel-event edge
  // function (refunds + push notifications already handled there). All
  // ticket-purchase paths must be suppressed when the event is cancelled.
  const isCancelled = useMemo(
    () => (eventData as any)?.status === "cancelled",
    [eventData],
  );

  // Rating eligibility: event ended + user has ticket/RSVP + not the host
  const isHostUser = isHost;

  const canRate = useMemo(() => {
    if (!isPast) return false;
    if (!hasTicket) return false;
    if (isHostUser) return false;
    return true;
  }, [isPast, hasTicket, isHostUser]);

  const ratingIneligibleReason = useMemo(() => {
    if (isHostUser) return "Hosts cannot rate their own event";
    if (!isPast) return "Ratings unlock after the event ends";
    if (!hasTicket) return "Only verified attendees can rate";
    return "";
  }, [isPast, hasTicket, isHostUser]);

  // ── Loading state ───────────────────────────────────────────────────
  // Show skeleton while: params not ready, query disabled/pending, or actively fetching
  if (!eventId || isPending || isLoading) {
    return <EventDetailSkeleton />;
  }

  // ── Error state ─────────────────────────────────────────────────────
  if (hasError || !eventData) {
    return (
      <View style={s.errorContainer}>
        <StatusBar barStyle="light-content" />
        <Text style={s.errorEmoji}>🔒</Text>
        <Text style={s.errorTitle}>Event Unavailable</Text>
        <Text style={s.errorSubtitle}>
          This event may be private, require an invite, or no longer exist.
        </Text>
        <Pressable onPress={() => fetchEvent()} style={s.retryButton}>
          <Text style={s.retryText}>Try Again</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} style={s.backLink}>
          <Text style={s.backLinkText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const event = safeEvent;
  const host = event.host;
  // CRITICAL: event.date is the day number ("22"), event.fullDate is the ISO string
  const isoDate = event.fullDate || event.date;
  const dateStr = formatEventDate(isoDate);
  const timeStr = formatEventTime(isoDate);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />

      <Animated.ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* ── 1. HERO SECTION ──────────────────────────────────── */}
        <View style={s.heroWrapper}>
          {/* Parallax hero image — branded gradient fallback when the
              event hasn't been given a cover image yet. Without this
              the hero is just black behind the existing overlay
              gradient, which makes the screen look unfinished. */}
          <View style={s.heroImageContainer}>
            <Animated.View style={[s.heroImageContainer, heroParallaxStyle]}>
              {/* Video flyer is the preferred hero medium when the organizer
                  uploaded one — it's the headline asset they crafted for the
                  event. Falls back to the static cover image, then to a brand
                  gradient placeholder. */}
              {eventData.flyerVideoUrl ? (
                <DVNTAnimatedVideoView
                  uri={eventData.flyerVideoUrl}
                  width="100%"
                  height="120%"
                  style={s.heroImage}
                  contentFit="cover"
                  muted
                />
              ) : event.image ? (
                <Image
                  source={{ uri: event.image }}
                  style={s.heroImage}
                  contentFit="cover"
                  transition={200}
                  cachePolicy="memory-disk"
                />
              ) : (
                <LinearGradient
                  colors={[
                    "rgba(138,64,207,0.6)",
                    "rgba(255,91,252,0.25)",
                    "rgba(63,220,255,0.15)",
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.heroImage}
                />
              )}
            </Animated.View>
          </View>

          {/* Dark gradient overlay */}
          <LinearGradient
            colors={[
              "rgba(52,162,223,0.25)",
              "transparent",
              "rgba(138,64,207,0.35)",
              "#000",
            ]}
            locations={[0, 0.25, 0.7, 1]}
            style={s.heroGradient}
          />

          {/* Floating chips */}
          <View style={s.heroChips}>
            {(
              liveTicketTypes.length > 0
                ? liveTicketTypes.every((t) => (t.price_cents || 0) === 0)
                : ticketTiers.length > 0
                  ? ticketTiers.every((t) => t.price === 0)
                  : !isLoading && event.price === 0
            ) ? (
              <View style={[s.chip, s.chipFree]}>
                <Text style={s.chipFreeText}>FREE</Text>
              </View>
            ) : (
              <View style={[s.chip, s.chipVip]}>
                <Text style={s.chipVipText}>VIP</Text>
              </View>
            )}
            <View style={s.chip}>
              <Text style={s.chipText}>{dateStr}</Text>
            </View>
            {timeStr ? (
              <View style={s.chip}>
                <Text style={s.chipText}>{timeStr}</Text>
              </View>
            ) : null}
          </View>

          {/* Countdown */}
          <View style={s.heroCountdown}>
            <CountdownTimer
              targetDate={event.fullDate || event.date}
              endDate={event.endDate}
            />
          </View>
        </View>

        {/* ── 2. CORE INFO BLOCK ───────────────────────────────── */}
        <View style={s.content}>
          {/* ── CANCELLED — premium full-bleed banner that replaces
                 the entire ticketing surface. The cancel-event edge
                 function already refunded buyers + sent push notifs;
                 this is the visible takeover for the detail screen. */}
          {isCancelled && (
            <View style={s.section}>
              <LinearGradient
                colors={["rgba(239,68,68,0.18)", "rgba(239,68,68,0.06)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  borderRadius: 20,
                  padding: 20,
                  borderWidth: 1,
                  borderColor: "rgba(239,68,68,0.45)",
                  gap: 10,
                }}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: "rgba(239,68,68,0.25)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Trash2 size={18} color="#ef4444" />
                  </View>
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 20,
                      fontFamily: "InterBold",
                      letterSpacing: 0.2,
                    }}
                  >
                    Event Cancelled
                  </Text>
                </View>
                <Text
                  style={{
                    color: "rgba(255,255,255,0.78)",
                    fontSize: 14,
                    lineHeight: 20,
                  }}
                >
                  {hasTicket
                    ? "The organizer cancelled this event. A refund has been issued to your original payment method — it can take up to 10 business days to appear."
                    : "The organizer cancelled this event. Tickets are no longer available."}
                </Text>
              </LinearGradient>
            </View>
          )}

          {/* ── TICKETS NOT YET ON SALE — premium "Sale Starts" card ──
              Shows only for PAID events without tier rows. FREE events
              (price=0) use the normal RSVP CTA instead — gating a free
              RSVP behind tier setup was the polish issue Micah hit on
              NYC "Euphoria". */}
          {!isCancelled &&
            ticketTiers.length === 0 &&
            (Number((eventData as any).price) || 0) > 0 && (
            <TicketsOpeningSoonCard
              saleStart={(eventData as any).ticketSaleStart || null}
              notifyEnabled={notifyOnSaleOpen}
              onToggleNotify={handleToggleSaleNotify}
              onAddToCalendar={
                (eventData as any).ticketSaleStart
                  ? handleAddSaleToCalendar
                  : undefined
              }
            />
          )}
          {/* ── TICKET TIERS — hidden once cancelled ───────────── */}
          {!isCancelled && ticketTiers.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Select Your Tier</Text>
              <LegendList
                data={ticketTiers}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(item) => item.id}
                contentContainerStyle={s.tierList}
                estimatedItemSize={200}
                renderItem={({ item }) => (
                  <TicketTierCard
                    tier={item}
                    isSelected={selectedTier?.id === item.id}
                    onSelect={handleSelectTier}
                  />
                )}
              />

              {/* Promo code input */}
              {selectedTier && selectedTier.price > 0 && !hasTicket && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginTop: 12,
                    gap: 8,
                  }}
                >
                  <TextInput
                    value={promoCode}
                    onChangeText={setPromoCode}
                    placeholder="Promo code"
                    placeholderTextColor="#71717a"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: "rgba(255,255,255,0.06)",
                      borderWidth: 1,
                      borderColor: promoCode.trim()
                        ? "#8A40CF60"
                        : "rgba(255,255,255,0.08)",
                      paddingHorizontal: 12,
                      color: "#fff",
                      fontSize: 14,
                      fontFamily: "InterSemiBold",
                      letterSpacing: 1,
                    }}
                  />
                  {promoCode.trim() ? (
                    <Pressable
                      onPress={() => setPromoCode("")}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 8,
                        backgroundColor: "rgba(255,255,255,0.06)",
                      }}
                    >
                      <Text
                        style={{
                          color: "#a1a1aa",
                          fontSize: 13,
                          fontFamily: "InterSemiBold",
                        }}
                      >
                        Clear
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              )}

              {/* Quantity selector — shown for all real DB tiers (free and paid).
                  Excluded for the synthetic "free" id which uses the legacy RSVP path. */}
              {selectedTier &&
                !hasTicket &&
                selectedTier.id !== "free" &&
                (selectedTier.maxPerOrder || 4) > 1 && (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 12,
                      paddingHorizontal: 4,
                    }}
                  >
                    <Text
                      style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}
                    >
                      Quantity
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 16,
                      }}
                    >
                      <Pressable
                        onPress={() => setTicketQty(ticketQty - 1)}
                        disabled={ticketQty <= 1}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor:
                            ticketQty <= 1
                              ? "rgba(255,255,255,0.06)"
                              : "rgba(255,255,255,0.12)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text
                          style={{
                            color: ticketQty <= 1 ? "#555" : "#fff",
                            fontSize: 20,
                            lineHeight: 22,
                          }}
                        >
                          −
                        </Text>
                      </Pressable>
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 18,
                          fontWeight: "700",
                          minWidth: 24,
                          textAlign: "center",
                        }}
                      >
                        {ticketQty}
                      </Text>
                      <Pressable
                        onPress={() => setTicketQty(ticketQty + 1)}
                        disabled={ticketQty >= (selectedTier.maxPerOrder || 4)}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor:
                            ticketQty >= (selectedTier.maxPerOrder || 4)
                              ? "rgba(255,255,255,0.06)"
                              : "rgba(255,255,255,0.12)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text
                          style={{
                            color:
                              ticketQty >= (selectedTier.maxPerOrder || 4)
                                ? "#555"
                                : "#fff",
                            fontSize: 20,
                            lineHeight: 22,
                          }}
                        >
                          +
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}
            </View>
          )}

          {/* ── Upgrade options ────────────────────────────────── */}
          {hasTicket &&
            myTicketData &&
            upgradeOptions.length > 0 &&
            !isPast && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Upgrade Your Ticket</Text>
                <Text
                  style={[
                    s.sectionSubtitle,
                    { color: "#71717a", marginBottom: 12 },
                  ]}
                >
                  You have:{" "}
                  {myTicketData.ticket_type_name || "General Admission"}
                </Text>
                {upgradeOptions.map((option) => (
                  <View key={option.tier.id} style={{ marginBottom: 10 }}>
                    <UpgradeTierCard
                      option={option}
                      onPress={handleUpgradePress}
                    />
                  </View>
                ))}
              </View>
            )}

          <View>
            <Text style={s.eventTitle}>{translatedTitle || event.title}</Text>

            {/* Translate button — adjacent to title, only when foreign text detected */}
            {showTranslateButton && (
              <View style={{ marginTop: 8, marginBottom: 4 }}>
                <TranslateButton
                  onTranslate={handleTranslateEvent}
                  isTranslated={isEventTranslated}
                  onToggleOriginal={showOriginalEvent}
                  size="md"
                  showLabel
                />
              </View>
            )}

            {/* Host */}
            <Pressable style={s.hostRow}>
              <Image
                source={{
                  uri: host?.avatar || "",
                }}
                style={s.hostAvatar}
              />
              <Text style={s.hostName}>
                {host?.name || host?.username || "Organizer"}
              </Text>
              {host?.verified && <BadgeCheck size={16} color="#34A2DF" />}
            </Pressable>
          </View>

          {/* ── 3. GOING — expandable attendees grid ─────────────── */}
          <View style={s.section}>
            <GoingAccordion
              attendees={realAttendees}
              totalCount={
                typeof event.attendees === "number"
                  ? event.attendees
                  : realAttendees.length || 0
              }
              isLoggedIn={true}
              onAttendeePress={handleAttendeePress}
            />
          </View>

          {/* ── Hosted by — organizer card (posh-style) ──────────── */}
          <OrganizerCard eventId={eventId} />

          {/* ── 3.25 HOST ORGANIZER TOOLS ──────────────────────────── */}
          {isHost ? (
            <View style={s.section}>
              <Pressable
                onPress={() =>
                  router.push(`/(protected)/events/${eventId}/edit` as any)
                }
                style={[
                  s.organizerButton,
                  { marginBottom: 10, flexDirection: "row", gap: 6 },
                ]}
              >
                <Pencil size={16} color="#3FDCFF" />
                <Text style={s.organizerButtonText}>Edit Event</Text>
              </Pressable>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() =>
                    router.push(
                      `/(protected)/events/${eventId}/organizer` as any,
                    )
                  }
                  style={[s.organizerButton, { flex: 1 }]}
                >
                  <LayoutDashboard size={16} color="#8A40CF" />
                  <Text style={s.organizerButtonText}>Dashboard</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    router.push(`/(protected)/events/${eventId}/scanner` as any)
                  }
                  style={[s.organizerButton, { flex: 1 }]}
                >
                  <ScanLine size={16} color="#22C55E" />
                  <Text style={s.organizerButtonText}>Scanner</Text>
                </Pressable>
              </View>
              <Pressable
                onPress={() =>
                  usePromotionStore
                    .getState()
                    .openSheet(
                      eventId,
                      eventData?.title || "Event",
                      eventData?.image,
                      eventData?.flyerVideoUrl,
                    )
                }
                style={[
                  s.organizerButton,
                  { marginTop: 8, flexDirection: "row", gap: 6 },
                ]}
              >
                <Zap size={16} color="#f59e0b" />
                <Text style={s.organizerButtonText}>Promote to Spotlight</Text>
              </Pressable>
              <Pressable
                onPress={handleDownloadOffline}
                style={[s.organizerButton, { marginTop: 8 }]}
              >
                <Text style={s.organizerButtonText}>
                  {offlineTokenCount > 0
                    ? `✅ ${offlineTokenCount} tickets cached for offline`
                    : "📲 Download for Offline Check-in"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── 3.5 WEATHER FORECAST ─────────────────────────────── */}
          {(event.locationLat && event.locationLng) ||
          (event.location && deviceLat && deviceLng) ? (
            <View style={s.section}>
              <WeatherModule
                lat={event.locationLat ?? deviceLat ?? 0}
                lng={event.locationLng ?? deviceLng ?? 0}
                locationName={event.locationName || event.location}
                eventDate={event.fullDate || undefined}
              />
            </View>
          ) : null}

          {/* ── 3.6 EVENT MAP & DIRECTIONS ───────────────────────── */}
          {event.locationLat && event.locationLng && (
            <View style={s.section}>
              <EventMapSection
                location={{
                  placeId: `event_${eventId}`,
                  provider: "google",
                  name:
                    event.locationName || event.location || "Event Location",
                  formattedAddress: event.location || "",
                  latitude: event.locationLat,
                  longitude: event.locationLng,
                }}
                eventTitle={event.title}
                fallbackAddress={event.location}
              />
            </View>
          )}

          {/* ── 4. COLLAPSIBLE EVENT DETAILS ─────────────────────── */}
          <View style={s.collapsibleSection}>
            {event.description ? (
              <CollapsibleRow
                icon="📝"
                title="About"
                content={translatedDescription}
              />
            ) : null}
            {event.lineup && event.lineup.length > 0 ? (
              <CollapsibleRow
                icon="🎧"
                title="Lineup"
                content={isLineupTranslated ? translatedLineup : event.lineup}
              />
            ) : null}
            {event.dressCode ? (
              <CollapsibleRow
                icon="👔"
                title="Dress Code"
                content={
                  isLineupTranslated ? translatedDressCode : event.dressCode
                }
              />
            ) : null}
            {event.doorPolicy ? (
              <CollapsibleRow
                icon="🚪"
                title="Door Policy"
                content={
                  isDoorPolicyTranslated
                    ? translatedDoorPolicy
                    : event.doorPolicy
                }
              />
            ) : null}
            {event.entryWindow ? (
              <CollapsibleRow
                icon="🕘"
                title="Entry Window"
                content={event.entryWindow}
              />
            ) : null}
            {event.perks && event.perks.length > 0 ? (
              <CollapsibleRow
                icon="🍾"
                title="What's Included"
                content={event.perks}
              />
            ) : null}
          </View>

          {/* ── 4b. YOUTUBE VIDEO ──────────────────────────────── */}
          {event.youtubeVideoUrl ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Video</Text>
              <YouTubeEmbed url={event.youtubeVideoUrl} height={220} />
            </View>
          ) : null}

          {/* ── 4c. EVENT IMAGES ───────────────────────────────── */}
          {event.images && event.images.length > 0 ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Photos</Text>
              <Galeria
                urls={event.images
                  .map((img: any) => (typeof img === "string" ? img : img?.url))
                  .filter(Boolean)}
                theme="dark"
              >
                <View style={s.imageGrid}>
                  {event.images.map((img: any, idx: number) => {
                    const imageUrl = typeof img === "string" ? img : img?.url;
                    if (!imageUrl) return null;
                    return (
                      <Galeria.Image index={idx} key={idx}>
                        <Image
                          source={{ uri: imageUrl }}
                          style={s.imageGridImage}
                        />
                      </Galeria.Image>
                    );
                  })}
                </View>
              </Galeria>
            </View>
          ) : null}

          {/* ── Who's Over Here (ephemeral event moments) ─────────── */}
          <View style={s.section}>
            <WhoAllOverThere
              eventId={eventId}
              canUpload={isHost || hasTicket}
            />
          </View>

          {/* ── Ratings & Reviews ─────────────────────────────────── */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={s.sectionHeaderLeft}>
                <Star size={18} color="#FFD700" />
                <Text style={[s.sectionTitle, { marginBottom: 0 }]}>
                  Ratings & Reviews
                </Text>
              </View>
              {eventData?.averageRating != null &&
                eventData.averageRating > 0 && (
                  <View style={s.ratingBadge}>
                    <StarRatingDisplay
                      rating={eventData.averageRating}
                      starSize={14}
                      color="#FFD700"
                      emptyColor="#333"
                    />
                    <Text style={s.ratingText}>
                      {eventData.averageRating.toFixed(1)}
                    </Text>
                  </View>
                )}
            </View>

            {canRate ? (
              <Pressable
                onPress={() => setShowRatingModal(true)}
                style={s.rateButton}
              >
                <Star size={16} color="#FF5BFC" />
                <Text style={s.rateButtonText}>Rate This Event</Text>
              </Pressable>
            ) : (
              <View
                style={[s.rateButton, { opacity: 0.4 }]}
                pointerEvents="none"
              >
                <Star size={16} color="#666" />
                <Text style={[s.rateButtonText, { color: "#666" }]}>
                  {ratingIneligibleReason}
                </Text>
              </View>
            )}

            {isLoadingReviews ? (
              <Text style={s.mutedText}>Loading reviews...</Text>
            ) : reviews.length > 0 ? (
              <View style={{ gap: 10 }}>
                {reviews.length > 3 ? (
                  <Pressable
                    onPress={() =>
                      router.push(
                        `/(protected)/events/${eventId}/reviews` as any,
                      )
                    }
                    hitSlop={8}
                    style={{ alignSelf: "flex-end", paddingVertical: 4 }}
                  >
                    <Text
                      style={{
                        color: "#FF5BFC",
                        fontSize: 13,
                        fontWeight: "700",
                      }}
                    >
                      See all {reviews.length} reviews →
                    </Text>
                  </Pressable>
                ) : null}
                {reviews.slice(0, 3).map((review: any) => (
                  <View key={review.id} style={s.reviewCard}>
                    <View style={s.reviewHeader}>
                      <Text style={s.reviewAuthor}>
                        {review.username ||
                          review.user?.username ||
                          review.user?.name ||
                          "Anonymous"}
                      </Text>
                      <StarRatingDisplay
                        rating={review.rating || 0}
                        starSize={12}
                        color="#FFD700"
                        emptyColor="#333"
                      />
                    </View>
                    {review.comment && (
                      <Text style={s.reviewComment}>{review.comment}</Text>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <View
                style={{ alignItems: "center", paddingVertical: 20, gap: 6 }}
              >
                <Star size={28} color="#333" strokeWidth={1.5} />
                <Text style={[s.mutedText, { marginTop: 4 }]}>
                  No ratings yet
                </Text>
                {canRate && (
                  <Text
                    style={{
                      color: "#FF5BFC",
                      fontSize: 13,
                      fontWeight: "600",
                    }}
                  >
                    Be the first to rate this event
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* ── Comments ──────────────────────────────────────────── */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={s.sectionHeaderLeft}>
                <MessageCircle size={18} color="#34A2DF" />
                <Text style={[s.sectionTitle, { marginBottom: 0 }]}>
                  Comments
                </Text>
                {comments.length > 0 && (
                  <Text style={s.commentCount}>({comments.length})</Text>
                )}
              </View>
              {comments.length > 5 && (
                <Pressable
                  onPress={() =>
                    router.push(
                      `/(protected)/events/${eventId}/comments` as any,
                    )
                  }
                  style={s.viewAllButton}
                >
                  <Text style={s.viewAllText}>View All</Text>
                  <ChevronRight size={14} color="#34A2DF" />
                </Pressable>
              )}
            </View>

            {isLoadingComments ? (
              <Text style={s.mutedText}>Loading comments...</Text>
            ) : comments.length > 0 ? (
              <View style={{ gap: 14 }}>
                {comments.slice(0, 5).map((comment: any) => (
                  <View key={comment.id} style={s.commentRow}>
                    <Image
                      source={{
                        uri:
                          comment.user?.avatar ||
                          comment.avatar ||
                          comment.author?.avatar ||
                          "",
                      }}
                      style={s.commentAvatar}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.commentAuthor}>
                        {comment.user?.username ||
                          comment.username ||
                          comment.author?.username ||
                          "User"}
                      </Text>
                      <Text style={s.commentContent}>
                        {(comment.content || "")
                          .split(/(@\w+)/g)
                          .map((part: string, i: number) =>
                            part.startsWith("@") ? (
                              <Text
                                key={i}
                                onPress={() =>
                                  router.push(
                                    `/(protected)/profile/${part.slice(1)}` as any,
                                  )
                                }
                                style={{
                                  color: MENTION_COLOR,
                                  fontWeight: "600",
                                }}
                              >
                                {part}
                              </Text>
                            ) : (
                              <Text key={i}>{part}</Text>
                            ),
                          )}
                      </Text>
                      {(comment.created_at || comment.createdAt) && (
                        <Text style={s.commentDate}>
                          {new Date(
                            comment.created_at || comment.createdAt,
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View
                style={{ alignItems: "center", paddingVertical: 20, gap: 6 }}
              >
                <MessageCircle size={28} color="#333" strokeWidth={1.5} />
                <Text style={[s.mutedText, { marginTop: 4 }]}>
                  No comments yet
                </Text>
                <Text
                  style={{ color: "#34A2DF", fontSize: 13, fontWeight: "600" }}
                >
                  Start the conversation
                </Text>
              </View>
            )}

            <Pressable
              onPress={() => {
                screenPrefetch.eventComments(queryClient, eventId);
                router.push(`/(protected)/events/${eventId}/comments` as any);
              }}
              style={s.addCommentButton}
            >
              <MessageCircle size={16} color="#34A2DF" />
              <Text style={s.addCommentText}>Add a Comment</Text>
            </Pressable>
          </View>
        </View>
      </Animated.ScrollView>

      {/* ── Floating Header (rendered AFTER scroll so it's on top for touches) */}
      <View
        style={[s.headerContainer, { paddingTop: insets.top }]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[s.headerBg, headerBgStyle]}
          pointerEvents="none"
        />
        <View style={s.headerInner} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <DVNTLiquidGlassIconButton size={40}>
              <ArrowLeft size={20} color="#fff" />
            </DVNTLiquidGlassIconButton>
          </Pressable>
          <Animated.Text
            style={[s.headerTitle, headerTitleStyle]}
            numberOfLines={1}
          >
            {event.title}
          </Animated.Text>
          <View style={s.headerActions}>
            {/*
              Header buttons collapsed into a single overflow menu. Heart
              stays inline for one-tap like/unlike since it's the highest-
              frequency action. Everything else (edit/delete/calendar/
              share/send) lives in the EventActionSheet to keep the chrome
              uncluttered.
            */}
            <Pressable onPress={handleToggleLike} hitSlop={12}>
              <DVNTLiquidGlassIconButton size={40}>
                <Heart
                  size={18}
                  color={isLiked ? "#FF5BFC" : "#fff"}
                  fill={isLiked ? "#FF5BFC" : "transparent"}
                />
              </DVNTLiquidGlassIconButton>
            </Pressable>
            <Pressable
              onPress={() => setShowActionSheet(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <DVNTLiquidGlassIconButton size={40}>
                <MoreHorizontal size={20} color="#fff" />
              </DVNTLiquidGlassIconButton>
            </Pressable>
          </View>
        </View>
      </View>

      {/* ── Sticky CTA ─────────────────────────────────────────── */}
      <StickyCTA
        selectedTier={selectedTier}
        hasTicket={hasTicket}
        isPast={isPast}
        ticketQty={ticketQty}
        onGetTickets={handleGetTickets}
        onViewTicket={handleViewTicket}
        onBuyMore={
          selectedTier && selectedTier.price > 0 ? handleGetTickets : undefined
        }
        waitlistJoined={waitlistJoined}
        onJoinWaitlist={handleJoinWaitlist}
        onLeaveWaitlist={handleLeaveWaitlist}
        isWaitlistBusy={isWaitlistBusy}
        tiersUnavailable={
          // Show "Sale Starts ..." CTA only for PAID events with no
          // tier rows. FREE events (price=0) always show the RSVP CTA
          // even when ticketing_enabled=true with no tier rows —
          // gating a free RSVP behind tier setup was the polish issue
          // Micah hit on NYC "Euphoria".
          ticketTiers.length === 0 &&
          (Number((eventData as any).price) || 0) > 0
        }
        ticketSaleStart={(eventData as any).ticketSaleStart || null}
        notifyEnabled={notifyOnSaleOpen}
        onToggleNotify={handleToggleSaleNotify}
        isCancelled={isCancelled}
      />

      {/* Rating Modal */}
      <EventRatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        eventId={eventId}
        onSubmit={async (rating, comment) => {
          await createReview.mutateAsync({
            eventId,
            rating,
            comment,
            authorUsername: user?.username,
          });
        }}
      />

      {/* Promote Event Sheet (organizer) */}
      <PromoteEventSheet />

      {/* Ticket Upgrade Confirmation Sheet */}
      <UpgradeConfirmationSheet
        visible={!!upgradeSheetOption}
        option={upgradeSheetOption}
        onClose={() => setUpgradeSheetOption(null)}
        onConfirm={handleUpgradeConfirm}
        isPending={isUpgradePending}
      />

      {/* Share Event to DM Inbox */}
      <ShareEventSheet
        visible={showShareSheet}
        onClose={() => setShowShareSheet(false)}
        eventId={eventId}
        eventTitle={eventData?.title || ""}
        eventDate={eventData?.fullDate || eventData?.date || undefined}
        eventImage={eventData?.image || undefined}
        eventLocation={eventData?.location || undefined}
      />

      {/* Header overflow — calendar / share / edit / delete / promote */}
      <EventActionSheet
        visible={showActionSheet}
        onClose={() => setShowActionSheet(false)}
        isHost={isHost}
        isLiked={isLiked}
        onShare={handleShare}
        onToggleLike={handleToggleLike}
        onAddToCalendar={handleAddToCalendar}
        onEdit={() =>
          router.push(`/(protected)/events/${eventId}/edit` as any)
        }
        onDelete={handleDeleteEvent}
        onDashboard={
          isHost
            ? () =>
                router.push(
                  `/(protected)/events/${eventId}/organizer` as any,
                )
            : undefined
        }
        onScanner={
          isHost
            ? () =>
                router.push(
                  `/(protected)/events/${eventId}/scanner` as any,
                )
            : undefined
        }
        onStaff={
          isHost
            ? () =>
                router.push(
                  `/(protected)/events/${eventId}/staff` as any,
                )
            : undefined
        }
        onAttendees={
          isHost
            ? () =>
                router.push(
                  `/(protected)/events/${eventId}/attendees` as any,
                )
            : undefined
        }
        onLive={
          isHost
            ? () =>
                router.push(
                  `/(protected)/events/${eventId}/live` as any,
                )
            : undefined
        }
      />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    maxWidth: 768,
    width: "100%",
    alignSelf: "center",
  },

  // Header
  headerContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  headerBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.95)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  headerTitle: {
    flex: 1,
    marginHorizontal: 12,
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },

  // Scroll
  scroll: {
    flex: 1,
  },

  // Hero
  heroWrapper: {
    height: HERO_HEIGHT,
    overflow: "hidden",
  },
  heroImageContainer: {
    ...StyleSheet.absoluteFill,
  },
  heroImage: {
    width: "100%",
    height: "120%",
  },
  heroGradient: {
    ...StyleSheet.absoluteFill,
  },
  heroChips: {
    position: "absolute",
    bottom: 70,
    left: 20,
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  chipText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  chipVip: {
    backgroundColor: "rgba(138,64,207,0.2)",
    borderColor: "rgba(138,64,207,0.3)",
  },
  chipVipText: {
    color: "#8A40CF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  chipFree: {
    backgroundColor: "rgba(63,220,255,0.15)",
    borderColor: "rgba(63,220,255,0.3)",
  },
  chipFreeText: {
    color: "#3FDCFF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  heroCountdown: {
    position: "absolute",
    bottom: 24,
    left: 20,
  },

  // Content
  content: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  eventTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  venueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
  },
  venueText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  hostAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(52,162,223,0.3)",
  },
  hostName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },

  // Sections
  section: {
    marginTop: 24,
  },
  collapsibleSection: {
    marginTop: 24,
    gap: 8,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontSize: 13,
    marginTop: -8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  // Ticket tiers
  tierList: {
    paddingRight: 20,
  },

  // Ratings
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  rateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255, 91, 252, 0.1)",
    paddingVertical: 12,
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 91, 252, 0.15)",
  },
  rateButtonText: {
    color: "#FF5BFC",
    fontSize: 14,
    fontWeight: "600",
  },
  reviewCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  reviewAuthor: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  reviewComment: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 18,
  },

  // Comments
  commentCount: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
  },
  viewAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  viewAllText: {
    color: "#34A2DF",
    fontSize: 14,
    fontWeight: "500",
  },
  commentRow: {
    flexDirection: "row",
    gap: 10,
  },
  commentAvatar: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
  commentAuthor: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 2,
  },
  commentContent: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    lineHeight: 18,
  },
  commentDate: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 11,
    marginTop: 3,
  },
  addCommentButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(52,162,223,0.15)",
    backgroundColor: "rgba(52,162,223,0.06)",
  },
  addCommentText: {
    color: "#34A2DF",
    fontSize: 14,
    fontWeight: "500",
  },

  // Image grid
  imageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  imageGridItem: {
    width: (SCREEN_WIDTH - 40 - 8) / 2,
    height: (SCREEN_WIDTH - 40 - 8) / 2,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  imageGridImage: {
    width: (SCREEN_WIDTH - 40 - 8) / 2,
    height: (SCREEN_WIDTH - 40 - 8) / 2,
    borderRadius: 14,
  },

  // Shared
  mutedText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
  },

  // Error state
  errorContainer: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  errorSubtitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  retryButton: {
    backgroundColor: "#34A2DF",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  retryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  backLink: {
    paddingVertical: 8,
  },
  backLinkText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
  },
  organizerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  organizerButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});

// Wrap with ErrorBoundary for crash protection
export default function EventDetailScreen() {
  const router = useRouter();

  return (
    <ErrorBoundary
      screenName="EventDetail"
      onGoHome={() => router.replace("/(protected)/(tabs)/feed" as any)}
    >
      <EventDetailScreenContent />
    </ErrorBoundary>
  );
}
