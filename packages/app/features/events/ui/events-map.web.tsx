"use client";

import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEventsScreenStore } from "@dvnt/app/lib/stores/events-screen-store";
import type { Event } from "@dvnt/app/lib/hooks/use-events";
import { eventMapApi } from "@dvnt/app/lib/api/event-map";
import { eventMapIds, eventMapPins, eventListAllowsMap, attachEventMapFlyers } from "@dvnt/app/lib/events/event-map";

const MemberMap = lazy(() => import("./member-map.web"));

export default function EventsMap({ events, onClose, onOpenEvent }: {
  events: Event[];
  onClose: () => void;
  onOpenEvent: (id: string) => void;
}) {
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
  const pins = attachEventMapFlyers(eventMapPins(locations.isError ? [] : locations.data || [], ids), eligibleEvents);
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
          <p className="text-sm text-white/60">Party flyers and opted-in member avatars on one map.</p>
        </div>
        <button onClick={onClose} className="shrink-0 min-h-11 px-3 rounded-xl bg-white/10 text-sm font-semibold" aria-label="Show event list">List view</button>
      </div>
      <Suspense fallback={<p role="status" className="p-4">Loading map…</p>}><MemberMap eventPins={pins} selectedEventId={selectedId} onSelectEvent={setSelectedId} onOpenEvent={onOpenEvent} /></Suspense>
      {locations.isPending && ids.length > 0 ? (
        <p role="status" className="p-4">Loading event locations…</p>
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
          <div className="w-full">
            <div className="min-w-0 p-4 flex flex-col gap-3">
              <p className="text-sm text-white/60" role="status">{pins.length} {pins.length === 1 ? "event venue" : "event venues"} • flyers shown on the map</p>
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
