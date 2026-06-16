/**
 * Edit Event Screen
 *
 * Allows organizers to edit event details including:
 * - Title, description, date/time, location
 * - Cover image and gallery images
 *
 * Route: /(protected)/events/[id]/edit
 */

import { useState, useEffect, useCallback } from "react";
import { DVNTAnimatedVideoView } from "@dvnt/app/components/media/DVNTAnimatedVideoView";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  Switch,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Check,
  Calendar,
  Clock,
  Image as ImageIcon,
  MapPin,
  X,
  Plus,
  DollarSign,
  Users,
  Tag,
  Eye,
  Video,
  Shirt,
  DoorOpen,
  Music,
  Gift,
  ChevronDown,
} from "lucide-react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColorScheme, useMediaPicker } from "@dvnt/app/lib/hooks";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { eventsApi, formatEventDate } from "@dvnt/app/lib/api/events";
import { organizerApi } from "@dvnt/app/lib/api/organizer";
import { getCurrentUserAuthId } from "@dvnt/app/lib/api/auth-helper";
import { useQueryClient } from "@tanstack/react-query";
import { eventKeys, useUpdateEvent } from "@dvnt/app/lib/hooks/use-events";
import {
  LocationAutocompleteInstagram,
  type LocationData,
} from "@dvnt/app/components/ui/location-autocomplete-instagram";
import {
  isRemoteMediaUri,
  persistLocalMediaSelection,
} from "@dvnt/app/lib/media/persist-local-selection";
import {
  ticketTypesApi,
  TICKET_TYPE_CATEGORIES,
  type TicketTypeCategory,
} from "@dvnt/app/lib/api/ticket-types";

const TIER_LEVELS = ["free", "ga", "vip", "table"] as const;
type TierLevel = (typeof TIER_LEVELS)[number];

interface LocalTicketTier {
  id?: string; // undefined = new (not yet saved)
  name: string;
  category: TicketTypeCategory;
  priceDollars: string; // user types dollars, we convert to cents
  quantity: string;
  maxPerOrder: string;
  tier: TierLevel;
  description: string;
  isActive: boolean;
  // ISO string. Empty means sales open immediately on publish.
  saleStart: string;
}

function EditEventScreenContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useColorScheme();
  const queryClient = useQueryClient();
  const updateEventMutation = useUpdateEvent();
  const showToast = useUIStore((s) => s.showToast);
  const currentUser = useAuthStore((state) => state.user);
  const { pickFromLibrary, requestPermissions } = useMediaPicker();
  const { uploadMultiple, isUploading } = useMediaUpload({ folder: "events" });

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [locationData, setLocationData] = useState<LocationData | null>(null);
  const [eventImages, setEventImages] = useState<string[]>([]);
  const [eventDate, setEventDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  // V2 fields
  const [price, setPrice] = useState("");
  const [maxAttendees, setMaxAttendees] = useState("");
  const [category, setCategory] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [dressCode, setDressCode] = useState("");
  const [doorPolicy, setDoorPolicy] = useState("");
  const [lineup, setLineup] = useState("");
  const [perks, setPerks] = useState("");
  const [youtubeVideoUrl, setYoutubeVideoUrl] = useState("");
  const [ticketingEnabled, setTicketingEnabled] = useState(false);
  const [ticketTiers, setTicketTiers] = useState<LocalTicketTier[]>([]);
  // Which tier currently has its "Sale starts" picker expanded. Indexed by
  // array position because tiers without a server id share `undefined` as
  // their identifier.
  const [openSalePickerIdx, setOpenSalePickerIdx] = useState<number | null>(
    null,
  );
  const [originalTierIds, setOriginalTierIds] = useState<Set<string>>(
    new Set(),
  );
  const [flyerImage, setFlyerImage] = useState<string | null>(null);
  const [flyerMediaType, setFlyerMediaType] = useState<"image" | "video">(
    "image",
  );

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [originalData, setOriginalData] = useState<any>(null);

  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);

  const persistEventDraftAssets = useCallback(
    async (
      assets: Array<{
        uri: string;
        fileName?: string;
        mimeType?: string;
      }>,
    ) =>
      Promise.all(
        assets.map((asset) =>
          persistLocalMediaSelection(asset.uri, {
            scope: "event-drafts/images",
            fileName: asset.fileName,
            mimeType: asset.mimeType,
          }),
        ),
      ),
    [],
  );

  // Fetch event data
  useEffect(() => {
    async function fetchEvent() {
      if (!id) return;

      try {
        const event = await eventsApi.getEventById(id);
        if (!event) {
          showToast("error", "Error", "Event not found");
          router.back();
          return;
        }

        // Check ownership via server-side auth (host_id === auth_id)
        const canEdit = await eventsApi.canEditEvent(
          id,
          (await getCurrentUserAuthId()) || "",
        );
        setIsOwner(canEdit);

        if (!canEdit) {
          showToast("error", "Error", "You can only edit your own events");
          router.back();
          return;
        }

        // Populate form
        const ev = event as any;
        setTitle(ev.title || "");
        setDescription(ev.description || "");
        setLocation(ev.location || "");

        if (ev.locationLat && ev.locationLng) {
          setLocationData({
            name: ev.locationName || ev.location || "",
            latitude: ev.locationLat,
            longitude: ev.locationLng,
            placeId: "",
          });
        }

        // Parse images
        const images: string[] = [];
        const coverUrl = ev.image || ev.coverImage;
        if (coverUrl) {
          const url = typeof coverUrl === "object" ? coverUrl.url : coverUrl;
          if (url) images.push(url);
        }
        if (Array.isArray(ev.images)) {
          ev.images.forEach((img: any) => {
            const url = typeof img === "object" ? img.url : img;
            if (url && !images.includes(url)) images.push(url);
          });
        }
        setEventImages(images);

        // Parse dates
        const isoDate = ev.fullDate || ev.startDate || ev.date;
        if (isoDate) setEventDate(new Date(isoDate));
        if (ev.endDate) setEndDate(new Date(ev.endDate));

        // V2 fields
        setPrice(ev.price != null ? String(ev.price) : "");
        setMaxAttendees(ev.maxAttendees != null ? String(ev.maxAttendees) : "");
        setCategory(ev.category || "");
        setVisibility(ev.visibility || "public");
        setDressCode(ev.dressCode || "");
        setDoorPolicy(ev.doorPolicy || "");
        setLineup(ev.lineup || "");
        setPerks(
          Array.isArray(ev.perks) ? ev.perks.join(", ") : ev.perks || "",
        );
        setYoutubeVideoUrl(ev.youtubeVideoUrl || "");
        setTicketingEnabled(!!ev.ticketingEnabled);

        setOriginalData(ev);

        // Load existing flyer
        const existingFlyerUrl = (ev as any).flyerImageUrl || null;
        if (existingFlyerUrl) {
          setFlyerImage(existingFlyerUrl);
          setFlyerMediaType(
            /\.(mp4|mov|webm|m4v)(\?|$)/i.test(existingFlyerUrl)
              ? "video"
              : "image",
          );
        }

        // Load ticket tiers
        const dbTiers = await ticketTypesApi.getByEvent(id);
        const activeTiers = dbTiers.filter(
          (t: any) => t.active !== false && t.is_active !== false,
        );
        setOriginalTierIds(new Set(activeTiers.map((t: any) => t.id)));
        setTicketTiers(
          activeTiers.map((t: any) => ({
            id: t.id,
            name: t.name || "",
            category: t.category || "admission",
            priceDollars:
              t.price_cents != null ? String(t.price_cents / 100) : "0",
            quantity:
              t.quantity_total != null ? String(t.quantity_total) : "100",
            maxPerOrder: t.max_per_user != null ? String(t.max_per_user) : "4",
            tier: (t.tier || "ga") as TierLevel,
            description: t.description || "",
            isActive: true,
            saleStart: t.sale_start || "",
          })),
        );

        setIsLoading(false);
      } catch (error: any) {
        console.error("[EditEvent] Fetch error:", error);
        showToast("error", "Error", error?.message || "Failed to load event");
        router.back();
      }
    }

    fetchEvent();
  }, [id, currentUser?.id, showToast, router]);

  // Track changes
  useEffect(() => {
    if (!originalData) return;
    const od = originalData;
    const isoDate = od.fullDate || od.startDate || od.date;

    const changed =
      title !== (od.title || "") ||
      description !== (od.description || "") ||
      location !== (od.location || "") ||
      eventDate.toISOString() !==
        new Date(isoDate || Date.now()).toISOString() ||
      price !== (od.price != null ? String(od.price) : "") ||
      maxAttendees !==
        (od.maxAttendees != null ? String(od.maxAttendees) : "") ||
      category !== (od.category || "") ||
      visibility !== (od.visibility || "public") ||
      dressCode !== (od.dressCode || "") ||
      doorPolicy !== (od.doorPolicy || "") ||
      lineup !== (od.lineup || "") ||
      youtubeVideoUrl !== (od.youtubeVideoUrl || "") ||
      ticketingEnabled !== !!od.ticketingEnabled ||
      flyerImage !== ((od as any).flyerImageUrl || null);

    setHasChanges(changed);
  }, [
    title,
    description,
    location,
    eventDate,
    endDate,
    price,
    maxAttendees,
    category,
    visibility,
    dressCode,
    doorPolicy,
    lineup,
    perks,
    youtubeVideoUrl,
    ticketingEnabled,
    flyerImage,
    originalData,
  ]);

  const handlePickImages = async () => {
    const remaining = 4 - eventImages.length;
    if (remaining <= 0) return;

    const result = await pickFromLibrary({
      maxSelection: remaining,
      allowsMultipleSelection: remaining > 1,
    });
    if (result && result.length > 0) {
      try {
        const persistedUris = await persistEventDraftAssets(result);
        setEventImages((prev) => [...prev, ...persistedUris].slice(0, 4));
        setHasChanges(true);
      } catch (error) {
        console.error("[EditEvent] Failed to persist selected images:", error);
        showToast(
          "error",
          "Media Error",
          "Failed to add the selected images. Please try again.",
        );
      }
    }
  };

  const removeImage = (index: number) => {
    setEventImages((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleDateChange = (_event: unknown, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const newDate = new Date(eventDate);
      newDate.setFullYear(selectedDate.getFullYear());
      newDate.setMonth(selectedDate.getMonth());
      newDate.setDate(selectedDate.getDate());
      setEventDate(newDate);
    }
  };

  const handleTimeChange = (_event: unknown, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (selectedTime) {
      const newDate = new Date(eventDate);
      newDate.setHours(selectedTime.getHours());
      newDate.setMinutes(selectedTime.getMinutes());
      setEventDate(newDate);
    }
  };

  const handleEndDateChange = (_event: unknown, selectedDate?: Date) => {
    setShowEndDatePicker(false);
    if (selectedDate) {
      const base =
        endDate || new Date(eventDate.getTime() + 3 * 60 * 60 * 1000);
      base.setFullYear(selectedDate.getFullYear());
      base.setMonth(selectedDate.getMonth());
      base.setDate(selectedDate.getDate());
      setEndDate(new Date(base));
    }
  };

  const handleEndTimeChange = (_event: unknown, selectedTime?: Date) => {
    setShowEndTimePicker(false);
    if (selectedTime) {
      const base =
        endDate || new Date(eventDate.getTime() + 3 * 60 * 60 * 1000);
      base.setHours(selectedTime.getHours());
      base.setMinutes(selectedTime.getMinutes());
      setEndDate(new Date(base));
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const handleSave = useCallback(async () => {
    if (!id || isSaving) return;

    if (!title.trim()) {
      showToast("error", "Error", "Title is required");
      return;
    }

    // MANDATORY STRIPE CONNECT CHECK — match the create flow. If the
    // organizer enabled paid ticketing here (or flipped tiers from
    // free → paid on an existing event), they must complete Stripe
    // onboarding before save, otherwise buyers hit "Organizer has
    // not completed payment setup" at checkout.
    const hasPaidTier =
      ticketingEnabled &&
      ticketTiers.some((t) => parseFloat(t.priceDollars || "0") > 0);

    if (hasPaidTier) {
      try {
        const status = await organizerApi.getStatus();
        const ready =
          status.connected &&
          status.charges_enabled === true &&
          status.payouts_enabled === true;
        if (!ready) {
          showToast(
            "error",
            "Connect your bank first",
            "Paid events need a Stripe payout account. Let's finish that now.",
          );
          router.push("/(protected)/events/organizer-setup" as any);
          return;
        }
      } catch (err) {
        console.error("[EditEvent] Stripe status check failed:", err);
        showToast(
          "error",
          "Couldn't verify payout setup",
          "We couldn't confirm your Stripe account status. Please try again.",
        );
        return;
      }
    }

    setIsSaving(true);
    try {
      // Upload new images if any are local URIs
      const uploadedImages: string[] = [];
      const normalizedImages = await Promise.all(
        eventImages.map((uri) =>
          isRemoteMediaUri(uri)
            ? Promise.resolve(uri)
            : persistLocalMediaSelection(uri, { scope: "event-drafts/images" }),
        ),
      );
      setEventImages(normalizedImages);

      const localImages = normalizedImages.filter(
        (uri) => !isRemoteMediaUri(uri),
      );
      const remoteImages = normalizedImages.filter((uri) =>
        isRemoteMediaUri(uri),
      );

      if (localImages.length > 0) {
        // Convert string URIs to MediaFile format
        const mediaFiles = localImages.map((uri) => ({
          uri,
          type: "image" as const,
        }));
        const uploadResults = await uploadMultiple(mediaFiles);
        const successfulUploads = uploadResults
          .filter((r) => r.success && r.url)
          .map((r) => r.url!);

        if (successfulUploads.length !== localImages.length) {
          showToast("warning", "Warning", "Some images failed to upload");
        }
        uploadedImages.push(...successfulUploads);
      }

      const allImages = [...remoteImages, ...uploadedImages];

      // Upload flyer if changed
      let flyerImageUrl: string | null | undefined = undefined; // undefined = no change
      const originalFlyerUrl = (originalData as any)?.flyerImageUrl || null;
      if (flyerImage !== originalFlyerUrl) {
        if (!flyerImage) {
          flyerImageUrl = null;
        } else if (isRemoteMediaUri(flyerImage)) {
          flyerImageUrl = flyerImage;
        } else {
          const normalizedFlyerUri = await persistLocalMediaSelection(
            flyerImage,
            {
              scope: "event-drafts/flyers",
            },
          );
          if (isRemoteMediaUri(normalizedFlyerUri)) {
            flyerImageUrl = normalizedFlyerUri;
          } else {
            const flyerResults = await uploadMultiple([
              {
                uri: normalizedFlyerUri,
                type: flyerMediaType as "image" | "video",
              },
            ]);
            flyerImageUrl = flyerResults[0]?.success
              ? flyerResults[0].url
              : originalFlyerUrl;
          }
        }
      }

      // Prepare update data
      const updateData: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        location: locationData?.name || location,
        startDate: eventDate.toISOString(),
        endDate: endDate ? endDate.toISOString() : undefined,
        price: price ? parseFloat(price) : 0,
        maxAttendees: maxAttendees ? parseInt(maxAttendees) : undefined,
        category: category || undefined,
        visibility,
        dressCode: dressCode || undefined,
        doorPolicy: doorPolicy || undefined,
        lineup: lineup || undefined,
        perks: perks || undefined,
        youtubeVideoUrl: youtubeVideoUrl.trim() || null,
        ticketingEnabled,
        ...(flyerImageUrl !== undefined ? { flyerImageUrl } : {}),
      };

      if (locationData) {
        updateData.locationLat = locationData.latitude;
        updateData.locationLng = locationData.longitude;
        updateData.locationName = locationData.name;
      }

      if (allImages.length > 0) {
        updateData.coverImage = allImages[0];
        updateData.images = allImages.slice(1).map((url) => ({ url }));
      }

      // ── Optimistic update: patch cache + navigate back immediately ──
      const detailKey = ["events", "detail", id];
      const previousDetail = queryClient.getQueryData(detailKey);

      // Build optimistic patch matching EventDetail shape.
      // Includes derived date/month/time so the detail screen's date
      // pill updates the instant the user taps back — without waiting
      // on the useUpdateEvent mutation's onMutate to compute them.
      const dateParts = updateData.startDate
        ? formatEventDate(updateData.startDate as string)
        : null;
      const optimisticPatch: Record<string, unknown> = {
        title: updateData.title,
        description: updateData.description,
        location: updateData.location,
        fullDate: updateData.startDate,
        endDate: updateData.endDate || null,
        price: updateData.price,
        maxAttendees: updateData.maxAttendees,
        category: updateData.category || null,
        visibility: updateData.visibility,
        dressCode: updateData.dressCode || null,
        doorPolicy: updateData.doorPolicy || null,
        lineup: updateData.lineup
          ? String(updateData.lineup)
              .split(",")
              .map((s: string) => s.trim())
          : null,
        perks: updateData.perks
          ? String(updateData.perks)
              .split(",")
              .map((s: string) => s.trim())
          : null,
        youtubeVideoUrl: updateData.youtubeVideoUrl || null,
        ticketingEnabled: updateData.ticketingEnabled,
        ...(dateParts
          ? {
              date: dateParts.date,
              month: dateParts.month,
              time: dateParts.time,
            }
          : {}),
      };
      if (updateData.locationLat != null) {
        optimisticPatch.locationLat = updateData.locationLat;
        optimisticPatch.locationLng = updateData.locationLng;
        optimisticPatch.locationName = updateData.locationName;
      }
      if (allImages.length > 0) {
        optimisticPatch.image = allImages[0];
        optimisticPatch.images = allImages.slice(1).map((url) => ({
          type: "image",
          url,
        }));
      }

      // Patch ticket tiers too — buyers see the new price immediately
      // without waiting for a refetch. Existing tiers keep their server
      // id; new tiers get a temp id until the create promise resolves.
      const optimisticTiers = ticketTiers.map((t) => ({
        id: t.id || `temp_${t.name}_${Date.now()}`,
        event_id: parseInt(id, 10),
        name: t.name || "General Admission",
        description: t.description || null,
        category: t.category || "admission",
        price_cents: Math.round(parseFloat(t.priceDollars || "0") * 100),
        currency: "usd",
        quantity_total: parseInt(t.quantity || "100", 10),
        quantity_sold: 0,
        max_per_user: parseInt(t.maxPerOrder || "4", 10),
        is_active: true,
        tier: t.tier || "ga",
      }));
      optimisticPatch.ticketTiers = optimisticTiers;

      // Merge into cached detail
      queryClient.setQueryData(detailKey, (old: any) =>
        old ? { ...old, ...optimisticPatch } : old,
      );

      // Also patch any list caches that contain this event
      queryClient.setQueriesData<any[]>({ queryKey: ["events"] }, (old) => {
        if (!old || !Array.isArray(old)) return old;
        return old.map((e) =>
          String(e.id) === String(id) ? { ...e, ...optimisticPatch } : e,
        );
      });

      // ── Persist EVERYTHING to the server before navigating back ──
      //
      // The previous version was "optimistic + fire-and-forget": showed
      // the success toast and ran router.back() immediately, then fired
      // the mutation in the background. That raced with the detail
      // screen's `refetchOnMount: "always"` config — the refetch often
      // landed BEFORE the mutation completed, returning stale server
      // data that overwrote the optimistic patch. From the host's
      // point of view, the edits "disappeared" the moment they
      // navigated back. Confirmed in production on event 36 (Caliente)
      // where ticketing_enabled toggle, lineup, perks, max_attendees,
      // and category never persisted across the round-trip.
      //
      // Fix: await all server mutations BEFORE router.back(). The
      // optimistic patch still paints instantly and provides a
      // perceived-fast UX during the network round-trip; the await
      // guarantees the cache and server agree before the user lands
      // on the detail screen.

      // 1. Event row update — must finish before navigation
      try {
        await updateEventMutation.mutateAsync({
          eventId: id,
          updates: updateData,
        });
      } catch (err: any) {
        // Roll back the hand-rolled detail patch (the mutation hook
        // rolls back its own snapshot via onError).
        if (previousDetail) {
          queryClient.setQueryData(detailKey, previousDetail);
        }
        queryClient.invalidateQueries({ queryKey: ["events"] });
        showToast(
          "error",
          "Save Failed",
          err?.message || "Changes could not be saved. Please try again.",
        );
        setIsSaving(false);
        return;
      }

      // 2. Ticket tier creates / updates / deactivates — also awaited
      const tierPromises = ticketTiers.map(async (tier) => {
        const priceCents = Math.round(
          parseFloat(tier.priceDollars || "0") * 100,
        );
        const qty = parseInt(tier.quantity || "100");
        const maxPerUser = parseInt(tier.maxPerOrder || "4");

        if (!tier.id) {
          await ticketTypesApi.create({
            eventId: id,
            name: tier.name || "General Admission",
            category: tier.category || "admission",
            description: tier.description || undefined,
            priceCents,
            quantityTotal: qty,
            maxPerUser,
            saleStart: tier.saleStart || undefined,
          });
        } else {
          await ticketTypesApi.update(tier.id, {
            name: tier.name,
            category: tier.category || "admission",
            description: tier.description || null,
            price_cents: priceCents,
            quantity_total: qty,
            max_per_user: maxPerUser,
            sale_start: tier.saleStart || null,
          });
        }
      });

      const currentIds = new Set(
        ticketTiers.filter((t) => t.id).map((t) => t.id!),
      );
      const removedIds = [...originalTierIds].filter(
        (id) => !currentIds.has(id),
      );
      const deactivatePromises = removedIds.map((tid) =>
        ticketTypesApi.deactivate(tid),
      );

      try {
        await Promise.all([...tierPromises, ...deactivatePromises]);
      } catch (err: any) {
        // Tier sync failed but the event row already saved — surface
        // the partial failure honestly so the host can retry instead
        // of thinking the whole save went through.
        console.error("[EditEvent] Tier sync error:", err);
        showToast(
          "warning",
          "Partial save",
          "Event saved, but some ticket tier changes did not apply. Open Edit and re-save.",
        );
      }

      // 3. Invalidate so the detail screen, host dashboard, ticket
      //    detail screens etc. refresh against the now-authoritative
      //    server state (temp_* tier ids get replaced with real ids).
      queryClient.invalidateQueries({ queryKey: ["events", "detail", id] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["tickets", "types", id] });

      // 4. Confirmation + navigation
      showToast("success", "Saved", "Event updated successfully");
      setIsSaving(false);
      router.back();
      return;
    } catch (error: any) {
      console.error("[EditEvent] Save error:", error);
      showToast("error", "Error", error?.message || "Failed to save changes");
      setIsSaving(false);
    }
  }, [
    id,
    title,
    description,
    location,
    locationData,
    eventDate,
    endDate,
    eventImages,
    price,
    maxAttendees,
    category,
    visibility,
    dressCode,
    doorPolicy,
    lineup,
    perks,
    youtubeVideoUrl,
    ticketingEnabled,
    ticketTiers,
    originalTierIds,
    flyerImage,
    flyerMediaType,
    originalData,
    isSaving,
    uploadMultiple,
    queryClient,
    showToast,
    router,
  ]);

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="text-lg font-semibold text-foreground">
          Edit Event
        </Text>
        <Pressable
          onPress={handleSave}
          disabled={!hasChanges || isSaving || isUploading}
          hitSlop={12}
          style={{ opacity: hasChanges && !isSaving && !isUploading ? 1 : 0.5 }}
        >
          {isSaving || isUploading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Check
              size={24}
              color={hasChanges ? colors.primary : colors.mutedForeground}
            />
          )}
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Images */}
        <View className="mb-6">
          <Text className="text-sm font-medium text-foreground mb-2">
            Event Images
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-3">
              {eventImages.map((uri, index) => (
                <View key={`img-${index}`} className="relative">
                  <Image
                    source={{ uri }}
                    style={{ width: 100, height: 100, borderRadius: 12 }}
                    contentFit="cover"
                  />
                  <Pressable
                    onPress={() => removeImage(index)}
                    className="absolute -top-2 -right-2 bg-destructive rounded-full p-1"
                  >
                    <X size={14} color="#fff" />
                  </Pressable>
                  {index === 0 && (
                    <View className="absolute bottom-1 left-1 bg-black/60 px-2 py-0.5 rounded">
                      <Text className="text-white text-xs">Cover</Text>
                    </View>
                  )}
                </View>
              ))}
              {eventImages.length < 4 && (
                <Pressable
                  onPress={handlePickImages}
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderStyle: "dashed",
                    borderColor: colors.border,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Plus size={24} color={colors.mutedForeground} />
                  <Text className="text-xs text-muted-foreground mt-1">
                    Add
                  </Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        </View>

        {/* Flyer (Optional) — image or video */}
        <View className="mb-6">
          <View className="flex-row justify-between items-center mb-3">
            <View>
              <Text className="text-sm font-medium text-foreground">
                Flyer (Optional)
              </Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                Photo or video · 3:5 portrait · up to 60 sec
              </Text>
            </View>
          </View>

          {flyerImage ? (
            <View
              className="relative rounded-2xl overflow-hidden self-start"
              style={{ width: "60%", aspectRatio: 3 / 5 }}
            >
              {flyerMediaType === "video" ? (
                <DVNTAnimatedVideoView
                  uri={flyerImage}
                  width="100%"
                  height="100%"
                  contentFit="cover"
                  isPlaying
                  muted={false}
                />
              ) : (
                <Image
                  source={{ uri: flyerImage }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                />
              )}
              <Pressable
                onPress={() => {
                  setFlyerImage(null);
                  setFlyerMediaType("image");
                  setHasChanges(true);
                }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 items-center justify-center"
              >
                <X size={16} color="#fff" />
              </Pressable>
              <View className="absolute bottom-2 left-2 bg-amber-500/90 px-2 py-1 rounded-lg">
                <Text className="text-xs font-medium text-white">
                  {flyerMediaType === "video" ? "Video Flyer" : "Flyer"}
                </Text>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={async () => {
                const result = await pickFromLibrary({
                  allowsMultipleSelection: false,
                  maxSelection: 1,
                  mediaTypes: ["images", "videos"],
                });
                if (result && result.length > 0) {
                  try {
                    const picked = result[0];
                    const isVideo =
                      picked.mimeType?.startsWith("video/") ||
                      picked.type === "video";
                    const [persistedUri] =
                      await persistEventDraftAssets(result);
                    setFlyerImage(persistedUri);
                    setFlyerMediaType(isVideo ? "video" : "image");
                    setHasChanges(true);
                  } catch (error) {
                    console.error(
                      "[EditEvent] Failed to persist flyer:",
                      error,
                    );
                    showToast(
                      "error",
                      "Media Error",
                      "Failed to add the flyer. Please try again.",
                    );
                  }
                }
              }}
              style={{
                width: "60%",
                aspectRatio: 3 / 5,
                borderRadius: 16,
                borderWidth: 2,
                borderStyle: "dashed",
                borderColor: colors.border,
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: "rgba(255,255,255,0.06)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Plus size={24} color={colors.mutedForeground} />
              </View>
              <Text className="text-xs text-muted-foreground font-medium text-center px-4">
                Add Flyer
              </Text>
              <Text className="text-[10px] text-muted-foreground/60 text-center px-4">
                Photo or video ad
              </Text>
            </Pressable>
          )}
        </View>

        {/* Title */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Title *
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Event title"
            placeholderTextColor={colors.mutedForeground}
            maxLength={100}
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              padding: 16,
              color: colors.foreground,
              fontSize: 16,
            }}
          />
        </View>

        {/* Description */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Description
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Describe your event..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={2000}
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              padding: 16,
              color: colors.foreground,
              fontSize: 16,
              minHeight: 120,
              textAlignVertical: "top",
            }}
          />
        </View>

        {/* Location */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Location
          </Text>
          <LocationAutocompleteInstagram
            value={location}
            placeholder="Search location..."
            onLocationSelect={(data: LocationData) => {
              setLocation(data.name);
              setLocationData(data);
            }}
            onClear={() => {
              setLocation("");
              setLocationData(null);
            }}
          />
        </View>

        {/* Date & Time */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Date & Time
          </Text>
          <View className="flex-row gap-3">
            <Pressable
              onPress={() => setShowDatePicker(true)}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: colors.card,
                borderRadius: 12,
                padding: 16,
                gap: 8,
              }}
            >
              <Calendar size={20} color={colors.mutedForeground} />
              <Text style={{ color: colors.foreground }}>
                {formatDate(eventDate)}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowTimePicker(true)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: colors.card,
                borderRadius: 12,
                padding: 16,
                gap: 8,
              }}
            >
              <Clock size={20} color={colors.mutedForeground} />
              <Text style={{ color: colors.foreground }}>
                {formatTime(eventDate)}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Date/Time Pickers */}
        {showDatePicker && (
          <DateTimePicker
            value={eventDate}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={handleDateChange}
            minimumDate={new Date()}
          />
        )}
        {showTimePicker && (
          <DateTimePicker
            value={eventDate}
            mode="time"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={handleTimeChange}
          />
        )}

        {/* End Date & Time */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            End Date & Time
          </Text>
          <View className="flex-row gap-3">
            <Pressable
              onPress={() => setShowEndDatePicker(true)}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: colors.card,
                borderRadius: 12,
                padding: 16,
                gap: 8,
              }}
            >
              <Calendar size={20} color={colors.mutedForeground} />
              <Text
                style={{
                  color: endDate ? colors.foreground : colors.mutedForeground,
                }}
              >
                {endDate ? formatDate(endDate) : "Set end date"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowEndTimePicker(true)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: colors.card,
                borderRadius: 12,
                padding: 16,
                gap: 8,
              }}
            >
              <Clock size={20} color={colors.mutedForeground} />
              <Text
                style={{
                  color: endDate ? colors.foreground : colors.mutedForeground,
                }}
              >
                {endDate ? formatTime(endDate) : "--:--"}
              </Text>
            </Pressable>
          </View>
          {endDate && (
            <Pressable onPress={() => setEndDate(null)} className="mt-1">
              <Text className="text-xs text-destructive">Clear end date</Text>
            </Pressable>
          )}
        </View>

        {showEndDatePicker && (
          <DateTimePicker
            value={
              endDate || new Date(eventDate.getTime() + 3 * 60 * 60 * 1000)
            }
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={handleEndDateChange}
            minimumDate={eventDate}
          />
        )}
        {showEndTimePicker && (
          <DateTimePicker
            value={
              endDate || new Date(eventDate.getTime() + 3 * 60 * 60 * 1000)
            }
            mode="time"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={handleEndTimeChange}
          />
        )}

        {/* Price */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Price
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.card,
              borderRadius: 12,
              paddingHorizontal: 16,
            }}
          >
            <DollarSign size={18} color={colors.mutedForeground} />
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="0 (free)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              style={{
                flex: 1,
                padding: 16,
                color: colors.foreground,
                fontSize: 16,
              }}
            />
          </View>
        </View>

        {/* Capacity */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Capacity
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.card,
              borderRadius: 12,
              paddingHorizontal: 16,
            }}
          >
            <Users size={18} color={colors.mutedForeground} />
            <TextInput
              value={maxAttendees}
              onChangeText={setMaxAttendees}
              placeholder="Max attendees"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              style={{
                flex: 1,
                padding: 16,
                color: colors.foreground,
                fontSize: 16,
              }}
            />
          </View>
        </View>

        {/* Category */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Category
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.card,
              borderRadius: 12,
              paddingHorizontal: 16,
            }}
          >
            <Tag size={18} color={colors.mutedForeground} />
            <TextInput
              value={category}
              onChangeText={setCategory}
              placeholder="e.g. Music, Nightlife, Tech..."
              placeholderTextColor={colors.mutedForeground}
              maxLength={50}
              style={{
                flex: 1,
                padding: 16,
                color: colors.foreground,
                fontSize: 16,
              }}
            />
          </View>
        </View>

        {/* Visibility */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Visibility
          </Text>
          <View className="flex-row gap-3">
            {/* Values MUST match the DB CHECK constraint
                ('public','private','link_only'). The previous value
                "unlisted" wasn't in that list and would fail to save. */}
            {(["public", "private", "link_only"] as const).map((v) => {
              const label =
                v === "link_only"
                  ? "Link Only"
                  : v === "public"
                    ? "Public"
                    : "Private";
              return (
                <Pressable
                  key={v}
                  onPress={() => setVisibility(v)}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: "center",
                    backgroundColor:
                      visibility === v ? colors.primary : colors.card,
                  }}
                >
                  <Text
                    style={{
                      color: visibility === v ? "#fff" : colors.foreground,
                      fontSize: 13,
                      fontWeight: visibility === v ? "600" : "400",
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Explainer — mirrors the create flow so hosts see the same
              guidance whether they're making or editing an event. */}
          <View
            className="mt-3 p-3 rounded-xl"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.06)",
            }}
          >
            <Text
              className="text-[12px] leading-[17px]"
              style={{ color: colors.mutedForeground }}
            >
              {visibility === "public" && (
                <>
                  <Text
                    className="font-bold"
                    style={{ color: colors.foreground }}
                  >
                    Public ·{" "}
                  </Text>
                  Appears in the Home feed, For You, and Search. Anyone can see
                  and buy a ticket. Best for events you want to fill.
                </>
              )}
              {visibility === "link_only" && (
                <>
                  <Text
                    className="font-bold"
                    style={{ color: colors.foreground }}
                  >
                    Link Only ·{" "}
                  </Text>
                  Hidden from the public feed and Search. Anyone with the share
                  link can see and buy. Best for soft-launch events you promote
                  on Instagram, group chats, or email.
                </>
              )}
              {visibility === "private" && (
                <>
                  <Text
                    className="font-bold"
                    style={{ color: colors.foreground }}
                  >
                    Private ·{" "}
                  </Text>
                  Hidden from the public feed and from people without the link.
                  Intended for invite-only guest lists.
                </>
              )}
            </Text>
          </View>
        </View>

        {/* Ticketing Toggle — visible on EVERY event so a free event can
            be flipped paid (and vice versa) without leaving the screen. */}
        <View
          className="mb-4"
          style={{
            backgroundColor: colors.card,
            borderRadius: 12,
            padding: 16,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 16,
                  fontWeight: "600",
                }}
              >
                Sell tickets for this event
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 12,
                  marginTop: 2,
                  lineHeight: 16,
                }}
              >
                Turn this on to charge for entry, add VIP, or sell paid
                add-ons like coat check, drink tokens, or bottle service.
                You can keep general admission free and still sell extras.
              </Text>
            </View>
            <Switch
              value={ticketingEnabled}
              onValueChange={setTicketingEnabled}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
        </View>

        {/* Ticket Tiers */}
        {ticketingEnabled && (
          <View className="mb-4">
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <Text className="text-sm font-medium text-foreground">
                Ticket Tiers
              </Text>
              <Pressable
                onPress={() => {
                  setTicketTiers((prev) => [
                    ...prev,
                    {
                      name: "General Admission",
                      category: "admission",
                      priceDollars: "0",
                      quantity: "100",
                      maxPerOrder: "4",
                      tier: "ga",
                      description: "",
                      isActive: true,
                      saleStart: "",
                    },
                  ]);
                  setHasChanges(true);
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  backgroundColor: "rgba(138,64,207,0.15)",
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "rgba(138,64,207,0.3)",
                }}
              >
                <Plus size={14} color="#8A40CF" />
                <Text
                  style={{ color: "#8A40CF", fontSize: 13, fontWeight: "600" }}
                >
                  Add Tier
                </Text>
              </Pressable>
            </View>

            {ticketTiers.length === 0 && (
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 13,
                  textAlign: "center",
                  paddingVertical: 16,
                }}
              >
                No ticket tiers yet. Tap "Add Tier" to create one.
              </Text>
            )}

            {ticketTiers.map((tier, idx) => (
              <View
                key={idx}
                style={{
                  backgroundColor: colors.card,
                  borderRadius: 14,
                  padding: 16,
                  marginBottom: 10,
                  borderWidth: 1,
                  borderColor:
                    tier.tier === "vip"
                      ? "rgba(138,64,207,0.3)"
                      : tier.tier === "table"
                        ? "rgba(255,91,252,0.3)"
                        : tier.tier === "free"
                          ? "rgba(63,220,255,0.3)"
                          : "rgba(52,162,223,0.3)",
                }}
              >
                {/* Tier level selector */}
                <View
                  style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}
                >
                  {TIER_LEVELS.map((lvl) => (
                    <Pressable
                      key={lvl}
                      onPress={() => {
                        const updated = [...ticketTiers];
                        updated[idx] = { ...updated[idx], tier: lvl };
                        if (lvl === "free") updated[idx].priceDollars = "0";
                        setTicketTiers(updated);
                        setHasChanges(true);
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 6,
                        borderRadius: 8,
                        alignItems: "center",
                        backgroundColor:
                          tier.tier === lvl
                            ? lvl === "vip"
                              ? "#8A40CF"
                              : lvl === "table"
                                ? "#FF5BFC"
                                : lvl === "free"
                                  ? "#3FDCFF"
                                  : "#34A2DF"
                            : "transparent",
                        borderWidth: 1,
                        borderColor:
                          tier.tier === lvl ? "transparent" : colors.border,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            tier.tier === lvl ? "#fff" : colors.mutedForeground,
                          fontSize: 11,
                          fontWeight: "600",
                          textTransform: "uppercase",
                        }}
                      >
                        {lvl}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View
                  style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}
                >
                  {TICKET_TYPE_CATEGORIES.map((option) => {
                    const selected =
                      (tier.category || "admission") === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => {
                          const updated = [...ticketTiers];
                          updated[idx] = {
                            ...updated[idx],
                            category: option.value,
                          };
                          setTicketTiers(updated);
                          setHasChanges(true);
                        }}
                        style={{
                          flex: 1,
                          paddingVertical: 7,
                          borderRadius: 8,
                          alignItems: "center",
                          backgroundColor: selected
                            ? colors.primary
                            : "transparent",
                          borderWidth: 1,
                          borderColor: selected ? "transparent" : colors.border,
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          style={{
                            color: selected
                              ? colors.primaryForeground
                              : colors.mutedForeground,
                            fontSize: 11,
                            fontWeight: "700",
                          }}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Active category hint — tells the organizer what this
                    tier actually represents so they don't conflate
                    "GA admission" with "drink token" at $5 each. */}
                {(() => {
                  const active = TICKET_TYPE_CATEGORIES.find(
                    (c) => c.value === (tier.category || "admission"),
                  );
                  if (!active) return null;
                  return (
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 11,
                        marginBottom: 10,
                        lineHeight: 15,
                      }}
                    >
                      {active.hint}
                    </Text>
                  );
                })()}

                {/* Name */}
                <TextInput
                  value={tier.name}
                  onChangeText={(v) => {
                    const updated = [...ticketTiers];
                    updated[idx] = { ...updated[idx], name: v };
                    setTicketTiers(updated);
                    setHasChanges(true);
                  }}
                  placeholder="Tier name"
                  placeholderTextColor={colors.mutedForeground}
                  style={{
                    color: colors.foreground,
                    fontSize: 15,
                    fontWeight: "600",
                    marginBottom: 10,
                    paddingVertical: 4,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                />

                {/* Price + Quantity row */}
                <View
                  style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 11,
                        marginBottom: 4,
                      }}
                    >
                      Price ($)
                    </Text>
                    <TextInput
                      value={tier.priceDollars}
                      onChangeText={(v) => {
                        const updated = [...ticketTiers];
                        updated[idx] = { ...updated[idx], priceDollars: v };
                        setTicketTiers(updated);
                        setHasChanges(true);
                      }}
                      placeholder="0"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                      editable={tier.tier !== "free"}
                      style={{
                        color:
                          tier.tier === "free"
                            ? colors.mutedForeground
                            : colors.foreground,
                        fontSize: 15,
                        fontWeight: "600",
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        backgroundColor: "rgba(255,255,255,0.05)",
                        borderRadius: 8,
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 11,
                        marginBottom: 4,
                      }}
                    >
                      Quantity
                    </Text>
                    <TextInput
                      value={tier.quantity}
                      onChangeText={(v) => {
                        const updated = [...ticketTiers];
                        updated[idx] = { ...updated[idx], quantity: v };
                        setTicketTiers(updated);
                        setHasChanges(true);
                      }}
                      placeholder="100"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="number-pad"
                      style={{
                        color: colors.foreground,
                        fontSize: 15,
                        fontWeight: "600",
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        backgroundColor: "rgba(255,255,255,0.05)",
                        borderRadius: 8,
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 11,
                        marginBottom: 4,
                      }}
                    >
                      Max/Order
                    </Text>
                    <TextInput
                      value={tier.maxPerOrder}
                      onChangeText={(v) => {
                        const updated = [...ticketTiers];
                        updated[idx] = { ...updated[idx], maxPerOrder: v };
                        setTicketTiers(updated);
                        setHasChanges(true);
                      }}
                      placeholder="4"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="number-pad"
                      style={{
                        color: colors.foreground,
                        fontSize: 15,
                        fontWeight: "600",
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        backgroundColor: "rgba(255,255,255,0.05)",
                        borderRadius: 8,
                      }}
                    />
                  </View>
                </View>

                {/* Description */}
                <TextInput
                  value={tier.description}
                  onChangeText={(v) => {
                    const updated = [...ticketTiers];
                    updated[idx] = { ...updated[idx], description: v };
                    setTicketTiers(updated);
                    setHasChanges(true);
                  }}
                  placeholder="Perks description (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={{
                    color: colors.foreground,
                    fontSize: 13,
                    paddingVertical: 6,
                    marginBottom: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                    minHeight: 36,
                  }}
                />

                {/* Sale start — when this tier becomes purchasable.
                    Empty = opens immediately on publish. */}
                <Pressable
                  onPress={() =>
                    setOpenSalePickerIdx(
                      openSalePickerIdx === idx ? null : idx,
                    )
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor: "rgba(255,255,255,0.05)",
                    borderRadius: 8,
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    marginBottom: 10,
                  }}
                >
                  <Calendar size={14} color={colors.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 10,
                        letterSpacing: 1.2,
                        fontWeight: "700",
                      }}
                    >
                      SALE STARTS
                    </Text>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontSize: 14,
                        fontWeight: "600",
                        marginTop: 2,
                      }}
                    >
                      {tier.saleStart
                        ? new Date(tier.saleStart).toLocaleString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "Immediately on publish"}
                    </Text>
                  </View>
                  {tier.saleStart ? (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        const updated = [...ticketTiers];
                        updated[idx] = { ...updated[idx], saleStart: "" };
                        setTicketTiers(updated);
                        setHasChanges(true);
                        setOpenSalePickerIdx(null);
                      }}
                      hitSlop={10}
                    >
                      <Text
                        style={{
                          color: "#8A40CF",
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        Clear
                      </Text>
                    </Pressable>
                  ) : null}
                </Pressable>
                {openSalePickerIdx === idx && (
                  <View
                    style={{
                      backgroundColor: "rgba(255,255,255,0.04)",
                      borderRadius: 8,
                      overflow: "hidden",
                      marginBottom: 10,
                    }}
                  >
                    <DateTimePicker
                      value={
                        tier.saleStart ? new Date(tier.saleStart) : new Date()
                      }
                      mode="datetime"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      minimumDate={new Date()}
                      themeVariant="dark"
                      style={{ width: "100%" }}
                      onChange={(_, picked) => {
                        if (Platform.OS === "android") {
                          setOpenSalePickerIdx(null);
                        }
                        if (picked) {
                          const updated = [...ticketTiers];
                          updated[idx] = {
                            ...updated[idx],
                            saleStart: picked.toISOString(),
                          };
                          setTicketTiers(updated);
                          setHasChanges(true);
                        }
                      }}
                    />
                  </View>
                )}

                {/* Remove */}
                <Pressable
                  onPress={() => {
                    setTicketTiers((prev) => prev.filter((_, i) => i !== idx));
                    setHasChanges(true);
                  }}
                  style={{
                    alignSelf: "flex-start",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <X size={14} color="#ef4444" />
                  <Text style={{ color: "#ef4444", fontSize: 12 }}>
                    Remove tier
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* YouTube Video URL */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            YouTube Video URL
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.card,
              borderRadius: 12,
              paddingHorizontal: 16,
            }}
          >
            <Video size={18} color={colors.mutedForeground} />
            <TextInput
              value={youtubeVideoUrl}
              onChangeText={setYoutubeVideoUrl}
              placeholder="https://youtube.com/watch?v=..."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                padding: 16,
                color: colors.foreground,
                fontSize: 16,
              }}
            />
          </View>
        </View>

        {/* Dress Code */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Dress Code
          </Text>
          <TextInput
            value={dressCode}
            onChangeText={setDressCode}
            placeholder="e.g. Smart casual — No sneakers"
            placeholderTextColor={colors.mutedForeground}
            maxLength={200}
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              padding: 16,
              color: colors.foreground,
              fontSize: 16,
            }}
          />
        </View>

        {/* Door Policy */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Door Policy
          </Text>
          <TextInput
            value={doorPolicy}
            onChangeText={setDoorPolicy}
            placeholder="e.g. 21+ with valid ID"
            placeholderTextColor={colors.mutedForeground}
            maxLength={200}
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              padding: 16,
              color: colors.foreground,
              fontSize: 16,
            }}
          />
        </View>

        {/* Lineup */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Lineup / Performers
          </Text>
          <TextInput
            value={lineup}
            onChangeText={setLineup}
            placeholder="DJ sets, performers, speakers..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={1000}
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              padding: 16,
              color: colors.foreground,
              fontSize: 16,
              minHeight: 80,
              textAlignVertical: "top",
            }}
          />
        </View>

        {/* Perks */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            What's Included
          </Text>
          <TextInput
            value={perks}
            onChangeText={setPerks}
            placeholder="Complimentary drinks, VIP access..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={1000}
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              padding: 16,
              color: colors.foreground,
              fontSize: 16,
              minHeight: 80,
              textAlignVertical: "top",
            }}
          />
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

export default function EditEventScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="EditEventDetail" onGoBack={() => router.back()}>
      <EditEventScreenContent />
    </ErrorBoundary>
  );
}
