import { useEffect, useCallback, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import { DVNTAnimatedVideoView } from "@dvnt/app/components/media/DVNTAnimatedVideoView";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  Switch,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeHeader } from "@dvnt/app/lib/hooks/use-safe-header";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import {
  useSafeAreaInsets,
  SafeAreaView,
} from "react-native-safe-area-context";
import { useLayoutEffect } from "react";
import {
  X,
  Calendar,
  Clock,
  Image as ImageIcon,
  Tag,
  FileText,
  Ticket,
  DollarSign,
  Users,
  Plus,
  Video,
  Globe,
  Shield,
  Wifi,
  Shirt,
  DoorOpen,
  Music,
  Gift,
  UserPlus,
  Trash2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Eye,
} from "lucide-react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Image } from "expo-image";
import { useColorScheme, useMediaPicker } from "@dvnt/app/lib/hooks";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useCreateEventStore } from "@dvnt/app/lib/stores/create-event-store";
// Popover removed — inline expanding pickers used instead
import { DvntMap } from "@dvnt/app/src/components/map";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { Motion } from "@legendapp/motion";
import { Badge } from "@dvnt/app/components/ui/badge";
import { Text as UIText } from "@dvnt/app/components/ui/text";
import { Progress } from "@dvnt/app/components/ui/progress";
import {
  LocationAutocompleteV3,
  type LocationData,
} from "@dvnt/app/components/ui/location-autocomplete-v3";
import { useCreateEvent } from "@dvnt/app/lib/hooks/use-events";
import { eventsApi } from "@dvnt/app/lib/api/events";
import { organizerApi } from "@dvnt/app/lib/api/organizer";
import {
  ticketTypesApi,
  type CreateTicketTypeParams,
  TICKET_TYPE_CATEGORIES,
  type TicketTypeCategory,
} from "@dvnt/app/lib/api/ticket-types";
import { YouTubeEmbed, extractVideoId } from "@dvnt/app/components/youtube-embed";
import { usersApi } from "@dvnt/app/lib/api/users";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { Debouncer } from "@tanstack/react-pacer";
import {
  isRemoteMediaUri,
  persistLocalMediaSelection,
} from "@dvnt/app/lib/media/persist-local-selection";

type VisibilityOption = "public" | "private" | "link_only";
type AgeRestriction = "none" | "18+" | "21+";

// Canonical Event Type taxonomy lives in the shared form core (one schema,
// two layouts). Imported for local use here and re-exported for existing
// importers of this screen.
import { EVENT_TYPE_LABELS } from "@dvnt/app/features/events/create/event-form";
export { EVENT_TYPE_LABELS };

interface TicketTier {
  id: string;
  name: string;
  category: TicketTypeCategory;
  priceCents: number;
  quantity: number;
  maxPerUser: number;
  description: string;
  saleStart: string;
  saleEnd: string;
}

const WIZARD_STEPS = [
  { label: "Info", icon: FileText },
  { label: "Media", icon: ImageIcon },
  { label: "Venue", icon: Calendar },
  { label: "Details", icon: Music },
  { label: "Terms", icon: Shield },
  { label: "Review", icon: Eye },
] as const;

const SUGGESTED_TAGS = [
  "music",
  "tech",
  "networking",
  "food",
  "art",
  "sports",
  "nightlife",
  "wellness",
  "education",
  "charity",
];

function CreateEventScreenContent() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const { pickFromLibrary, requestPermissions } = useMediaPicker();
  const createEvent = useCreateEvent();
  const showToast = useUIStore((s) => s.showToast);
  // Transient UI state: which tier currently has its "Sale starts" picker
  // open. Kept outside the draft store because it's not persisted.
  const [openSalePickerTierId, setOpenSalePickerTierId] = useState<
    string | null
  >(null);
  const {
    uploadMultiple,
    isUploading: isUploadingMedia,
    progress: mediaUploadProgress,
    cancelUpload: cancelMediaUpload,
  } = useMediaUpload({ folder: "events" });

  // All form state lives in Zustand (MMKV-persisted draft). Each field is
  // selected INDIVIDUALLY — the previous whole-store destructure subscribed
  // this 2000-line component to every field, so every keystroke in every
  // input re-rendered the whole tree. That's why date/time pickers felt
  // laggy, the scroll stuttered, and quantity inputs could drop characters
  // (Zustand setters are stable so action selectors are free).
  const title = useCreateEventStore((s) => s.title);
  const setTitle = useCreateEventStore((s) => s.setTitle);
  const description = useCreateEventStore((s) => s.description);
  const setDescription = useCreateEventStore((s) => s.setDescription);
  const location = useCreateEventStore((s) => s.location);
  const setLocation = useCreateEventStore((s) => s.setLocation);
  const locationData = useCreateEventStore((s) => s.locationData);
  const setLocationData = useCreateEventStore((s) => s.setLocationData);
  const eventImages = useCreateEventStore((s) => s.eventImages);
  const setEventImages = useCreateEventStore((s) => s.setEventImages);
  const tags = useCreateEventStore((s) => s.tags);
  const toggleTag = useCreateEventStore((s) => s.toggleTag);
  const customTag = useCreateEventStore((s) => s.customTag);
  const setCustomTag = useCreateEventStore((s) => s.setCustomTag);
  const addCustomTag = useCreateEventStore((s) => s.addCustomTag);
  const eventDateISO = useCreateEventStore((s) => s.eventDate);
  const setEventDateISO = useCreateEventStore((s) => s.setEventDate);
  const endDateISO = useCreateEventStore((s) => s.endDate);
  const setEndDateISO = useCreateEventStore((s) => s.setEndDate);
  const ticketPrice = useCreateEventStore((s) => s.ticketPrice);
  const setTicketPrice = useCreateEventStore((s) => s.setTicketPrice);
  const maxAttendees = useCreateEventStore((s) => s.maxAttendees);
  const setMaxAttendees = useCreateEventStore((s) => s.setMaxAttendees);
  const youtubeUrl = useCreateEventStore((s) => s.youtubeUrl);
  const setYoutubeUrl = useCreateEventStore((s) => s.setYoutubeUrl);
  const isSubmitting = useCreateEventStore((s) => s.isSubmitting);
  const setIsSubmitting = useCreateEventStore((s) => s.setIsSubmitting);
  const uploadProgress = useCreateEventStore((s) => s.uploadProgress);
  const setUploadProgress = useCreateEventStore((s) => s.setUploadProgress);
  const ticketingEnabled = useCreateEventStore((s) => s.ticketingEnabled);
  const setTicketingEnabled = useCreateEventStore((s) => s.setTicketingEnabled);
  const ticketTierName = useCreateEventStore((s) => s.ticketTierName);
  const setTicketTierName = useCreateEventStore((s) => s.setTicketTierName);
  const simpleMaxPerUser = useCreateEventStore((s) => s.simpleMaxPerUser);
  const setSimpleMaxPerUser = useCreateEventStore((s) => s.setSimpleMaxPerUser);
  const showDatePicker = useCreateEventStore((s) => s.showDatePicker);
  const setShowDatePicker = useCreateEventStore((s) => s.setShowDatePicker);
  const showTimePicker = useCreateEventStore((s) => s.showTimePicker);
  const setShowTimePicker = useCreateEventStore((s) => s.setShowTimePicker);
  const showEndDatePicker = useCreateEventStore((s) => s.showEndDatePicker);
  const setShowEndDatePicker = useCreateEventStore(
    (s) => s.setShowEndDatePicker,
  );
  const showEndTimePicker = useCreateEventStore((s) => s.showEndTimePicker);
  const setShowEndTimePicker = useCreateEventStore(
    (s) => s.setShowEndTimePicker,
  );
  const visibility = useCreateEventStore((s) => s.visibility);
  const setVisibility = useCreateEventStore((s) => s.setVisibility);
  const ageRestriction = useCreateEventStore((s) => s.ageRestriction);
  const setAgeRestriction = useCreateEventStore((s) => s.setAgeRestriction);
  const isNsfw = useCreateEventStore((s) => s.isNsfw);
  const setIsNsfw = useCreateEventStore((s) => s.setIsNsfw);
  const isOnline = useCreateEventStore((s) => s.isOnline);
  const setIsOnline = useCreateEventStore((s) => s.setIsOnline);
  const dressCode = useCreateEventStore((s) => s.dressCode);
  const setDressCode = useCreateEventStore((s) => s.setDressCode);
  const doorPolicy = useCreateEventStore((s) => s.doorPolicy);
  const setDoorPolicy = useCreateEventStore((s) => s.setDoorPolicy);
  const lineup = useCreateEventStore((s) => s.lineup);
  const setLineup = useCreateEventStore((s) => s.setLineup);
  const lineupInput = useCreateEventStore((s) => s.lineupInput);
  const setLineupInput = useCreateEventStore((s) => s.setLineupInput);
  const perks = useCreateEventStore((s) => s.perks);
  const setPerks = useCreateEventStore((s) => s.setPerks);
  const perksInput = useCreateEventStore((s) => s.perksInput);
  const setPerksInput = useCreateEventStore((s) => s.setPerksInput);
  const ticketTiers = useCreateEventStore((s) => s.ticketTiers);
  const setTicketTiers = useCreateEventStore((s) => s.setTicketTiers);
  const addLineupItem = useCreateEventStore((s) => s.addLineupItem);
  const addPerk = useCreateEventStore((s) => s.addPerk);
  const coOrganizers = useCreateEventStore((s) => s.coOrganizers);
  const addCoOrganizer = useCreateEventStore((s) => s.addCoOrganizer);
  const removeCoOrganizer = useCreateEventStore((s) => s.removeCoOrganizer);
  const coOrganizerSearch = useCreateEventStore((s) => s.coOrganizerSearch);
  const setCoOrganizerSearch = useCreateEventStore(
    (s) => s.setCoOrganizerSearch,
  );
  const coOrganizerResults = useCreateEventStore((s) => s.coOrganizerResults);
  const setCoOrganizerResults = useCreateEventStore(
    (s) => s.setCoOrganizerResults,
  );
  const removeLineupItem = useCreateEventStore((s) => s.removeLineupItem);
  const removePerk = useCreateEventStore((s) => s.removePerk);
  const currentStep = useCreateEventStore((s) => s.currentStep);
  const setCurrentStep = useCreateEventStore((s) => s.setCurrentStep);
  const nextStep = useCreateEventStore((s) => s.nextStep);
  const prevStep = useCreateEventStore((s) => s.prevStep);
  const canProceed = useCreateEventStore((s) => s.canProceed);
  const totalSteps = useCreateEventStore((s) => s.totalSteps);
  const resetDraft = useCreateEventStore((s) => s.resetDraft);
  const eventType = useCreateEventStore((s) => s.eventType);
  const setEventType = useCreateEventStore((s) => s.setEventType);
  const disclaimers = useCreateEventStore((s) => s.disclaimers);
  const setDisclaimers = useCreateEventStore((s) => s.setDisclaimers);
  const agreementAccepted = useCreateEventStore((s) => s.agreementAccepted);
  const setAgreementAccepted = useCreateEventStore(
    (s) => s.setAgreementAccepted,
  );
  const flyerImage = useCreateEventStore((s) => s.flyerImage);
  const setFlyerImage = useCreateEventStore((s) => s.setFlyerImage);
  const flyerMediaType = useCreateEventStore((s) => s.flyerMediaType);
  const setFlyerMediaType = useCreateEventStore((s) => s.setFlyerMediaType);

  // Convert ISO strings to Date objects for pickers
  const eventDate = useMemo(() => new Date(eventDateISO), [eventDateISO]);
  const endDate = useMemo(
    () => (endDateISO ? new Date(endDateISO) : null),
    [endDateISO],
  );

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
      scope: string,
    ) =>
      Promise.all(
        assets.map((asset) =>
          persistLocalMediaSelection(asset.uri, {
            scope,
            fileName: asset.fileName,
            mimeType: asset.mimeType,
          }),
        ),
      ),
    [],
  );

  // Debounced co-organizer search
  const coOrgSearchDebouncer = useMemo(
    () =>
      new Debouncer(
        async (query: string) => {
          if (query.length < 2) {
            setCoOrganizerResults([]);
            return;
          }
          const { docs } = await usersApi.searchUsers(query, 6);
          setCoOrganizerResults(
            docs.map((u: any) => ({
              id: u.id,
              authId: u.authId,
              username: u.username,
              avatar: u.avatar,
              name: u.name,
            })),
          );
        },
        { wait: 300 },
      ),
    [setCoOrganizerResults],
  );

  useEffect(() => {
    coOrgSearchDebouncer.maybeExecute(coOrganizerSearch);
  }, [coOrganizerSearch, coOrgSearchDebouncer]);

  const handlePickImages = async () => {
    const remaining = 4 - eventImages.length;
    if (remaining <= 0) return;

    const result = await pickFromLibrary({
      maxSelection: remaining,
      allowsMultipleSelection: remaining > 1,
    });
    if (result && result.length > 0) {
      try {
        const persistedUris = await persistEventDraftAssets(
          result,
          "event-drafts/images",
        );
        setEventImages((prev) => [...prev, ...persistedUris].slice(0, 4));
      } catch (error) {
        console.error(
          "[CreateEvent] Failed to persist selected images:",
          error,
        );
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
  };

  const handleDateChange = (event: unknown, selectedDate?: Date) => {
    if (Platform.OS === "android") setShowDatePicker(false);
    if (selectedDate) {
      const newDate = new Date(eventDate);
      newDate.setFullYear(selectedDate.getFullYear());
      newDate.setMonth(selectedDate.getMonth());
      newDate.setDate(selectedDate.getDate());
      setEventDateISO(newDate.toISOString());
    }
  };

  const handleTimeChange = (event: unknown, selectedTime?: Date) => {
    if (Platform.OS === "android") setShowTimePicker(false);
    if (selectedTime) {
      const newDate = new Date(eventDate);
      newDate.setHours(selectedTime.getHours());
      newDate.setMinutes(selectedTime.getMinutes());
      setEventDateISO(newDate.toISOString());
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
    });
  };

  // Unified required set (PROMPT 20): Title · Event Type · a location OR online.
  // Virtual events no longer dead-end on the location requirement.
  const isValid =
    !!title.trim() && !!eventType && (!!location.trim() || isOnline);

  const handleSubmit = async () => {
    // Prevent double submission
    if (isSubmitting || createEvent.isPending) {
      console.log("[CreateEvent] Already submitting, ignoring");
      return;
    }

    if (!title.trim()) {
      showToast("error", "Add a title", "Please enter an event title");
      return;
    }
    if (!eventType) {
      showToast("error", "Pick a type", "Choose what kind of event this is");
      return;
    }
    // Honor virtual events — an online event doesn't need a typed location.
    if (!isOnline && !location.trim()) {
      showToast(
        "error",
        "Add a location",
        "Enter a venue, or switch the event to online",
      );
      return;
    }

    // ── MANDATORY STRIPE CONNECT CHECK ───────────────────────────────
    // If the organizer is enabling paid ticketing and has any tier
    // priced > 0, they MUST have completed Stripe Connect onboarding
    // (charges_enabled + payouts_enabled) before the event can go
    // live. Previously buyers tapped "Get Tickets" and saw a generic
    // "Organizer has not completed payment setup" error — by then the
    // damage (embarrassment + lost sale) was done. We block at
    // publish time and route the host to the onboarding screen.
    const hasPaidTier =
      ticketingEnabled &&
      (ticketTiers.some((t) => t.priceCents > 0) ||
        (ticketTiers.length === 0 &&
          !!ticketPrice &&
          parseFloat(ticketPrice) > 0));

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
            "Paid events need a Stripe payout account so you can actually get paid. Let's finish that now.",
          );
          router.push("/(protected)/events/organizer-setup" as any);
          return;
        }
      } catch (err) {
        console.error("[CreateEvent] Stripe status check failed:", err);
        showToast(
          "error",
          "Couldn't verify payout setup",
          "We couldn't confirm your Stripe account status. Please try again.",
        );
        return;
      }
    }

    // ── TIER PRICE FLOOR ─────────────────────────────────────────────
    // The fee policy is 2.5% + $1/ticket per side, so any tier priced
    // below $2 would result in a negative organizer transfer at checkout
    // (server-side computeFees throws). Block at publish time with a
    // clear message instead of letting buyers hit a generic checkout
    // error. $2 is also the smallest payout that's not embarrassing
    // after fees (~$0.85 to organizer).
    const MIN_PAID_TIER_CENTS = 200;
    if (hasPaidTier) {
      const offending = ticketTiers.filter(
        (t) => t.priceCents > 0 && t.priceCents < MIN_PAID_TIER_CENTS,
      );
      const singleTooLow =
        ticketTiers.length === 0 &&
        !!ticketPrice &&
        parseFloat(ticketPrice) > 0 &&
        parseFloat(ticketPrice) < MIN_PAID_TIER_CENTS / 100;
      if (offending.length > 0 || singleTooLow) {
        showToast(
          "error",
          "Tier price too low",
          "Paid tiers must be at least $2.00 to cover platform fees and leave a payout for the organizer.",
        );
        return;
      }
    }

    setIsSubmitting(true);
    setUploadProgress(0);

    try {
      // Upload main event image (first image) and additional images to Bunny.net CDN
      let mainEventImageUrl = "";
      let additionalImageUrls: string[] = [];

      if (eventImages.length > 0) {
        const normalizedImageEntries = await Promise.all(
          eventImages.map(async (uri) => {
            if (isRemoteMediaUri(uri)) {
              return { uri, kind: "remote" as const };
            }

            return {
              uri: await persistLocalMediaSelection(uri, {
                scope: "event-drafts/images",
              }),
              kind: "local" as const,
            };
          }),
        );

        const normalizedImageUris = normalizedImageEntries.map(
          (entry) => entry.uri,
        );
        setEventImages(normalizedImageUris);

        const localMediaFiles = normalizedImageEntries
          .filter((entry) => entry.kind === "local")
          .map((entry) => ({
            uri: entry.uri,
            type: "image" as const,
          }));

        console.log(
          "[CreateEvent] Uploading media files:",
          localMediaFiles.length,
        );
        const uploadResults =
          localMediaFiles.length > 0
            ? await uploadMultiple(localMediaFiles)
            : [];
        const failedUploads = uploadResults.filter((r) => !r.success);

        if (failedUploads.length > 0) {
          setIsSubmitting(false);
          console.error("[CreateEvent] Upload failures:", failedUploads);
          showToast(
            "error",
            "Upload Error",
            failedUploads[0]?.error ||
              "Failed to upload images. Please try again.",
          );
          return;
        }

        let localUploadIndex = 0;
        const finalImageUrls = normalizedImageEntries
          .map((entry) => {
            if (entry.kind === "remote") {
              return entry.uri;
            }

            const upload = uploadResults[localUploadIndex++];
            return upload?.url || "";
          })
          .filter(Boolean);

        // First image is the main event image
        mainEventImageUrl = finalImageUrls[0] || "";
        // Remaining images are additional images
        additionalImageUrls = finalImageUrls.slice(1);
        console.log(
          "[CreateEvent] Upload successful - Main:",
          mainEventImageUrl,
          "Additional:",
          additionalImageUrls.length,
        );
      }

      // Upload flyer (image or video) if provided
      let flyerImageUrl = "";
      if (flyerImage) {
        console.log("[CreateEvent] Uploading flyer", flyerMediaType);
        const normalizedFlyerUri = await persistLocalMediaSelection(
          flyerImage,
          {
            scope: "event-drafts/flyers",
          },
        );
        if (normalizedFlyerUri !== flyerImage) {
          setFlyerImage(normalizedFlyerUri);
        }

        if (isRemoteMediaUri(normalizedFlyerUri)) {
          flyerImageUrl = normalizedFlyerUri;
        } else {
          const flyerResults = await uploadMultiple([
            {
              uri: normalizedFlyerUri,
              type: flyerMediaType as "image" | "video",
            },
          ]);
          if (flyerResults[0]?.success) {
            flyerImageUrl = flyerResults[0].url;
          }
        }
      }

      const eventData: Record<string, any> = {
        title: title.trim(),
        description: description.trim(),
        date: eventDateISO,
        time: formatTime(eventDate),
        location: location.trim(),
        price: ticketPrice ? parseFloat(ticketPrice) : 0,
        image: mainEventImageUrl,
        images: additionalImageUrls.map((url) => ({ type: "image", url })),
        category: tags[0] || "Event",
        maxAttendees: maxAttendees ? parseInt(maxAttendees, 10) : undefined,
        youtubeVideoUrl: youtubeUrl.trim() || undefined,
        flyerImageUrl: flyerImageUrl || undefined,
        // V2 fields — location coordinates from autocomplete
        locationLat: locationData?.latitude,
        locationLng: locationData?.longitude,
        locationName: locationData?.name,
        locationAddress: locationData?.address,
        locationType: isOnline ? "virtual" : "physical",
        isOnline,
        ticketingEnabled,
        event_type: eventType || undefined,
        disclaimers: disclaimers.trim() || undefined,
        // V2 fields — new
        endDate: endDateISO || undefined,
        visibility,
        ageRestriction: ageRestriction !== "none" ? ageRestriction : undefined,
        dressCode: dressCode.trim() || undefined,
        doorPolicy: doorPolicy.trim() || undefined,
        lineup: lineup.length > 0 ? lineup : undefined,
        perks: perks.length > 0 ? perks : undefined,
        nsfw: isNsfw || undefined,
      };

      console.log("[CreateEvent] Creating event with data:", eventData);

      createEvent.mutate(eventData, {
        onSuccess: async (data) => {
          console.log("[CreateEvent] Event created successfully:", data);

          // Create ticket types if ticketing is enabled
          if (ticketingEnabled && data?.id) {
            if (ticketTiers.length > 0) {
              // Multi-tier: create each tier
              for (const tier of ticketTiers) {
                await ticketTypesApi.create({
                  eventId: String(data.id),
                  name: tier.name,
                  category: tier.category || "admission",
                  description: tier.description || undefined,
                  priceCents: tier.priceCents,
                  quantityTotal: tier.quantity,
                  maxPerUser: tier.maxPerUser,
                  saleStart: tier.saleStart || undefined,
                  saleEnd: tier.saleEnd || undefined,
                });
              }
              console.log(
                "[CreateEvent] Created",
                ticketTiers.length,
                "ticket tiers",
              );
            } else {
              // Fallback: single default tier
              const priceCents = ticketPrice
                ? Math.round(parseFloat(ticketPrice) * 100)
                : 0;
              const qty = maxAttendees ? parseInt(maxAttendees, 10) : 200;
              const tierName =
                ticketTierName.trim() ||
                (priceCents === 0 ? "Free" : "General Admission");
              await ticketTypesApi.create({
                eventId: String(data.id),
                name: tierName,
                priceCents,
                quantityTotal: qty,
                maxPerUser: simpleMaxPerUser || 4,
              });
              console.log("[CreateEvent] Default ticket type created");
            }
          }

          // Invite co-organizers (best-effort, non-blocking). The
          // invite-co-organizer edge function fires a push + in-app
          // notification to each invitee.
          if (coOrganizers.length > 0 && data?.id) {
            let invitedCount = 0;
            for (const org of coOrganizers) {
              if (!org.username) {
                console.warn(
                  "[CreateEvent] Skipping co-organizer with no username",
                  org,
                );
                continue;
              }
              try {
                await eventsApi.addCoOrganizer(
                  String(data.id),
                  org.username,
                  "editor",
                );
                invitedCount += 1;
              } catch (coOrgErr) {
                console.error(
                  "[CreateEvent] Failed to invite co-organizer:",
                  org.username,
                  coOrgErr,
                );
              }
            }
            if (invitedCount > 0) {
              showToast(
                "success",
                invitedCount === 1 ? "Invited" : `Invited ${invitedCount}`,
                invitedCount === 1
                  ? `@${coOrganizers[0]?.username} has been notified`
                  : `${invitedCount} co-organizers were notified`,
              );
            }
          }

          setUploadProgress(100);
          showToast("success", "Success", "Event created successfully!");
          resetDraft();
          router.back();
        },
        onError: (error: any) => {
          setIsSubmitting(false);
          console.error("[CreateEvent] Error creating event:", error);
          console.error(
            "[CreateEvent] Error details:",
            JSON.stringify(error, null, 2),
          );
          const errorMessage =
            error?.message ||
            error?.error?.message ||
            "Failed to create event. Please try again.";
          showToast("error", "Error", errorMessage);
        },
      });
    } catch (error: any) {
      setIsSubmitting(false);
      console.error("[CreateEvent] Unexpected error:", error);
      showToast(
        "error",
        "Error",
        error?.message || "An unexpected error occurred. Please try again.",
      );
    }
  };

  // FIX: Use safe header update to prevent loops
  const headerTitle = `${WIZARD_STEPS[currentStep]?.label ?? "Create"} (${currentStep + 1}/${totalSteps})`;

  useSafeHeader({
    headerShown: true,
    headerTitle: headerTitle,
    headerTitleAlign: "left" as const,
    headerStyle: {
      backgroundColor: colors.background,
    },
    headerTitleStyle: {
      color: colors.foreground,
      fontWeight: "600" as const,
      fontSize: 18,
    },
    headerLeft: () => (
      <Pressable
        onPress={() => {
          if (currentStep > 0) {
            prevStep();
          } else {
            router.back();
          }
        }}
        hitSlop={12}
        style={{
          marginLeft: 8,
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {currentStep > 0 ? (
          <ChevronLeft size={24} color={colors.foreground} strokeWidth={2.5} />
        ) : (
          <X size={24} color={colors.foreground} strokeWidth={2.5} />
        )}
      </Pressable>
    ),
    headerRight: () => (
      <Text
        style={{
          fontSize: 13,
          fontWeight: "500",
          color: colors.mutedForeground,
          marginRight: 12,
        }}
      >
        Step {currentStep + 1} of {totalSteps}
      </Text>
    ),
  });

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 20,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
        bottomOffset={100}
        enabled={true}
      >
        {/* Step Progress Indicator */}
        <View className="flex-row items-center justify-center gap-2 mb-6">
          {WIZARD_STEPS.map((step, idx) => {
            const StepIcon = step.icon;
            const isActive = idx === currentStep;
            const isCompleted = idx < currentStep;
            return (
              <Pressable
                key={step.label}
                onPress={() => {
                  if (idx <= currentStep || isCompleted) setCurrentStep(idx);
                }}
                className="items-center gap-1"
              >
                <View
                  className="w-10 h-10 rounded-full items-center justify-center"
                  style={{
                    backgroundColor: isActive
                      ? colors.primary
                      : isCompleted
                        ? `${colors.primary}30`
                        : `${colors.foreground}10`,
                  }}
                >
                  {isCompleted ? (
                    <Check size={16} color={colors.primary} strokeWidth={3} />
                  ) : (
                    <StepIcon
                      size={16}
                      color={isActive ? "#fff" : colors.mutedForeground}
                      strokeWidth={2}
                    />
                  )}
                </View>
                <Text
                  className="text-[10px] font-medium"
                  style={{
                    color: isActive ? colors.primary : colors.mutedForeground,
                  }}
                >
                  {step.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ==================== STEP 0: INFO ==================== */}
        {currentStep === 0 && (
          <>
            {/* Title & Description */}
            <View className="mb-6">
              <View className="flex-row items-center bg-card rounded-2xl px-4 mb-3">
                <FileText size={20} color={colors.primary} />
                <TextInput
                  className="flex-1 ml-3 py-4 text-lg font-semibold text-foreground"
                  placeholder="Event Title"
                  placeholderTextColor={colors.mutedForeground}
                  value={title}
                  onChangeText={setTitle}
                  maxLength={200}
                />
              </View>

              <View className="bg-card rounded-2xl p-4">
                <TextInput
                  className="text-base text-foreground min-h-[100px]"
                  placeholder="Describe your event... What will attendees experience?"
                  placeholderTextColor={colors.mutedForeground}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={4}
                  maxLength={2000}
                  textAlignVertical="top"
                />
                <Text className="text-xs text-muted-foreground text-right mt-2">
                  {description.length}/2000
                </Text>
              </View>
            </View>

            {/* Date & Time */}
            <View className="mb-6">
              <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Date & Time
              </Text>

              {/* Date row */}
              <Pressable
                onPress={() => {
                  setShowDatePicker(!showDatePicker);
                  setShowTimePicker(false);
                }}
                className="flex-row items-center bg-card rounded-2xl p-4 gap-3 mb-3"
              >
                <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
                  <Calendar size={18} color={colors.primary} />
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground mb-0.5">
                    Date
                  </Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {formatDate(eventDate)}
                  </Text>
                </View>
              </Pressable>

              {showDatePicker && (
                <View className="bg-card rounded-2xl mb-3 overflow-hidden">
                  <DateTimePicker
                    value={eventDate}
                    mode="date"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={handleDateChange}
                    minimumDate={new Date()}
                    themeVariant="dark"
                    style={{ width: "100%" }}
                  />
                </View>
              )}

              {/* Time row */}
              <Pressable
                onPress={() => {
                  setShowTimePicker(!showTimePicker);
                  setShowDatePicker(false);
                }}
                className="flex-row items-center bg-card rounded-2xl p-4 gap-3"
              >
                <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
                  <Clock size={18} color={colors.primary} />
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted-foreground mb-0.5">
                    Time
                  </Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {formatTime(eventDate)}
                  </Text>
                </View>
              </Pressable>

              {showTimePicker && (
                <View className="bg-card rounded-2xl mt-3 overflow-hidden">
                  <DateTimePicker
                    value={eventDate}
                    mode="time"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={handleTimeChange}
                    themeVariant="dark"
                    style={{ width: "100%" }}
                  />
                </View>
              )}

              {/* End Date toggle + pickers */}
              {!endDate ? (
                <Pressable
                  onPress={() => {
                    const d = new Date(eventDate);
                    d.setHours(d.getHours() + 3);
                    setEndDateISO(d.toISOString());
                  }}
                  className="flex-row items-center gap-2 mt-3 px-1"
                >
                  <Plus size={16} color={colors.primary} />
                  <Text className="text-sm font-semibold text-primary">
                    Add End Date & Time
                  </Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    onPress={() => {
                      setShowEndDatePicker(!showEndDatePicker);
                      setShowEndTimePicker(false);
                    }}
                    className="flex-row items-center bg-card rounded-2xl p-4 gap-3 mt-3"
                  >
                    <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
                      <Calendar size={18} color={colors.primary} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs text-muted-foreground mb-0.5">
                        End Date
                      </Text>
                      <Text className="text-sm font-semibold text-foreground">
                        {formatDate(endDate)}
                      </Text>
                    </View>
                    <Pressable onPress={() => setEndDateISO(null)} hitSlop={12}>
                      <X size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </Pressable>

                  {showEndDatePicker && (
                    <View className="bg-card rounded-2xl mt-3 overflow-hidden">
                      <DateTimePicker
                        value={endDate}
                        mode="date"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        onChange={(_e: unknown, d?: Date) => {
                          if (Platform.OS === "android")
                            setShowEndDatePicker(false);
                          if (d) {
                            const nd = new Date(endDate!);
                            nd.setFullYear(
                              d.getFullYear(),
                              d.getMonth(),
                              d.getDate(),
                            );
                            setEndDateISO(nd.toISOString());
                          }
                        }}
                        minimumDate={eventDate}
                        themeVariant="dark"
                        style={{ width: "100%" }}
                      />
                    </View>
                  )}

                  <Pressable
                    onPress={() => {
                      setShowEndTimePicker(!showEndTimePicker);
                      setShowEndDatePicker(false);
                    }}
                    className="flex-row items-center bg-card rounded-2xl p-4 gap-3 mt-3"
                  >
                    <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
                      <Clock size={18} color={colors.primary} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs text-muted-foreground mb-0.5">
                        End Time
                      </Text>
                      <Text className="text-sm font-semibold text-foreground">
                        {formatTime(endDate)}
                      </Text>
                    </View>
                  </Pressable>

                  {showEndTimePicker && (
                    <View className="bg-card rounded-2xl mt-3 overflow-hidden">
                      <DateTimePicker
                        value={endDate}
                        mode="time"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        onChange={(_e: unknown, t?: Date) => {
                          if (Platform.OS === "android")
                            setShowEndTimePicker(false);
                          if (t) {
                            const nd = new Date(endDate!);
                            nd.setHours(t.getHours(), t.getMinutes());
                            setEndDateISO(nd.toISOString());
                          }
                        }}
                        themeVariant="dark"
                        style={{ width: "100%" }}
                      />
                    </View>
                  )}
                </>
              )}
            </View>
          </>
        )}

        {/* ==================== EVENT TYPE (bottom of Step 0) ==================== */}
        {currentStep === 0 && (
          <View className="mb-6">
            <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Event Type
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => {
                const isActive = eventType === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setEventType(isActive ? null : (key as any))}
                    className="px-3 py-2 rounded-xl"
                    style={{
                      backgroundColor: isActive
                        ? colors.primary
                        : "rgba(255,255,255,0.04)",
                      borderWidth: 1,
                      borderColor: isActive
                        ? colors.primary
                        : "rgba(255,255,255,0.08)",
                    }}
                  >
                    <Text
                      className="text-xs font-semibold"
                      style={{
                        color: isActive ? "#000" : "#fff",
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* ==================== STEP 2: VENUE ==================== */}
        {currentStep === 2 && (
          <>
            {/* Location */}
            <View className="mb-6">
              <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Location
              </Text>
              <View style={{ zIndex: 1000, position: "relative" }}>
                <LocationAutocompleteV3
                  value={location}
                  placeholder="Search venue or address"
                  onLocationSelect={(data: LocationData) => {
                    setLocation(data.name);
                    // Map the Places result's formattedAddress → address so the
                    // structured street address reaches events.location_address.
                    setLocationData({
                      name: data.name,
                      latitude: data.latitude,
                      longitude: data.longitude,
                      placeId: data.placeId,
                      address: data.formattedAddress,
                    });
                  }}
                  onTextChange={(text: string) => {
                    // Keep step validation in sync with inline typing.
                    setLocation(text);
                    if (!text.trim()) {
                      setLocationData(null);
                    }
                  }}
                  onClear={() => {
                    setLocation("");
                    setLocationData(null);
                  }}
                />
              </View>

              {locationData?.latitude && locationData?.longitude && (
                <View
                  className="mt-3 rounded-2xl overflow-hidden"
                  style={{ height: 180 }}
                >
                  <DvntMap
                    center={[locationData.longitude, locationData.latitude]}
                    zoom={15}
                    markers={[
                      {
                        id: "event-location",
                        coordinate: [
                          locationData.longitude,
                          locationData.latitude,
                        ],
                      },
                    ]}
                    showControls={false}
                  />
                </View>
              )}
            </View>

            {/* Event Settings — Visibility, Age, Virtual */}
            <View className="mb-6">
              <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Event Settings
              </Text>

              {/* Virtual / Online toggle */}
              <View className="flex-row items-center justify-between bg-card rounded-2xl p-4 mb-3">
                <View className="flex-row items-center gap-3 flex-1 mr-3">
                  <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
                    <Wifi size={18} color={colors.primary} />
                  </View>
                  <View>
                    <Text className="text-sm font-semibold text-foreground">
                      Virtual Event
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      Online-only, no physical venue
                    </Text>
                  </View>
                </View>
                <Switch
                  value={isOnline}
                  onValueChange={setIsOnline}
                  trackColor={{ false: "#333", true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              {/* Spicy / NSFW toggle */}
              <View className="flex-row items-center justify-between bg-card rounded-2xl p-4 mb-3">
                <View className="flex-row items-center gap-3 flex-1 mr-3">
                  <View
                    className="w-10 h-10 rounded-xl items-center justify-center"
                    style={{
                      backgroundColor: isNsfw
                        ? "rgba(153,27,27,0.25)"
                        : "rgba(255,255,255,0.06)",
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>😈</Text>
                  </View>
                  <View>
                    <Text className="text-sm font-semibold text-foreground">
                      Spicy / 18+ Content
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      Marks event for mature audiences only
                    </Text>
                  </View>
                </View>
                <Switch
                  value={isNsfw}
                  onValueChange={setIsNsfw}
                  trackColor={{ false: "#333", true: "#991b1b" }}
                  thumbColor="#fff"
                />
              </View>

              {/* Visibility */}
              <View className="bg-card rounded-2xl p-4 mb-3">
                <View className="flex-row items-center gap-3 mb-3">
                  <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
                    <Globe size={18} color={colors.primary} />
                  </View>
                  <Text className="text-sm font-semibold text-foreground">
                    Visibility
                  </Text>
                </View>
                <View className="flex-row gap-2">
                  {(
                    ["public", "private", "link_only"] as VisibilityOption[]
                  ).map((opt) => {
                    const labels: Record<VisibilityOption, string> = {
                      public: "Public",
                      private: "Private",
                      link_only: "Link Only",
                    };
                    const isActive = visibility === opt;
                    return (
                      <Pressable
                        key={opt}
                        onPress={() => setVisibility(opt)}
                        className="flex-1 py-2.5 rounded-xl items-center"
                        style={{
                          backgroundColor: isActive
                            ? colors.primary
                            : "rgba(255,255,255,0.04)",
                          borderWidth: 1,
                          borderColor: isActive
                            ? colors.primary
                            : "rgba(255,255,255,0.08)",
                        }}
                      >
                        <Text
                          className="text-xs font-semibold"
                          style={{
                            color: isActive ? "#fff" : colors.mutedForeground,
                          }}
                        >
                          {labels[opt]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Explainer — what the selected option actually does,
                    so the host doesn't have to guess Public vs Link Only
                    vs Private. Copy is intentionally plainspoken. */}
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
                        Appears in the Home feed, For You, and Search. Anyone
                        can see and buy a ticket. Best for events you want to
                        fill.
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
                        Hidden from the public feed and Search. Anyone with the
                        share link can see and buy. Best for soft-launch events
                        you promote on Instagram, group chats, or email.
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
                        Hidden from the public feed and from people without the
                        link. Intended for invite-only guest lists.
                      </>
                    )}
                  </Text>
                </View>
              </View>

              {/* Age Restriction */}
              <View className="bg-card rounded-2xl p-4">
                <View className="flex-row items-center gap-3 mb-3">
                  <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
                    <Shield size={18} color={colors.primary} />
                  </View>
                  <Text className="text-sm font-semibold text-foreground">
                    Age Restriction
                  </Text>
                </View>
                <View className="flex-row gap-2">
                  {(["none", "18+", "21+"] as AgeRestriction[]).map((opt) => {
                    const labels: Record<AgeRestriction, string> = {
                      none: "All Ages",
                      "18+": "18+",
                      "21+": "21+",
                    };
                    const isActive = ageRestriction === opt;
                    return (
                      <Pressable
                        key={opt}
                        onPress={() => setAgeRestriction(opt)}
                        className="flex-1 py-2.5 rounded-xl items-center"
                        style={{
                          backgroundColor: isActive
                            ? colors.primary
                            : "rgba(255,255,255,0.04)",
                          borderWidth: 1,
                          borderColor: isActive
                            ? colors.primary
                            : "rgba(255,255,255,0.08)",
                        }}
                      >
                        <Text
                          className="text-xs font-semibold"
                          style={{
                            color: isActive ? "#fff" : colors.mutedForeground,
                          }}
                        >
                          {labels[opt]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </>
        )}

        {/* ==================== STEP 1: MEDIA ==================== */}
        {currentStep === 1 && (
          <>
            {/* YouTube Video URL */}
            <View className="mb-6">
              <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                YouTube Video (Optional)
              </Text>
              <View className="flex-row items-center bg-card rounded-2xl px-4">
                <Video size={20} color={colors.primary} />
                <TextInput
                  className="flex-1 ml-3 py-4 text-base text-foreground"
                  placeholder="Paste YouTube URL or video ID"
                  placeholderTextColor={colors.mutedForeground}
                  value={youtubeUrl}
                  onChangeText={setYoutubeUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                {youtubeUrl.trim() !== "" && (
                  <Pressable onPress={() => setYoutubeUrl("")} className="p-2">
                    <X size={18} color={colors.mutedForeground} />
                  </Pressable>
                )}
              </View>

              {/* Live YouTube preview */}
              {youtubeUrl.trim() !== "" &&
                extractVideoId(youtubeUrl.trim()) && (
                  <View className="mt-3">
                    <YouTubeEmbed url={youtubeUrl.trim()} height={200} />
                  </View>
                )}
            </View>

            {/* Event Images */}
            <View className="mb-6">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Event Images
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {eventImages.length}/4
                </Text>
              </View>

              <View className="flex-row flex-wrap gap-3">
                {eventImages.map((uri, index) => (
                  <View
                    key={uri}
                    className="relative rounded-2xl overflow-hidden"
                    style={{ width: "48%", aspectRatio: 1 }}
                  >
                    <Image
                      source={{ uri }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                    />
                    <Pressable
                      onPress={() => removeImage(index)}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 items-center justify-center"
                    >
                      <X size={16} color="#fff" />
                    </Pressable>
                    {index === 0 && (
                      <View className="absolute bottom-2 left-2 bg-primary px-2 py-1 rounded-lg">
                        <Text className="text-xs font-medium text-primary-foreground">
                          Cover
                        </Text>
                      </View>
                    )}
                  </View>
                ))}

                {eventImages.length < 4 && (
                  <Pressable
                    onPress={handlePickImages}
                    className="bg-card rounded-2xl items-center justify-center border-2 border-dashed border-border"
                    style={{
                      width: "48%",
                      aspectRatio: 1,
                      justifyContent: "center",
                    }}
                  >
                    <View className="items-center justify-center gap-2 mb-8">
                      <View className="w-12 h-12 rounded-xl bg-muted items-center justify-center">
                        <Plus size={24} color={colors.mutedForeground} />
                      </View>
                      <Text className="text-xs text-muted-foreground font-medium">
                        Add Image
                      </Text>
                    </View>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Flyer (Optional) — image or video, 3:5 aspect ratio */}
            <View className="mb-6">
              <View className="flex-row justify-between items-center mb-3">
                <View>
                  <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
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
                    await requestPermissions();
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
                        const [persistedFlyerUri] =
                          await persistEventDraftAssets(
                            result,
                            "event-drafts/flyers",
                          );
                        setFlyerImage(persistedFlyerUri);
                        setFlyerMediaType(isVideo ? "video" : "image");
                      } catch (error) {
                        console.error(
                          "[CreateEvent] Failed to persist flyer:",
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
                  className="bg-card rounded-2xl items-center justify-center border-2 border-dashed border-border self-start"
                  style={{ width: "60%", aspectRatio: 3 / 5 }}
                >
                  <View className="items-center justify-center gap-2">
                    <View className="w-12 h-12 rounded-xl bg-muted items-center justify-center">
                      <Plus size={24} color={colors.mutedForeground} />
                    </View>
                    <Text className="text-xs text-muted-foreground font-medium text-center px-4">
                      Add Flyer
                    </Text>
                    <Text className="text-[10px] text-muted-foreground/60 text-center px-4">
                      Photo or video ad
                    </Text>
                  </View>
                </Pressable>
              )}
            </View>
          </>
        )}

        {/* ==================== STEP 3: DETAILS ==================== */}
        {currentStep === 3 && (
          <>
            {/* Tags */}
            <View className="mb-6">
              <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Suggested Tags
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {SUGGESTED_TAGS.map((tag) => (
                  <Pressable key={tag} onPress={() => toggleTag(tag)}>
                    <Badge variant={tags.includes(tag) ? "default" : "outline"}>
                      <UIText>{tag}</UIText>
                    </Badge>
                  </Pressable>
                ))}
              </View>

              {/* Selected custom tags */}
              {tags.filter((t) => !SUGGESTED_TAGS.includes(t)).length > 0 && (
                <View className="flex-row flex-wrap gap-2 mb-3">
                  {tags
                    .filter((t) => !SUGGESTED_TAGS.includes(t))
                    .map((tag) => (
                      <Pressable key={tag} onPress={() => toggleTag(tag)}>
                        <Badge variant="secondary">
                          <UIText>{tag}</UIText>
                          <X size={12} color={colors.secondaryForeground} />
                        </Badge>
                      </Pressable>
                    ))}
                </View>
              )}

              {/* Add custom tag */}
              <View className="flex-row items-center bg-card rounded-2xl px-4 gap-2">
                <Tag size={18} color={colors.mutedForeground} />
                <TextInput
                  className="flex-1 py-4 text-base text-foreground"
                  placeholder="Add custom tag..."
                  placeholderTextColor={colors.mutedForeground}
                  value={customTag}
                  onChangeText={setCustomTag}
                  onSubmitEditing={addCustomTag}
                  returnKeyType="done"
                />
                {customTag.trim() && (
                  <Pressable onPress={addCustomTag} className="p-2">
                    <Plus size={20} color={colors.primary} />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Enrichment Fields — Dress Code, Door Policy, Lineup, Perks */}
            <View className="mb-6">
              <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Event Details (Optional)
              </Text>

              {/* Dress Code */}
              <View className="flex-row items-center bg-card rounded-2xl px-4 mb-3">
                <Shirt size={18} color={colors.mutedForeground} />
                <TextInput
                  className="flex-1 ml-3 py-4 text-base text-foreground"
                  placeholder="Dress code (e.g. Smart Casual)"
                  placeholderTextColor={colors.mutedForeground}
                  value={dressCode}
                  onChangeText={setDressCode}
                />
              </View>

              {/* Door Policy */}
              <View className="flex-row items-center bg-card rounded-2xl px-4 mb-3">
                <DoorOpen size={18} color={colors.mutedForeground} />
                <TextInput
                  className="flex-1 ml-3 py-4 text-base text-foreground"
                  placeholder="Door policy (e.g. Guest list only)"
                  placeholderTextColor={colors.mutedForeground}
                  value={doorPolicy}
                  onChangeText={setDoorPolicy}
                />
              </View>

              {/* Lineup */}
              <View className="bg-card rounded-2xl p-4 mb-3">
                <View className="flex-row items-center gap-2 mb-3">
                  <Music size={18} color={colors.mutedForeground} />
                  <Text className="text-sm font-semibold text-foreground">
                    Lineup / Performers
                  </Text>
                </View>
                {lineup.length > 0 && (
                  <View className="flex-row flex-wrap gap-2 mb-3">
                    {lineup.map((performer, idx) => (
                      <View
                        key={idx}
                        className="flex-row items-center gap-1.5 bg-muted px-3 py-1.5 rounded-full"
                      >
                        <Text className="text-sm text-foreground">
                          {performer}
                        </Text>
                        <Pressable
                          onPress={() => removeLineupItem(idx)}
                          hitSlop={8}
                        >
                          <X size={12} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                <View className="flex-row items-center gap-2">
                  <TextInput
                    className="flex-1 py-2.5 text-base text-foreground"
                    placeholder="Add performer name..."
                    placeholderTextColor={colors.mutedForeground}
                    value={lineupInput}
                    onChangeText={setLineupInput}
                    onSubmitEditing={addLineupItem}
                    returnKeyType="done"
                  />
                  {lineupInput.trim() !== "" && (
                    <Pressable onPress={addLineupItem} className="p-2">
                      <Plus size={20} color={colors.primary} />
                    </Pressable>
                  )}
                </View>
              </View>

              {/* Perks */}
              <View className="bg-card rounded-2xl p-4">
                <View className="flex-row items-center gap-2 mb-3">
                  <Gift size={18} color={colors.mutedForeground} />
                  <Text className="text-sm font-semibold text-foreground">
                    Perks / What's Included
                  </Text>
                </View>
                {perks.length > 0 && (
                  <View className="flex-row flex-wrap gap-2 mb-3">
                    {perks.map((perk, idx) => (
                      <View
                        key={idx}
                        className="flex-row items-center gap-1.5 bg-muted px-3 py-1.5 rounded-full"
                      >
                        <Text className="text-sm text-foreground">{perk}</Text>
                        <Pressable onPress={() => removePerk(idx)} hitSlop={8}>
                          <X size={12} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                <View className="flex-row items-center gap-2">
                  <TextInput
                    className="flex-1 py-2.5 text-base text-foreground"
                    placeholder="Add perk (e.g. Open bar, VIP access)"
                    placeholderTextColor={colors.mutedForeground}
                    value={perksInput}
                    onChangeText={setPerksInput}
                    onSubmitEditing={addPerk}
                    returnKeyType="done"
                  />
                  {perksInput.trim() !== "" && (
                    <Pressable onPress={addPerk} className="p-2">
                      <Plus size={20} color={colors.primary} />
                    </Pressable>
                  )}
                </View>
              </View>
            </View>

            {/* Co-Organizers */}
            <View className="mb-6">
              <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Co-Organizers
              </Text>
              <View className="bg-card rounded-2xl p-4">
                <View className="flex-row items-center gap-2 mb-3">
                  <UserPlus size={18} color={colors.mutedForeground} />
                  <Text className="text-sm font-semibold text-foreground">
                    Invite Co-Organizers
                  </Text>
                </View>

                {/* Selected co-organizers */}
                {coOrganizers.length > 0 && (
                  <View className="flex-row flex-wrap gap-2 mb-3">
                    {coOrganizers.map((org) => (
                      <View
                        key={org.id}
                        className="flex-row items-center gap-2 bg-muted px-3 py-1.5 rounded-full"
                      >
                        <Avatar
                          uri={org.avatar}
                          username={org.username}
                          size={20}
                        />
                        <Text className="text-sm text-foreground">
                          @{org.username}
                        </Text>
                        <Pressable
                          onPress={() => removeCoOrganizer(org.id)}
                          hitSlop={8}
                        >
                          <X size={12} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                {/* Search input */}
                <TextInput
                  className="py-2.5 text-base text-foreground"
                  placeholder="Search by username..."
                  placeholderTextColor={colors.mutedForeground}
                  value={coOrganizerSearch}
                  onChangeText={setCoOrganizerSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {/* Search results */}
                {coOrganizerResults.length > 0 && (
                  <View className="mt-2 border-t border-border pt-2">
                    {coOrganizerResults
                      .filter((u) => !coOrganizers.some((c) => c.id === u.id))
                      .map((user) => (
                        <Pressable
                          key={user.id}
                          onPress={() => {
                            Haptics.impactAsync(
                              Haptics.ImpactFeedbackStyle.Light,
                            );
                            addCoOrganizer({
                              id: user.id,
                              authId: user.authId,
                              username: user.username,
                              avatar: user.avatar,
                            });
                            setCoOrganizerSearch("");
                            setCoOrganizerResults([]);
                          }}
                          className="flex-row items-center gap-3 py-2.5"
                        >
                          <Avatar
                            uri={user.avatar}
                            username={user.username}
                            size={32}
                          />
                          <View className="flex-1">
                            <Text className="text-sm font-semibold text-foreground">
                              {user.name}
                            </Text>
                            <Text className="text-xs text-muted-foreground">
                              @{user.username}
                            </Text>
                          </View>
                          <Plus size={16} color={colors.primary} />
                        </Pressable>
                      ))}
                  </View>
                )}
              </View>
            </View>

            {/* Ticketing */}
            <View className="mb-6">
              <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Ticketing
              </Text>

              {/* Ticketing toggle */}
              <View className="flex-row items-center justify-between bg-card rounded-2xl p-4 mb-3">
                <View className="flex-1 mr-3">
                  <Text className="text-sm font-semibold text-foreground">
                    Enable Paid Ticketing
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    Sell tickets via Stripe (2.5% + $1/ticket buyer fee)
                  </Text>
                </View>
                <Switch
                  value={ticketingEnabled}
                  onValueChange={setTicketingEnabled}
                  trackColor={{ false: "#333", true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              {ticketingEnabled && (
                <>
                  {/* Default single tier name + max per person (used if no multi-tiers added) */}
                  {ticketTiers.length === 0 && (
                    <>
                      <View className="flex-row items-center bg-card rounded-2xl px-4 mb-3">
                        <Ticket size={18} color={colors.mutedForeground} />
                        <TextInput
                          className="flex-1 ml-3 py-4 text-base text-foreground"
                          placeholder="Ticket tier name (e.g. General Admission)"
                          placeholderTextColor={colors.mutedForeground}
                          value={ticketTierName}
                          onChangeText={setTicketTierName}
                        />
                      </View>
                      <View className="flex-row items-center bg-card rounded-2xl px-4 mb-3">
                        <Users size={18} color={colors.mutedForeground} />
                        <Text className="ml-3 text-base text-foreground flex-1">
                          Max tickets per person
                        </Text>
                        <TextInput
                          className="text-base text-foreground text-right w-16"
                          placeholder="4"
                          placeholderTextColor={colors.mutedForeground}
                          value={
                            simpleMaxPerUser > 0 ? String(simpleMaxPerUser) : ""
                          }
                          onChangeText={(v) =>
                            setSimpleMaxPerUser(
                              v ? Math.max(1, parseInt(v, 10) || 1) : 4,
                            )
                          }
                          keyboardType="number-pad"
                          maxLength={2}
                        />
                      </View>
                    </>
                  )}

                  {/* Multi-tier ticket list */}
                  {ticketTiers.map((tier, idx) => (
                    <View
                      key={tier.id}
                      className="bg-card rounded-2xl p-4 mb-3"
                    >
                      <View className="flex-row items-center justify-between mb-3">
                        <Text className="text-sm font-semibold text-foreground">
                          Tier {idx + 1}
                        </Text>
                        <Pressable
                          onPress={() =>
                            setTicketTiers((prev) =>
                              prev.filter((t) => t.id !== tier.id),
                            )
                          }
                          hitSlop={12}
                        >
                          <Trash2 size={16} color="#EF4444" />
                        </Pressable>
                      </View>

                      <TextInput
                        className="bg-muted rounded-xl px-4 py-3 text-base text-foreground mb-2"
                        placeholder="Tier name (e.g. VIP, Early Bird)"
                        placeholderTextColor={colors.mutedForeground}
                        value={tier.name}
                        onChangeText={(v) =>
                          setTicketTiers((prev) =>
                            prev.map((t) =>
                              t.id === tier.id ? { ...t, name: v } : t,
                            ),
                          )
                        }
                      />

                      <TextInput
                        className="bg-muted rounded-xl px-4 py-3 text-base text-foreground mb-2"
                        placeholder="Description (optional)"
                        placeholderTextColor={colors.mutedForeground}
                        value={tier.description}
                        onChangeText={(v) =>
                          setTicketTiers((prev) =>
                            prev.map((t) =>
                              t.id === tier.id ? { ...t, description: v } : t,
                            ),
                          )
                        }
                      />

                      <View className="flex-row gap-2 mb-2">
                        {TICKET_TYPE_CATEGORIES.map((option) => {
                          const selected =
                            (tier.category || "admission") === option.value;
                          return (
                            <Pressable
                              key={option.value}
                              onPress={() =>
                                setTicketTiers((prev) =>
                                  prev.map((t) =>
                                    t.id === tier.id
                                      ? { ...t, category: option.value }
                                      : t,
                                  ),
                                )
                              }
                              className="flex-1 rounded-xl px-3 py-2 items-center"
                              style={{
                                backgroundColor: selected
                                  ? colors.primary
                                  : colors.muted,
                              }}
                            >
                              <Text
                                className="text-xs font-semibold"
                                style={{
                                  color: selected
                                    ? colors.primaryForeground
                                    : colors.mutedForeground,
                                }}
                                numberOfLines={1}
                              >
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      {/* Field captions — without these the three compact
                          inputs below (Price / Quantity / Max per order)
                          all look identical and buyers/hosts couldn't
                          tell what the "4" on Max/user meant. */}
                      <View className="flex-row gap-2 mb-1 px-1">
                        <Text
                          className="flex-1 text-[11px] font-semibold text-muted-foreground"
                          style={{ letterSpacing: 0.4 }}
                        >
                          PRICE
                        </Text>
                        <Text
                          className="flex-1 text-[11px] font-semibold text-muted-foreground"
                          style={{ letterSpacing: 0.4 }}
                        >
                          QUANTITY
                        </Text>
                        <Text
                          className="flex-1 text-[11px] font-semibold text-muted-foreground"
                          style={{ letterSpacing: 0.4 }}
                        >
                          MAX / ORDER
                        </Text>
                      </View>

                      <View className="flex-row gap-2 mb-2">
                        <View className="flex-1 flex-row items-center bg-muted rounded-xl px-3">
                          <DollarSign
                            size={14}
                            color={colors.mutedForeground}
                          />
                          <TextInput
                            className="flex-1 ml-2 py-3 text-sm text-foreground"
                            placeholder="0"
                            placeholderTextColor={colors.mutedForeground}
                            value={
                              tier.priceCents > 0
                                ? (tier.priceCents / 100).toString()
                                : ""
                            }
                            onChangeText={(v) =>
                              setTicketTiers((prev) =>
                                prev.map((t) =>
                                  t.id === tier.id
                                    ? {
                                        ...t,
                                        priceCents: v
                                          ? Math.round(parseFloat(v) * 100)
                                          : 0,
                                      }
                                    : t,
                                ),
                              )
                            }
                            keyboardType="decimal-pad"
                            autoCorrect={false}
                            autoComplete="off"
                            spellCheck={false}
                            textContentType="none"
                          />
                        </View>
                        <View className="flex-1 flex-row items-center bg-muted rounded-xl px-3">
                          <Users size={14} color={colors.mutedForeground} />
                          <TextInput
                            className="flex-1 ml-2 py-3 text-sm text-foreground"
                            placeholder="100"
                            placeholderTextColor={colors.mutedForeground}
                            value={
                              tier.quantity > 0 ? tier.quantity.toString() : ""
                            }
                            onChangeText={(v) =>
                              setTicketTiers((prev) =>
                                prev.map((t) =>
                                  t.id === tier.id
                                    ? {
                                        ...t,
                                        quantity: v ? parseInt(v, 10) : 0,
                                      }
                                    : t,
                                ),
                              )
                            }
                            keyboardType="number-pad"
                            autoCorrect={false}
                            autoComplete="off"
                            spellCheck={false}
                            textContentType="none"
                          />
                        </View>
                        <View className="flex-1 flex-row items-center bg-muted rounded-xl px-3">
                          <TextInput
                            className="flex-1 py-3 text-sm text-foreground"
                            placeholder="0"
                            placeholderTextColor={colors.mutedForeground}
                            value={
                              tier.maxPerUser > 0
                                ? tier.maxPerUser.toString()
                                : ""
                            }
                            onChangeText={(v) =>
                              setTicketTiers((prev) =>
                                prev.map((t) =>
                                  t.id === tier.id
                                    ? {
                                        ...t,
                                        maxPerUser: v ? parseInt(v, 10) : 0,
                                      }
                                    : t,
                                ),
                              )
                            }
                            keyboardType="number-pad"
                            autoCorrect={false}
                            autoComplete="off"
                            spellCheck={false}
                            textContentType="none"
                          />
                        </View>
                      </View>

                      {/* Sale-start: organizer schedules when this tier
                          becomes purchasable. Empty = opens immediately when
                          the event is published. */}
                      <Pressable
                        onPress={() =>
                          setOpenSalePickerTierId(
                            openSalePickerTierId === tier.id ? null : tier.id,
                          )
                        }
                        className="flex-row items-center bg-muted rounded-xl px-3 py-3 gap-2"
                      >
                        <Calendar size={14} color={colors.mutedForeground} />
                        <View className="flex-1">
                          <Text className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            Sale starts
                          </Text>
                          <Text className="text-sm font-semibold text-foreground">
                            {tier.saleStart
                              ? new Date(tier.saleStart).toLocaleString(
                                  "en-US",
                                  {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  },
                                )
                              : "Immediately on publish"}
                          </Text>
                        </View>
                        {tier.saleStart ? (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              setTicketTiers((prev) =>
                                prev.map((t) =>
                                  t.id === tier.id ? { ...t, saleStart: "" } : t,
                                ),
                              );
                              setOpenSalePickerTierId(null);
                            }}
                            hitSlop={10}
                          >
                            <Text className="text-xs font-semibold text-primary">
                              Clear
                            </Text>
                          </Pressable>
                        ) : null}
                      </Pressable>

                      {openSalePickerTierId === tier.id && (
                        <View className="bg-card rounded-xl mt-2 overflow-hidden">
                          <DateTimePicker
                            value={
                              tier.saleStart
                                ? new Date(tier.saleStart)
                                : new Date()
                            }
                            mode="datetime"
                            display={
                              Platform.OS === "ios" ? "spinner" : "default"
                            }
                            minimumDate={new Date()}
                            themeVariant="dark"
                            style={{ width: "100%" }}
                            onChange={(_, picked) => {
                              if (Platform.OS === "android") {
                                setOpenSalePickerTierId(null);
                              }
                              if (picked) {
                                setTicketTiers((prev) =>
                                  prev.map((t) =>
                                    t.id === tier.id
                                      ? {
                                          ...t,
                                          saleStart: picked.toISOString(),
                                        }
                                      : t,
                                  ),
                                );
                              }
                            }}
                          />
                        </View>
                      )}
                    </View>
                  ))}

                  {/* Add tier button */}
                  <Pressable
                    onPress={() =>
                      setTicketTiers((prev) => [
                        ...prev,
                        {
                          id: `tier-${Date.now()}`,
                          name: "",
                          category: "admission",
                          priceCents: 0,
                          quantity: 100,
                          maxPerUser: 0,
                          description: "",
                          saleStart: "",
                          saleEnd: "",
                        },
                      ])
                    }
                    className="flex-row items-center justify-center gap-2 bg-card rounded-2xl p-4 mb-3 border border-dashed border-border"
                  >
                    <Plus size={16} color={colors.primary} />
                    <Text className="text-sm font-semibold text-primary">
                      {ticketTiers.length === 0
                        ? "Add Multiple Ticket Tiers"
                        : "Add Another Tier"}
                    </Text>
                  </Pressable>
                </>
              )}

              <View className="flex-row gap-3">
                <View className="flex-1 flex-row items-center bg-card rounded-2xl px-4">
                  <DollarSign size={18} color={colors.mutedForeground} />
                  <TextInput
                    className="flex-1 ml-3 py-4 text-base text-foreground"
                    placeholder="Price (0 = free)"
                    placeholderTextColor={colors.mutedForeground}
                    value={ticketPrice}
                    onChangeText={setTicketPrice}
                    keyboardType="decimal-pad"
                  />
                </View>

                <View className="flex-1 flex-row items-center bg-card rounded-2xl px-4">
                  <Users size={18} color={colors.mutedForeground} />
                  <TextInput
                    className="flex-1 ml-3 py-4 text-base text-foreground"
                    placeholder="Max attendees"
                    placeholderTextColor={colors.mutedForeground}
                    value={maxAttendees}
                    onChangeText={setMaxAttendees}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </View>

            {/* Info Card */}
            <View className="flex-row bg-card rounded-2xl p-4 gap-3.5 border border-border">
              <View
                className="w-11 h-11 rounded-xl items-center justify-center"
                style={{ backgroundColor: `${colors.primary}20` }}
              >
                <Ticket size={20} color={colors.primary} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground mb-1">
                  Secure Ticketing
                </Text>
                <Text className="text-sm text-muted-foreground leading-5">
                  Each ticket will be generated with a unique QR code for secure
                  check-in. Attendees can add tickets to Apple Wallet or Google
                  Wallet.
                </Text>
              </View>
            </View>

            {/* Disclaimers */}
            <View className="mt-3">
              <Text className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Disclaimers (Optional)
              </Text>
              <View className="bg-card rounded-2xl p-4">
                <TextInput
                  className="text-base text-foreground min-h-[80px]"
                  placeholder="Any disclaimers, warnings, or special notices for attendees..."
                  placeholderTextColor={colors.mutedForeground}
                  value={disclaimers}
                  onChangeText={setDisclaimers}
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  textAlignVertical="top"
                />
                <Text className="text-xs text-muted-foreground text-right mt-1">
                  {disclaimers.length}/500
                </Text>
              </View>
            </View>
          </>
        )}

        {/* ==================== STEP 4: AGREEMENT ==================== */}
        {currentStep === 4 && (
          <View className="gap-4">
            <Text className="text-lg font-semibold text-foreground mb-1">
              Ticketing Agreement
            </Text>
            <Text className="text-sm text-muted-foreground leading-5 mb-2">
              Please review DVNT's ticketing terms before publishing your event.
            </Text>

            {/* Fee breakdown card */}
            <View className="bg-card rounded-2xl p-4 gap-3 border border-border">
              <Text className="text-sm font-semibold text-foreground mb-1">
                Fee Structure
              </Text>
              <View className="flex-row justify-between">
                <Text className="text-sm text-muted-foreground">
                  Base ticket price
                </Text>
                <Text className="text-sm text-foreground">Your set price</Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm text-muted-foreground">
                  Buyer service fee
                </Text>
                <Text className="text-sm text-foreground">
                  2.5% + $1.00 / ticket
                </Text>
              </View>
              <View className="h-px bg-border my-1" />
              <View className="flex-row justify-between">
                <Text className="text-sm text-muted-foreground">
                  Organizer platform fee
                </Text>
                <Text className="text-sm text-foreground">
                  2.5% + $1.00 / ticket
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm font-semibold text-foreground">
                  Your payout
                </Text>
                <Text className="text-sm font-semibold text-primary">
                  Price − 2.5% − $1/ticket
                </Text>
              </View>
            </View>

            {/* Non-refundable notice */}
            <View
              className="rounded-2xl p-4 flex-row gap-3"
              style={{ backgroundColor: "rgba(234, 179, 8, 0.1)" }}
            >
              <Shield size={18} color="#EAB308" style={{ marginTop: 1 }} />
              <Text className="text-sm text-foreground leading-5 flex-1">
                <Text className="font-semibold">
                  DVNT service fees are non-refundable.
                </Text>{" "}
                If you issue a refund, only the base ticket price is returned to
                the buyer. The DVNT platform fee is retained.
              </Text>
            </View>

            {/* Payout schedule */}
            <View className="bg-card rounded-2xl p-4">
              <Text className="text-sm font-semibold text-foreground mb-2">
                Payout Schedule
              </Text>
              <Text className="text-sm text-muted-foreground leading-5">
                Payouts are released 2 business days after your event ends and
                are subject to Stripe Connect's standard disbursement schedule.
                Disputes or chargebacks will place payouts on hold.
              </Text>
            </View>

            {/* Accept checkbox */}
            <Pressable
              onPress={() => setAgreementAccepted(!agreementAccepted)}
              className="flex-row items-start gap-3 bg-card rounded-2xl p-4"
            >
              <View
                className="w-6 h-6 rounded-md items-center justify-center mt-0.5"
                style={{
                  backgroundColor: agreementAccepted
                    ? colors.primary
                    : "transparent",
                  borderWidth: agreementAccepted ? 0 : 2,
                  borderColor: colors.mutedForeground,
                }}
              >
                {agreementAccepted && <Check size={14} color="#000" />}
              </View>
              <Text className="text-sm text-foreground leading-5 flex-1">
                I have read and agree to DVNT's{" "}
                <Text className="text-primary font-semibold">
                  Ticketing Terms
                </Text>
                , understand the non-refundable fee policy, and confirm that my
                event complies with DVNT's community guidelines.
              </Text>
            </Pressable>
          </View>
        )}

        {/* ==================== STEP 5: REVIEW ==================== */}
        {currentStep === 5 && (
          <View className="gap-4">
            <Text className="text-lg font-semibold text-foreground mb-2">
              Review Your Event
            </Text>

            {/* Title */}
            <View className="bg-card rounded-2xl p-4">
              <Text className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                Title
              </Text>
              <Text className="text-base font-semibold text-foreground">
                {title || "—"}
              </Text>
            </View>

            {/* Description */}
            <View className="bg-card rounded-2xl p-4">
              <Text className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                Description
              </Text>
              <Text className="text-sm text-foreground" numberOfLines={4}>
                {description || "—"}
              </Text>
            </View>

            {/* Date & Time */}
            <View className="bg-card rounded-2xl p-4">
              <Text className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                Date & Time
              </Text>
              <Text className="text-sm text-foreground">
                {formatDate(eventDate)} at {formatTime(eventDate)}
                {endDate
                  ? ` — ${formatDate(endDate)} at ${formatTime(endDate)}`
                  : ""}
              </Text>
            </View>

            {/* Location */}
            <View className="bg-card rounded-2xl p-4">
              <Text className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                {isOnline ? "Virtual Event" : "Location"}
              </Text>
              <Text className="text-sm text-foreground">{location || "—"}</Text>
            </View>

            {/* Media */}
            {(eventImages.length > 0 || youtubeUrl.trim()) && (
              <View className="bg-card rounded-2xl p-4">
                <Text className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                  Media
                </Text>
                {eventImages.length > 0 && (
                  <View className="flex-row gap-2 mb-2">
                    {eventImages.map((uri) => (
                      <Image
                        key={uri}
                        source={{ uri }}
                        style={{ width: 56, height: 56, borderRadius: 12 }}
                        contentFit="cover"
                      />
                    ))}
                  </View>
                )}
                {youtubeUrl.trim() !== "" && (
                  <Text className="text-sm text-muted-foreground">
                    YouTube: {youtubeUrl}
                  </Text>
                )}
              </View>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <View className="bg-card rounded-2xl p-4">
                <Text className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                  Tags
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      <UIText>{tag}</UIText>
                    </Badge>
                  ))}
                </View>
              </View>
            )}

            {/* Settings summary */}
            <View className="bg-card rounded-2xl p-4">
              <Text className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                Settings
              </Text>
              <View className="gap-1.5">
                <Text className="text-sm text-foreground">
                  Visibility:{" "}
                  {visibility === "link_only"
                    ? "Link Only"
                    : visibility.charAt(0).toUpperCase() + visibility.slice(1)}
                </Text>
                {ageRestriction !== "none" && (
                  <Text className="text-sm text-foreground">
                    Age: {ageRestriction}
                  </Text>
                )}
                {ticketingEnabled && (
                  <Text className="text-sm text-foreground">
                    Ticketing: Enabled{" "}
                    {ticketTiers.length > 0
                      ? `(${ticketTiers.length} tiers)`
                      : ""}
                  </Text>
                )}
                {coOrganizers.length > 0 && (
                  <Text className="text-sm text-foreground">
                    Co-organizers:{" "}
                    {coOrganizers.map((c) => `@${c.username}`).join(", ")}
                  </Text>
                )}
              </View>
            </View>
          </View>
        )}
      </KeyboardAwareScrollView>

      {/* ==================== WIZARD FOOTER ==================== */}
      <View
        className="flex-row items-center justify-between px-5 py-3 border-t border-border bg-background"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        {/* Back button */}
        {currentStep > 0 ? (
          <Pressable
            onPress={prevStep}
            className="flex-row items-center gap-1.5 px-5 py-3 rounded-full bg-card border border-border"
          >
            <ChevronLeft size={16} color={colors.foreground} />
            <Text className="text-sm font-semibold text-foreground">Back</Text>
          </Pressable>
        ) : (
          <View />
        )}

        {/* Next / Create button */}
        {currentStep < totalSteps - 1 ? (
          <Pressable
            onPress={() => {
              if (canProceed()) {
                nextStep();
                return;
              }
              // Tell the user WHY Next is blocked instead of silently dimming.
              if (currentStep === 0) {
                showToast(
                  "error",
                  "Almost there",
                  !title.trim()
                    ? "Add an event title to continue"
                    : "Pick an event type to continue",
                );
              } else if (currentStep === 2) {
                showToast(
                  "error",
                  "Add a location",
                  "Enter a venue, or switch the event to online",
                );
              } else if (currentStep === 4) {
                showToast(
                  "error",
                  "Accept the agreement",
                  "You must accept the ticketing agreement to continue",
                );
              }
            }}
            className="flex-row items-center gap-1.5 px-6 py-3 rounded-full"
            style={{
              backgroundColor: canProceed()
                ? colors.primary
                : `${colors.primary}40`,
            }}
          >
            <Text className="text-sm font-semibold text-primary-foreground">
              Next
            </Text>
            <ChevronRight size={16} color="#fff" />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              if (!isSubmitting) handleSubmit();
            }}
            disabled={isSubmitting}
            className="flex-row items-center gap-1.5 px-6 py-3 rounded-full"
            style={{
              backgroundColor:
                isValid && !isSubmitting
                  ? colors.primary
                  : `${colors.primary}40`,
            }}
          >
            <Check size={16} color="#fff" />
            <Text className="text-sm font-semibold text-primary-foreground">
              {isSubmitting ? "Creating..." : "Create Event"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Progress Overlay */}
      {isSubmitting && (
        <View className="absolute inset-0 bg-black/80 items-center justify-center z-50">
          <Motion.View
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="bg-card rounded-3xl p-8 items-center gap-4"
          >
            <View className="w-48 mb-2">
              <Progress value={uploadProgress} />
            </View>
            <Text className="text-lg font-semibold text-foreground">
              Creating Event...
            </Text>
            <Text className="text-sm text-muted-foreground text-center">
              Please wait while we set up your event
            </Text>
            <Pressable
              onPress={() => {
                cancelMediaUpload();
                setIsSubmitting(false);
                setUploadProgress(0);
              }}
              hitSlop={12}
              style={{
                marginTop: 8,
                paddingHorizontal: 24,
                paddingVertical: 10,
                borderRadius: 20,
                backgroundColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Text style={{ color: "#999", fontSize: 14, fontWeight: "600" }}>
                Cancel
              </Text>
            </Pressable>
          </Motion.View>
        </View>
      )}
    </SafeAreaView>
  );
}

export default function CreateEventScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="CreateEvent" onGoBack={() => router.back()}>
      <CreateEventScreenContent />
    </ErrorBoundary>
  );
}
