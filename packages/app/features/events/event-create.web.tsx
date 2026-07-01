/**
 * Create Event — WEB (@dvnt/app/features/events/event-create).
 *
 * The web layout of the UNIFIED create flow (PROMPT 20): a multi-section
 * organizer form with a sticky live-preview, sharing ONE schema with the mobile
 * wizard. Field metadata, validation and the publish payload come from the
 * shared core (features/events/create/event-form) so the two platforms never
 * diverge. State is the shared persisted draft store (useCreateEventStore).
 *
 * This rebuild closes the parity + correctness gaps the audit found
 * (docs/event-creation-audit.md): real CDN upload (was a dead blob: URL),
 * ticket-type creation for paid events (was none), Stripe + $2 guards, and the
 * full set of fields the mobile wizard captures (type, age, spicy, dress code,
 * door policy, lineup, perks, tags, YouTube, disclaimers).
 *
 * Known web follow-ups (present on mobile, queued next): multi-tier ticket
 * editor and co-organizer search. Single-tier ticketing is fully wired here.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "solito/navigation";
import {
  Calendar,
  MapPin,
  Globe,
  ImagePlus,
  X,
  ChevronDown,
  Plus,
  Trash2,
  Search,
} from "lucide-react";
import { VenueSearchInput } from "@dvnt/ui";
import { useCreateEventStore } from "@dvnt/app/lib/stores/create-event-store";
import { useCreateEvent } from "@dvnt/app/lib/hooks/use-events";
import { usePlacesAutocomplete } from "@dvnt/app/lib/hooks/use-places-autocomplete";
import type { PlacesLocationData } from "@dvnt/app/lib/places/types";
import { ticketTypesApi } from "@dvnt/app/lib/api/ticket-types";
import { organizerApi } from "@dvnt/app/lib/api/organizer";
import { uploadToServer } from "@dvnt/app/lib/server-upload";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { eventsApi } from "@dvnt/app/lib/api/events";
import {
  EVENT_TYPE_OPTIONS,
  SUGGESTED_TAGS,
  validateEventDraft,
  buildEventInsert,
  hasPaidTier,
  type EventFormErrors,
} from "@dvnt/app/features/events/create/event-form";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-white/55">
          {title}
        </h2>
        {subtitle ? (
          <p className="text-xs text-white/40 mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

const inputCls =
  "w-full bg-white/[0.05] border border-white/12 rounded-xl px-3 h-11 text-[15px] text-white placeholder:text-white/40 outline-none focus:border-[#3FDCFF]/60";
const labelCls = "text-xs text-white/55";
const errCls = "text-xs text-[#FF6B81] mt-1";

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className={labelCls}>
        {label}
        {required ? <span className="text-[#3FDCFF]"> *</span> : null}
      </label>
      {children}
      {error ? <span className={errCls}>{error}</span> : null}
    </div>
  );
}

export function CreateEventScreen() {
  const router = useRouter();
  const s = useCreateEventStore();
  const createEvent = useCreateEvent();
  const showToast = useUIStore((st) => st.showToast);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const places = usePlacesAutocomplete({
    value: s.location,
    onLocationSelect: (location: PlacesLocationData) => {
      s.setLocation(location.name);
      s.setLocationData({
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        placeId: location.placeId,
        address: location.formattedAddress,
      });
    },
  });

  const validation = validateEventDraft(s);
  const errors: EventFormErrors = attempted ? validation.errors : {};

  const publish = async () => {
    setAttempted(true);
    const { ok, errors: errs } = validateEventDraft(s);
    if (!ok) {
      const first =
        errs.title || errs.eventType || errs.date || errs.location || errs.price || errs.terms;
      showToast("error", "Almost there", first || "Check the highlighted fields.");
      return;
    }
    if (busy || createEvent.isPending) return;

    // Paid events need a connected Stripe payout account (same gate as mobile).
    if (hasPaidTier(s)) {
      try {
        const status = await organizerApi.getStatus();
        const ready =
          status.connected &&
          status.charges_enabled === true &&
          status.payouts_enabled === true;
        if (!ready) {
          showToast(
            "error",
            "Connect payouts first",
            "Paid events need a Stripe payout account so you can get paid.",
          );
          router.push("/feed/events/organizer-setup");
          return;
        }
      } catch {
        showToast(
          "error",
          "Couldn't verify payouts",
          "We couldn't confirm your Stripe status. Please try again.",
        );
        return;
      }
    }

    setBusy(true);
    const slug = slugifyTitle(s.title);
    try {
      // Upload the cover to the CDN. The draft holds a blob:/data: URL from the
      // file picker — fetchable in-session — which uploadToServer turns into a
      // real media-upload URL. (Previously the blob URL was sent verbatim and
      // never resolved server-side.) Already-http URLs pass through untouched.
      // Upload the primary flyer slot (image OR video). Already-hosted
      // URLs pass through; blob:/data:/file: URLs are uploaded fresh.
      const uploadIfLocal = async (url: string | null | undefined) => {
        if (!url) return undefined;
        if (!/^(blob:|data:|file:)/i.test(url)) return url;
        const up = await uploadToServer(url, "events");
        if (!up.success || !up.url) {
          throw new Error(
            up.error || "Couldn't upload an image. Re-select it and try again.",
          );
        }
        return up.url;
      };

      const primaryUrl = await uploadIfLocal(s.flyerImage);
      // Fallback (poster) image: present when the primary is a video AND
      // the user uploaded a separate still. Stored in flyerFallbackImage.
      const posterUrl = await uploadIfLocal(s.flyerFallbackImage);

      // Map the two-slot store into the persistence fields. Video flyer
      // wins for display; the still flyer IS the poster for static
      // contexts (wallet pass, OG, .ics) — single column, no
      // separate poster.
      const isVideoPrimary = s.flyerMediaType === "video" && !!primaryUrl;
      const videoFlyerUrl = isVideoPrimary ? primaryUrl : undefined;
      const flyerImageUrl = isVideoPrimary ? posterUrl ?? undefined : primaryUrl;
      const image = flyerImageUrl ?? primaryUrl;

      // Secondary gallery (`eventImages`). Upload any locally-picked blobs;
      // pass already-uploaded URLs through. A single failed image fails the
      // publish — silently dropping an image the user explicitly added is
      // worse than asking them to retry.
      const galleryUrls: string[] = [];
      for (const url of s.eventImages) {
        if (/^(blob:|data:|file:)/i.test(url)) {
          const up = await uploadToServer(url, "events");
          if (!up.success || !up.url) {
            throw new Error(
              up.error || "Couldn't upload an additional image. Re-select it and try again.",
            );
          }
          galleryUrls.push(up.url);
        } else {
          galleryUrls.push(url);
        }
      }

      const payload = buildEventInsert(s, {
        image,
        flyerImageUrl,
        videoFlyerUrl,
        images: galleryUrls.map((url) => ({ type: "image", url })),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await createEvent.mutateAsync(payload as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const id = (created as any)?.id;

      // Create ticket types so the event is actually purchasable/RSVP-able.
      // Multi-tier branch wins when the user added explicit tiers;
      // otherwise we keep the single-price-into-one-tier fallback so a
      // user who never opened the tier editor still publishes correctly.
      if (s.ticketingEnabled && id) {
        if (s.ticketTiers.length > 0) {
          // Best-effort sequential creation — failing one tier shouldn't
          // silently swallow the rest, so any error propagates to the
          // catch below and the user is told to retry.
          for (const tier of s.ticketTiers) {
            await ticketTypesApi.create({
              eventId: String(id),
              name: tier.name || "General Admission",
              priceCents: tier.priceCents,
              quantityTotal: tier.quantity > 0 ? tier.quantity : 0,
              maxPerUser:
                tier.maxPerUser > 0 ? tier.maxPerUser : s.simpleMaxPerUser,
            });
          }
        } else {
          const priceCents = Math.round((parseFloat(s.ticketPrice) || 0) * 100);
          const qty = s.maxAttendees ? parseInt(s.maxAttendees, 10) : 200;
          await ticketTypesApi.create({
            eventId: String(id),
            name: priceCents === 0 ? "Free" : "General Admission",
            priceCents,
            quantityTotal: qty,
            maxPerUser: s.simpleMaxPerUser > 0 ? s.simpleMaxPerUser : 4,
          });
        }
      }

      // Invite each co-organizer. Failure to invite one shouldn't roll back
      // the event — the organizer can retry from the dashboard — so we log
      // and toast a soft warning instead of throwing.
      if (id && s.coOrganizers.length > 0) {
        const failed: string[] = [];
        for (const co of s.coOrganizers) {
          try {
            await eventsApi.addCoOrganizer(String(id), co.username, "editor");
          } catch (err) {
            console.warn("[create-event] addCoOrganizer failed", co.username, err);
            failed.push(co.username);
          }
        }
        if (failed.length > 0) {
          showToast(
            "warning",
            "Some co-organizers weren't invited",
            `Retry from the event dashboard: ${failed.map((u) => "@" + u).join(", ")}.`,
          );
        }
      }

      s.resetDraft();
      showToast("success", "Published", "Your event is live.");
      router.push(id ? `/events/${slug || id}` : "/events");
    } catch (e) {
      showToast(
        "error",
        "Couldn't publish",
        e instanceof Error ? e.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  // Two-slot flyer model. The video slot is the priority — when both are
  // present, video plays and the image is the still-fallback (poster).
  // Uploading a video AFTER an image promotes it to primary automatically;
  // the previously-picked image stays as the fallback. Uploading an image
  // when a video is already set lands it in the fallback slot. Uploading an
  // image when there's no video makes it the primary.
  const onVideoFlyerPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) return;
    // If an image had been picked as primary, demote it to the fallback
    // slot so the user doesn't lose it.
    if (s.flyerImage && s.flyerMediaType === "image" && !s.flyerFallbackImage) {
      s.setFlyerFallbackImage(s.flyerImage);
    }
    s.setFlyerImage(URL.createObjectURL(file));
    s.setFlyerMediaType("video");
    e.currentTarget.value = "";
  };

  const onImageFlyerPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    if (s.flyerMediaType === "video" && s.flyerImage) {
      // Video is in the primary slot — this image becomes the fallback.
      s.setFlyerFallbackImage(url);
    } else {
      // No video present — image takes the primary slot.
      s.setFlyerImage(url);
      s.setFlyerMediaType("image");
    }
    e.currentTarget.value = "";
  };

  const isVideo = s.flyerMediaType === "video";
  const publishing = busy || createEvent.isPending;

  return (
    <div className="min-h-[100dvh] bg-[#02030A] text-white">
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-28">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold">Create event</h1>
          <button
            onClick={publish}
            disabled={publishing}
            className="h-10 px-5 rounded-full bg-linear-to-r from-[#3FDCFF] to-[#8A40CF] text-white font-bold disabled:opacity-40"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
        <p className="text-sm text-white/40 mt-1">
          Title, type, date and a location are all you need to publish — the rest
          is optional.
        </p>

        <div className="grid lg:grid-cols-[1fr_380px] gap-5 mt-5 items-start">
          {/* ── Form ── */}
          <div className="flex flex-col gap-4">
            <Section title="Basics">
              <Field label="Event title" required error={errors.title}>
                <input
                  className={inputCls}
                  placeholder="What's the event called?"
                  value={s.title}
                  onChange={(e) => s.setTitle(e.target.value)}
                />
              </Field>
              <Field label="Event type" required error={errors.eventType}>
                <div className="relative">
                  <select
                    className={`${inputCls} appearance-none pr-9`}
                    value={s.eventType ?? ""}
                    onChange={(e) =>
                      s.setEventType((e.target.value || null) as typeof s.eventType)
                    }
                  >
                    <option value="" disabled>
                      Choose a type…
                    </option>
                    {EVENT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} className="bg-[#02030A]">
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/40"
                  />
                </div>
              </Field>
              <Field label="Description">
                <textarea
                  className={`${inputCls} h-28 py-2.5 resize-none`}
                  placeholder="Describe your event…"
                  maxLength={2000}
                  value={s.description}
                  onChange={(e) => s.setDescription(e.target.value)}
                />
              </Field>
            </Section>

            <Section title="When & Where">
              <Field label="Starts" required error={errors.date}>
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={toLocalInput(s.eventDate)}
                  onChange={(e) => s.setEventDate(fromLocalInput(e.target.value))}
                />
              </Field>
              <Field label="Ends (optional)">
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={toLocalInput(s.endDate)}
                  onChange={(e) =>
                    s.setEndDate(e.target.value ? fromLocalInput(e.target.value) : null)
                  }
                />
              </Field>
              <label className="flex items-center gap-2 mt-1 text-sm text-white/75">
                <input
                  type="checkbox"
                  checked={s.isOnline}
                  onChange={(e) => s.setIsOnline(e.target.checked)}
                />
                Online event
              </label>
              {!s.isOnline ? (
                <Field label="Venue / address" required error={errors.location}>
                  <VenueSearchInput
                    value={places.input}
                    placeholder="Search a venue or address"
                    predictions={places.predictions}
                    isLoading={places.isLoading}
                    isSelecting={places.isSelecting}
                    error={places.error}
                    showDropdown={places.showDropdown}
                    onFocus={() => places.setShowDropdown(true)}
                    onChangeText={(text) => {
                      places.setInput(text);
                      s.setLocation(text);
                      if (!text.trim()) s.setLocationData(null);
                    }}
                    onSelectPrediction={places.selectPrediction}
                    onClear={() => {
                      places.clear();
                      s.setLocation("");
                      s.setLocationData(null);
                    }}
                  />
                </Field>
              ) : null}
            </Section>

            <Section title="Media">
              {/* Two flyer slots: video is priority. When both are filled,
                  the video plays and the image is the still-fallback /
                  poster. When only one is filled, that one is the flyer. */}
              <div className="grid grid-cols-2 gap-3">
                {/* Video flyer (priority). */}
                <div className="flex flex-col gap-1.5">
                  <span className={labelCls}>Video flyer (priority)</span>
                  <label className="relative flex h-40 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed border-white/20 bg-white/[0.03] text-white/55">
                    {isVideo && s.flyerImage ? (
                      <video
                        src={s.flyerImage}
                        className="absolute inset-0 h-full w-full object-cover"
                        muted
                        playsInline
                      />
                    ) : (
                      <>
                        <ImagePlus size={22} />
                        <span className="text-xs">Upload .mp4 / .mov</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={onVideoFlyerPick}
                    />
                  </label>
                  {isVideo && s.flyerImage ? (
                    <button
                      type="button"
                      onClick={() => {
                        // Promote the fallback (if any) into the primary
                        // slot when the video is removed — user keeps any
                        // still they uploaded.
                        if (s.flyerFallbackImage) {
                          s.setFlyerImage(s.flyerFallbackImage);
                          s.setFlyerMediaType("image");
                          s.setFlyerFallbackImage(null);
                        } else {
                          s.setFlyerImage(null);
                          s.setFlyerMediaType("image");
                        }
                      }}
                      className="self-start text-xs text-white/50 flex items-center gap-1"
                    >
                      <X size={12} /> Remove video
                    </button>
                  ) : null}
                </div>

                {/* Image flyer (primary fallback). */}
                <div className="flex flex-col gap-1.5">
                  <span className={labelCls}>Flyer image</span>
                  <label className="relative flex h-40 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed border-white/20 bg-white/[0.03] text-white/55">
                    {(() => {
                      const url = isVideo ? s.flyerFallbackImage : s.flyerImage;
                      return url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <>
                          <ImagePlus size={22} />
                          <span className="text-xs">Upload image</span>
                        </>
                      );
                    })()}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={onImageFlyerPick}
                    />
                  </label>
                  {(isVideo ? s.flyerFallbackImage : s.flyerImage) ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (isVideo) {
                          s.setFlyerFallbackImage(null);
                        } else {
                          s.setFlyerImage(null);
                        }
                      }}
                      className="self-start text-xs text-white/50 flex items-center gap-1"
                    >
                      <X size={12} /> Remove image
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Secondary image gallery. Mirrors mobile's `eventImages[]`.
                  Selecting files immediately previews via blob URLs; the
                  publish flow uploads each blob to the CDN. */}
              <Field label="Additional images (optional)">
                <div className="flex flex-wrap gap-2">
                  {s.eventImages.map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      className="relative h-20 w-20 overflow-hidden rounded-xl bg-white/5"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          s.setEventImages(s.eventImages.filter((_, i) => i !== idx))
                        }
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                        aria-label="Remove image"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.03] text-white/55 hover:bg-white/[0.06]">
                    <Plus size={18} />
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        const urls = Array.from(files).map((f) =>
                          URL.createObjectURL(f),
                        );
                        s.setEventImages([...s.eventImages, ...urls]);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              </Field>

              <Field label="YouTube video (optional)">
                <input
                  className={inputCls}
                  placeholder="https://youtube.com/watch?v=…"
                  value={s.youtubeUrl}
                  onChange={(e) => s.setYoutubeUrl(e.target.value)}
                />
              </Field>
            </Section>

            <Section
              title="Tickets"
              subtitle="Leave off for a free RSVP event."
            >
              <label className="flex items-center gap-2 text-sm text-white/75">
                <input
                  type="checkbox"
                  checked={s.ticketingEnabled}
                  onChange={(e) => s.setTicketingEnabled(e.target.checked)}
                />
                Sell tickets
              </label>
              {s.ticketingEnabled ? (
                <>
                  {s.ticketTiers.length === 0 ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Price (USD)" error={errors.price}>
                          <input
                            className={inputCls}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={s.ticketPrice}
                            onChange={(e) => s.setTicketPrice(e.target.value)}
                          />
                        </Field>
                        <Field label="Capacity">
                          <input
                            className={inputCls}
                            inputMode="numeric"
                            placeholder="Unlimited"
                            value={s.maxAttendees}
                            onChange={(e) => s.setMaxAttendees(e.target.value)}
                          />
                        </Field>
                      </div>
                      <p className="text-xs text-white/40">
                        Paid tickets must be at least $2.00.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          // Seed the array with one tier carrying the
                          // current single-tier values; users keep their
                          // typed price/capacity instead of losing it.
                          const priceCents = Math.round(
                            (parseFloat(s.ticketPrice) || 0) * 100,
                          );
                          const quantity =
                            parseInt(s.maxAttendees, 10) > 0
                              ? parseInt(s.maxAttendees, 10)
                              : 0;
                          s.setTicketTiers([
                            {
                              id: `tier-${Date.now()}`,
                              name: "General Admission",
                              category: "admission",
                              priceCents,
                              quantity,
                              maxPerUser: s.simpleMaxPerUser,
                              description: "",
                              saleStart: "",
                              saleEnd: "",
                            },
                          ]);
                        }}
                        className="self-start text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                      >
                        + Switch to multiple tiers
                      </button>
                    </>
                  ) : (
                    <TicketTiersEditor />
                  )}

                  <Field label="Max tickets per person">
                    <input
                      className={inputCls}
                      inputMode="numeric"
                      placeholder="4"
                      value={String(s.simpleMaxPerUser)}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        s.setSimpleMaxPerUser(
                          Number.isFinite(n) && n > 0 ? n : 1,
                        );
                      }}
                    />
                  </Field>

                  {hasPaidTier(s) ? (
                    <label className="flex items-start gap-2 text-sm text-white/75 mt-1">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={s.agreementAccepted}
                        onChange={(e) => s.setAgreementAccepted(e.target.checked)}
                      />
                      <span>
                        I accept the ticketing agreement (2.5% + $1/ticket per
                        side; payouts release after the event).
                        {errors.terms ? (
                          <span className={`block ${errCls}`}>{errors.terms}</span>
                        ) : null}
                      </span>
                    </label>
                  ) : null}
                </>
              ) : null}
            </Section>

            <Section title="Visibility & audience">
              <Field label="Who can see this">
                <div className="flex gap-2">
                  {(["public", "private", "link_only"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => s.setVisibility(v)}
                      className={`flex-1 h-9 rounded-xl text-sm font-medium capitalize ${
                        s.visibility === v
                          ? "bg-white text-black"
                          : "bg-white/8 text-white/70"
                      }`}
                    >
                      {v.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Age restriction">
                <div className="flex gap-2">
                  {(["none", "18+", "21+"] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => s.setAgeRestriction(a)}
                      className={`flex-1 h-9 rounded-xl text-sm font-medium ${
                        s.ageRestriction === a
                          ? "bg-white text-black"
                          : "bg-white/8 text-white/70"
                      }`}
                    >
                      {a === "none" ? "All ages" : a}
                    </button>
                  ))}
                </div>
              </Field>
              <label className="flex items-center gap-2 text-sm text-white/75">
                <input
                  type="checkbox"
                  checked={s.isNsfw}
                  onChange={(e) => s.setIsNsfw(e.target.checked)}
                />
                😈 Spicy / 18+ content
              </label>
            </Section>

            <Section
              title="Co-organizers"
              subtitle="People who can manage this event with you."
            >
              <CoOrganizersField />
            </Section>

            {/* Advanced — progressive disclosure */}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 h-12 text-sm font-semibold text-white/70"
            >
              More details (optional)
              <ChevronDown
                size={18}
                className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}
              />
            </button>
            {showAdvanced ? (
              <Section title="More details">
                <Field label="Tags">
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_TAGS.map((t) => (
                      <button
                        key={t}
                        onClick={() => s.toggleTag(t)}
                        className={`h-8 px-3 rounded-lg text-sm capitalize ${
                          s.tags.includes(t)
                            ? "bg-[#3FDCFF] text-black font-semibold"
                            : "bg-white/8 text-white/70"
                        }`}
                      >
                        #{t}
                      </button>
                    ))}
                    {s.tags
                      .filter((t) => !(SUGGESTED_TAGS as readonly string[]).includes(t))
                      .map((t) => (
                        <span
                          key={`custom-${t}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#3FDCFF] px-3 text-sm font-semibold text-black"
                        >
                          #{t}
                          <button
                            type="button"
                            onClick={() => s.toggleTag(t)}
                            aria-label={`Remove ${t}`}
                            className="text-black/70 hover:text-black"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                  </div>
                  {/* Custom tag input — mirrors mobile's `customTag`
                      field + addCustomTag(). Lowercases + dedups inside
                      the store. */}
                  <div className="mt-2 flex gap-2">
                    <input
                      className={`${inputCls} flex-1`}
                      placeholder="Add a custom tag…"
                      value={s.customTag}
                      onChange={(e) => s.setCustomTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          s.addCustomTag();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => s.addCustomTag()}
                      className="h-11 rounded-xl bg-white/8 px-4 text-sm font-semibold text-white/80 hover:bg-white/12"
                    >
                      Add
                    </button>
                  </div>
                </Field>
                <Field label="Dress code">
                  <input
                    className={inputCls}
                    placeholder="e.g. All black, cocktail…"
                    value={s.dressCode}
                    onChange={(e) => s.setDressCode(e.target.value)}
                  />
                </Field>
                <Field label="Door policy">
                  <input
                    className={inputCls}
                    placeholder="e.g. 21+ with ID, no re-entry…"
                    value={s.doorPolicy}
                    onChange={(e) => s.setDoorPolicy(e.target.value)}
                  />
                </Field>
                <ChipListField
                  label="Lineup / performers"
                  items={s.lineup}
                  value={s.lineupInput}
                  onChange={s.setLineupInput}
                  onAdd={s.addLineupItem}
                  onRemove={s.removeLineupItem}
                  placeholder="Add a performer…"
                />
                <ChipListField
                  label="Perks / what's included"
                  items={s.perks}
                  value={s.perksInput}
                  onChange={s.setPerksInput}
                  onAdd={s.addPerk}
                  onRemove={s.removePerk}
                  placeholder="Add a perk…"
                />
                <Field label="Disclaimers">
                  <textarea
                    className={`${inputCls} h-20 py-2.5 resize-none`}
                    placeholder="Anything attendees should know…"
                    maxLength={500}
                    value={s.disclaimers}
                    onChange={(e) => s.setDisclaimers(e.target.value)}
                  />
                </Field>
              </Section>
            ) : null}
          </div>

          {/* ── Live preview ── */}
          <div className="hidden lg:block sticky top-24">
            <div className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-2">
              Preview
            </div>
            <div className="relative w-full rounded-2xl overflow-hidden aspect-video bg-white/[0.04]">
              {s.flyerImage ? (
                isVideo ? (
                  <video
                    src={s.flyerImage}
                    className="absolute inset-0 w-full h-full object-cover"
                    muted
                    playsInline
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.flyerImage}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )
              ) : null}
              <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                <div className="flex items-center gap-1.5 text-[#3FDCFF] text-xs font-semibold">
                  <Calendar size={13} />
                  {s.eventDate ? niceDate(s.eventDate) : "Date TBA"}
                </div>
                <div className="text-xl font-extrabold leading-tight mt-1 line-clamp-2">
                  {s.title || "Your event title"}
                </div>
                <div className="flex items-center gap-1.5 text-white/70 text-sm mt-1">
                  {s.isOnline ? <Globe size={13} /> : <MapPin size={13} />}
                  {s.isOnline ? "Online" : s.location || "Location"}
                </div>
              </div>
            </div>
            {s.ticketingEnabled ? (
              <div className="mt-2 text-sm text-white/60">
                {parseFloat(s.ticketPrice) > 0
                  ? `$${parseFloat(s.ticketPrice).toFixed(2)} · ticketed`
                  : "Free ticket"}
              </div>
            ) : (
              <div className="mt-2 text-sm text-white/60">Free RSVP</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tag-style add/remove list (lineup, perks). Avatars/chips are rounded-rect. */
function ChipListField({
  label,
  items,
  value,
  onChange,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  items: string[];
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  placeholder: string;
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
        />
        <button
          onClick={onAdd}
          className="h-11 w-11 shrink-0 rounded-xl bg-white/8 text-white/80 flex items-center justify-center"
          aria-label={`Add to ${label}`}
        >
          <Plus size={18} />
        </button>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2 mt-1">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-lg bg-white/8 text-sm text-white/80"
            >
              {item}
              <button
                onClick={() => onRemove(i)}
                className="text-white/40 hover:text-white"
                aria-label={`Remove ${item}`}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </Field>
  );
}

export default CreateEventScreen;

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
function niceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date TBA";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function slugifyTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-");
}

// ── TicketTiersEditor ───────────────────────────────────────────────
// Per-tier name / price / quantity / per-user cap / sale window.
// Mirrors the mobile multi-tier UI; stays inside the existing Section.
function TicketTiersEditor() {
  const ticketTiers = useCreateEventStore((st) => st.ticketTiers);
  const setTicketTiers = useCreateEventStore((st) => st.setTicketTiers);
  const update = (idx: number, patch: Partial<typeof ticketTiers[number]>) =>
    setTicketTiers((cur) => cur.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  const remove = (idx: number) =>
    setTicketTiers((cur) => cur.filter((_, i) => i !== idx));
  const add = () =>
    setTicketTiers((cur) => [
      ...cur,
      {
        id: `tier-${Date.now()}-${cur.length}`,
        name: `Tier ${cur.length + 1}`,
        category: "admission",
        priceCents: 0,
        quantity: 0,
        maxPerUser: 4,
        description: "",
        saleStart: "",
        saleEnd: "",
      },
    ]);

  return (
    <div className="flex flex-col gap-3">
      {ticketTiers.map((tier, idx) => (
        <div
          key={tier.id}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2">
            <input
              className="flex-1 h-9 rounded-lg bg-white/8 px-2 text-sm font-semibold text-white outline-none"
              value={tier.name}
              placeholder="Tier name"
              onChange={(e) => update(idx, { name: e.target.value })}
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              aria-label="Remove tier"
              className="text-white/40 hover:text-white/80"
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              className="h-9 rounded-lg bg-white/8 px-2 text-sm text-white outline-none"
              inputMode="decimal"
              placeholder="Price USD"
              value={tier.priceCents > 0 ? (tier.priceCents / 100).toString() : ""}
              onChange={(e) => {
                const dollars = parseFloat(e.target.value);
                update(idx, {
                  priceCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0,
                });
              }}
            />
            <input
              className="h-9 rounded-lg bg-white/8 px-2 text-sm text-white outline-none"
              inputMode="numeric"
              placeholder="Quantity"
              value={tier.quantity > 0 ? String(tier.quantity) : ""}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                update(idx, { quantity: Number.isFinite(n) && n > 0 ? n : 0 });
              }}
            />
            <input
              className="h-9 rounded-lg bg-white/8 px-2 text-sm text-white outline-none"
              inputMode="numeric"
              placeholder="Max/person"
              value={tier.maxPerUser > 0 ? String(tier.maxPerUser) : ""}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                update(idx, { maxPerUser: Number.isFinite(n) && n > 0 ? n : 1 });
              }}
            />
          </div>
          <input
            className="h-9 rounded-lg bg-white/8 px-2 text-xs text-white outline-none"
            placeholder="Description (optional)"
            value={tier.description}
            onChange={(e) => update(idx, { description: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-white/55">
              Sales start
              <input
                type="datetime-local"
                className="mt-1 h-9 w-full rounded-lg bg-white/8 px-2 text-xs text-white outline-none"
                value={tier.saleStart ? toLocalInput(tier.saleStart) : ""}
                onChange={(e) =>
                  update(idx, { saleStart: e.target.value ? fromLocalInput(e.target.value) : "" })
                }
              />
            </label>
            <label className="text-[11px] text-white/55">
              Sales end
              <input
                type="datetime-local"
                className="mt-1 h-9 w-full rounded-lg bg-white/8 px-2 text-xs text-white outline-none"
                value={tier.saleEnd ? toLocalInput(tier.saleEnd) : ""}
                onChange={(e) =>
                  update(idx, { saleEnd: e.target.value ? fromLocalInput(e.target.value) : "" })
                }
              />
            </label>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="self-start inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3 h-9 text-xs font-semibold text-white/85 hover:bg-white/10"
      >
        <Plus size={14} /> Add tier
      </button>
    </div>
  );
}

// ── CoOrganizersField ───────────────────────────────────────────────
// Debounced user search + click-to-add + remove chip. Reuses the same
// usersApi.searchUsers the mobile screen uses, so the result shape is
// identical and the store's `addCoOrganizer` just consumes it.
function CoOrganizersField() {
  const coOrganizers = useCreateEventStore((st) => st.coOrganizers);
  const addCoOrganizer = useCreateEventStore((st) => st.addCoOrganizer);
  const removeCoOrganizer = useCreateEventStore((st) => st.removeCoOrganizer);
  const search = useCreateEventStore((st) => st.coOrganizerSearch);
  const setSearch = useCreateEventStore((st) => st.setCoOrganizerSearch);
  const results = useCreateEventStore((st) => st.coOrganizerResults);
  const setResults = useCreateEventStore((st) => st.setCoOrganizerResults);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ponytail: native setTimeout debounce. Adding @tanstack/react-pacer
  // here is YAGNI for a single 300ms input.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const { docs } = await usersApi.searchUsers(search.trim(), 6);
        setResults(
          (docs || []).map((u: any) => ({
            id: u.id,
            authId: u.authId,
            username: u.username,
            avatar: u.avatar,
            name: u.name ?? "",
          })),
        );
      } catch {
        setResults([]);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, setResults]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#111] px-3 h-11">
          <Search size={16} className="text-white/40" />
          <input
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 outline-none"
            value={search}
            placeholder="Search by username"
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setResults([]);
              }}
              className="text-white/40 hover:text-white/80"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        {results.length > 0 ? (
          <div className="absolute left-0 right-0 mt-1 z-10 max-h-56 overflow-auto rounded-2xl border border-white/10 bg-[#0E1320] shadow-xl">
            {results
              .filter((u) => !coOrganizers.some((c) => c.id === u.id))
              .map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    addCoOrganizer({
                      id: u.id,
                      authId: u.authId,
                      username: u.username,
                      avatar: u.avatar,
                    });
                    setSearch("");
                    setResults([]);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/5"
                >
                  {u.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={u.avatar}
                      alt=""
                      className="h-7 w-7 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-white/10" />
                  )}
                  <span className="text-sm text-white">@{u.username}</span>
                </button>
              ))}
          </div>
        ) : null}
      </div>
      {coOrganizers.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {coOrganizers.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white"
            >
              @{c.username}
              <button
                type="button"
                onClick={() => removeCoOrganizer(c.id)}
                aria-label={`Remove ${c.username}`}
                className="text-white/60 hover:text-white"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-white/45">
          Type a username to search. Co-organizers can edit this event and view
          its dashboard.
        </p>
      )}
    </div>
  );
}
