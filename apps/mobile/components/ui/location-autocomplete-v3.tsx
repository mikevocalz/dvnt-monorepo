/**
 * Custom Google Places Autocomplete Component (v3)
 * Uses the newer Google Places API (New) directly
 */

import { useRef, useEffect, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  FlatList,
  TouchableOpacity,
} from "react-native";
import { MapPin, X, Loader2 } from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useEventsLocationStore } from "@/lib/stores/events-location-store";

export interface LocationData {
  name: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  formattedAddress?: string;
}

interface LocationAutocompleteProps {
  value?: string;
  placeholder?: string;
  onLocationSelect: (location: LocationData) => void;
  onClear?: () => void;
  onTextChange?: (text: string) => void;
  embedded?: boolean;
  showLeadingIcon?: boolean;
}

interface GooglePlace {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text?: string;
  };
  types?: string[];
  latitude?: number;
  longitude?: number;
}

const GOOGLE_PLACES_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || "";

const US_STATE_CODES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const US_STATE_NAMES = Object.fromEntries(
  Object.entries(US_STATE_CODES).map(([name, code]) => [code, name]),
);

function normalizeMatchText(value?: string | null) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocalityHints(state?: string | null, city?: string | null) {
  const hints = new Set<string>();
  const normalizedState = normalizeMatchText(state);

  if (normalizedState) {
    hints.add(normalizedState);

    const stateCode = US_STATE_CODES[normalizedState];
    if (stateCode) {
      hints.add(normalizeMatchText(stateCode));
    }

    const stateName = US_STATE_NAMES[normalizedState.toUpperCase()];
    if (stateName) {
      hints.add(normalizeMatchText(stateName));
    }
  }

  const normalizedCity = normalizeMatchText(city);
  if (normalizedCity) {
    hints.add(normalizedCity);
  }

  return Array.from(hints).filter((hint) => hint.length >= 2);
}

function prioritizeNearbyPredictions(
  predictions: GooglePlace[],
  localityHints: string[],
  query: string,
) {
  if (localityHints.length === 0 || predictions.length === 0) {
    return predictions;
  }

  const normalizedQuery = normalizeMatchText(query);
  const hasExplicitLocationInQuery = normalizedQuery.includes(",");
  const scoredPredictions = predictions.map((prediction, index) => {
    const haystack = normalizeMatchText(
      `${prediction.description} ${prediction.structured_formatting.secondary_text || ""}`,
    );
    const score = localityHints.reduce((total, hint) => {
      if (!hint || !haystack.includes(hint)) return total;
      return total + (hint.includes(" ") ? 3 : 2);
    }, 0);

    return {
      prediction,
      score,
      index,
    };
  });

  const localMatches = scoredPredictions
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.prediction);

  if (!hasExplicitLocationInQuery && localMatches.length > 0) {
    return localMatches;
  }

  return scoredPredictions
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.prediction);
}

function createPredictionFromSuggestion(suggestion: any): GooglePlace | null {
  const place = suggestion?.place;
  const text = suggestion?.text?.text;
  const placeId = place?.id;
  const mainText = place?.displayName?.text || text || "";
  const secondaryText = place?.formattedAddress || "";

  if (!mainText) return null;

  return {
    place_id: placeId || `fallback-${mainText.toLowerCase()}`,
    description: secondaryText ? `${mainText}, ${secondaryText}` : mainText,
    structured_formatting: {
      main_text: mainText,
      secondary_text: secondaryText,
    },
    types: place?.types || [],
    latitude: place?.location?.latitude,
    longitude: place?.location?.longitude,
  };
}

function createPredictionFromTextSearchResult(place: any): GooglePlace | null {
  const mainText = place?.name;
  const secondaryText = place?.formatted_address;
  const placeId = place?.place_id;

  if (!mainText && !secondaryText) return null;

  return {
    place_id:
      placeId ||
      `textsearch-${normalizeMatchText(mainText || secondaryText || "")}`,
    description:
      mainText && secondaryText ? `${mainText}, ${secondaryText}` : mainText || secondaryText,
    structured_formatting: {
      main_text: mainText || secondaryText || "",
      secondary_text: secondaryText,
    },
    types: place?.types || [],
    latitude: place?.geometry?.location?.lat,
    longitude: place?.geometry?.location?.lng,
  };
}

function normalizePhotonPredictions(data: any): GooglePlace[] {
  if (!data || !Array.isArray(data.features)) return [];

  return data.features
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
        props.name ||
        props.street ||
        props.city ||
        props.state ||
        props.country;

      if (!mainText) return null;

      const secondaryText = [
        props.street,
        props.city,
        props.state,
        props.country,
      ]
        .filter(Boolean)
        .join(", ");

      return {
        place_id:
          props.osm_id != null
            ? `photon-${props.osm_type || "place"}-${props.osm_id}`
            : `photon-${normalizeMatchText(mainText)}-${latitude ?? "x"}-${longitude ?? "y"}`,
        description: secondaryText ? `${mainText}, ${secondaryText}` : mainText,
        structured_formatting: {
          main_text: mainText,
          secondary_text: secondaryText || undefined,
        },
        types: [props.osm_value || "geocode"],
        latitude,
        longitude,
      } satisfies GooglePlace;
    })
    .filter(Boolean)
    .slice(0, 8) as GooglePlace[];
}

function mergePredictions(
  primary: GooglePlace[],
  secondary: GooglePlace[],
): GooglePlace[] {
  const seen = new Set<string>();
  const merged: GooglePlace[] = [];

  for (const prediction of [...primary, ...secondary]) {
    const key =
      prediction.place_id || normalizeMatchText(prediction.description);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(prediction);
  }

  return merged;
}

function createManualPrediction(
  query: string,
  activeCity?: { name?: string | null; state?: string | null } | null,
): GooglePlace | null {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return null;

  const localityParts = [activeCity?.name, activeCity?.state].filter(Boolean);
  const secondaryText =
    localityParts.length > 0 ? `${localityParts.join(", ")}, USA` : "Nearby";

  return {
    place_id: `manual-${normalizeMatchText(`${normalizedQuery}-${secondaryText}`)}`,
    description: `${normalizedQuery}, ${secondaryText}`,
    structured_formatting: {
      main_text: normalizedQuery,
      secondary_text: secondaryText,
    },
    types: ["establishment"],
  };
}

export function LocationAutocompleteV3({
  value,
  placeholder = "Search location...",
  onLocationSelect,
  onClear,
  onTextChange,
  embedded = false,
  showLeadingIcon = true,
}: LocationAutocompleteProps) {
  const { colors } = useColorScheme();
  const activeCity = useEventsLocationStore((state) => state.activeCity);
  const deviceLat = useEventsLocationStore((state) => state.deviceLat);
  const deviceLng = useEventsLocationStore((state) => state.deviceLng);
  const [inputText, setInputText] = useState(value || "");
  const [predictions, setPredictions] = useState<GooglePlace[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const requestIdRef = useRef(0);
  const suppressNextLookupRef = useRef(false);
  const lastResolvedValueRef = useRef(value || "");
  const hasGooglePlacesKey =
    !!GOOGLE_PLACES_API_KEY &&
    GOOGLE_PLACES_API_KEY !== "your_google_places_api_key_here";
  const localityHints = getLocalityHints(activeCity?.state, activeCity?.name);
  const biasLatitude = activeCity?.lat ?? deviceLat;
  const biasLongitude = activeCity?.lng ?? deviceLng;

  // Debounce the input text for API calls (300ms delay)
  const debouncedText = useDebounce(inputText, 300);

  useEffect(() => {
    const nextValue = value || "";

    if (nextValue === lastResolvedValueRef.current || nextValue === inputText) {
      return;
    }

    lastResolvedValueRef.current = nextValue;
    suppressNextLookupRef.current = true;
    setInputText(nextValue);
    setPredictions([]);
    setShowDropdown(false);
  }, [inputText, value]);

  useEffect(() => {
    if (!hasGooglePlacesKey) {
      console.warn(
        "[LocationAutocompleteV3] Google Places API key not configured in this build. Falling back to Photon search.",
      );
    }
  }, [hasGooglePlacesKey]);

  // Fetch predictions when debounced text changes
  useEffect(() => {
    if (debouncedText.length < 2) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }

    if (suppressNextLookupRef.current) {
      suppressNextLookupRef.current = false;
      return;
    }

    void fetchPredictions(debouncedText);
  }, [debouncedText]);

  const fetchPhotonPredictions = useCallback(
    async (text: string) => {
      const params = new URLSearchParams({
        q: text,
        limit: "8",
        lang: "en",
      });

      if (typeof biasLatitude === "number" && typeof biasLongitude === "number") {
        params.set("lat", String(biasLatitude));
        params.set("lon", String(biasLongitude));
      }

      const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Photon HTTP error! status: ${response.status}`);
      }

      return normalizePhotonPredictions(await response.json());
    },
    [biasLatitude, biasLongitude],
  );

  const fetchPredictions = useCallback(async (text: string) => {
    const normalizedText = text.trim();

    if (normalizedText.length < 2) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setShowDropdown(true);

    try {
      if (!hasGooglePlacesKey) {
        const manualPrediction = createManualPrediction(normalizedText, activeCity);
        const photonPredictions = await fetchPhotonPredictions(normalizedText);
        if (requestId !== requestIdRef.current) return;
        setPredictions(
          prioritizeNearbyPredictions(
            mergePredictions(
              photonPredictions,
              mergePredictions(
                manualPrediction ? [manualPrediction] : [],
                getPopularLocations(normalizedText),
              ),
            ),
            localityHints,
            normalizedText,
          ),
        );
        return;
      }

      const localTextSearchPromise =
        typeof biasLatitude === "number" && typeof biasLongitude === "number"
          ? fetch(
              `https://maps.googleapis.com/maps/api/place/textsearch/json?key=${GOOGLE_PLACES_API_KEY}&query=${encodeURIComponent(normalizedText)}&location=${biasLatitude},${biasLongitude}&radius=250000&language=en&region=us`,
            )
              .then(async (response) => {
                if (!response.ok) return [];
                const data = await response.json();
                if (
                  data.status !== "OK" &&
                  data.status !== "ZERO_RESULTS"
                ) {
                  return [];
                }
                return (data.results || [])
                  .map(createPredictionFromTextSearchResult)
                  .filter(Boolean) as GooglePlace[];
              })
              .catch((error) => {
                console.error(
                  "[LocationAutocompleteV3] Local text search error:",
                  error,
                );
                return [] as GooglePlace[];
              })
          : Promise.resolve([] as GooglePlace[]);

      // Use the Google Places API with the correct parameters for Instagram-like results
      const locationBiasQuery =
        typeof biasLatitude === "number" && typeof biasLongitude === "number"
          ? `&location=${biasLatitude},${biasLongitude}&radius=250000`
          : "";
      const [response, localTextPredictions] = await Promise.all([
        fetch(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?key=${GOOGLE_PLACES_API_KEY}&input=${encodeURIComponent(normalizedText)}&language=en&components=country:us${locationBiasQuery}&strictbounds=false`,
        ),
        localTextSearchPromise,
      ]);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.status === "REQUEST_DENIED") {
        console.error(
          "[LocationAutocompleteV3] API error:",
          data.error_message,
        );
        // Try alternative endpoint for Places API (New)
        await tryAlternativeAPI(normalizedText, requestId);
        return;
      }

      if (requestId !== requestIdRef.current) return;
      const nextPredictions = mergePredictions(
        localTextPredictions,
        data.predictions || [],
      );
      setPredictions(
        prioritizeNearbyPredictions(nextPredictions, localityHints, normalizedText),
      );
    } catch (error) {
      console.error("[LocationAutocompleteV3] Fetch error:", error);
      // Try alternative API on error
      await tryAlternativeAPI(normalizedText, requestId);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    activeCity,
    biasLatitude,
    biasLongitude,
    fetchPhotonPredictions,
    hasGooglePlacesKey,
    localityHints,
  ]);

  // Try alternative Places API (New) endpoint
  const tryAlternativeAPI = async (text: string, requestId: number) => {
    let photonPredictions: GooglePlace[] = [];

    try {
      photonPredictions = await fetchPhotonPredictions(text).catch(
        (error) => {
          console.error("[LocationAutocompleteV3] Photon fallback error:", error);
          return [] as GooglePlace[];
        },
      );

      if (!hasGooglePlacesKey) {
        const manualPrediction = createManualPrediction(text, activeCity);
        if (requestId !== requestIdRef.current) return;
        setPredictions(
          prioritizeNearbyPredictions(
            mergePredictions(
              photonPredictions,
              mergePredictions(
                manualPrediction ? [manualPrediction] : [],
                getPopularLocations(text),
              ),
            ),
            localityHints,
            text,
          ),
        );
        return;
      }

      const localTextPredictions =
        typeof biasLatitude === "number" && typeof biasLongitude === "number"
          ? await fetch(
              `https://maps.googleapis.com/maps/api/place/textsearch/json?key=${GOOGLE_PLACES_API_KEY}&query=${encodeURIComponent(text)}&location=${biasLatitude},${biasLongitude}&radius=250000&language=en&region=us`,
            )
              .then(async (response) => {
                if (!response.ok) return [];
                const data = await response.json();
                if (
                  data.status !== "OK" &&
                  data.status !== "ZERO_RESULTS"
                ) {
                  return [];
                }
                return (data.results || [])
                  .map(createPredictionFromTextSearchResult)
                  .filter(Boolean) as GooglePlace[];
              })
              .catch((error) => {
                console.error(
                  "[LocationAutocompleteV3] Local text search error:",
                  error,
                );
                return [] as GooglePlace[];
              })
          : [];
      const response = await fetch(
        `https://places.googleapis.com/v1/places:autocomplete?key=${GOOGLE_PLACES_API_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          },
          body: JSON.stringify({
            input: text,
            languageCode: "en",
            includedRegionCodes: ["us"],
            ...(
              typeof biasLatitude === "number" &&
              typeof biasLongitude === "number"
                ? {
                    locationBias: {
                      circle: {
                        center: {
                          latitude: biasLatitude,
                          longitude: biasLongitude,
                        },
                        radius: 250000,
                      },
                    },
                  }
                : {}
            ),
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        if (data.suggestions) {
          const convertedPredictions = data.suggestions
            .map(createPredictionFromSuggestion)
            .filter(Boolean);
          if (requestId !== requestIdRef.current) return;
          setPredictions(
            prioritizeNearbyPredictions(
              mergePredictions(
                photonPredictions,
                mergePredictions(localTextPredictions, convertedPredictions),
              ),
              localityHints,
              text,
            ),
          );
          return;
        }
      }
    } catch (error) {
      console.error("[LocationAutocompleteV3] Alternative API error:", error);
    }

    // Ultimate fallback to popular locations
    if (requestId !== requestIdRef.current) return;
    const manualPrediction = createManualPrediction(text, activeCity);
    setPredictions(
      prioritizeNearbyPredictions(
        mergePredictions(
          photonPredictions,
          mergePredictions(
            manualPrediction ? [manualPrediction] : [],
            getPopularLocations(text),
          ),
        ),
        localityHints,
        text,
      ),
    );
  };

  // Fallback popular locations when API is not working
  const getPopularLocations = (searchText: string): GooglePlace[] => {
    const popularPlaces = [
      {
        place_id: "chIJrTLr-GyuEmsRBfyf1GDuE7U",
        description: "Madison Square Garden, New York, NY, USA",
        structured_formatting: {
          main_text: "Madison Square Garden",
          secondary_text: "New York, NY, USA",
        },
      },
      {
        place_id: "chIJvUwsRj5ZwokR-9v8Ch2w_mWQ",
        description: "Times Square, New York, NY, USA",
        structured_formatting: {
          main_text: "Times Square",
          secondary_text: "New York, NY, USA",
        },
      },
      {
        place_id: "chIJQ3S6Gh6ZwokR4jA_p_kd_hvw",
        description: "Central Park, New York, NY, USA",
        structured_formatting: {
          main_text: "Central Park",
          secondary_text: "New York, NY, USA",
        },
      },
      {
        place_id: "chIJdRlClxZawokR7_p3d5i9SQhY",
        description: "Brooklyn Bridge, New York, NY, USA",
        structured_formatting: {
          main_text: "Brooklyn Bridge",
          secondary_text: "New York, NY, USA",
        },
      },
      {
        place_id: "chIJN8h6Cc6ZwokR2Mj_hQyGdRYY",
        description: "Statue of Liberty, New York, NY, USA",
        structured_formatting: {
          main_text: "Statue of Liberty",
          secondary_text: "New York, NY, USA",
        },
      },
      {
        place_id: "chIJc3RyCQ-ZwokR6jE3d_dk32Ks",
        description: "Empire State Building, New York, NY, USA",
        structured_formatting: {
          main_text: "Empire State Building",
          secondary_text: "New York, NY, USA",
        },
      },
      {
        place_id: "chIJt9uV8l6ZwokRj3d_dk32Ks",
        description: "One World Trade Center, New York, NY, USA",
        structured_formatting: {
          main_text: "One World Trade Center",
          secondary_text: "New York, NY, USA",
        },
      },
      {
        place_id: "chIJr9LdDh6ZwokR2Mj_hQyGdRYY",
        description: "High Line, New York, NY, USA",
        structured_formatting: {
          main_text: "High Line",
          secondary_text: "New York, NY, USA",
        },
      },
    ];

    if (!searchText || searchText.length < 2) return [];

    // Filter popular places based on search text
    return popularPlaces.filter(
      (place) =>
        place.structured_formatting.main_text
          .toLowerCase()
          .includes(searchText.toLowerCase()) ||
        place.description.toLowerCase().includes(searchText.toLowerCase()),
    );
  };

  const fetchPlaceDetails = async (placeId: string) => {
    if (
      !hasGooglePlacesKey ||
      placeId.startsWith("photon-") ||
      placeId.startsWith("manual-")
    ) {
      return null;
    }

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?key=${GOOGLE_PLACES_API_KEY}&place_id=${placeId}&fields=formatted_address,name,geometry,place_id,types`,
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.status === "REQUEST_DENIED") {
        console.error(
          "[LocationAutocompleteV3] Details API error:",
          data.error_message,
        );
        // Return fallback coordinates for popular locations
        return getFallbackLocationDetails(placeId);
      }

      return data.result;
    } catch (error) {
      console.error("[LocationAutocompleteV3] Details fetch error:", error);
      // Return fallback coordinates for popular locations
      return getFallbackLocationDetails(placeId);
    }
  };

  // Fallback location details for popular places
  const getFallbackLocationDetails = (placeId: string) => {
    const fallbackDetails: Record<string, any> = {
      "chIJrTLr-GyuEmsRBfyf1GDuE7U": {
        place_id: "chIJrTLr-GyuEmsRBfyf1GDuE7U",
        name: "Madison Square Garden",
        formatted_address: "Madison Square Garden, New York, NY, USA",
        geometry: {
          location: {
            lat: 40.7505,
            lng: -73.9934,
          },
        },
      },
      "chIJvUwsRj5ZwokR-9v8Ch2w_mWQ": {
        place_id: "chIJvUwsRj5ZwokR-9v8Ch2w_mWQ",
        name: "Times Square",
        formatted_address: "Times Square, New York, NY, USA",
        geometry: {
          location: {
            lat: 40.758,
            lng: -73.9855,
          },
        },
      },
      chIJQ3S6Gh6ZwokR4jA_p_kd_hvw: {
        place_id: "chIJQ3S6Gh6ZwokR4jA_p_kd_hvw",
        name: "Central Park",
        formatted_address: "Central Park, New York, NY, USA",
        geometry: {
          location: {
            lat: 40.7829,
            lng: -73.9654,
          },
        },
      },
      chIJdRlClxZawokR7_p3d5i9SQhY: {
        place_id: "chIJdRlClxZawokR7_p3d5i9SQhY",
        name: "Brooklyn Bridge",
        formatted_address: "Brooklyn Bridge, New York, NY, USA",
        geometry: {
          location: {
            lat: 40.7061,
            lng: -73.9969,
          },
        },
      },
      chIJN8h6Cc6ZwokR2Mj_hQyGdRYY: {
        place_id: "chIJN8h6Cc6ZwokR2Mj_hQyGdRYY",
        name: "Statue of Liberty",
        formatted_address: "Statue of Liberty, New York, NY, USA",
        geometry: {
          location: {
            lat: 40.6892,
            lng: -74.0445,
          },
        },
      },
      "chIJc3RyCQ-ZwokR6jE3d_dk32Ks": {
        place_id: "chIJc3RyCQ-ZwokR6jE3d_dk32Ks",
        name: "Empire State Building",
        formatted_address: "Empire State Building, New York, NY, USA",
        geometry: {
          location: {
            lat: 40.7484,
            lng: -73.9857,
          },
        },
      },
      chIJt9uV8l6ZwokRj3d_dk32Ks: {
        place_id: "chIJt9uV8l6ZwokRj3d_dk32Ks",
        name: "One World Trade Center",
        formatted_address: "One World Trade Center, New York, NY, USA",
        geometry: {
          location: {
            lat: 40.7127,
            lng: -74.0134,
          },
        },
      },
      chIJr9LdDh6ZwokR2Mj_hQyGdRYY: {
        place_id: "chIJr9LdDh6ZwokR2Mj_hQyGdRYY",
        name: "High Line",
        formatted_address: "High Line, New York, NY, USA",
        geometry: {
          location: {
            lat: 40.748,
            lng: -74.0048,
          },
        },
      },
    };

    return fallbackDetails[placeId] || null;
  };

  const handleSelectPrediction = async (prediction: GooglePlace) => {
    suppressNextLookupRef.current = true;
    lastResolvedValueRef.current = prediction.description;
    setInputText(prediction.description);
    setShowDropdown(false);
    setPredictions([]);

    if (
      prediction.place_id.startsWith("manual-") ||
      prediction.place_id.startsWith("photon-") ||
      !hasGooglePlacesKey
    ) {
      onLocationSelect({
        name: prediction.structured_formatting.main_text,
        placeId: prediction.place_id,
        formattedAddress: prediction.description,
        latitude: prediction.latitude,
        longitude: prediction.longitude,
      });
      return;
    }

    // Fetch detailed place information
    const details = await fetchPlaceDetails(prediction.place_id);

    const locationData: LocationData = {
      name: prediction.structured_formatting.main_text,
      placeId: prediction.place_id,
      formattedAddress: prediction.description,
      latitude: details?.geometry?.location?.lat ?? prediction.latitude,
      longitude: details?.geometry?.location?.lng ?? prediction.longitude,
    };

    onLocationSelect(locationData);
  };

  const handleTextChange = useCallback(
    (text: string) => {
      lastResolvedValueRef.current = text;
      setInputText(text);
      setShowDropdown(text.trim().length >= 2);
      if (onTextChange) {
        onTextChange(text);
      }
    },
    [onTextChange],
  );

  const handleClear = () => {
    suppressNextLookupRef.current = true;
    lastResolvedValueRef.current = "";
    setInputText("");
    setPredictions([]);
    setShowDropdown(false);
    if (onClear) {
      onClear();
    }
  };

  const handleSubmit = () => {
    if (inputText.trim()) {
      suppressNextLookupRef.current = true;
      lastResolvedValueRef.current = inputText.trim();
      const locationData: LocationData = {
        name: inputText.trim(),
      };
      onLocationSelect(locationData);
      setShowDropdown(false);
    }
  };

  const visiblePredictions = (() => {
    const manualPrediction =
      predictions.length === 0 && inputText.trim().length >= 2
        ? createManualPrediction(inputText, activeCity)
        : null;

    return manualPrediction
      ? mergePredictions([manualPrediction], predictions)
      : predictions;
  })();

  return (
    <View style={styles.container}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: embedded ? "transparent" : colors.card,
          borderRadius: embedded ? 0 : 16,
          paddingHorizontal: embedded ? 0 : 12,
        }}
      >
        {showLeadingIcon ? (
          <MapPin size={18} color={colors.mutedForeground} />
        ) : null}
        <TextInput
          style={{
            flex: 1,
            height: 48,
            color: colors.foreground,
            fontSize: 15,
            marginLeft: showLeadingIcon ? 8 : 0,
            backgroundColor: "transparent",
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={inputText}
          onChangeText={handleTextChange}
          onSubmitEditing={handleSubmit}
          onFocus={() => {
            const normalizedText = inputText.trim();
            setShowDropdown(normalizedText.length >= 2);
            if (
              normalizedText.length >= 2 &&
              predictions.length === 0 &&
              !isLoading
            ) {
              void fetchPredictions(normalizedText);
            }
          }}
        />
        {isLoading && <Loader2 size={18} color={colors.mutedForeground} />}
        {inputText.length > 0 && !isLoading && (
          <Pressable onPress={handleClear} hitSlop={8}>
            <X size={18} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {showDropdown && visiblePredictions.length > 0 && (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 12,
            marginTop: 8,
            borderWidth: 1,
            borderColor: colors.border,
            maxHeight: 200,
            position: "absolute",
            top: 56,
            left: 0,
            right: 0,
            zIndex: 1000,
            elevation: 1000,
          }}
        >
          <FlatList
            keyboardShouldPersistTaps="always"
            data={visiblePredictions}
            keyExtractor={(item) => item.place_id}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => handleSelectPrediction(item)}
                style={{
                  padding: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <MapPin size={16} color={colors.mutedForeground} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: 15,
                      fontWeight: "500",
                    }}
                  >
                    {item.structured_formatting.main_text}
                  </Text>
                  {item.structured_formatting.secondary_text && (
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 13,
                        marginTop: 2,
                      }}
                    >
                      {item.structured_formatting.secondary_text}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    zIndex: 1000,
  },
});
