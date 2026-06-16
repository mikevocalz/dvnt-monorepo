"use client";

/**
 * App Trace / Dev Telemetry — web port of native `app/(public)/dev/telemetry.tsx`.
 *
 * Shows the last persisted funnel + crash events and lets you Refresh / Clear.
 *
 * Law 1 (data wiring): imports the EXACT portable diagnostics store the native
 * screen uses — `AppTrace` (.dump() / .clear()) and the `AppTraceEvent` type
 * from `@dvnt/app/lib/diagnostics/app-trace` (bundler resolves to app-trace.web
 * which is localStorage-backed). Same `.slice(-80).reverse()` projection.
 * State is Zustand (no useState) — a tiny `useTelemetryStore` holds the dumped
 * events; Refresh re-dumps, Clear clears the portable buffer then re-dumps.
 * Long list → TanStack Virtual.
 *
 * Native-only bit made web-native: native used `useFocusEffect` to refresh on
 * focus; on web we refresh on mount + via the visible Refresh button.
 */

import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AppTrace, type AppTraceEvent } from "@dvnt/app/lib/diagnostics/app-trace";

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatContext(ctx: AppTraceEvent["ctx"]): string {
  const entries = Object.entries(ctx);
  if (entries.length === 0) return "no context";
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" | ");
}

interface TelemetryState {
  events: AppTraceEvent[];
  refresh: () => void;
  clear: () => void;
}

const useTelemetryStore = create<TelemetryState>((set) => ({
  events: [],
  refresh: () => set({ events: AppTrace.dump().slice(-80).reverse() }),
  clear: () => {
    AppTrace.clear();
    set({ events: AppTrace.dump().slice(-80).reverse() });
  },
}));

const EST_ROW_HEIGHT = 132; // card + 12px gap

export function DevTelemetryScreen() {
  const events = useTelemetryStore((s) => s.events);
  const refresh = useTelemetryStore((s) => s.refresh);
  const clear = useTelemetryStore((s) => s.clear);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => EST_ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div className="flex min-h-[100dvh] flex-col bg-black text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-black/85 px-4 py-4 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">App Trace</h1>
          <p className="text-sm text-zinc-400">
            Last {events.length} persisted funnel + crash events
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="flex min-h-11 items-center justify-center rounded-2xl bg-white/10 px-4 font-semibold text-white active:scale-95"
          >
            Refresh
          </button>
          <button
            onClick={clear}
            className="flex min-h-11 items-center justify-center rounded-2xl bg-[#34A2DF] px-4 font-semibold text-white active:scale-95"
          >
            Clear
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {events.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="font-semibold text-white">No events yet</p>
            <p className="mt-2 leading-5 text-zinc-400">
              Trigger signup, verification, posting, recovery, or a public gate,
              then come back here.
            </p>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 140px)" }}
          >
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const event = events[item.index];
                if (!event) return null;
                return (
                  <div
                    key={`${event.ts}-${event.tag}-${event.event}-${item.index}`}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                      paddingBottom: 12,
                    }}
                  >
                    <div className="flex flex-col gap-2 rounded-3xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-white">
                          {event.tag} · {event.event}
                        </p>
                        <p className="text-xs text-zinc-500">{formatTimestamp(event.ts)}</p>
                      </div>
                      <p
                        className={
                          event.level === "error"
                            ? "text-xs uppercase tracking-[1px] text-red-400"
                            : event.level === "warn"
                              ? "text-xs uppercase tracking-[1px] text-yellow-300"
                              : "text-xs uppercase tracking-[1px] text-[#34A2DF]"
                        }
                      >
                        {event.level}
                      </p>
                      <p className="text-sm leading-5 text-zinc-300">
                        {formatContext(event.ctx)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default DevTelemetryScreen;
