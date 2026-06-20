import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import type {
  PlacesBias,
  PlacesLocationData,
  PlacesPrediction,
} from "@dvnt/app/lib/places/types";

const DEFAULT_BIAS: PlacesBias = {
  latitude: 34.0522,
  longitude: -118.2437,
  radiusMeters: 50_000,
};

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

async function requestDeviceBias(): Promise<PlacesBias | null> {
  if (Platform.OS === "web") {
    if (typeof navigator === "undefined" || !navigator.geolocation) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            radiusMeters: 50_000,
          }),
        () => resolve(null),
        { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 2500 },
      );
    });
  }

  try {
    const ExpoLocation = await import("expo-location");
    const permission = await ExpoLocation.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return null;
    const position = await ExpoLocation.getCurrentPositionAsync({
      accuracy: ExpoLocation.Accuracy.Balanced,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      radiusMeters: 50_000,
    };
  } catch {
    return null;
  }
}

interface UsePlacesAutocompleteOptions {
  value?: string;
  onLocationSelect?: (location: PlacesLocationData) => void;
  debounceMs?: number;
}

export function usePlacesAutocomplete({
  value = "",
  onLocationSelect,
  debounceMs = 280,
}: UsePlacesAutocompleteOptions = {}) {
  const activeCity = useEventsLocationStore((s) => s.activeCity);
  const deviceLat = useEventsLocationStore((s) => s.deviceLat);
  const deviceLng = useEventsLocationStore((s) => s.deviceLng);
  const setDeviceLocation = useEventsLocationStore((s) => s.setDeviceLocation);

  const [input, setInput] = useState(value);
  const [predictions, setPredictions] = useState<PlacesPrediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [deviceBias, setDeviceBias] = useState<PlacesBias | null>(null);
  const requestIdRef = useRef(0);
  const suppressLookupRef = useRef(false);
  const sessionTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (value !== input) {
      suppressLookupRef.current = true;
      setInput(value);
    }
  }, [input, value]);

  useEffect(() => {
    if (
      activeCity ||
      (isFiniteCoord(deviceLat) && isFiniteCoord(deviceLng)) ||
      deviceBias
    ) {
      return;
    }

    let cancelled = false;
    requestDeviceBias().then((bias) => {
      if (cancelled || !bias) return;
      setDeviceBias(bias);
      setDeviceLocation(bias.latitude, bias.longitude);
    });
    return () => {
      cancelled = true;
    };
  }, [activeCity, deviceBias, deviceLat, deviceLng, setDeviceLocation]);

  const locationBias = useMemo<PlacesBias>(() => {
    if (activeCity) {
      return {
        latitude: activeCity.lat,
        longitude: activeCity.lng,
        radiusMeters: 50_000,
      };
    }
    if (isFiniteCoord(deviceLat) && isFiniteCoord(deviceLng)) {
      return { latitude: deviceLat, longitude: deviceLng, radiusMeters: 50_000 };
    }
    return deviceBias || DEFAULT_BIAS;
  }, [activeCity, deviceBias, deviceLat, deviceLng]);

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
    [ensureSession, locationBias],
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
