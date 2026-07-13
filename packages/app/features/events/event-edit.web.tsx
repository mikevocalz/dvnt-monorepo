/**
 * Edit Event — WEB (@dvnt/app/features/events/event-edit). Real web port of the
 * native editor `(protected)/events/[id]/edit.tsx`. Single-page sectioned form
 * (Cover · Details · When & Where · Pricing & Visibility · Ticket Tiers · More)
 * that PREFILLS from the fetched event (useEvent) and persists via the SAME data
 * hooks the native screen uses: useUpdateEvent for the event row and
 * ticketTypesApi.create/update/deactivate for the per-tier CRUD diff.
 *
 * Conventions: NativeWind interop OFF — Tailwind className on raw DOM tags only,
 * no <View>/<Text>. State lives in the dedicated Zustand edit store (never
 * useState). Date/time via <input type="datetime-local">. Cover/flyer via file
 * input + object-URL preview (rounded SQUARE). Navigation via solito useRouter.
 */
"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "solito/navigation";
import {
  Calendar,
  DollarSign,
  Users,
  Tag,
  Video,
  ImagePlus,
  Plus,
  X,
} from "lucide-react";
import { FormField, StickySaveBar, useDirtyGuard } from "@dvnt/ui";
import { useEvent, useUpdateEvent } from "@dvnt/app/lib/hooks/use-events";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import {
  ticketTypesApi,
  TICKET_TYPE_CATEGORIES,
} from "@dvnt/app/lib/api/ticket-types";
import {
  useEventEditStore,
  TIER_LEVELS,
  type LocalTicketTier,
} from "@dvnt/app/lib/stores/event-edit-store";

const inputCls =
  "w-full bg-white/[0.05] border border-white/12 rounded-xl px-3 h-11 text-[15px] text-white placeholder:text-white/40 outline-none focus:border-[#3FDCFF]/60";

const tierLevelColor: Record<string, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#8A40CF",
  table: "#FF5BFC",
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`stalled at: ${label} (${ms / 1000}s)`)), ms),
    ),
  ]);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-white/55 mb-3">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function EventEditScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = String((params as any)?.id ?? "");

  const showToast = useUIStore((st) => st.showToast);
  const updateEventMutation = useUpdateEvent();
  const { data: event, isLoading } = useEvent(id);
  // Host ownership: only the event's host may edit (mirrors native's auth guard).
  const currentUser = useAuthStore((state) => state.user);
  const s = useEventEditStore();
  const flyerRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  // ── Prefill from the fetched event (mirrors native fetchEvent) ──
  useEffect(() => {
    if (!event || s.hydratedId === id) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev = event as any;

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

    const isoDate = ev.fullDate || ev.startDate || ev.date;
    const existingFlyerUrl = ev.flyerImageUrl || null;

    s.hydrate({
      hydratedId: id,
      title: ev.title || "",
      description: ev.description || "",
      location: ev.location || "",
      eventDate: isoDate
        ? new Date(isoDate).toISOString()
        : new Date().toISOString(),
      endDate: ev.endDate ? new Date(ev.endDate).toISOString() : null,
      price: ev.price != null ? String(ev.price) : "",
      maxAttendees: ev.maxAttendees != null ? String(ev.maxAttendees) : "",
      category: ev.category || "",
      visibility: ev.visibility || "public",
      dressCode: ev.dressCode || "",
      doorPolicy: ev.doorPolicy || "",
      lineup: Array.isArray(ev.lineup) ? ev.lineup.join(", ") : ev.lineup || "",
      perks: Array.isArray(ev.perks) ? ev.perks.join(", ") : ev.perks || "",
      youtubeVideoUrl: ev.youtubeVideoUrl || "",
      ticketingEnabled: !!ev.ticketingEnabled,
      flyerImage: existingFlyerUrl,
      flyerMediaType: /\.(mp4|mov|webm|m4v)(\?|$)/i.test(existingFlyerUrl || "")
        ? "video"
        : "image",
      eventImages: images,
    });

    // Load ticket tiers
    ticketTypesApi.getByEvent(id).then((dbTiers) => {
      const activeTiers = dbTiers.filter(
        (t: any) => t.active !== false && t.is_active !== false,
      );
      const tiers: LocalTicketTier[] = activeTiers.map((t: any) => ({
        id: t.id,
        name: t.name || "",
        category: t.category || "admission",
        priceDollars: t.price_cents != null ? String(t.price_cents / 100) : "0",
        quantity: t.quantity_total != null ? String(t.quantity_total) : "100",
        maxPerOrder: t.max_per_user != null ? String(t.max_per_user) : "4",
        tier: (t.tier || "ga") as LocalTicketTier["tier"],
        description: t.description || "",
        isActive: true,
        saleStart: t.sale_start || "",
      }));
      useEventEditStore.setState({
        ticketTiers: tiers,
        originalTierIds: activeTiers.map((t: any) => t.id),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, id]);

  const isDirty = s.hydratedId === id && s.title.trim().length > 0;
  useDirtyGuard(isDirty);

  // ── Save (mirrors native handleSave: event row + tier CRUD diff) ──
  const handleSave = async () => {
    if (!id || updateEventMutation.isPending) return;
    if (!s.title.trim()) {
      showToast("error", "Error", "Title is required");
      return;
    }

    try {
      const allImages = s.eventImages;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ev = event as any;
      const originalFlyerUrl = ev?.flyerImageUrl || null;
      let flyerImageUrl: string | null | undefined = undefined;
      if (s.flyerImage !== originalFlyerUrl) {
        flyerImageUrl = s.flyerImage || null;
      }

      const updateData: Record<string, unknown> = {
        title: s.title.trim(),
        description: s.description.trim(),
        location: s.location,
        startDate: s.eventDate,
        endDate: s.endDate || undefined,
        price: s.price ? parseFloat(s.price) : 0,
        maxAttendees: s.maxAttendees ? parseInt(s.maxAttendees) : undefined,
        category: s.category || undefined,
        visibility: s.visibility,
        dressCode: s.dressCode || undefined,
        doorPolicy: s.doorPolicy || undefined,
        lineup: s.lineup || undefined,
        perks: s.perks || undefined,
        youtubeVideoUrl: s.youtubeVideoUrl.trim() || null,
        ticketingEnabled: s.ticketingEnabled,
        ...(flyerImageUrl !== undefined ? { flyerImageUrl } : {}),
      };
      if (allImages.length > 0) {
        updateData.coverImage = allImages[0];
        updateData.images = allImages.slice(1).map((url) => ({ url }));
      }

      // 1. Event row update — must finish before navigation
      try {
        await withTimeout(
          updateEventMutation.mutateAsync({ eventId: id, updates: updateData }),
          20000,
          "event-update",
        );
      } catch (err: any) {
        showToast(
          "error",
          "Save Failed",
          err?.message || "Changes could not be saved. Please try again.",
        );
        return;
      }

      // 2. Ticket tier creates / updates / deactivates
      const tierPromises = s.ticketTiers.map(async (tier) => {
        const priceCents = Math.round(parseFloat(tier.priceDollars || "0") * 100);
        const qty = parseInt(tier.quantity || "100");
        const maxPerUser = parseInt(tier.maxPerOrder || "4");

        if (!tier.id) {
          await withTimeout(
            ticketTypesApi.create({
              eventId: id,
              name: tier.name || "General Admission",
              category: tier.category || "admission",
              description: tier.description || undefined,
              priceCents,
              quantityTotal: qty,
              maxPerUser,
              saleStart: tier.saleStart || undefined,
            }),
            15000,
            "ticket-type-create",
          );
        } else {
          await withTimeout(
            ticketTypesApi.update(tier.id, {
              name: tier.name,
              category: tier.category || "admission",
              description: tier.description || null,
              price_cents: priceCents,
              quantity_total: qty,
              max_per_user: maxPerUser,
              sale_start: tier.saleStart || null,
            }),
            15000,
            "ticket-type-update",
          );
        }
      });

      const currentIds = new Set(
        s.ticketTiers.filter((t) => t.id).map((t) => t.id!),
      );
      const removedIds = s.originalTierIds.filter((tid) => !currentIds.has(tid));
      const deactivatePromises = removedIds.map((tid) =>
        withTimeout(ticketTypesApi.deactivate(tid), 15000, "ticket-type-deactivate"),
      );

      try {
        await Promise.all([...tierPromises, ...deactivatePromises]);
      } catch (err: any) {
        console.error("[EditEvent] Tier sync error:", err);
        showToast(
          "warning",
          "Partial save",
          "Event saved, but some ticket tier changes did not apply. Open Edit and re-save.",
        );
      }

      showToast("success", "Saved", "Event updated successfully");
      router.back();
    } catch (error: any) {
      console.error("[EditEvent] Save error:", error);
      showToast("error", "Error", error?.message || "Failed to save changes");
    }
  };

  const onCoverPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const urls = files.map((f) => URL.createObjectURL(f));
    s.setEventImages((prev) => [...prev, ...urls]);
  };

  const onFlyerPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    s.setFlyerImage(URL.createObjectURL(file));
    s.setFlyerMediaType(file.type.startsWith("video/") ? "video" : "image");
  };

  if (isLoading || s.hydratedId !== id) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white flex items-center justify-center">
        <span className="text-sm text-white/50">Loading event…</span>
      </div>
    );
  }

  // Host-only guard (mirrors native's canEditEvent ownership check).
  const ev = event as any;
  const hostId = ev?.hostId ?? ev?.host_id ?? ev?.organizerId ?? ev?.host?.id;
  const isOwner = !currentUser || !hostId || String(hostId) === String(currentUser.id);
  if (!isOwner) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white flex flex-col items-center justify-center gap-3 px-6">
        <span className="text-sm text-white/60 text-center">
          You don&apos;t have permission to edit this event.
        </span>
        <button
          onClick={() => router.back()}
          className="px-4 h-10 rounded-xl bg-white/8 text-sm font-semibold"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          className="text-[16px] text-white/80 active:opacity-60"
        >
          Cancel
        </button>
        <h1 className="text-[17px] font-semibold">Edit Event</h1>
        <button
          onClick={handleSave}
          disabled={updateEventMutation.isPending}
          className="text-[16px] font-semibold text-[#3FDCFF] disabled:text-white/40"
        >
          {updateEventMutation.isPending ? "Saving…" : "Done"}
        </button>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-4 flex flex-col gap-4">
        {/* Cover / images — rounded square */}
        <Section title="Event Images">
          <div className="flex flex-wrap gap-3">
            {s.eventImages.map((uri, index) => (
              <div key={`img-${index}`} className="relative w-24 h-24">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uri}
                  alt=""
                  className="w-24 h-24 rounded-xl object-cover bg-white/8"
                />
                <button
                  onClick={() =>
                    s.setEventImages((prev) => prev.filter((_, i) => i !== index))
                  }
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-lg bg-red-500 flex items-center justify-center"
                >
                  <X size={12} color="#fff" />
                </button>
                {index === 0 ? (
                  <span className="absolute bottom-1 left-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px]">
                    Cover
                  </span>
                ) : null}
              </div>
            ))}
            {s.eventImages.length < 4 ? (
              <button
                onClick={() => coverRef.current?.click()}
                className="w-24 h-24 rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center gap-1 text-white/50"
              >
                <ImagePlus size={20} />
                <span className="text-[11px]">Add</span>
              </button>
            ) : null}
            <input
              ref={coverRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={onCoverPick}
            />
          </div>
        </Section>

        {/* Flyer — rounded square, image or video */}
        <Section title="Flyer (Optional)">
          <p className="text-xs text-white/45 -mt-1">
            Photo or video · 3:5 portrait · up to 60 sec
          </p>
          {s.flyerImage ? (
            <div
              className="relative rounded-2xl overflow-hidden bg-white/[0.04]"
              style={{ width: "60%", aspectRatio: "3 / 5" }}
            >
              {s.flyerMediaType === "video" ? (
                <video
                  src={s.flyerImage}
                  className="w-full h-full object-cover"
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.flyerImage}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
              <button
                onClick={() => {
                  s.setFlyerImage(null);
                  s.setFlyerMediaType("image");
                }}
                className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/60 flex items-center justify-center"
              >
                <X size={16} color="#fff" />
              </button>
              <span className="absolute bottom-2 left-2 bg-amber-500/90 px-2 py-1 rounded-lg text-xs font-medium">
                {s.flyerMediaType === "video" ? "Video Flyer" : "Flyer"}
              </span>
            </div>
          ) : (
            <button
              onClick={() => flyerRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/20 text-white/50"
              style={{ width: "60%", aspectRatio: "3 / 5" }}
            >
              <Plus size={24} />
              <span className="text-xs font-medium">Add Flyer</span>
              <span className="text-[10px] text-white/40">Photo or video ad</span>
            </button>
          )}
          <input
            ref={flyerRef}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={onFlyerPick}
          />
        </Section>

        {/* Details */}
        <Section title="Details">
          <FormField label="Title" required>
            <input
              className={inputCls}
              placeholder="Event title"
              maxLength={100}
              value={s.title}
              onChange={(e) => s.setTitle(e.target.value)}
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className={`${inputCls} h-28 py-2.5 resize-none`}
              placeholder="Describe your event…"
              maxLength={2000}
              value={s.description}
              onChange={(e) => s.setDescription(e.target.value)}
            />
          </FormField>
          <FormField label="Location">
            <input
              className={inputCls}
              placeholder="Venue / address"
              value={s.location}
              onChange={(e) => s.setLocation(e.target.value)}
            />
          </FormField>
        </Section>

        {/* When */}
        <Section title="When">
          <FormField label="Starts">
            <input
              type="datetime-local"
              className={inputCls}
              value={toLocalInput(s.eventDate)}
              onChange={(e) => s.setEventDate(fromLocalInput(e.target.value))}
            />
          </FormField>
          <FormField label="Ends (optional)">
            <input
              type="datetime-local"
              className={inputCls}
              value={toLocalInput(s.endDate)}
              onChange={(e) =>
                s.setEndDate(e.target.value ? fromLocalInput(e.target.value) : null)
              }
            />
          </FormField>
          {s.endDate ? (
            <button
              onClick={() => s.setEndDate(null)}
              className="self-start text-xs text-red-400"
            >
              Clear end date
            </button>
          ) : null}
        </Section>

        {/* Pricing & Visibility */}
        <Section title="Pricing & Visibility">
          <FormField label="Price">
            <div className="flex items-center gap-2 bg-white/[0.05] border border-white/12 rounded-xl px-3 h-11">
              <DollarSign size={18} className="text-white/40 shrink-0" />
              <input
                className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
                inputMode="decimal"
                placeholder="0 (free)"
                value={s.price}
                onChange={(e) => s.setPrice(e.target.value)}
              />
            </div>
          </FormField>
          <FormField label="Capacity">
            <div className="flex items-center gap-2 bg-white/[0.05] border border-white/12 rounded-xl px-3 h-11">
              <Users size={18} className="text-white/40 shrink-0" />
              <input
                className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
                inputMode="numeric"
                placeholder="Max attendees"
                value={s.maxAttendees}
                onChange={(e) => s.setMaxAttendees(e.target.value)}
              />
            </div>
          </FormField>
          <FormField label="Category">
            <div className="flex items-center gap-2 bg-white/[0.05] border border-white/12 rounded-xl px-3 h-11">
              <Tag size={18} className="text-white/40 shrink-0" />
              <input
                className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
                maxLength={50}
                placeholder="e.g. Music, Nightlife, Tech…"
                value={s.category}
                onChange={(e) => s.setCategory(e.target.value)}
              />
            </div>
          </FormField>
          <FormField label="Visibility">
            <div className="flex gap-2">
              {(["public", "private", "link_only"] as const).map((v) => {
                const label =
                  v === "link_only"
                    ? "Link Only"
                    : v === "public"
                      ? "Public"
                      : "Private";
                return (
                  <button
                    key={v}
                    onClick={() => s.setVisibility(v)}
                    className={`flex-1 h-9 rounded-xl text-sm font-medium ${
                      s.visibility === v
                        ? "bg-[#3FDCFF] text-black"
                        : "bg-white/8 text-white/70"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] leading-[17px] text-white/55 rounded-xl bg-white/[0.04] border border-white/[0.06] p-3">
              {s.visibility === "public" ? (
                <>
                  <strong className="text-white">Public · </strong>Appears in the
                  Home feed, For You, and Search. Anyone can see and buy a ticket.
                </>
              ) : s.visibility === "link_only" ? (
                <>
                  <strong className="text-white">Link Only · </strong>Hidden from
                  the public feed and Search. Anyone with the share link can see
                  and buy.
                </>
              ) : (
                <>
                  <strong className="text-white">Private · </strong>Hidden from
                  the public feed and from people without the link. Invite-only
                  guest lists.
                </>
              )}
            </p>
          </FormField>
        </Section>

        {/* Ticketing toggle */}
        <Section title="Tickets">
          <label className="flex items-start justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold text-white">
                Sell tickets for this event
              </span>
              <span className="text-xs text-white/50 mt-0.5 leading-4">
                Turn this on to charge for entry, add VIP, or sell paid add-ons
                like coat check, drink tokens, or bottle service.
              </span>
            </span>
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={s.ticketingEnabled}
              onChange={(e) => s.setTicketingEnabled(e.target.checked)}
            />
          </label>

          {s.ticketingEnabled ? (
            <div className="flex flex-col gap-3 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">
                  Ticket Tiers
                </span>
                <button
                  onClick={() => s.addTier()}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#8A40CF]/15 border border-[#8A40CF]/30 text-[#8A40CF] text-[13px] font-semibold"
                >
                  <Plus size={14} /> Add Tier
                </button>
              </div>

              {s.ticketTiers.length === 0 ? (
                <p className="text-center text-[13px] text-white/50 py-4">
                  No ticket tiers yet. Tap "Add Tier" to create one.
                </p>
              ) : null}

              {s.ticketTiers.map((tier, idx) => (
                <TierCard key={idx} tier={tier} idx={idx} />
              ))}
            </div>
          ) : null}
        </Section>

        {/* More details */}
        <Section title="More Details">
          <FormField label="YouTube Video URL">
            <div className="flex items-center gap-2 bg-white/[0.05] border border-white/12 rounded-xl px-3 h-11">
              <Video size={18} className="text-white/40 shrink-0" />
              <input
                className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
                autoCapitalize="none"
                placeholder="https://youtube.com/watch?v=…"
                value={s.youtubeVideoUrl}
                onChange={(e) => s.setYoutubeVideoUrl(e.target.value)}
              />
            </div>
          </FormField>
          <FormField label="Dress Code">
            <input
              className={inputCls}
              maxLength={200}
              placeholder="e.g. Smart casual — No sneakers"
              value={s.dressCode}
              onChange={(e) => s.setDressCode(e.target.value)}
            />
          </FormField>
          <FormField label="Door Policy">
            <input
              className={inputCls}
              maxLength={200}
              placeholder="e.g. 21+ with valid ID"
              value={s.doorPolicy}
              onChange={(e) => s.setDoorPolicy(e.target.value)}
            />
          </FormField>
          <FormField label="Lineup / Performers">
            <textarea
              className={`${inputCls} h-20 py-2.5 resize-none`}
              maxLength={1000}
              placeholder="DJ sets, performers, speakers…"
              value={s.lineup}
              onChange={(e) => s.setLineup(e.target.value)}
            />
          </FormField>
          <FormField label="What's Included">
            <textarea
              className={`${inputCls} h-20 py-2.5 resize-none`}
              maxLength={1000}
              placeholder="Complimentary drinks, VIP access…"
              value={s.perks}
              onChange={(e) => s.setPerks(e.target.value)}
            />
          </FormField>
        </Section>
      </div>

      <StickySaveBar
        visible={isDirty}
        onSave={handleSave}
        onCancel={() => router.back()}
        saving={updateEventMutation.isPending}
      />
    </div>
  );
}

function TierCard({ tier, idx }: { tier: LocalTicketTier; idx: number }) {
  const updateTier = useEventEditStore((st) => st.updateTier);
  const removeTier = useEventEditStore((st) => st.removeTier);
  const borderColor = `${tierLevelColor[tier.tier] ?? "#34A2DF"}4D`;
  const activeCat = TICKET_TYPE_CATEGORIES.find(
    (c) => c.value === (tier.category || "admission"),
  );

  return (
    <div
      className="rounded-2xl bg-white/[0.04] p-4 border"
      style={{ borderColor }}
    >
      {/* Tier level selector */}
      <div className="flex gap-1.5 mb-3">
        {TIER_LEVELS.map((lvl) => {
          const selected = tier.tier === lvl;
          return (
            <button
              key={lvl}
              onClick={() => updateTier(idx, { tier: lvl })}
              className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold uppercase border"
              style={{
                backgroundColor: selected ? tierLevelColor[lvl] : "transparent",
                borderColor: selected ? "transparent" : "rgba(255,255,255,0.12)",
                color: selected ? "#fff" : "rgba(255,255,255,0.5)",
              }}
            >
              {lvl}
            </button>
          );
        })}
      </div>

      {/* Category selector */}
      <div className="flex gap-1.5 mb-2">
        {TICKET_TYPE_CATEGORIES.map((option) => {
          const selected = (tier.category || "admission") === option.value;
          return (
            <button
              key={option.value}
              onClick={() => updateTier(idx, { category: option.value })}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border ${
                selected
                  ? "bg-[#3FDCFF] text-black border-transparent"
                  : "text-white/50 border-white/12"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {activeCat ? (
        <p className="text-[11px] leading-[15px] text-white/50 mb-2.5">
          {activeCat.hint}
        </p>
      ) : null}

      {/* Name */}
      <input
        className="w-full bg-transparent text-[15px] font-semibold text-white placeholder:text-white/40 outline-none border-b border-white/12 pb-1 mb-2.5"
        placeholder="Tier name"
        value={tier.name}
        onChange={(e) => updateTier(idx, { name: e.target.value })}
      />

      {/* Price / Quantity / Max-per-order */}
      <div className="grid grid-cols-3 gap-2.5 mb-2.5">
        <div>
          <span className="block text-[11px] text-white/50 mb-1">Price ($)</span>
          <input
            className="w-full bg-white/[0.05] rounded-lg px-2.5 py-1.5 text-[15px] font-semibold text-white outline-none disabled:text-white/40"
            inputMode="decimal"
            placeholder="0"
            disabled={tier.tier === "free"}
            value={tier.priceDollars}
            onChange={(e) => updateTier(idx, { priceDollars: e.target.value })}
          />
        </div>
        <div>
          <span className="block text-[11px] text-white/50 mb-1">Quantity</span>
          <input
            className="w-full bg-white/[0.05] rounded-lg px-2.5 py-1.5 text-[15px] font-semibold text-white outline-none"
            inputMode="numeric"
            placeholder="100"
            value={tier.quantity}
            onChange={(e) => updateTier(idx, { quantity: e.target.value })}
          />
        </div>
        <div>
          <span className="block text-[11px] text-white/50 mb-1">Max/Order</span>
          <input
            className="w-full bg-white/[0.05] rounded-lg px-2.5 py-1.5 text-[15px] font-semibold text-white outline-none"
            inputMode="numeric"
            placeholder="4"
            value={tier.maxPerOrder}
            onChange={(e) => updateTier(idx, { maxPerOrder: e.target.value })}
          />
        </div>
      </div>

      {/* Description */}
      <input
        className="w-full bg-transparent text-[13px] text-white placeholder:text-white/40 outline-none border-b border-white/12 pb-1 mb-2.5"
        placeholder="Perks description (optional)"
        value={tier.description}
        onChange={(e) => updateTier(idx, { description: e.target.value })}
      />

      {/* Sale start */}
      <div className="flex items-center gap-2.5 bg-white/[0.05] rounded-lg px-2.5 py-2 mb-2.5">
        <Calendar size={14} className="text-white/40 shrink-0" />
        <div className="flex-1">
          <span className="block text-[10px] font-bold tracking-[1.2px] text-white/50">
            SALE STARTS
          </span>
          <input
            type="datetime-local"
            className="bg-transparent text-[14px] font-semibold text-white outline-none w-full"
            value={toLocalInput(tier.saleStart || null)}
            onChange={(e) =>
              updateTier(idx, {
                saleStart: e.target.value ? fromLocalInput(e.target.value) : "",
              })
            }
          />
        </div>
        {tier.saleStart ? (
          <button
            onClick={() => updateTier(idx, { saleStart: "" })}
            className="text-[12px] font-bold text-[#8A40CF]"
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Remove */}
      <button
        onClick={() => removeTier(idx)}
        className="flex items-center gap-1 text-[12px] text-red-500"
      >
        <X size={14} /> Remove tier
      </button>
    </div>
  );
}

export default EventEditScreen;

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
