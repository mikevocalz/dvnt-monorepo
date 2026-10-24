import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocationSettings } from "@dvnt/app/lib/hooks/use-member-map";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import type {
  PlacesBias,
  PlacesLocationData,
  PlacesOrigin,
  PlacesPrediction,
} from "@dvnt/app/lib/places/types";

function createSessionToken() {
  const cryptoApi = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isFiniteCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

interface UsePlacesAutocompleteOptions {
  value?: string;
  onLocationSelect?: (location: PlacesLocationData) => void;
  debounceMs?: number;
  /** When set, each prediction comes back with distanceMeters from here. */
  origin?: PlacesOrigin | null;
}

export function usePlacesAutocomplete({
  value = "",
  onLocationSelect,
  debounceMs = 280,
  origin = null,
}: UsePlacesAutocompleteOptions = {}) {
  const access = useLocationSettings();
  const activeCity = useEventsLocationStore((s) => s.activeCity);
  const deviceLat = useEventsLocationStore((s) => s.deviceLat);
  const deviceLng = useEventsLocationStore((s) => s.deviceLng);

  const [input, setInput] = useState(value);
  const [predictions, setPredictions] = useState<PlacesPrediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const requestIdRef = useRef(0);
  const suppressLookupRef = useRef(false);
  const sessionTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (value !== input) {
      suppressLookupRef.current = true;
      setInput(value);
    }
  }, [input, value]);

  const locationBias = useMemo<PlacesBias | null>(() => {
    if (activeCity) {
      return {
        latitude: activeCity.lat,
        longitude: activeCity.lng,
        radiusMeters: 50_000,
      };
    }
    if (access.enabled && isFiniteCoord(deviceLat) && isFiniteCoord(deviceLng)) {
      return { latitude: deviceLat, longitude: deviceLng, radiusMeters: 50_000 };
    }
    // No city, no device location — send null so the edge fn biases to the
    // user's approximate location via their IP instead of a hardcoded default
    // (which used to pin everyone to LA — an NYC user got LA venues).
    return null;
  }, [activeCity, access.enabled, deviceLat, deviceLng]);

  // Depend on the numbers, not the object, so a caller passing a fresh
  // { latitude, longitude } literal each render does not refire the search.
  const originLat = access.enabled ? origin?.latitude : undefined;
  const originLng = access.enabled ? origin?.longitude : undefined;

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
  }, []);

  const ensureSession = useCallback(() => {
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = createSessionToken();
    }
    return sessionTokenRef.current;
  }, []);

  const search = useCallback(
    async (text: string) => {
      const query = text.trim();
      if (query.length < 2) {
        setPredictions([]);
        setShowDropdown(false);
        setError(null);
        return;
      }

      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setShowDropdown(true);
      setError(null);

      const { data, error: invokeError } = await supabase.functions.invoke<{
        ok: boolean;
        predictions?: PlacesPrediction[];
        error?: string;
      }>("places-autocomplete", {
        body: {
          input: query,
          sessionToken: ensureSession(),
          locationBias,
          allowIpBias: access.enabled,
          ...(isFiniteCoord(originLat) && isFiniteCoord(originLng)
            ? { origin: { latitude: originLat, longitude: originLng } }
            : {}),
        },
      });

      if (requestId !== requestIdRef.current) return;

      if (invokeError || !data?.ok) {
        setPredictions([]);
        setError(data?.error || invokeError?.message || "Location search failed.");
      } else {
        setPredictions(data.predictions || []);
      }
      setIsLoading(false);
    },
    [ensureSession, locationBias, originLat, originLng, access.enabled],
  );

  useEffect(() => {
    if (suppressLookupRef.current) {
      suppressLookupRef.current = false;
      return;
    }

    const timer = setTimeout(() => {
      void search(input);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [debounceMs, input, search]);

  const setQuery = useCallback(
    (text: string) => {
      setInput(text);
      setError(null);
      if (!sessionTokenRef.current && text.trim().length > 0) {
        sessionTokenRef.current = createSessionToken();
      }
      if (!text.trim()) {
        setPredictions([]);
        setShowDropdown(false);
        resetSession();
      }
    },
    [resetSession],
  );

  const clear = useCallback(() => {
    setQuery("");
    setPredictions([]);
    setShowDropdown(false);
    setError(null);
    resetSession();
  }, [resetSession, setQuery]);

  const selectPrediction = useCallback(
    async (prediction: PlacesPrediction) => {
      setIsSelecting(true);
      setError(null);
      const token = ensureSession();

      const { data, error: invokeError } = await supabase.functions.invoke<{
        ok: boolean;
        place?: PlacesLocationData;
        error?: string;
      }>("places-details", {
        body: {
          placeId: prediction.placeId,
          sessionToken: token,
        },
      });

      setIsSelecting(false);

      if (invokeError || !data?.ok || !data.place) {
        setError(data?.error || invokeError?.message || "Location details failed.");
        return null;
      }

      const place = data.place;
      const location: PlacesLocationData = {
        ...place,
        placeId: place.placeId || prediction.placeId,
        name: place.name || prediction.mainText,
        formattedAddress: place.formattedAddress || prediction.fullText,
      };

      suppressLookupRef.current = true;
      setInput(location.name);
      setPredictions([]);
      setShowDropdown(false);
      resetSession();
      onLocationSelect?.(location);
      return location;
    },
    [ensureSession, onLocationSelect, resetSession],
  );

  return {
    input,
    setInput: setQuery,
    predictions,
    isLoading,
    isSelecting,
    error,
    showDropdown,
    setShowDropdown,
    locationBias,
    clear,
    selectPrediction,
    sessionToken: sessionTokenRef.current,
  };
}
