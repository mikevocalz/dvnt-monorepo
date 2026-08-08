/**
 * Event detail — WEB (@dvnt/app/features/events/event-detail). URL /events/{slug}.
 * Resolves the slug to an event id from the list, then loads the FULL event via
 * useEvent(id) and renders every section the mobile detail shows: cover (video),
 * host, About, YouTube embed, Lineup, Perks, Dress code / Door policy, Ticket
 * tiers, Attendees, Location (+ Maps), Tags, Disclaimers — plus a header menu
 * popover (Share / Edit / Report / Delete). Raw semantic tags + Tailwind; Solito.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter, usePathname } from "solito/navigation";
import { loginPathWithReturn } from "@dvnt/app/lib/auth/return-to";
import { formatEventTime } from "@dvnt/app/lib/events/event-time";
import {
  ArrowLeft,
  MoreHorizontal,
  Calendar,
  MapPin,
  CloudSun,
  Check,
  Users,
  Share2,
  Pencil,
  Flag,
  Music2,
  Sparkles,
  Shirt,
  DoorOpen,
  ExternalLink,
  Clock,
  ImageIcon,
  Star,
  MessageCircle,
  Heart,
  Ticket,
  Languages,
  Megaphone,
  ArrowUpCircle,
  Minus,
  Plus,
  Lock,
  Copy,
  CalendarX2,
  RotateCcw,
  Ban,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@dvnt/app/lib/api/events";
import { useCreateEventStore } from "@dvnt/app/lib/stores/create-event-store";
import { eventKeys } from "@dvnt/app/lib/hooks/use-events";
import { propagateEntity } from "@dvnt/app/lib/cache/propagate";
import { useEvents, useEvent, useToggleEventLike, useRsvpEvent } from "@dvnt/app/lib/hooks/use-events";
import { useEventRealtime } from "@dvnt/app/lib/hooks/use-event-realtime";
import { useEventDominantColor } from "@dvnt/app/lib/color/useEventDominantColor";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import { computePromoDiscountCents, promoLabel } from "@dvnt/app/lib/payments/promo-discount";
import { WhoAllOverThere } from "@dvnt/app/components/event/WhoAllOverThere.web";
import { WeatherStrip } from "./ui/weather-strip.web";
import { OrganizerCard } from "./ui/OrganizerCard.web";
import {
  useTicketTypes,
  useMyTicketForEvent,
} from "@dvnt/app/lib/hooks/use-tickets";
import { useTicketCheckout } from "@dvnt/app/lib/hooks/use-ticket-checkout";
import {
  useTicketUpgradeOptions,
  useInitiateUpgrade,
} from "@dvnt/app/lib/hooks/use-ticket-upgrade";
import {
  useEventWaitlistStatus,
  useJoinWaitlist,
  useLeaveWaitlist,
} from "@dvnt/app/lib/hooks/use-event-waitlist";
import { useCreateEventReview } from "@dvnt/app/lib/hooks/use-event-reviews";
import { useContentTranslation } from "@dvnt/app/lib/stores/translation-store";
import { shouldShowTranslateButton } from "@dvnt/app/lib/utils/language-detection";
import { useTicketStore } from "@dvnt/app/lib/stores/ticket-store";
import { usePromotionStore } from "@dvnt/app/lib/stores/promotion-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useEventDetailUiStore } from "@dvnt/app/lib/stores/event-detail-ui-store";
import {
  useAgeVerificationStatus,
  needsAgeVerification,
} from "@dvnt/app/lib/hooks/use-age-verification";
import { VerificationInterstitial } from "@dvnt/app/components/verification-interstitial.web";
import { onboardingCheckpoint } from "@dvnt/observability/flows";
import { useLightboxStore } from "@dvnt/app/lib/stores/lightbox-store";
import { Lightbox } from "@dvnt/app/components/lightbox.web";
import { Dialog } from "@dvnt/ui";
import { BottomSheet } from "@dvnt/app/components/bottom-sheet.web";
import { GuestRsvpSheet } from "./guest-rsvp-sheet.web";
import { useGuestRsvpStore } from "@dvnt/app/lib/stores/guest-rsvp-store";
import { GuestCheckoutSheet } from "./guest-checkout-sheet.web";
import { useGuestCheckoutStore } from "@dvnt/app/lib/stores/guest-checkout-store";
import { usePromoterRefStore } from "@dvnt/app/lib/stores/promoter-ref-store";
import {
  ticketTypesApi,
  type TicketTypeRecord,
} from "@dvnt/app/lib/api/ticket-types";
import {
  filterBuyerVisibleTiers,
  tierIsHiddenFromBuyers,
  tierIsLockedForBuyer,
  effectiveAddonUnitPriceCents,
} from "@dvnt/app/lib/tickets/pricing";
import { addonsApi, type AddonRecord } from "@dvnt/app/lib/api/addons";
import {
  AddonUpsellStrip,
  addonSelectionsTotalCents,
} from "./addon-upsell.web";
import { useAddonUpsellStore } from "@dvnt/app/lib/stores/addon-upsell-store";
import { useCartStore } from "@dvnt/app/lib/stores/cart";
import LiteYouTubeEmbed from "react-lite-youtube-embed";
import "react-lite-youtube-embed/dist/LiteYouTubeEmbed.css";
import { matchBySlug } from "@dvnt/app/lib/slug";
import {
  resolvePosterUrl,
  resolveRenderableMedia,
} from "@dvnt/app/lib/media/resolve-renderable";

// Route the event cover flyer through the single render-side resolver — same
// contract as events-list.web.tsx `flyerFor`: a videoUrl is only handed back
// when Chrome/Firefox/Edge can actually paint it (QuickTime/.mov dropped), and a
// posterUrl is NEVER a video URL and is null for HEIC, so those fall through to
// the empty cover box instead of a broken <img>/<video>. Falls back across
// flyerVideoUrl → image → coverImageUrl → gallery.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coverFor(e: any): { videoUrl: string | null; posterUrl: string | null } {
  const images: any[] = Array.isArray(e?.images) ? e.images : [];
  const rawVideo =
    e?.flyerVideoUrl ||
    (e?.image && VIDEO_RE.test(e.image) ? e.image : null) ||
    images.find(
      (m) => resolveRenderableMedia({ url: m?.url, type: m?.type }).kind === "video",
    )?.url ||
    null;

  const video = rawVideo
    ? resolveRenderableMedia({ url: rawVideo, type: "video" })
    : null;
  const videoUrl = video && !video.browserUnsupported ? video.videoUrl : null;

  const posterUrl =
    (video ? video.posterUrl : null) ||
    resolvePosterUrl({ url: e?.image }) ||
    resolvePosterUrl({ url: e?.coverImageUrl }) ||
    images
      .map((m) => resolvePosterUrl({ url: m?.url, type: m?.type }))
      .find((u: string | null): u is string => !!u) ||
    null;

  return { videoUrl, posterUrl };
}

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          color="#F5C518"
          fill={i <= Math.round(rating) ? "#F5C518" : "transparent"}
        />
      ))}
    </span>
  );
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const VIDEO_RE = /post-video|flyer-video|\.(mp4|mov|webm)(\?|$)/i;

// Timezone-correct: physical events with a known venue zone render event-local
// (same door time for everyone); otherwise viewer-local. Always shows a zone
// abbreviation so "9:00 PM PDT" is never ambiguous. Falls back gracefully when
// event_tz isn't present yet (older events) → viewer-local.
function fmt(
  iso?: string,
  eventTz?: string | null,
  isOnline?: boolean | null,
): string {
  if (!iso) return "Date TBA";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date TBA";
  const mode = !isOnline && eventTz ? "event-local" : "viewer-local";
  return formatEventTime(d, eventTz ?? null, mode);
}

function ytId(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/,
  );
  return m?.[1] ?? null;
}

function Section({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon?: typeof Music2;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-center gap-2 mb-2">
        {Icon ? <Icon size={16} color="#379ED8" /> : null}
        <h2 className="text-base font-bold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#02030A] flex items-center justify-center">
      <span className="text-white/50">{children}</span>
    </div>
  );
}

export function EventDetailScreen() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slug = String((params as any)?.slug ?? "");
  const { data: events, isLoading } = useEvents();
  const listEvent = matchBySlug(events, slug);
  // The cached list is filtered (upcoming only), so it can't resolve past events.
  // A lightweight {id,title} index over ALL events resolves any slug.
  const { data: slugIndex } = useQuery<Array<{ id: number; title?: string }>>({
    queryKey: ["events", "slug-index"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return [];
      const res = await fetch(`${url}/rest/v1/events?select=id,title`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      return res.ok ? res.json() : [];
    },
  });
  const resolvedId = listEvent?.id ?? matchBySlug(slugIndex, slug)?.id;
  const { data: full } = useEvent(resolvedId ? String(resolvedId) : "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = (full ?? listEvent) as any;

  // Cover dominant color: db value if the edge fn already set it, else extract
  // on-device (video → thumbnail frame) and persist via set-event-color so this
  // event is colored for every future viewer. Called before early returns to
  // keep hook order stable; degrades to the brand gradient. See
  // docs/color-extraction-fit.md.
  const coverVideoSrc = e?.flyerVideoUrl || (e?.image && VIDEO_RE.test(e.image) ? e.image : null);
  const { color: coverColor } = useEventDominantColor({
    eventId: e?.id,
    dominantColor: e?.dominantColor,
    imageUrl: !coverVideoSrc ? e?.image || e?.coverImageUrl : null,
    videoUrl: coverVideoSrc,
  });

  const me = useAuthStore((s) => s.user?.username);
  const userId = useAuthStore((s) => s.user?.id) || "";
  // Comments + the "who's going" attendee list are members-only: logged-out
  // visitors see a blurred teaser with a sign-in prompt, never the real content.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // Any write/commerce action requires a session — logged-out visitors are sent
  // to sign in rather than into a checkout that throws "Not authenticated".
  const gateAuth = (action: () => void) => {
    if (!isAuthenticated) {
      router.push(loginPathWithReturn(pathname));
      return;
    }
    action();
  };
  // Guest RSVP (free public events) — no account required (Phase 5.6.3b).
  const openGuestRsvp = useGuestRsvpStore((s) => s.openSheet);
  // Guest paid checkout (paid public events) — no account required (Phase 5.6.3).
  const openGuestCheckout = useGuestCheckoutStore((s) => s.openSheet);
  const menuOpen = useEventDetailUiStore((s) => s.menuOpen);
  const setMenuOpen = useEventDetailUiStore((s) => s.setMenuOpen);
  const openAt = useLightboxStore((s) => s.openAt);
  const showToast = useUIStore((s) => s.showToast);

  // ── event-detail UI flags (Zustand, no useState) ─────────────────────
  const checkoutOpen = useEventDetailUiStore((s) => s.checkoutOpen);
  const setCheckoutOpen = useEventDetailUiStore((s) => s.setCheckoutOpen);
  // B3: deferred ID verification — gate age-restricted RSVP/tickets, never registration.
  const verifyOpen = useEventDetailUiStore((s) => s.verifyOpen);
  const setVerifyOpen = useEventDetailUiStore((s) => s.setVerifyOpen);
  const { data: verificationStatus } = useAgeVerificationStatus();
  const selectedTierId = useEventDetailUiStore((s) => s.selectedTierId);
  const setSelectedTierId = useEventDetailUiStore((s) => s.setSelectedTierId);
  const ticketQty = useEventDetailUiStore((s) => s.ticketQty);
  const setTicketQty = useEventDetailUiStore((s) => s.setTicketQty);
  const promoCode = useEventDetailUiStore((s) => s.promoCode);
  const setPromoCode = useEventDetailUiStore((s) => s.setPromoCode);
  const upgradeTierId = useEventDetailUiStore((s) => s.upgradeTierId);
  const setUpgradeTierId = useEventDetailUiStore((s) => s.setUpgradeTierId);
  const reviewOpen = useEventDetailUiStore((s) => s.reviewOpen);
  const setReviewOpen = useEventDetailUiStore((s) => s.setReviewOpen);
  const reviewRating = useEventDetailUiStore((s) => s.reviewRating);
  const setReviewRating = useEventDetailUiStore((s) => s.setReviewRating);
  const reviewText = useEventDetailUiStore((s) => s.reviewText);
  const setReviewText = useEventDetailUiStore((s) => s.setReviewText);
  const translated = useEventDetailUiStore((s) => s.translated);
  const setTranslated = useEventDetailUiStore((s) => s.setTranslated);
  // Locked-tier unlock ("Have a code?") — validation is server-side only.
  const unlockOpen = useEventDetailUiStore((s) => s.unlockOpen);
  const setUnlockOpen = useEventDetailUiStore((s) => s.setUnlockOpen);
  const unlockCodeInput = useEventDetailUiStore((s) => s.unlockCodeInput);
  const setUnlockCodeInput = useEventDetailUiStore((s) => s.setUnlockCodeInput);
  const unlockError = useEventDetailUiStore((s) => s.unlockError);
  const setUnlockError = useEventDetailUiStore((s) => s.setUnlockError);
  const unlockBusy = useEventDetailUiStore((s) => s.unlockBusy);
  const setUnlockBusy = useEventDetailUiStore((s) => s.setUnlockBusy);
  const unlockedTierIds = useEventDetailUiStore((s) => s.unlockedTierIds);
  const addUnlockedTierIds = useEventDetailUiStore((s) => s.addUnlockedTierIds);
  const resetUi = useEventDetailUiStore((s) => s.reset);
  // WS-9 host lifecycle/destructive action dialogs (Zustand, no useState).
  const hostAction = useEventDetailUiStore((s) => s.hostAction);
  const setHostAction = useEventDetailUiStore((s) => s.setHostAction);
  const hostActionBusy = useEventDetailUiStore((s) => s.hostActionBusy);
  const setHostActionBusy = useEventDetailUiStore((s) => s.setHostActionBusy);
  const queryClient = useQueryClient();

  // Reset transient flags when leaving the screen.
  useEffect(() => () => resetUi(), [resetUi]);

  const eventId = resolvedId ? String(resolvedId) : "";

  // Promoter attribution (WS-4): capture ?ref=CODE from tracked share
  // links (?promo= is taken by promo codes) into the MMKV/localStorage-
  // persisted store so the Stripe redirect can't lose it. The checkout
  // API layer forwards it as promoter_code; pricing is never affected.
  // Covers /feed/events/[id] AND /public/events/[id] (both render this
  // screen).
  const setPromoterRef = usePromoterRefStore((s) => s.setRef);
  useEffect(() => {
    if (!eventId || typeof window === "undefined") return;
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref) setPromoterRef(eventId, ref);
    } catch {
      /* malformed URL — ignore */
    }
  }, [eventId, setPromoterRef]);

  // Phase 2 — live propagation: subscribe to this event's row + tier/ticket
  // changes so a host edit (time/venue/price/cancel) reflects here without a
  // refetch. RLS-respecting (anon only gets public events).
  useEventRealtime(eventId);

  // ── 3. LIKE — real toggle mutation ───────────────────────────────────
  const toggleLike = useToggleEventLike();
  const isLiked = !!(full as any)?.isLiked;
  const handleToggleLike = () => {
    if (!isAuthenticated) {
      router.push(loginPathWithReturn(pathname));
      return;
    }
    if (!eventId) return;
    toggleLike.mutate(
      { eventId, isLiked },
      {
        onSuccess: (result: any) => {
          if (result?.liked && !isLiked) {
            showToast("success", "Saved", "Event added to your liked events");
          }
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err || "");
          showToast("error", "Like failed", msg || "Failed to update like");
        },
      },
    );
  };

  // ── 1. TICKETS — live ticket types + checkout + my-ticket + upgrade ──
  const { data: liveTicketTypes = [] } = useTicketTypes(eventId);
  const { data: myTicketData } = useMyTicketForEvent(eventId);
  const { checkout, isLoading: isCheckingOut } = useTicketCheckout();
  // Authed RSVP for free, tier-less events (no checkout sheet to open).
  const rsvpMutation = useRsvpEvent();
  const { setTicket } = useTicketStore();
  const hasTicket =
    !!myTicketData &&
    (myTicketData.status === "active" || myTicketData.status === "scanned");

  // Upgrade options derived from live tiers + the user's current ticket.
  const upgradeOptions = useTicketUpgradeOptions(
    liveTicketTypes as TicketTypeRecord[],
    myTicketData ?? null,
  );
  const { mutate: initiateUpgrade, isPending: isUpgradePending } =
    useInitiateUpgrade(eventId);

  // ── 1b. ADD-ONS — catalog for the upsell strip (WS-3). Public read; the
  //    hold RPC reprices + tier-gates every line server-side, so this list is
  //    display + preview only.
  const { data: eventAddons = [] } = useQuery<AddonRecord[]>({
    queryKey: ["event-addons", eventId],
    enabled: !!eventId,
    staleTime: 60 * 1000,
    queryFn: () => addonsApi.getByEvent(eventId),
  });
  const resetAddonSelections = useAddonUpsellStore((s) => s.reset);

  // ── 2. WAITLIST — status + join/leave for the selected tier ──────────
  const { data: waitlistStatus } = useEventWaitlistStatus(
    eventId || null,
    selectedTierId,
  );
  const waitlistJoined = !!waitlistStatus?.joined;
  const joinWaitlist = useJoinWaitlist();
  const leaveWaitlist = useLeaveWaitlist();
  const isWaitlistBusy = joinWaitlist.isPending || leaveWaitlist.isPending;
  const handleJoinWaitlist = () => {
    if (!isAuthenticated) {
      router.push(loginPathWithReturn(pathname));
      return;
    }
    if (!eventId || isWaitlistBusy) return;
    joinWaitlist.mutate(
      { eventId, ticketTypeId: selectedTierId },
      {
        onSuccess: () =>
          showToast(
            "success",
            "You're on the waitlist",
            "We'll let you know if a spot opens up.",
          ),
        onError: (err: any) =>
          showToast(
            "error",
            "Couldn't join waitlist",
            err?.message || "Try again in a moment.",
          ),
      },
    );
  };
  const handleLeaveWaitlist = () => {
    if (!eventId || isWaitlistBusy) return;
    leaveWaitlist.mutate(
      { eventId, ticketTypeId: selectedTierId },
      {
        onError: (err: any) =>
          showToast(
            "error",
            "Couldn't leave waitlist",
            err?.message || "Try again in a moment.",
          ),
      },
    );
  };

  // ── 4. REVIEW SUBMIT — real create-review mutation ───────────────────
  const createReview = useCreateEventReview();
  const handleSubmitReview = () => {
    if (!eventId || createReview.isPending) return;
    createReview.mutate(
      {
        eventId,
        rating: reviewRating,
        comment: reviewText.trim() || undefined,
        authorUsername: me,
      },
      {
        onSuccess: () => {
          setReviewOpen(false);
          setReviewText("");
          setReviewRating(5);
          showToast("success", "Review posted", "Thanks for the feedback!");
        },
        onError: (err: any) =>
          showToast(
            "error",
            "Couldn't post review",
            err?.message || "Try again in a moment.",
          ),
      },
    );
  };

  // ── 5. TRANSLATION — caption/description translate toggle ────────────
  const descText = ((full ?? listEvent) as any)?.description ?? "";
  const {
    displayText: translatedDescription,
    isTranslated: isDescriptionTranslated,
    translate: translateDescription,
    showOriginal: showOriginalDescription,
  } = useContentTranslation(`event-${eventId}-description`, descText, "en");
  // Only offer translation when the description is detectably non-English —
  // same gate as the native feed/event cards.
  const showTranslate = shouldShowTranslateButton(descText, "en");
  const handleToggleTranslate = () => {
    if (isDescriptionTranslated) {
      showOriginalDescription();
      setTranslated(false);
    } else {
      void translateDescription();
      setTranslated(true);
    }
  };

  // ── 6. PROMOTION — open the promote-event sheet (host only) ──────────
  const openPromotionSheet = usePromotionStore((s) => s.openSheet);

  // ── 7. LOCKED TIERS — "Have a code?" unlock. The code is validated
  //    SERVER-side (ticketTypesApi.unlockTier → `unlock-ticket-tier` edge fn,
  //    a payments-wave seam); we never compare against a fetched unlock_code.
  const unlockedSet = new Set(unlockedTierIds);
  const handleUnlockSubmit = async () => {
    const code = unlockCodeInput.trim();
    if (!code || unlockBusy || !eventId) return;
    setUnlockBusy(true);
    setUnlockError(null);
    const { tierIds, error } = await ticketTypesApi.unlockTier(eventId, code);
    setUnlockBusy(false);
    if (error || tierIds.length === 0) {
      setUnlockError(error || "That code didn't unlock a tier.");
      return;
    }
    addUnlockedTierIds(tierIds);
    setUnlockOpen(false);
    setUnlockCodeInput("");
    showToast("success", "Unlocked", "A hidden tier is now available.");
  };

  const resolving =
    (isLoading && !listEvent) || !slugIndex || (!!resolvedId && !full);
  if (!e && resolving) return <Centered>Loading…</Centered>;
  if (!e) return <Centered>Event not found</Centered>;

  const isHost = !!me && me === e.host?.username;
  const { videoUrl: coverVideoUrl, posterUrl: coverPosterUrl } = coverFor(e);
  const yt = ytId(e.youtubeVideoUrl || e.youtubeUrl);
  const lineup: string[] = Array.isArray(e.lineup) ? e.lineup : [];
  const perks: string[] = Array.isArray(e.perks) ? e.perks : [];
  const tags: string[] = Array.isArray(e.tags) ? e.tags : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tiers: any[] = Array.isArray(e.ticketTiers) ? e.ticketTiers : [];
  // Buyer-facing tier visibility (v2 tier model): hidden tiers NEVER render;
  // locked tiers collapse into the "Have a code?" affordance until the server
  // unlocks them. Live ticket_types rows are authoritative for the flags; the
  // event payload's copy is the fallback for older aggregates.
  const liveList = liveTicketTypes as TicketTypeRecord[];
  const liveById = (tid: unknown) =>
    liveList.find((lt) => String(lt.id) === String(tid));
  const buyerVisibleTiers = tiers.filter((t) => {
    const live = liveById(t.id);
    const vis = {
      id: live?.id ?? t.id,
      tier_visibility:
        live?.tier_visibility ?? t.tier_visibility ?? t.tierVisibility ?? null,
    };
    return (
      !tierIsHiddenFromBuyers(vis) && !tierIsLockedForBuyer(vis, unlockedSet)
    );
  });
  const hasLockedTiers =
    liveList.some((t) => t.is_active && tierIsLockedForBuyer(t, unlockedSet)) ||
    tiers.some((t) =>
      tierIsLockedForBuyer(
        {
          id: t.id,
          tier_visibility: t.tier_visibility ?? t.tierVisibility ?? null,
        },
        unlockedSet,
      ),
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attendeeAvatars: any[] = Array.isArray(e.attendeeAvatars)
    ? e.attendeeAvatars
    : [];
  const going = e.totalAttendees ?? (typeof e.attendees === "number" ? e.attendees : 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reviews: any[] = Array.isArray(e.topReviews) ? e.topReviews : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comments: any[] = Array.isArray(e.topComments) ? e.topComments : [];
  const avgRating = Number(e.averageRating) || 0;
  const reviewCount = Number(e.reviewCount) || reviews.length;
  const maxAttendees = Number(e.maxAttendees) || 0;
  const remaining = maxAttendees > 0 ? Math.max(0, maxAttendees - going) : 0;
  // Gallery photos routed through the resolver: resolvePosterUrl never yields a
  // video URL and returns null for HEIC/unsupported, so videos + dead Live-Photo
  // rows drop out honestly (subsumes the old `type !== "video"` + VIDEO_RE guard)
  // and a browser-safe <img> URL is guaranteed for the rest.
  const gallery: string[] = (Array.isArray(e.images) ? e.images : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => resolvePosterUrl({ url: m?.url, type: m?.type }))
    .filter((u: string | null): u is string => !!u);
  const countdown = (() => {
    const start = new Date(e.date || e.fullDate || "");
    if (Number.isNaN(start.getTime())) return "";
    const ms = start.getTime() - Date.now();
    if (ms <= 0) return "";
    const days = Math.floor(ms / 86_400_000);
    const hrs = Math.floor((ms % 86_400_000) / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    return days > 0 ? `${days}d ${hrs}h` : hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  })();
  const mapEmbed =
    e.locationLat && e.locationLng
      ? `https://maps.google.com/maps?q=${e.locationLat},${e.locationLng}&z=15&output=embed`
      : e.location
        ? `https://maps.google.com/maps?q=${encodeURIComponent(e.location)}&z=14&output=embed`
        : null;

  const share = async () => {
    setMenuOpen(false);
    const url = `https://dvntapp.live/events/${slug}`;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((navigator as any).share) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (navigator as any).share({ title: e.title, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* cancelled */
    }
  };

  const mapsHref =
    e.locationLat && e.locationLng
      ? `https://maps.google.com/?q=${e.locationLat},${e.locationLng}`
      : e.location
        ? `https://maps.google.com/?q=${encodeURIComponent(e.location)}`
        : null;

  // ── WS-9 host lifecycle/destructive actions (web parity with the native
  //    action sheet). Owner-gated (isHost) + status-aware. Cancel loops the
  //    resumable event-cancel fn via eventsApi.cancelEventWithRefunds;
  //    Postpone/Resume are reversible; Delete is blocked server-side once
  //    tickets exist and routes the host to Cancel. ──────────────────────
  const status: string | undefined = e.status;
  const isCancelledEvent = status === "cancelled";
  const isPostponedEvent = status === "postponed";

  // Duplicate → clone scalars + tiers + add-ons into the create-event draft
  // as fresh unsaved rows, then open the create flow (WS-9, item 2).
  const handleDuplicate = async () => {
    setMenuOpen(false);
    try {
      const draft = await eventsApi.buildDuplicateDraft(eventId);
      const store = useCreateEventStore.getState();
      store.resetDraft();
      store.setTitle(e.title || "");
      store.setDescription(e.description || "");
      store.setLocation(e.location || "");
      if (e.locationName || e.location) {
        store.setLocationData({
          name: e.locationName || e.location || "",
          latitude: e.locationLat,
          longitude: e.locationLng,
          address: e.locationAddress,
        });
      }
      store.setIsOnline(e.locationType === "virtual" || !!e.isOnline);
      const galleryUrls: string[] = (Array.isArray(e.images) ? e.images : [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((m: any) => m?.url)
        .filter((u: unknown): u is string => typeof u === "string" && u.length > 0);
      store.setEventImages(galleryUrls);
      if (e.flyerVideoUrl) {
        store.setFlyerImage(e.flyerVideoUrl);
        store.setFlyerMediaType("video");
        store.setFlyerFallbackImage(e.flyerImageUrl || e.image || null);
      } else if (e.flyerImageUrl || e.image) {
        store.setFlyerImage(e.flyerImageUrl || e.image);
        store.setFlyerMediaType("image");
      }
      // Only carry a future date — a duplicated past event must not default
      // to an unbookable date.
      const srcDate = e.date || e.fullDate ? new Date(e.date || e.fullDate) : null;
      if (srcDate && !Number.isNaN(srcDate.getTime()) && srcDate.getTime() > Date.now()) {
        store.setEventDate(srcDate.toISOString());
        if (e.endDate) store.setEndDate(e.endDate);
      }
      if (e.maxAttendees) store.setMaxAttendees(String(e.maxAttendees));
      if (e.visibility) store.setVisibility(e.visibility);
      if (e.ageRestriction) store.setAgeRestriction(e.ageRestriction);
      store.setIsNsfw(!!e.nsfw);
      store.setTicketingEnabled(
        !!e.ticketingEnabled || draft.ticketTiers.length > 0,
      );
      store.setDressCode(e.dressCode || "");
      store.setDoorPolicy(e.doorPolicy || "");
      store.setLineup(Array.isArray(e.lineup) ? e.lineup : []);
      store.setPerks(Array.isArray(e.perks) ? e.perks : []);
      // NEW (WS-9): tiers + add-ons cloned as fresh unsaved draft rows.
      store.setTicketTiers(draft.ticketTiers);
      store.setAddons(draft.addons);
      store.setCurrentStep(0);
      router.push("/feed/events/create");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || "");
      showToast("error", "Couldn't duplicate", msg || "Try again in a moment.");
    }
  };

  const handleCancel = async () => {
    if (hostActionBusy) return;
    setHostActionBusy(true);
    try {
      const result = await eventsApi.cancelEventWithRefunds(eventId);
      propagateEntity(queryClient, "event", eventId, {
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: eventKeys.all });
      const refundLine =
        result.refundsIssued > 0
          ? `${result.refundsIssued} refund${result.refundsIssued === 1 ? "" : "s"} issued.`
          : "";
      const failedLine =
        result.refundsFailed > 0
          ? ` ${result.refundsFailed} refund${result.refundsFailed === 1 ? "" : "s"} couldn't be processed — re-run Cancel or check the host dashboard.`
          : "";
      setHostAction(null);
      showToast(
        result.refundsFailed > 0 ? "warning" : "success",
        "Event cancelled",
        `${refundLine}${failedLine}`.trim() || "Done.",
      );
      router.back();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || "");
      showToast("error", "Couldn't cancel", msg || "Try again in a moment.");
    } finally {
      setHostActionBusy(false);
    }
  };

  const handlePostpone = async () => {
    if (hostActionBusy) return;
    setHostActionBusy(true);
    try {
      await eventsApi.postponeEvent(eventId);
      propagateEntity(queryClient, "event", eventId, { status: "postponed" });
      queryClient.invalidateQueries({ queryKey: eventKeys.all });
      setHostAction(null);
      showToast(
        "success",
        "Event postponed",
        "Attendees have been notified. Tickets remain valid.",
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || "");
      showToast("error", "Couldn't postpone", msg || "Try again in a moment.");
    } finally {
      setHostActionBusy(false);
    }
  };

  const handleResume = async () => {
    if (hostActionBusy) return;
    setHostActionBusy(true);
    try {
      await eventsApi.resumeEvent(eventId);
      propagateEntity(queryClient, "event", eventId, { status: "active" });
      queryClient.invalidateQueries({ queryKey: eventKeys.all });
      setHostAction(null);
      showToast("success", "Event resumed", "You're back on.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || "");
      showToast("error", "Couldn't resume", msg || "Try again in a moment.");
    } finally {
      setHostActionBusy(false);
    }
  };

  const handleDelete = async () => {
    if (hostActionBusy) return;
    setHostActionBusy(true);
    try {
      await eventsApi.deleteEvent(eventId);
      queryClient.setQueriesData<unknown>(
        { queryKey: eventKeys.all },
        (old: unknown) =>
          Array.isArray(old)
            ? old.filter((ev: any) => String(ev?.id) !== String(eventId))
            : old,
      );
      queryClient.removeQueries({ queryKey: eventKeys.detail(eventId) });
      queryClient.invalidateQueries({ queryKey: eventKeys.all });
      setHostAction(null);
      showToast("success", "Event deleted", "");
      router.back();
    } catch (err: unknown) {
      // Server/client guard: paid tickets exist → route to the safe path.
      const msg = err instanceof Error ? err.message : String(err || "");
      if (/ticket/i.test(msg)) {
        setHostAction("delete_blocked");
        return;
      }
      showToast("error", "Couldn't delete", msg || "Try again in a moment.");
    } finally {
      setHostActionBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#02030A] text-white">
      <div className="mx-auto max-w-[680px] pb-28">
        {/* Cover + back + menu */}
        <div className="relative" style={{ backgroundColor: coverColor }}>
          {coverVideoUrl ? (
            <video
              src={coverVideoUrl}
              poster={coverPosterUrl ?? undefined}
              autoPlay
              muted
              loop
              playsInline
              className="w-full aspect-video object-cover"
            />
          ) : coverPosterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverPosterUrl} alt={e.title} className="w-full aspect-video object-cover" />
          ) : (
            <div className="w-full aspect-video bg-white/[0.06]" />
          )}
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="absolute top-3 left-3 w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center"
          >
            <ArrowLeft size={20} color="#fff" />
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="More"
            className="absolute top-3 right-3 w-9 h-9 rounded-xl bg-black/50 backdrop-blur flex items-center justify-center"
          >
            <MoreHorizontal size={20} color="#fff" />
          </button>
          {menuOpen ? (
            <>
              <button
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute right-3 top-14 z-50 w-48 rounded-xl border border-white/12 bg-[#0b0d16] py-1 shadow-2xl">
                <MenuItem Icon={Share2} label="Share event" onClick={share} />
                {/* 5. TRANSLATION — toggle the About copy via useContentTranslation. */}
                {showTranslate ? (
                  <MenuItem
                    Icon={Languages}
                    label={
                      isDescriptionTranslated
                        ? "Show original"
                        : "Translate event"
                    }
                    onClick={() => {
                      setMenuOpen(false);
                      handleToggleTranslate();
                    }}
                  />
                ) : null}
                {isHost ? (
                  <MenuItem
                    Icon={Pencil}
                    label="Edit event"
                    onClick={() => router.push(`/feed/events/${eventId}/edit`)}
                  />
                ) : null}
                {/* 6. PROMOTION — host-only; opens the promotion sheet store. */}
                {isHost ? (
                  <MenuItem
                    Icon={Megaphone}
                    label="Promote event"
                    onClick={() => {
                      setMenuOpen(false);
                      openPromotionSheet(
                        eventId,
                        e.title ?? "Event",
                        e.image ?? e.coverImageUrl ?? null,
                        e.flyerVideoUrl ?? null,
                      );
                    }}
                  />
                ) : null}
                {/* WS-9 host lifecycle/destructive actions — owner-gated,
                    status-aware. Confirms route through Zustand dialog state. */}
                {isHost ? (
                  <>
                    <div className="my-1 h-px bg-white/10" />
                    <MenuItem
                      Icon={Copy}
                      label="Duplicate event"
                      onClick={handleDuplicate}
                    />
                    {isPostponedEvent ? (
                      <MenuItem
                        Icon={RotateCcw}
                        label="Resume event"
                        onClick={() => {
                          setMenuOpen(false);
                          setHostAction("resume");
                        }}
                      />
                    ) : !isCancelledEvent ? (
                      <MenuItem
                        Icon={CalendarX2}
                        label="Postpone event…"
                        onClick={() => {
                          setMenuOpen(false);
                          setHostAction("postpone");
                        }}
                      />
                    ) : null}
                    {!isCancelledEvent ? (
                      <MenuItem
                        Icon={Ban}
                        label="Cancel event…"
                        destructive
                        onClick={() => {
                          setMenuOpen(false);
                          setHostAction("cancel");
                        }}
                      />
                    ) : null}
                    {!isCancelledEvent ? (
                      <MenuItem
                        Icon={Trash2}
                        label="Delete event…"
                        destructive
                        onClick={() => {
                          setMenuOpen(false);
                          setHostAction("delete");
                        }}
                      />
                    ) : null}
                  </>
                ) : null}
                <MenuItem Icon={Flag} label="Report" onClick={() => setMenuOpen(false)} />
              </div>
            </>
          ) : null}
        </div>

        <div className="px-4 pt-4">
          <div className="flex items-center gap-1.5 text-[#379ED8] text-sm font-semibold">
            <Calendar size={15} />
            {fmt(
              e.date || e.fullDate,
              (e as any).event_tz ?? (e as any).eventTz,
              (e as any).is_online ?? (e as any).isOnline,
            )}
          </div>
          <h1 className="text-2xl font-extrabold mt-1 leading-tight">{e.title}</h1>
          {e.location ? (
            <div className="flex items-center gap-1.5 text-white/60 text-sm mt-2">
              <MapPin size={15} />
              {e.location}
            </div>
          ) : null}

          {/* host + price/going */}
          <div className="flex items-center justify-between mt-4">
            {e.host?.username ? (
              <button
                onClick={() => router.push(`/profile/${e.host.username}`)}
                className="flex items-center gap-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={e.host.avatar}
                  alt=""
                  className="w-8 h-8 rounded-xl object-cover bg-white/10"
                />
                <span className="text-sm text-white/80">
                  Hosted by{" "}
                  <span className="font-semibold text-white">@{e.host.username}</span>
                </span>
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {/* 3. LIKE — real useToggleEventLike mutation. */}
              <button
                onClick={handleToggleLike}
                disabled={toggleLike.isPending}
                aria-label={isLiked ? "Unlike event" : "Like event"}
                aria-pressed={isLiked}
                className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center disabled:opacity-50"
              >
                <Heart
                  size={18}
                  color={isLiked ? "#f43f5e" : "#fff"}
                  fill={isLiked ? "#f43f5e" : "transparent"}
                />
              </button>
              <span className="px-3 py-1 rounded-lg bg-white/10 text-sm font-medium">
                {e.price ? `$${e.price}` : "Free"}
              </span>
            </div>
          </div>

          {/* Countdown */}
          {countdown ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] py-3 text-center">
              <div className="text-white/50 text-xs uppercase tracking-wider">
                Starts in
              </div>
              <div className="text-xl font-extrabold mt-0.5">{countdown}</div>
            </div>
          ) : null}

          {/* CTA — drives the real checkout / view-ticket / waitlist flow. */}
          {(() => {
            // Buyer-visible only: hidden tiers never sell here, locked tiers
            // join once the server unlocks them (v2 tier model).
            const sellableTiers = filterBuyerVisibleTiers(
              liveList.filter((t) => t.is_active),
              unlockedSet,
            ).visible;
            const allSoldOut =
              sellableTiers.length > 0 &&
              sellableTiers.every(
                (t) => t.quantity_total - t.quantity_sold <= 0,
              );
            // Free + no ticket tiers → a pure RSVP event (no checkout sheet to
            // open). Authed users RSVP directly into event_rsvps.
            const isFreeRsvp = !e.price && sellableTiers.length === 0;
            const isGoing = e.userRsvpStatus === "going";

            // Authed "going" → show a toggle to cancel the RSVP.
            if (isAuthenticated && isFreeRsvp && isGoing) {
              return (
                <button
                  onClick={() =>
                    rsvpMutation.mutate({ eventId, status: "not_going" })
                  }
                  disabled={rsvpMutation.isPending}
                  className="w-full mt-4 h-12 rounded-xl border border-white/15 bg-white/[0.04] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Check size={18} color="#379ED8" /> You&apos;re going · Tap to cancel
                </button>
              );
            }

            if (hasTicket) {
              return (
                <button
                  onClick={() => router.push(`/ticket/${eventId}`)}
                  className="w-full mt-4 h-12 rounded-xl bg-white/10 text-white font-bold flex items-center justify-center gap-2"
                >
                  <Ticket size={18} color="#379ED8" /> View ticket
                </button>
              );
            }

            if (allSoldOut) {
              // 2. WAITLIST — sold out → join/leave waitlist.
              return (
                <button
                  onClick={waitlistJoined ? handleLeaveWaitlist : handleJoinWaitlist}
                  disabled={isWaitlistBusy}
                  className={`w-full mt-4 h-12 rounded-xl font-bold disabled:opacity-50 ${
                    waitlistJoined
                      ? "border border-white/15 bg-white/[0.04] text-white"
                      : "bg-linear-to-r from-[#379ED8] to-[#874E9F] text-white"
                  }`}
                >
                  {isWaitlistBusy
                    ? "Working…"
                    : waitlistJoined
                      ? "Leave waitlist"
                      : "Join waitlist · Sold out"}
                </button>
              );
            }

            // 1. TICKETS — open the checkout sheet (or RSVP for free events).
            const openCheckout = () => {
              if (sellableTiers.length > 0 && !selectedTierId) {
                const firstPaid =
                  sellableTiers.find((t) => t.price_cents > 0) ??
                  sellableTiers[0];
                setSelectedTierId(String(firstPaid.id));
              }
              setCheckoutOpen(true);
            };
            return (
              <button
                onClick={() => {
                  // Public events, logged out → guest flow, NEVER /login.
                  if (!isAuthenticated) {
                    if (!e.price) {
                      openGuestRsvp(eventId, e.title ?? "Event");
                      return;
                    }
                    const tier =
                      sellableTiers.find((t) => t.price_cents > 0) ??
                      sellableTiers[0];
                    if (tier) {
                      openGuestCheckout({
                        eventId,
                        eventTitle: e.title ?? "Event",
                        tierId: String(tier.id),
                        tierName: tier.name,
                        priceCents: tier.price_cents,
                      });
                      return;
                    }
                    router.push(loginPathWithReturn(pathname));
                    return;
                  }
                  // B3: first age-gated action triggers the verify interstitial.
                  if (
                    needsAgeVerification(
                      (e as any).ageRestriction,
                      verificationStatus,
                    )
                  ) {
                    onboardingCheckpoint("verification.triggered", {
                      surface: "event_detail",
                    });
                    setVerifyOpen(true);
                    return;
                  }
                  // Authed: free tier-less event → RSVP; else open checkout.
                  if (isFreeRsvp) {
                    rsvpMutation.mutate({ eventId, status: "going" });
                    return;
                  }
                  gateAuth(openCheckout);
                }}
                disabled={isFreeRsvp && rsvpMutation.isPending}
                className="w-full mt-4 h-12 rounded-xl bg-linear-to-r from-[#379ED8] to-[#874E9F] text-white font-bold"
              >
                {e.price ? "Get tickets" : "RSVP"}
              </button>
            );
          })()}

          {/* Upgrade affordance — only when the user holds a ticket and a
              higher tier is available (4. useTicketUpgradeOptions). */}
          {hasTicket && upgradeOptions.length > 0 ? (
            <Section title="Upgrade your ticket" Icon={ArrowUpCircle}>
              <div className="flex flex-col gap-2">
                {upgradeOptions.map((opt) => (
                  <button
                    key={opt.tier.id}
                    disabled={!opt.available || isUpgradePending}
                    onClick={() => setUpgradeTierId(String(opt.tier.id))}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left disabled:opacity-50"
                  >
                    <div>
                      <div className="font-bold">{opt.tier.name}</div>
                      <div className="text-white/50 text-sm">
                        {opt.available ? "Available" : "Sold out"}
                      </div>
                    </div>
                    <span className="text-[#379ED8] font-bold">
                      +${(opt.diffCents / 100).toFixed(0)}
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Entry window */}
          {e.entryWindow ? (
            <Section title="Entry window" Icon={Clock}>
              <p className="text-white/85 text-[15px]">{e.entryWindow}</p>
            </Section>
          ) : null}

          {/* About — with translate toggle (5. useContentTranslation). */}
          {e.description ? (
            <Section title="About">
              <p className="text-white/85 text-[15px] leading-relaxed whitespace-pre-wrap">
                {isDescriptionTranslated ? translatedDescription : e.description}
              </p>
              {showTranslate ? (
                <button
                  onClick={handleToggleTranslate}
                  className="mt-2 inline-flex items-center gap-1.5 text-[#379ED8] text-sm font-medium"
                >
                  <Languages size={14} />
                  {isDescriptionTranslated ? "Show original" : "Translate"}
                </button>
              ) : null}
            </Section>
          ) : null}

          {/* Video — React YouTube facade (loads the player on click). */}
          {yt ? (
            <Section title="Video">
              <div className="rounded-xl overflow-hidden bg-black">
                <LiteYouTubeEmbed id={yt} title="Event video" />
              </div>
            </Section>
          ) : null}

          {/* Lineup */}
          {lineup.length > 0 ? (
            <Section title="Lineup" Icon={Music2}>
              <div className="flex flex-wrap gap-2">
                {lineup.map((name, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/10 text-sm"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Photos */}
          {gallery.length > 0 ? (
            <Section title="Photos" Icon={ImageIcon}>
              <div className="grid grid-cols-3 gap-1.5">
                {gallery.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => openAt(gallery.map((u) => ({ url: u })), i)}
                    className="relative aspect-square rounded-lg overflow-hidden bg-white/[0.06]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </Section>
          ) : null}

          {/* What's included */}
          {perks.length > 0 ? (
            <Section title="What's included" Icon={Sparkles}>
              <ul className="flex flex-col gap-1.5">
                {perks.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 text-white/85 text-[15px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#379ED8]" />
                    {p}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {/* Dress code / Door policy */}
          {e.dressCode ? (
            <Section title="Dress code" Icon={Shirt}>
              <p className="text-white/85 text-[15px]">{e.dressCode}</p>
            </Section>
          ) : null}
          {e.doorPolicy ? (
            <Section title="Door policy" Icon={DoorOpen}>
              <p className="text-white/85 text-[15px]">{e.doorPolicy}</p>
            </Section>
          ) : null}

          {/* Ticket tiers — selectable. Tapping a tier selects it and (when
              not already ticketed) opens the checkout sheet. The live
              ticket_types query (useTicketTypes) is the source of truth for
              sold-out + the real UUID id checkout needs; falls back to the
              event payload tiers for display only. */}
          {buyerVisibleTiers.length > 0 || hasLockedTiers ? (
            <Section title="Tickets">
              <div className="flex flex-col gap-2">
                {buyerVisibleTiers.map((t, i) => {
                  const price =
                    t.price != null
                      ? t.price
                      : t.priceCents != null
                        ? t.priceCents / 100
                        : 0;
                  const tperks: string[] = Array.isArray(t.perks) ? t.perks : [];
                  // Resolve the live tier so we get sold-out + the real id.
                  const live = (liveTicketTypes as TicketTypeRecord[]).find(
                    (lt) => String(lt.id) === String(t.id),
                  );
                  const tierId = String(live?.id ?? t.id ?? i);
                  const soldOut = live
                    ? live.quantity_total - live.quantity_sold <= 0
                    : false;
                  const isSelected = selectedTierId === tierId;
                  return (
                    <button
                      key={t.id ?? i}
                      type="button"
                      disabled={soldOut || hasTicket}
                      onClick={() => {
                        if (!isAuthenticated) {
                          if (price > 0 && live) {
                            openGuestCheckout({
                              eventId,
                              eventTitle: e.title ?? "Event",
                              tierId: String(live.id),
                              tierName: live.name ?? t.name ?? "Ticket",
                              priceCents: live.price_cents,
                            });
                          } else if (!e.price) {
                            openGuestRsvp(eventId, e.title ?? "Event");
                          } else {
                            router.push(loginPathWithReturn(pathname));
                          }
                          return;
                        }
                        gateAuth(() => {
                          setSelectedTierId(tierId);
                          if (!hasTicket) setCheckoutOpen(true);
                        });
                      }}
                      className={`w-full text-left rounded-xl border p-4 disabled:opacity-50 ${
                        isSelected
                          ? "border-[#379ED8] bg-[#379ED8]/[0.06]"
                          : "border-white/10 bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{t.name || t.title || "Ticket"}</span>
                        <span className="text-[#379ED8] font-bold">
                          {soldOut ? "Sold out" : price ? `$${price}` : "Free"}
                        </span>
                      </div>
                      {t.description ? (
                        <p className="text-white/55 text-sm mt-1">{t.description}</p>
                      ) : null}
                      {tperks.length > 0 ? (
                        <ul className="mt-2 flex flex-col gap-1">
                          {tperks.map((p, j) => (
                            <li key={j} className="text-white/70 text-sm flex items-center gap-2">
                              <span className="w-1 h-1 rounded-full bg-white/40" />
                              {p}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </button>
                  );
                })}

                {/* Locked tiers — "Have a code?" affordance. The code goes to
                    the server for validation; on success the unlocked tier(s)
                    appear in the list above. Never a client-side comparison. */}
                {hasLockedTiers ? (
                  <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4">
                    {!unlockOpen ? (
                      <button
                        type="button"
                        onClick={() => {
                          setUnlockError(null);
                          setUnlockOpen(true);
                        }}
                        className="flex w-full items-center gap-2 text-left text-sm font-medium text-white/70 hover:text-white"
                      >
                        <Lock size={14} color="#F5C518" />
                        Have a code? Unlock a hidden tier
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <span className="flex items-center gap-2 text-sm font-medium text-white/85">
                          <Lock size={14} color="#F5C518" /> Enter your access
                          code
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            value={unlockCodeInput}
                            onChange={(ev) =>
                              setUnlockCodeInput(ev.target.value.toUpperCase())
                            }
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") {
                                ev.preventDefault();
                                void handleUnlockSubmit();
                              }
                            }}
                            placeholder="ACCESS CODE"
                            autoCapitalize="characters"
                            className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 font-mono text-sm uppercase tracking-widest text-white placeholder:text-white/30 outline-none focus:border-[#F5C518]/60"
                          />
                          <button
                            type="button"
                            onClick={() => void handleUnlockSubmit()}
                            disabled={unlockBusy || !unlockCodeInput.trim()}
                            className="h-10 shrink-0 rounded-xl border border-[#F5C518]/40 bg-[#F5C518]/10 px-4 text-sm font-semibold text-[#F5C518] disabled:opacity-40"
                          >
                            {unlockBusy ? "…" : "Unlock"}
                          </button>
                        </div>
                        {unlockError ? (
                          <p className="text-sm text-[#FC253A]">{unlockError}</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </Section>
          ) : null}

          {/* Attendees — members-only; logged-out sees a blurred teaser. */}
          {going > 0 || attendeeAvatars.length > 0 || !isAuthenticated ? (
            <Section title="Who's going" Icon={Users}>
              <MembersOnly
                locked={!isAuthenticated}
                label="Sign in to see who's going."
                onSignIn={() => router.push(loginPathWithReturn(pathname))}
              >
                {going > 0 || attendeeAvatars.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {attendeeAvatars.slice(0, 6).map((a, i) => {
                        const src = a.image || a.avatar || a.url;
                        return src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={src}
                            alt=""
                            className="w-8 h-8 rounded-xl object-cover bg-white/10 ring-2 ring-[#02030A]"
                          />
                        ) : (
                          <div
                            key={i}
                            className="w-8 h-8 rounded-xl bg-white/10 ring-2 ring-[#02030A] flex items-center justify-center text-[10px] font-bold text-white/70"
                          >
                            {a.initials || "??"}
                          </div>
                        );
                      })}
                    </div>
                    <span className="text-white/60 text-sm">
                      {going} going
                      {remaining > 0 ? ` · ${remaining} spots left` : ""}
                    </span>
                  </div>
                ) : (
                  <TeaserRows kind="avatar" />
                )}
              </MembersOnly>
            </Section>
          ) : null}

          {/* Who All Over There — ephemeral event moments (ticket holders + host) */}
          <WhoAllOverThere eventId={eventId} canUpload={isHost || hasTicket} />

          {/* Ratings & Reviews */}
          {avgRating > 0 || reviews.length > 0 ? (
            <Section title="Ratings & Reviews" Icon={Star}>
              {avgRating > 0 ? (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-3xl font-extrabold">
                    {avgRating.toFixed(1)}
                  </span>
                  <div>
                    <Stars rating={avgRating} />
                    <div className="text-white/50 text-xs mt-0.5">
                      {reviewCount} review{reviewCount === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="flex flex-col gap-3">
                {reviews.slice(0, 4).map((r, i) => (
                  <div key={i} className="flex gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.avatar || r.user?.avatar}
                      alt=""
                      className="w-8 h-8 rounded-xl object-cover bg-white/10 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          @{r.username || r.user?.username}
                        </span>
                        {r.rating ? <Stars rating={r.rating} size={12} /> : null}
                      </div>
                      {r.comment ? (
                        <p className="text-white/80 text-sm mt-0.5">
                          {r.comment}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {/* 4. REVIEW SUBMIT — opens the write-a-review dialog. */}
              {!isHost ? (
                <button
                  onClick={() => gateAuth(() => setReviewOpen(true))}
                  className="mt-3 inline-flex items-center gap-1.5 text-[#379ED8] text-sm font-medium"
                >
                  <Star size={14} /> Write a review
                </button>
              ) : null}
            </Section>
          ) : !isHost ? (
            // No reviews yet — still surface the write-a-review affordance.
            <Section title="Ratings & Reviews" Icon={Star}>
              <p className="text-white/50 text-sm">No reviews yet.</p>
              <button
                onClick={() => gateAuth(() => setReviewOpen(true))}
                className="mt-3 inline-flex items-center gap-1.5 text-[#379ED8] text-sm font-medium"
              >
                <Star size={14} /> Write a review
              </button>
            </Section>
          ) : null}

          {/* Comments — members-only; logged-out sees a blurred teaser. */}
          {comments.length > 0 || !isAuthenticated ? (
            <Section title="Comments" Icon={MessageCircle}>
              <MembersOnly
                locked={!isAuthenticated}
                label="Sign in to read and join the conversation."
                onSignIn={() => router.push(loginPathWithReturn(pathname))}
              >
                {comments.length > 0 ? (
                  <>
                    <div className="flex flex-col gap-3">
                      {comments.slice(0, 5).map((c, i) => (
                        <div key={i} className="flex gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={c.user?.avatar || c.avatar}
                            alt=""
                            className="w-8 h-8 rounded-xl object-cover bg-white/10 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">
                              <span className="font-semibold">
                                @{c.user?.username || c.username}
                              </span>{" "}
                              {c.content || c.text}
                            </p>
                            <span className="text-white/40 text-xs">
                              {timeAgo(c.created_at || c.createdAt)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() =>
                        router.push(`/feed/events/${eventId}/comments`)
                      }
                      className="text-[#379ED8] text-sm font-medium mt-3"
                    >
                      View all comments
                    </button>
                  </>
                ) : (
                  <TeaserRows kind="comment" />
                )}
              </MembersOnly>
            </Section>
          ) : null}

          {/* Weather forecast — only when the event has coordinates */}
          {e.locationLat != null && e.locationLng != null ? (
            <Section title="Weather" Icon={CloudSun}>
              <WeatherStrip lat={e.locationLat} lng={e.locationLng} />
            </Section>
          ) : null}

          {/* Location / map */}
          {e.locationName || e.locationAddress || mapsHref ? (
            <Section title="Location" Icon={MapPin}>
              {e.locationName ? (
                <div className="font-semibold">{e.locationName}</div>
              ) : null}
              {e.locationAddress ? (
                <div className="text-white/60 text-sm">{e.locationAddress}</div>
              ) : null}
              {mapEmbed ? (
                <div className="mt-3 rounded-xl overflow-hidden aspect-video border border-white/10">
                  <iframe
                    title="Event location"
                    src={mapEmbed}
                    className="w-full h-full"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              ) : null}
              {mapsHref ? (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 text-[#379ED8] text-sm font-medium"
                >
                  Open in Maps <ExternalLink size={13} />
                </a>
              ) : null}
            </Section>
          ) : null}

          {/* Hosted by — organizer card (posh-style) */}
          <OrganizerCard eventId={eventId} />

          {/* Tags */}
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-2 mt-6">
              {tags.map((t, i) => (
                <span key={i} className="text-[#379ED8] text-sm">
                  #{t}
                </span>
              ))}
            </div>
          ) : null}

          {/* Disclaimers */}
          {e.disclaimers ? (
            <p className="text-white/35 text-xs mt-6 whitespace-pre-wrap">
              {e.disclaimers}
            </p>
          ) : null}
        </div>
      </div>

      {/* 1. CHECKOUT SHEET — select qty + promo, fire useTicketCheckout. */}
      <CheckoutSheet
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        eventId={eventId}
        eventTitle={e.title ?? "Event"}
        tier={(liveTicketTypes as TicketTypeRecord[]).find(
          (t) => String(t.id) === String(selectedTierId),
        )}
        addons={eventAddons}
        qty={ticketQty}
        setQty={setTicketQty}
        promoCode={promoCode}
        setPromoCode={setPromoCode}
        isCheckingOut={isCheckingOut}
        onCheckout={async () => {
          const tier = (liveTicketTypes as TicketTypeRecord[]).find(
            (t) => String(t.id) === String(selectedTierId),
          );
          if (!tier) {
            showToast(
              "error",
              "Pick a tier",
              "Select a ticket tier to continue.",
            );
            return;
          }

          // Add-ons selected → the MIXED-CART rail (cart store →
          // cart-create-hold → cart_create_hold RPC holds tier + add-on
          // inventory atomically; cart-checkout prices server-side). The
          // single-tier fast path below stays untouched when no add-ons.
          const upsell = useAddonUpsellStore.getState();
          const selections =
            upsell.eventId === eventId ? upsell.selectionList() : [];
          if (selections.length > 0) {
            const cartStore = useCartStore.getState();
            cartStore.startCart(eventId);
            cartStore.addLineItem(eventId, {
              category: "admission",
              tierId: String(tier.id),
              quantity: ticketQty,
              unitPriceCents: tier.price_cents,
              metadata: {
                tierName: tier.name,
                eventTitle: e.title ?? "Event",
              },
            });
            for (const sel of selections) {
              const addon = eventAddons.find((a) => a.id === sel.addonId);
              if (!addon) continue;
              const variant = sel.variantId
                ? addon.ticket_addon_variants?.find(
                    (v) => v.id === sel.variantId,
                  )
                : null;
              cartStore.addLineItem(eventId, {
                category: "addon",
                // DTO back-compat: addon id rides tierId on addon lines.
                tierId: sel.addonId,
                addonId: sel.addonId,
                variantId: sel.variantId ?? undefined,
                quantity: sel.quantity,
                unitPriceCents: effectiveAddonUnitPriceCents(
                  addon.price_cents,
                  variant?.price_cents,
                ),
                metadata: {
                  name: variant
                    ? `${addon.name} — ${variant.name}`
                    : addon.name,
                  eventTitle: e.title ?? "Event",
                },
              });
            }
            resetAddonSelections();
            setCheckoutOpen(false);
            // Promo codes re-apply on the review screen (cart-checkout
            // validates them server-side there).
            router.push("/feed/checkout/review");
            return;
          }

          const result = await checkout({
            eventId,
            ticketTypeId: String(tier.id),
            quantity: ticketQty,
            ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
          });
          if (result.error) {
            if (result.error !== "Payment cancelled") {
              showToast("error", "Checkout failed", result.error);
            }
            return;
          }
          // Free ticket issued server-side — mirror into the ticket store.
          if (result.free && result.tickets?.length) {
            const t0 = result.tickets[0];
            setTicket(eventId, {
              id: t0.id,
              eventId,
              userId,
              paid: false,
              status: "valid",
              qrToken: t0.qr_token,
              tierName: tier.name,
              eventTitle: e.title,
            });
          }
          setCheckoutOpen(false);
          setPromoCode("");
          showToast(
            "success",
            result.free ? "Confirmed" : "Ticket purchased",
            `You're going to ${e.title}!`,
          );
        }}
      />

      {/* 4. UPGRADE CONFIRM — confirm then fire useInitiateUpgrade. */}
      <Dialog
        open={!!upgradeTierId}
        onClose={() => {
          if (!isUpgradePending) setUpgradeTierId(null);
        }}
        title="Upgrade ticket"
        footer={
          <>
            <button
              disabled={isUpgradePending}
              onClick={() => setUpgradeTierId(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isUpgradePending}
              onClick={() => {
                if (!myTicketData || !upgradeTierId) return;
                initiateUpgrade(
                  {
                    ticketId: myTicketData.id,
                    newTicketTypeId: upgradeTierId,
                  },
                  {
                    onSuccess: () => {
                      setUpgradeTierId(null);
                      showToast(
                        "info",
                        "Continue in browser",
                        "Finish your upgrade in the checkout that just opened.",
                      );
                    },
                    onError: (err: any) =>
                      showToast(
                        "error",
                        "Upgrade failed",
                        err?.message || "Try again in a moment.",
                      ),
                  },
                );
              }}
              className="flex-1 rounded-xl bg-linear-to-r from-[#379ED8] to-[#874E9F] py-3 font-semibold text-white disabled:opacity-50"
            >
              {isUpgradePending ? "Working…" : "Upgrade"}
            </button>
          </>
        }
      >
        {(() => {
          const opt = upgradeOptions.find(
            (o) => String(o.tier.id) === String(upgradeTierId),
          );
          return (
            <p className="text-sm leading-5 text-white/60">
              {opt
                ? `Upgrade to ${opt.tier.name} for an extra $${(opt.diffCents / 100).toFixed(0)}. You'll complete payment in a secure checkout.`
                : "Upgrade your ticket to a higher tier."}
            </p>
          );
        })()}
      </Dialog>

      {/* 4(b). WRITE A REVIEW — star picker + text → useCreateEventReview. */}
      <Dialog
        open={reviewOpen}
        onClose={() => {
          if (!createReview.isPending) setReviewOpen(false);
        }}
        title="Write a review"
        footer={
          <>
            <button
              disabled={createReview.isPending}
              onClick={() => setReviewOpen(false)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={createReview.isPending}
              onClick={handleSubmitReview}
              className="flex-1 rounded-xl bg-linear-to-r from-[#379ED8] to-[#874E9F] py-3 font-semibold text-white disabled:opacity-50"
            >
              {createReview.isPending ? "Posting…" : "Post review"}
            </button>
          </>
        }
      >
        <div className="flex items-center gap-1 mb-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setReviewRating(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
            >
              <Star
                size={28}
                color="#F5C518"
                fill={n <= reviewRating ? "#F5C518" : "transparent"}
              />
            </button>
          ))}
        </div>
        <textarea
          value={reviewText}
          onChange={(ev) => setReviewText(ev.target.value)}
          placeholder="Share how the event went…"
          rows={4}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#379ED8]"
        />
      </Dialog>

      {/* WS-9 — Cancel (destructive, auto-refund) confirm. */}
      <Dialog
        open={hostAction === "cancel"}
        onClose={() => {
          if (!hostActionBusy) setHostAction(null);
        }}
        title="Cancel event?"
        footer={
          <>
            <button
              disabled={hostActionBusy}
              onClick={() => setHostAction(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white disabled:opacity-50"
            >
              Keep event
            </button>
            <button
              disabled={hostActionBusy}
              onClick={handleCancel}
              className="flex-1 rounded-xl bg-[#FC253A] py-3 font-semibold text-white disabled:opacity-50"
            >
              {hostActionBusy ? "Refunding…" : "Cancel & Refund"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          Every paid order is automatically refunded (the whole payment,
          including fees) and every attendee is notified. Guest buyers get an
          email. This can&apos;t be undone.
        </p>
      </Dialog>

      {/* WS-9 — Postpone (reversible, no refunds) confirm. */}
      <Dialog
        open={hostAction === "postpone"}
        onClose={() => {
          if (!hostActionBusy) setHostAction(null);
        }}
        title="Postpone event?"
        footer={
          <>
            <button
              disabled={hostActionBusy}
              onClick={() => setHostAction(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white disabled:opacity-50"
            >
              Not now
            </button>
            <button
              disabled={hostActionBusy}
              onClick={handlePostpone}
              className="flex-1 rounded-xl bg-[#F5C518] py-3 font-semibold text-black disabled:opacity-50"
            >
              {hostActionBusy ? "Working…" : "Postpone"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          Attendees are notified that the event is postponed. Tickets remain
          valid — no refunds are issued. You can resume any time.
        </p>
      </Dialog>

      {/* WS-9 — Resume a postponed event. */}
      <Dialog
        open={hostAction === "resume"}
        onClose={() => {
          if (!hostActionBusy) setHostAction(null);
        }}
        title="Resume event?"
        footer={
          <>
            <button
              disabled={hostActionBusy}
              onClick={() => setHostAction(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white disabled:opacity-50"
            >
              Not now
            </button>
            <button
              disabled={hostActionBusy}
              onClick={handleResume}
              className="flex-1 rounded-xl bg-linear-to-r from-[#379ED8] to-[#874E9F] py-3 font-semibold text-white disabled:opacity-50"
            >
              {hostActionBusy ? "Working…" : "Resume"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          The event goes back to active and attendees are notified their tickets
          are valid as issued.
        </p>
      </Dialog>

      {/* WS-9 — Delete (blocked server-side once tickets exist). */}
      <Dialog
        open={hostAction === "delete"}
        onClose={() => {
          if (!hostActionBusy) setHostAction(null);
        }}
        title="Delete event?"
        footer={
          <>
            <button
              disabled={hostActionBusy}
              onClick={() => setHostAction(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white disabled:opacity-50"
            >
              Keep event
            </button>
            <button
              disabled={hostActionBusy}
              onClick={handleDelete}
              className="flex-1 rounded-xl bg-[#FC253A] py-3 font-semibold text-white disabled:opacity-50"
            >
              {hostActionBusy ? "Deleting…" : "Delete"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          This permanently removes the event. Events with paid tickets can&apos;t
          be deleted — cancel instead, which refunds every attendee.
        </p>
      </Dialog>

      {/* WS-9 — Delete blocked (paid tickets) → route the host to Cancel. */}
      <Dialog
        open={hostAction === "delete_blocked"}
        onClose={() => {
          if (!hostActionBusy) setHostAction(null);
        }}
        title="Can't delete — tickets sold"
        footer={
          <>
            <button
              disabled={hostActionBusy}
              onClick={() => setHostAction(null)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white disabled:opacity-50"
            >
              Keep event
            </button>
            <button
              disabled={hostActionBusy}
              onClick={() => setHostAction("cancel")}
              className="flex-1 rounded-xl bg-[#FC253A] py-3 font-semibold text-white disabled:opacity-50"
            >
              Cancel &amp; Refund…
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          This event has active tickets. Cancel the event instead — every paid
          order is refunded and attendees are notified.
        </p>
      </Dialog>

      <Lightbox />
      <GuestRsvpSheet />
      <GuestCheckoutSheet />
      {/* B3: age-gate interstitial (Didit hosted capture). */}
      <VerificationInterstitial
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        status={verificationStatus}
        ageLabel={(event as any)?.ageRestriction || "18+"}
      />
    </div>
  );
}

export default EventDetailScreen;

/**
 * CheckoutSheet — draggable BottomSheet (centered, max-w-3xl, snap-open /
 * drag-to-dismiss) that collects quantity + promo code and fires the real
 * useTicketCheckout flow via onCheckout. Mirrors native's checkout sheet.
 */
function CheckoutSheet({
  open,
  onClose,
  eventId,
  eventTitle,
  tier,
  addons,
  qty,
  setQty,
  promoCode,
  setPromoCode,
  isCheckingOut,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  tier: TicketTypeRecord | undefined;
  addons: AddonRecord[];
  qty: number;
  setQty: (q: number) => void;
  promoCode: string;
  setPromoCode: (c: string) => void;
  isCheckingOut: boolean;
  onCheckout: () => void;
}) {
  const maxPer = tier?.max_per_user ?? 6;
  const subtotalCents = (tier?.price_cents ?? 0) * qty;

  // Add-on upsell selections (WS-3) — preview math only; server reprices.
  const upsellSelections = useAddonUpsellStore((s) =>
    s.eventId === eventId ? s.selections : undefined,
  );
  const selectionList = upsellSelections ? Object.values(upsellSelections) : [];
  const addonPreviewCents = addonSelectionsTotalCents(addons, selectionList);
  const hasAddonSelections = selectionList.length > 0;

  const appliedPromo = useEventDetailUiStore((s) => s.appliedPromo);
  const setAppliedPromo = useEventDetailUiStore((s) => s.setAppliedPromo);
  const promoError = useEventDetailUiStore((s) => s.promoError);
  const setPromoError = useEventDetailUiStore((s) => s.setPromoError);
  const promoApplying = useEventDetailUiStore((s) => s.promoApplying);
  const setPromoApplying = useEventDetailUiStore((s) => s.setPromoApplying);

  // Drop a validated promo once the buyer edits the code away from it.
  useEffect(() => {
    if (
      appliedPromo &&
      promoCode.trim().toUpperCase() !== appliedPromo.code.toUpperCase()
    ) {
      setAppliedPromo(null);
      setPromoError(null);
    }
  }, [promoCode, appliedPromo, setAppliedPromo, setPromoError]);

  // Discount is recomputed from the validated promo + current qty (BOGO depends
  // on qty). Server re-validates at charge — this is the buyer-facing preview.
  const discountCents = appliedPromo
    ? computePromoDiscountCents(appliedPromo.type, appliedPromo.value, subtotalCents, qty)
    : 0;
  const totalCents = Math.max(0, subtotalCents - discountCents) + addonPreviewCents;
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;

  const applyPromo = async () => {
    const code = promoCode.trim();
    if (!code) {
      setPromoError("Enter a promo code.");
      return;
    }
    if (!tier) return;
    setPromoApplying(true);
    setPromoError(null);
    const { data, error } = await invokeEdge<{
      valid: boolean;
      discount_type?: "percent" | "fixed_cents" | "bogo";
      discount_value?: number;
      code?: string;
      error?: string;
    }>("validate-promo-code", {
      event_id: Number(eventId),
      code,
      ticket_type_id: tier.id,
    });
    setPromoApplying(false);
    if (error || !data?.valid || !data.discount_type) {
      setAppliedPromo(null);
      setPromoError(data?.error || error?.message || "Invalid promo code.");
      return;
    }
    setAppliedPromo({
      type: data.discount_type,
      value: data.discount_value ?? 0,
      code: data.code || code,
    });
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Checkout">
      <div className="flex flex-col gap-4">
        <div>
          <div className="font-bold">{tier?.name ?? "Ticket"}</div>
          <div className="text-white/50 text-sm">{eventTitle}</div>
        </div>

        {/* Quantity stepper */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/70">Quantity</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQty(Math.max(1, qty - 1))}
              disabled={qty <= 1}
              aria-label="Decrease quantity"
              className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center disabled:opacity-40"
            >
              <Minus size={16} color="#fff" />
            </button>
            <span className="w-6 text-center font-semibold">{qty}</span>
            <button
              onClick={() => setQty(Math.min(maxPer, qty + 1))}
              disabled={qty >= maxPer}
              aria-label="Increase quantity"
              className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center disabled:opacity-40"
            >
              <Plus size={16} color="#fff" />
            </button>
          </div>
        </div>

        {/* Promo code + apply */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              value={promoCode}
              onChange={(ev) => setPromoCode(ev.target.value)}
              placeholder="Promo code (optional)"
              autoCapitalize="characters"
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#379ED8]"
            />
            <button
              type="button"
              onClick={applyPromo}
              disabled={promoApplying || !tier || !promoCode.trim()}
              className="h-11 shrink-0 rounded-xl border border-[#379ED8]/40 bg-[#379ED8]/10 px-4 text-sm font-semibold text-[#379ED8] disabled:opacity-40"
            >
              {promoApplying ? "…" : appliedPromo ? "Applied" : "Apply"}
            </button>
          </div>
          {promoError ? (
            <p className="text-sm text-[#FC253A]">{promoError}</p>
          ) : appliedPromo ? (
            <p className="flex items-center gap-1 text-sm text-[#379ED8]">
              <Check size={14} color="#379ED8" />
              {promoLabel(appliedPromo.type, appliedPromo.value)} applied
            </p>
          ) : null}
        </div>

        {/* Add-on upsell (WS-3) — eligibility gated by the selected tier;
            selections become cart line items on the mixed-cart rail. */}
        {tier ? (
          <AddonUpsellStrip
            eventId={eventId}
            addons={addons}
            selectedTierIds={new Set([String(tier.id)])}
          />
        ) : null}

        {/* Price breakdown */}
        <div className="flex flex-col gap-1.5 border-t border-white/10 pt-3">
          {addonPreviewCents > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/55">Add-ons</span>
              <span className="font-mono text-sm text-white/80">
                {money(addonPreviewCents)}
              </span>
            </div>
          ) : null}
          {discountCents > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/55">Subtotal</span>
                <span className="text-sm text-white/80">{money(subtotalCents)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#379ED8]">
                  {promoLabel(appliedPromo!.type, appliedPromo!.value)}
                </span>
                <span className="text-sm text-[#379ED8]">−{money(discountCents)}</span>
              </div>
            </>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/70">Total</span>
            <span className="font-bold">{totalCents ? money(totalCents) : "Free"}</span>
          </div>
        </div>

        <button
          onClick={onCheckout}
          disabled={isCheckingOut || !tier}
          className="w-full h-12 rounded-xl bg-linear-to-r from-[#379ED8] to-[#874E9F] text-white font-bold disabled:opacity-50"
        >
          {isCheckingOut
            ? "Processing…"
            : hasAddonSelections
              ? `Review order · ${money(totalCents)}`
              : totalCents
                ? `Pay ${money(totalCents)}`
                : "Confirm RSVP"}
        </button>
      </div>
    </BottomSheet>
  );
}

/**
 * MembersOnly — gates members-only content (comments, attendee list). When
 * `locked`, the real children are blurred + made non-interactive and a sign-in
 * prompt overlays them, so logged-out visitors see that there's something there
 * without reading it. When unlocked, children render normally.
 */
function MembersOnly({
  locked,
  label,
  onSignIn,
  children,
}: {
  locked: boolean;
  label: string;
  onSignIn: () => void;
  children: React.ReactNode;
}) {
  if (!locked) return <>{children}</>;
  return (
    // min-height guarantees room for the prompt so the overlay is never clipped
    // by the (often short) blurred teaser underneath.
    <div className="relative min-h-[168px] overflow-hidden rounded-xl">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 select-none blur-[3px] opacity-60"
      >
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#02030A]/35 px-4 text-center">
        <Lock size={18} color="#379ED8" />
        <p className="max-w-[260px] text-sm font-medium text-white/85">{label}</p>
        <button
          onClick={onSignIn}
          className="mt-1 rounded-lg bg-linear-to-r from-[#379ED8] to-[#874E9F] px-4 py-2 text-sm font-semibold text-white"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

/** Faint placeholder rows so the blurred teaser has body when the logged-out
 *  payload carries no real comments/attendees to obscure. */
function TeaserRows({ kind }: { kind: "comment" | "avatar" }) {
  if (kind === "avatar") {
    return (
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-8 w-8 rounded-xl bg-white/10 ring-2 ring-[#02030A]"
            />
          ))}
        </div>
        <span className="text-sm text-white/60">Several people going</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {[36, 28, 32].map((w, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-8 w-8 shrink-0 rounded-xl bg-white/10" />
          <div className="flex-1">
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="mt-1.5 h-3 rounded bg-white/[0.07]" style={{ width: `${w}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MenuItem({
  Icon,
  label,
  onClick,
  destructive = false,
}: {
  Icon: typeof Share2;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-white/5 ${
        destructive ? "text-[#FC253A]" : "text-white"
      }`}
    >
      <Icon size={16} color={destructive ? "#FC253A" : "#fff"} />
      {label}
    </button>
  );
}
