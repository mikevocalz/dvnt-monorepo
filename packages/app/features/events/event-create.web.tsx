/**
 * Create Event — WEB (@dvnt/app/features/events/event-create). Designed for web:
 * a single-page sectioned form (Details · When & Where · Cover · Tickets) with a
 * sticky LIVE PREVIEW card on desktop, collapsing to one column on mobile. State
 * is the SHARED draft store (useCreateEventStore — no local useState; the draft
 * persists). Publishes via useCreateEvent and routes to the new event. The same
 * sections are reused by the edit sheet (see event-edit.web).
 */
import { useRouter } from "solito/navigation";
import { Calendar, MapPin, Globe, ImagePlus, X } from "lucide-react";
import { useCreateEventStore } from "@dvnt/app/lib/stores/create-event-store";
import { useCreateEvent } from "@dvnt/app/lib/hooks/use-events";

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

const inputCls =
  "w-full bg-white/[0.05] border border-white/12 rounded-xl px-3 h-11 text-[15px] text-white placeholder:text-white/40 outline-none focus:border-[#3FDCFF]/60";

export function CreateEventScreen() {
  const router = useRouter();
  const s = useCreateEventStore();
  const createEvent = useCreateEvent();

  const canPublish = s.title.trim().length > 0 && (s.location.trim() || s.isOnline);

  const publish = async () => {
    if (!canPublish || createEvent.isPending) return;
    try {
      const created = await createEvent.mutateAsync({
        title: s.title.trim(),
        description: s.description.trim(),
        date: s.eventDate || new Date().toISOString(),
        endDate: s.endDate || undefined,
        location: s.isOnline ? "Online" : s.location.trim(),
        price: s.ticketingEnabled ? Number(s.ticketPrice) || 0 : 0,
        maxAttendees: s.maxAttendees ? Number(s.maxAttendees) : undefined,
        visibility: s.visibility,
        isOnline: s.isOnline,
        image: s.flyerImage || s.eventImages[0] || undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      s.resetDraft();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const id = (created as any)?.id;
      router.push(id ? `/events/${s.title ? slugifyTitle(s.title) : id}` : "/events");
    } catch {
      // surfaced by the mutation; keep the draft so nothing is lost
    }
  };

  const onCoverPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) s.setFlyerImage(URL.createObjectURL(file));
  };

  return (
    <div className="min-h-[100dvh] bg-[#02030A] text-white">
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-28">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">Create event</h1>
          <button
            onClick={publish}
            disabled={!canPublish || createEvent.isPending}
            className="h-10 px-5 rounded-full bg-linear-to-r from-[#3FDCFF] to-[#8A40CF] text-white font-bold disabled:opacity-40"
          >
            {createEvent.isPending ? "Publishing…" : "Publish"}
          </button>
        </div>

        <div className="grid lg:grid-cols-[1fr_380px] gap-5 mt-5 items-start">
          {/* Form */}
          <div className="flex flex-col gap-4">
            <Section title="Details">
              <input
                className={inputCls}
                placeholder="Event title"
                value={s.title}
                onChange={(e) => s.setTitle(e.target.value)}
              />
              <textarea
                className={`${inputCls} h-28 py-2.5 resize-none`}
                placeholder="Describe your event…"
                value={s.description}
                onChange={(e) => s.setDescription(e.target.value)}
              />
            </Section>

            <Section title="When & Where">
              <label className="text-xs text-white/55">Starts</label>
              <input
                type="datetime-local"
                className={inputCls}
                value={toLocalInput(s.eventDate)}
                onChange={(e) => s.setEventDate(fromLocalInput(e.target.value))}
              />
              <label className="text-xs text-white/55 mt-1">Ends (optional)</label>
              <input
                type="datetime-local"
                className={inputCls}
                value={toLocalInput(s.endDate)}
                onChange={(e) =>
                  s.setEndDate(e.target.value ? fromLocalInput(e.target.value) : null)
                }
              />
              <label className="flex items-center gap-2 mt-1 text-sm text-white/75">
                <input
                  type="checkbox"
                  checked={s.isOnline}
                  onChange={(e) => s.setIsOnline(e.target.checked)}
                />
                Online event
              </label>
              {!s.isOnline ? (
                <input
                  className={inputCls}
                  placeholder="Venue / address"
                  value={s.location}
                  onChange={(e) => s.setLocation(e.target.value)}
                />
              ) : null}
            </Section>

            <Section title="Cover">
              <label className="flex flex-col items-center justify-center gap-2 h-40 rounded-xl border border-dashed border-white/20 bg-white/[0.03] cursor-pointer text-white/55">
                {s.flyerImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.flyerImage}
                    alt=""
                    className="w-full h-full object-cover rounded-xl"
                  />
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
                  <X size={12} /> Remove
                </button>
              ) : null}
            </Section>

            <Section title="Tickets & Visibility">
              <label className="flex items-center gap-2 text-sm text-white/75">
                <input
                  type="checkbox"
                  checked={s.ticketingEnabled}
                  onChange={(e) => s.setTicketingEnabled(e.target.checked)}
                />
                Sell tickets
              </label>
              {s.ticketingEnabled ? (
                <div className="grid grid-cols-2 gap-3">
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    placeholder="Price (USD)"
                    value={s.ticketPrice}
                    onChange={(e) => s.setTicketPrice(e.target.value)}
                  />
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    placeholder="Capacity"
                    value={s.maxAttendees}
                    onChange={(e) => s.setMaxAttendees(e.target.value)}
                  />
                </div>
              ) : null}
              <div className="flex gap-2 mt-1">
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
            </Section>
          </div>

          {/* Live preview */}
          <div className="hidden lg:block sticky top-24">
            <div className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-2">
              Preview
            </div>
            <div className="relative w-full rounded-2xl overflow-hidden aspect-video bg-white/[0.04]">
              {s.flyerImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.flyerImage}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
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
          </div>
        </div>
      </div>
    </div>
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
