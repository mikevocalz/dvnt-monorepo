/**
 * Location picker — WEB variant of the native dev screen
 * `app/(public)/dev/location-picker.tsx`.
 *
 * Native used `LocationAutocompleteInstagram` (a @gorhom bottom-sheet driven by
 * expo-location + the Google Places API, with a Photon/komoot fallback). The
 * Google Places autocomplete path and expo-location are NOT web-safe, so the web
 * picker uses the SAME Photon (photon.komoot.io) provider the native component
 * falls back to for its predictions — a simple debounced text input + results
 * list — paired with the @dvnt/ui `MapPicker` in tap-to-place mode (onChange).
 *
 * State = Zustand (`useLocationAutocompleteStore`, shared with native, + a small
 * selection store here; no useState). Lists = TanStack Virtual. Styling = raw
 * semantic tags + Tailwind only. bg #06070d, accent cyan #3FDCFF. Avatars/thumbs
 * are rounded squares.
 */
"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRouter, useSearchParams } from "solito/navigation";
import { ArrowLeft, MapPin, Search, X } from "lucide-react";
import { MapPicker } from "@dvnt/ui";
import { useLocationAutocompleteStore } from "@dvnt/app/lib/stores/location-autocomplete-store";
import { create } from "zustand";

// Web-safe place model — mirrors the native `LocationData` shape so a consumer
// could swap providers without changing the contract.
export type LocationData = {
  name: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  formattedAddress?: string;
};

type Prediction = {
  placeId: string;
  mainText: string;
  secondaryText?: string;
  latitude?: number;
  longitude?: number;
};

// Photon (komoot) → predictions. This is the EXACT web-safe fallback the native
// `LocationAutocompleteInstagram` uses; no API key required.
function normalizePhotonPredictions(data: unknown): Prediction[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  if (!d || !Array.isArray(d.features)) return [];
  return d.features
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((feature: any) => {
      const props = feature?.properties ?? {};
      const coords = Array.isArray(feature?.geometry?.coordinates)
        ? feature.geometry.coordinates
        : [];
      const longitude =
        typeof coords[0] === "number" ? Number(coords[0]) : undefined;
      const latitude =
        typeof coords[1] === "number" ? Number(coords[1]) : undefined;
      const mainText =
        props.name || props.street || props.city || props.state || props.country;
      if (!mainText) return null;
      const secondaryText = [props.street, props.city, props.state, props.country]
        .filter(Boolean)
        .join(", ");
      return {
        placeId:
          props.osm_id != null
            ? `photon-${props.osm_type || "place"}-${props.osm_id}`
            : `photon-${mainText.toLowerCase()}-${latitude ?? "x"}-${longitude ?? "y"}`,
        mainText,
        secondaryText: secondaryText || undefined,
        latitude,
        longitude,
      } satisfies Prediction;
    })
    .filter(Boolean)
    .slice(0, 8) as Prediction[];
}

async function fetchPhotonPredictions(text: string): Promise<Prediction[]> {
  const normalized = text.trim();
  if (normalized.length < 2) return [];
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(normalized)}&limit=8&lang=en`,
    );
    if (!res.ok) return [];
    return normalizePhotonPredictions(await res.json());
  } catch {
    return [];
  }
}

// Picker-local state (predictions + selection) in Zustand — no useState.
interface PickerState {
  predictions: Prediction[];
  setPredictions: (p: Prediction[]) => void;
  selected: LocationData | null;
  setSelected: (s: LocationData | null) => void;
  point: { lat: number; lng: number } | null;
  setPoint: (p: { lat: number; lng: number } | null) => void;
}
const usePickerStore = create<PickerState>((set) => ({
  predictions: [],
  setPredictions: (predictions) => set({ predictions }),
  selected: null,
  setSelected: (selected) => set({ selected }),
  point: null,
  setPoint: (point) => set({ point }),
}));

export function LocationPickerScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const initialQuery = (search?.get("query") || "Times Square").trim();

  // Shared autocomplete store (Zustand, same store the native component drives).
  const inputText = useLocationAutocompleteStore((s) => s.inputText);
  const setInputText = useLocationAutocompleteStore((s) => s.setInputText);
  const isLoading = useLocationAutocompleteStore((s) => s.isLoading);
  const setIsLoading = useLocationAutocompleteStore((s) => s.setIsLoading);

  const predictions = usePickerStore((s) => s.predictions);
  const setPredictions = usePickerStore((s) => s.setPredictions);
  const selected = usePickerStore((s) => s.selected);
  const setSelected = usePickerStore((s) => s.setSelected);
  const point = usePickerStore((s) => s.point);
  const setPoint = usePickerStore((s) => s.setPoint);

  // Seed the shared input once from the route query (DEV preview parity).
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setInputText(initialQuery);
  }, [initialQuery, setInputText]);

  // Debounced Photon search whenever the shared input text changes.
  useEffect(() => {
    const text = inputText.trim();
    if (text.length < 2) {
      setPredictions([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const handle = setTimeout(async () => {
      const next = await fetchPhotonPredictions(text);
      if (cancelled) return;
      setPredictions(next);
      setIsLoading(false);
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [inputText, setPredictions, setIsLoading]);

  const handleSelect = (p: Prediction) => {
    const location: LocationData = {
      name: p.mainText,
      latitude: p.latitude,
      longitude: p.longitude,
      placeId: p.placeId,
      formattedAddress: p.secondaryText
        ? `${p.mainText}, ${p.secondaryText}`
        : p.mainText,
    };
    setSelected(location);
    setInputText(location.formattedAddress || location.name);
    setPredictions([]);
    if (typeof p.latitude === "number" && typeof p.longitude === "number") {
      setPoint({ lat: p.latitude, lng: p.longitude });
    }
  };

  const handleClear = () => {
    setInputText("");
    setSelected(null);
    setPredictions([]);
  };

  // Tap-to-place on the map updates the selection (picker mode).
  const handleMapChange = (pt: { lat: number; lng: number }) => {
    setPoint(pt);
    setSelected({
      name: selected?.name || "Dropped pin",
      latitude: pt.lat,
      longitude: pt.lng,
      placeId: selected?.placeId,
      formattedAddress:
        selected?.formattedAddress ||
        `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`,
    });
  };

  // Results list = TanStack Virtual.
  const parentRef = useRef<HTMLDivElement>(null);
  const ROW_H = 64;
  const virtualizer = useVirtualizer({
    count: predictions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 6,
  });
  const rows = virtualizer.getVirtualItems();

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <header
        className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-10 h-10 -ml-1 rounded-xl bg-white/6 flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={22} color="#fff" />
        </button>
        <h1 className="text-lg font-extrabold">Location Picker Preview</h1>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pt-3 pb-10">
        <p className="text-xs font-extrabold tracking-widest text-white/50">
          DEV PREVIEW
        </p>
        <p className="mt-3 text-sm leading-5 text-white/[0.78]">
          This screen exercises the web location picker — a debounced place
          search (Photon/komoot, the same provider the native sheet falls back
          to) plus a tap-to-place map.
        </p>

        {/* Search input */}
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/4 px-3 py-2.5">
          <Search size={18} color="rgba(255,255,255,0.5)" />
          <input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Search venue or address"
            className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
          />
          {inputText ? (
            <button
              onClick={handleClear}
              aria-label="Clear"
              className="w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center active:scale-95"
            >
              <X size={15} color="#fff" />
            </button>
          ) : null}
        </div>

        {/* Predictions (TanStack Virtual) */}
        {predictions.length > 0 ? (
          <div
            ref={parentRef}
            className="mt-2 max-h-[256px] overflow-y-auto rounded-2xl border border-white/10 bg-white/4"
          >
            <div
              style={{ height: virtualizer.getTotalSize(), position: "relative" }}
            >
              {rows.map((row) => {
                const p = predictions[row.index];
                if (!p) return null;
                return (
                  <button
                    key={row.key}
                    onClick={() => handleSelect(p)}
                    className="absolute inset-x-0 flex w-full items-center gap-3 px-3 text-left active:bg-white/5"
                    style={{
                      top: 0,
                      height: ROW_H,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    <span className="w-9 h-9 rounded-lg bg-white/8 flex items-center justify-center shrink-0">
                      <MapPin size={16} color="#3FDCFF" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">
                        {p.mainText}
                      </span>
                      {p.secondaryText ? (
                        <span className="block truncate text-xs text-white/50">
                          {p.secondaryText}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : isLoading ? (
          <p className="mt-3 text-sm text-white/50">Searching…</p>
        ) : null}

        {/* Tap-to-place map */}
        <div className="mt-4">
          <MapPicker
            value={point}
            onChange={handleMapChange}
            zoom={13}
            height={260}
          />
          <p className="mt-2 text-xs text-white/40">
            Tap the map to drop a pin and set coordinates.
          </p>
        </div>

        {/* Selection summary */}
        <div className="mt-4 rounded-2xl border border-white/8 bg-white/4 p-4">
          <p className="text-xs font-extrabold tracking-wide text-white/[0.52]">
            Selection
          </p>
          <p className="mt-1.5 text-lg font-bold text-white">
            {selected?.name || "None yet"}
          </p>
          <p className="text-[13px] leading-[18px] text-white/70">
            {selected?.formattedAddress || inputText || "No typed query"}
          </p>
          {selected &&
          typeof selected.latitude === "number" &&
          typeof selected.longitude === "number" ? (
            <p className="mt-1 text-xs text-[#3FDCFF]">
              {selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default LocationPickerScreen;
