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
import { useState } from "react";
import { useRouter } from "solito/navigation";
import {
  Calendar,
  MapPin,
  Globe,
  ImagePlus,
  X,
  ChevronDown,
  Plus,
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
      let image: string | undefined;
      const cover = s.flyerImage;
      if (cover && /^(blob:|data:|file:)/i.test(cover)) {
        const up = await uploadToServer(cover, "events");
        if (!up.success || !up.url) {
          throw new Error(
            up.error || "Couldn't upload the cover image. Re-select it and try again.",
          );
        }
        image = up.url;
      } else if (cover) {
        image = cover;
      }

      const payload = buildEventInsert(s, { image, flyerImageUrl: image });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await createEvent.mutateAsync(payload as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const id = (created as any)?.id;

      // Create a ticket type so the event is actually purchasable/RSVP-able.
      // (Web previously wrote only a flat price and created no ticket type.)
      if (s.ticketingEnabled && id) {
        const priceCents = Math.round((parseFloat(s.ticketPrice) || 0) * 100);
        const qty = s.maxAttendees ? parseInt(s.maxAttendees, 10) : 200;
        await ticketTypesApi.create({
          eventId: String(id),
          name: priceCents === 0 ? "Free" : "General Admission",
          priceCents,
          quantityTotal: qty,
          maxPerUser: 4,
        });
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

  const onCoverPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    s.setFlyerMediaType(file.type.startsWith("video/") ? "video" : "image");
    s.setFlyerImage(URL.createObjectURL(file));
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
              <label className="flex flex-col items-center justify-center gap-2 h-44 rounded-xl border border-dashed border-white/20 bg-white/[0.03] cursor-pointer text-white/55 overflow-hidden">
                {s.flyerImage ? (
                  isVideo ? (
                    <video
                      src={s.flyerImage}
                      className="w-full h-full object-cover rounded-xl"
                      muted
                      playsInline
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.flyerImage}
                      alt=""
                      className="w-full h-full object-cover rounded-xl"
                    />
                  )
                ) : (
                  <>
                    <ImagePlus size={26} />
                    <span className="text-sm">Upload cover image or video</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={onCoverPick}
                />
              </label>
              {s.flyerImage ? (
                <button
                  onClick={() => s.setFlyerImage(null)}
                  className="self-start text-xs text-white/50 flex items-center gap-1"
                >
                  <X size={12} /> Remove cover
                </button>
              ) : null}
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
                    Paid tickets must be at least $2.00. Need tiers, add-ons or
                    promo codes? Use the mobile app for now.
                  </p>
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
