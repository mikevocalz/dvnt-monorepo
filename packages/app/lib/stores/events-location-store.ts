import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import {
  applyCityVisibility,
  applyFindEventsMode,
  applyRevokeCityVisibility,
  DEFAULT_VISIBILITY_DURATION_ID,
  readCityVisibility,
  visibilityDurationMs,
  type CityVisibilityGrant,
  type LocationMode,
  type VisibilityDurationId,
} from "@dvnt/app/lib/stores/city-discovery-visibility";

export interface City {
  id: number;
  name: string;
  state: string | null;
  country: string;
  lat: number;
  lng: number;
  timezone: string | null;
  slug: string;
}

export type { LocationMode, CityVisibilityGrant };

interface EventsLocationState {
  activeCity: City | null;
  /** How this member finds events. Says nothing about who can see them. */
  locationMode: LocationMode;
  deviceLat: number | null;
  deviceLng: number | null;
  recentCities: City[];
  /**
   * Whether other members can see the city this member picked. Off by default,
   * always time-boxed, and read through `readCityVisibility` so an expired
   * grant is off even if nothing was running to expire it.
   */
  cityVisibility: CityVisibilityGrant | null;
  /** How long the next grant lasts. Remembered so the member picks once. */
  visibilityDurationId: VisibilityDurationId;
  weatherData: WeatherDay[] | null;
  weatherCityId: number | null;
  weatherFetchedAt: number | null;
  /** Geocoded fallback coords for events that only have an address string */
  geocodedEventCoords: Record<string, { lat: number; lng: number }>;
  // Actions
  setActiveCity: (city: City) => void;
  setLocationMode: (mode: LocationMode) => void;
  setDeviceLocation: (lat: number, lng: number) => void;
  addRecentCity: (city: City) => void;
  setVisibilityDuration: (id: VisibilityDurationId) => void;
  /** Start a bounded grant for `city`. Never called by a find-events action. */
  showMeInCity: (city: City) => void;
  /** One-tap revoke. */
  hideMeInCity: () => void;
  setWeatherData: (data: WeatherDay[], cityId: number) => void;
  clearWeather: () => void;
  setGeocodedEventCoord: (eventId: string, coords: { lat: number; lng: number }) => void;
}

export interface WeatherDay {
  date: string; // ISO date
  dayName: string; // "Mon", "Tue", etc.
  high: number; // Fahrenheit
  low: number;
  icon: string; // weather icon key
  shortForecast: string;
}

export const useEventsLocationStore = create<EventsLocationState>()(
  persist(
    (set, get) => ({
      activeCity: null,
      locationMode: "city",
      deviceLat: null,
      deviceLng: null,
      recentCities: [],
      cityVisibility: null,
      visibilityDurationId: DEFAULT_VISIBILITY_DURATION_ID,
      weatherData: null,
      weatherCityId: null,
      weatherFetchedAt: null,
      geocodedEventCoords: {},

      setActiveCity: (city) => {
        set({ activeCity: city });
        // Also add to recents
        get().addRecentCity(city);
      },

      // Routed through applyFindEventsMode so the "finding events never makes
      // you findable" invariant lives in one tested place instead of in the
      // heads of everyone who adds a location mode later.
      setLocationMode: (mode) => set((s) => applyFindEventsMode(s, mode)),

      setDeviceLocation: (lat, lng) => set({ deviceLat: lat, deviceLng: lng }),

      addRecentCity: (city) =>
        set((s) => {
          const filtered = s.recentCities.filter((c) => c.id !== city.id);
          return { recentCities: [city, ...filtered].slice(0, 5) };
        }),

      setVisibilityDuration: (id) => set({ visibilityDurationId: id }),

      showMeInCity: (city) =>
        set((s) =>
          applyCityVisibility(
            s,
            city,
            visibilityDurationMs(s.visibilityDurationId),
            Date.now(),
          ),
        ),

      hideMeInCity: () => set((s) => applyRevokeCityVisibility(s)),

      setWeatherData: (data, cityId) =>
        set({
          weatherData: data,
          weatherCityId: cityId,
          weatherFetchedAt: Date.now(),
        }),

      clearWeather: () =>
        set({ weatherData: null, weatherCityId: null, weatherFetchedAt: null }),

      setGeocodedEventCoord: (eventId, coords) =>
        set((s) => ({
          geocodedEventCoords: { ...s.geocodedEventCoords, [eventId]: coords },
        })),
    }),
    {
      name: "events-location",
      storage: mmkvStorage,
      partialize: (state) => ({
        activeCity: state.activeCity,
        locationMode: state.locationMode,
        deviceLat: state.deviceLat,
        deviceLng: state.deviceLng,
        recentCities: state.recentCities,
        cityVisibility: state.cityVisibility,
        visibilityDurationId: state.visibilityDurationId,
        weatherData: state.weatherData,
        weatherCityId: state.weatherCityId,
        weatherFetchedAt: state.weatherFetchedAt,
      }),
    },
  ),
);

/**
 * The only supported way to ask "is this member visible right now". Returns the
 * grant when it is live and `null` otherwise, so a caller cannot read a stale
 * `cityVisibility` field and treat it as on.
 *
 * ponytail: recomputed on render rather than driven by a timer, so a screen
 * sitting open past the end time keeps showing "on" until something else
 * re-renders it. Every entry point to this setting re-mounts, which covers the
 * real cases; a ticking clock is not worth a subscription here.
 */
export function useActiveCityVisibility(): CityVisibilityGrant | null {
  const grant = useEventsLocationStore((s) => s.cityVisibility);
  return readCityVisibility(grant, Date.now());
}
