"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEventsScreenStore } from "@dvnt/app/lib/stores/events-screen-store";
import type { Event } from "@dvnt/app/lib/hooks/use-events";
import { eventMapApi } from "@dvnt/app/lib/api/event-map";
import { eventMapIds, eventMapPins, eventListAllowsMap, eventMapEmbedUrl, eventMapDirectionsUrl, type EventMapPin } from "@dvnt/app/lib/events/event-map";

const MemberMap = lazy(() => import("./member-map.web"));

export default function EventsMap({ events, onClose, onOpenEvent }: {
  events: Event[];
  onClose: () => void;
  onOpenEvent: (id: string) => void;
}) {
  const [mode, setMode] = useState<"events" | "people">("events");
  // A restrictive realtime list patch wins immediately over the last metadata
  // read. Missing policy fields are resolved by the fresh server-filtered query.
  const eligibleEvents = events.filter((event) => eventListAllowsMap(event));
  const ids = eventMapIds(eligibleEvents.map((event) => String(event.id)));
  const locations = useQuery({
    queryKey: ["events-map", ids],
    queryFn: ({ signal }) => eventMapApi.getLocations(ids, signal),
    enabled: ids.length > 0,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  // Never retain coordinates after a failed authorization/metadata refresh.
  const pins = eventMapPins(locations.isError ? [] : locations.data || [], ids);
  const selectedId = useEventsScreenStore((state) => state.selectedMapEventId);
  const setSelectedId = useEventsScreenStore((state) => state.setSelectedMapEventId);
  const selected = pins.find((pin) => pin.id === selectedId) || pins[0];
  const missing = Math.max(0, events.length - pins.length);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  return (
    <section aria-label="Events map" className="dvnt-events-map rounded-2xl border border-white/12 bg-white/[0.03] overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">Events map</h2>
          <p className="text-sm text-white/60">Select an event venue or explore opt-in nearby people.</p>
        </div>
        <button onClick={onClose} className="shrink-0 min-h-11 px-3 rounded-xl bg-white/10 text-sm font-semibold" aria-label="Show event list">List view</button>
      </div>
      <div className="px-4 pb-4 flex gap-2" role="group" aria-label="Map mode">
        <button className="min-h-11 rounded-xl px-4 border border-white/15" aria-pressed={mode === "events"} onClick={() => setMode("events")}>Event venues</button>
        <button className="min-h-11 rounded-xl px-4 border border-white/15" aria-pressed={mode === "people"} onClick={() => setMode("people")}>Nearby people</button>
      </div>
      {mode === "people" ? <Suspense fallback={<p role="status" className="p-4">Loading nearby people…</p>}><MemberMap /></Suspense> : locations.isPending && ids.length > 0 ? (
        <p role="status" className="p-8 text-center text-white/60">Loading event locations…</p>
      ) : locations.isError ? (
        <div className="p-8 text-center" role="alert">
          <p>Event locations couldn’t be loaded.</p>
          <button className="min-h-11 px-4 mt-3 rounded-xl bg-white/10" onClick={() => void locations.refetch()}>Retry locations</button>
        </div>
      ) : pins.length === 0 ? (
        <div className="p-8 text-center text-white/60" role="status">
          <p>No published map locations for these results.</p>
          <p className="text-sm mt-2">Try another search or filter, or return to the list. Online and private events aren’t pinned.</p>
        </div>
      ) : (
        <>
          <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
            {selected ? <SelectedVenueMap key={selected.id} pin={selected} /> : null}
            <div className="min-w-0 p-4 flex flex-col gap-3">
              <p className="text-sm text-white/60" role="status">{pins.length} {pins.length === 1 ? "event venue" : "event venues"} • one selected venue shown</p>
              {selected ? (
                <div className="rounded-xl border border-white/15 p-4">
                  <h3 className="font-bold break-words">{selected.title}</h3>
                  <p className="text-sm text-white/60 mt-1 break-words">{selected.location}</p>
                  <button className="min-h-11 px-4 mt-3 rounded-xl bg-[#379ED8] text-black font-semibold" onClick={() => onOpenEvent(selected.id)}>View event</button>
                </div>
              ) : null}
              <div className="max-h-64 overflow-y-auto flex flex-col gap-2" aria-label="Events with map locations">
                {pins.map((pin) => (
                  <button key={pin.id} data-event-id={pin.id} onClick={() => setSelectedId(pin.id)} aria-pressed={selected?.id === pin.id} className={`shrink-0 min-h-11 text-left px-3 py-2 rounded-xl border break-words ${selected?.id === pin.id ? "border-[#379ED8] bg-[#379ED8]/15" : "border-white/10 bg-white/[0.03]"}`}>
                    {pin.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {missing > 0 ? <p className="px-4 pb-4 text-sm text-white/50">{missing} {missing === 1 ? "result doesn’t" : "results don’t"} have a public in-person map location.</p> : null}
        </>
      )}
    </section>
  );
}

/** Same keyless Google Maps embed used on the existing event detail page. */
function SelectedVenueMap({ pin }: { pin: EventMapPin }) {
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const src = eventMapEmbedUrl(pin);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setLoading(true);
    setSlow(false);
    timer.current = setTimeout(() => { setSlow(true); setLoading(false); }, 15_000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [src, reload]);
  return (
    <div className="min-w-0">
      <div className="relative h-[360px] sm:h-[440px] lg:h-[520px] bg-white/[0.04]">
        <iframe
          key={`${src}:${reload}`}
          title={`Event location: ${pin.title}`}
          src={src}
          className="w-full h-full border-0"
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => { if (timer.current) clearTimeout(timer.current); setLoading(false); }}
          onError={() => { setLoading(false); setSlow(true); }}
        />
        {loading ? <p role="status" className="absolute top-3 left-3 right-3 pointer-events-none rounded-lg bg-black/85 p-2 text-sm">Loading map…</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
        <span className="text-white/55">{slow ? "Map taking too long?" : "Map not loading?"}</span>
        <button className="min-h-11 text-[#379ED8] font-semibold" onClick={() => setReload((value) => value + 1)}>Reload map</button>
        <a href={eventMapDirectionsUrl(pin)} target="_blank" rel="noopener noreferrer" className="min-h-11 inline-flex items-center text-[#379ED8] font-semibold">Open in Google Maps</a>
      </div>
    </div>
  );
}
