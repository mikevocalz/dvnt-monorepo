"use client";

import { MapPin } from "lucide-react";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import { usePlacesAutocomplete } from "@dvnt/app/lib/hooks/use-places-autocomplete";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";

const inputCls =
  "w-full h-11 px-3 rounded-xl bg-white/6 border border-white/10 text-[15px] text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60";

export function CreatePostLocation() {
  const location = useCreatePostStore((state) => state.location);
  const setLocation = useCreatePostStore((state) => state.setLocation);
  const setLocationData = useCreatePostStore((state) => state.setLocationData);
  const activeCity = useEventsLocationStore((state) => state.activeCity);

  const places = usePlacesAutocomplete({
    value: location,
    onLocationSelect: (loc) => {
      setLocationData({
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        placeId: loc.placeId,
      });
    },
  });

  return (
    <div className="relative mt-3">
      <input
        value={places.input}
        onChange={(event) => {
          const text = event.target.value;
          places.setInput(text);
          setLocation(text);
          if (!text.trim()) setLocationData(null);
        }}
        onFocus={() => places.setShowDropdown(true)}
        onBlur={() => setTimeout(() => places.setShowDropdown(false), 150)}
        placeholder="Add location"
        maxLength={100}
        className={inputCls}
        aria-label="Add location"
      />
      {places.showDropdown ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-white/12 bg-[#10121B] shadow-xl">
          {!places.input.trim() && activeCity ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setLocationData({
                  name: activeCity.state
                    ? `${activeCity.name}, ${activeCity.state}`
                    : activeCity.name,
                  latitude: activeCity.lat,
                  longitude: activeCity.lng,
                });
                places.setShowDropdown(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-cyan-500/10"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15">
                <MapPin size={15} className="text-cyan-300" />
              </span>
              <span>
                <span className="block text-sm font-bold text-white">Current location</span>
                <span className="block text-xs text-white/55">
                  {activeCity.state ? `${activeCity.name}, ${activeCity.state}` : activeCity.name}
                </span>
              </span>
            </button>
          ) : null}

          {places.input.trim().length >= 2 ? (
            places.error ? (
              <p className="px-3 py-2.5 text-[13px] text-white/60">{places.error}</p>
            ) : places.predictions.length > 0 ? (
              places.predictions.map((prediction) => (
                <button
                  key={prediction.placeId}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => places.selectPrediction(prediction)}
                  className="flex w-full items-center gap-2.5 border-t border-white/6 px-3 py-2.5 text-left hover:bg-cyan-500/10"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/12">
                    <MapPin size={14} className="text-cyan-300" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-white">{prediction.mainText}</span>
                    {prediction.secondaryText || prediction.fullText ? (
                      <span className="block truncate text-xs text-white/55">
                        {prediction.secondaryText || prediction.fullText}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))
            ) : places.isLoading ? null : (
              <p className="px-3 py-2.5 text-[13px] text-white/60">No places found</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
