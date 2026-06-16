import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { createMMKV } from "react-native-mmkv";
import * as Location from "expo-location";
import { Debouncer } from "@tanstack/react-pacer";
import {
  Building,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  Search,
  X,
} from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";
import { GlassSheetBackground } from "@/components/sheets/glass-sheet-background";

export type LocationData = {
  name: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  formattedAddress?: string;
};

interface LocationAutocompleteProps {
  value?: string;
  placeholder?: string;
  onLocationSelect: (location: LocationData) => void;
  onClear?: () => void;
  onTextChange?: (text: string) => void;
  autoOpen?: boolean;
  hideTrigger?: boolean;
  onDismiss?: () => void;
}

type GooglePlace = {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text?: string;
  };
  types?: string[];
  latitude?: number;
  longitude?: number;
};

type RecentLocation = {
  id: string;
  name: string;
  address?: string;
  timestamp: number;
  placeId?: string;
  latitude?: number;
  longitude?: number;
};

const GOOGLE_PLACES_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || "";
const recentLocationsStorage = createMMKV({ id: "dvnt-recent-locations" });
const HAS_GOOGLE_PLACES_KEY =
  !!GOOGLE_PLACES_API_KEY &&
  GOOGLE_PLACES_API_KEY !== "your_google_places_api_key_here";

function sanitizeRecentLocations(value: unknown): RecentLocation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RecentLocation =>
      !!item &&
      typeof item === "object" &&
      typeof (item as RecentLocation).id === "string" &&
      typeof (item as RecentLocation).name === "string",
  );
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
  };
}

function normalizeLegacyPredictions(data: any): GooglePlace[] | null {
  if (!data || typeof data !== "object") return null;
  if (data.status === "ZERO_RESULTS") return [];
  if (data.status !== "OK" || !Array.isArray(data.predictions)) return null;
  return data.predictions
    .filter(
      (prediction: any): prediction is GooglePlace =>
        !!prediction &&
        typeof prediction.place_id === "string" &&
        typeof prediction.description === "string" &&
        !!prediction.structured_formatting?.main_text,
    )
    .slice(0, 8);
}

function normalizePhotonPredictions(data: any): GooglePlace[] | null {
  if (!data || !Array.isArray(data.features)) return null;

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
            : `photon-${mainText.toLowerCase()}-${latitude ?? "x"}-${longitude ?? "y"}`,
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
    .slice(0, 8);
}

export function LocationAutocompleteInstagram({
  value,
  placeholder = "Search location...",
  onLocationSelect,
  onClear,
  onTextChange,
  autoOpen = false,
  hideTrigger = false,
  onDismiss,
}: LocationAutocompleteProps) {
  const { colors } = useColorScheme();
  const sheetRef = useRef<BottomSheetModal>(null);
  const searchInputRef = useRef<any>(null);
  const snapPoints = useMemo(() => ["78%"], []);
  const [query, setQuery] = useState(value || "");
  const [predictions, setPredictions] = useState<GooglePlace[]>([]);
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([]);
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [googleApiUnavailable, setGoogleApiUnavailable] = useState(
    !HAS_GOOGLE_PLACES_KEY,
  );

  const fetchDebouncerRef = useRef(
    new Debouncer(
      async (text: string) => {
        if (text.trim().length < 2) {
          setPredictions([]);
          return;
        }

        setIsLoading(true);
        try {
          const nextPredictions = await fetchPredictionsWithFallbacks(text);
          setPredictions(nextPredictions);
        } catch (error) {
          console.warn(
            "[LocationAutocompleteInstagram] Autocomplete request failed:",
            error,
          );
          setPredictions([]);
        } finally {
          setIsLoading(false);
        }
      },
      { wait: 260 },
    ),
  );

  useEffect(() => {
    try {
      const stored = recentLocationsStorage.getString("recent-locations");
      if (!stored) return;
      const parsed = sanitizeRecentLocations(JSON.parse(stored));
      setRecentLocations(parsed.sort((a, b) => b.timestamp - a.timestamp).slice(0, 8));
    } catch (error) {
      console.warn(
        "[LocationAutocompleteInstagram] Failed to load recent locations:",
        error,
      );
    }
  }, []);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  useEffect(() => {
    setIsLoadingLocation(true);

    const loadCurrentLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const [reverse] = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });

        const locationName =
          reverse?.name ||
          [reverse?.city, reverse?.region].filter(Boolean).join(", ") ||
          "Current Location";

        setCurrentLocation({
          name: locationName,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          formattedAddress: [
            reverse?.street,
            reverse?.city,
            reverse?.region,
            reverse?.postalCode,
          ]
            .filter(Boolean)
            .join(", "),
        });
      } catch (error) {
        console.warn(
          "[LocationAutocompleteInstagram] Failed to resolve current location:",
          error,
        );
      } finally {
        setIsLoadingLocation(false);
      }
    };

    void loadCurrentLocation();
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setPredictions([]);
      return;
    }

    fetchDebouncerRef.current.maybeExecute(query);
  }, [query]);

  const persistRecentLocation = useCallback((location: LocationData) => {
    try {
      const nextLocation: RecentLocation = {
        id: location.placeId || `${location.name.toLowerCase()}-${Date.now()}`,
        name: location.name,
        address: location.formattedAddress,
        timestamp: Date.now(),
        placeId: location.placeId,
        latitude: location.latitude,
        longitude: location.longitude,
      };

      const stored = recentLocationsStorage.getString("recent-locations");
      const existing = stored
        ? sanitizeRecentLocations(JSON.parse(stored))
        : [];
      const merged = [
        nextLocation,
        ...existing.filter((item) => item.id !== nextLocation.id),
      ].slice(0, 20);

      recentLocationsStorage.set("recent-locations", JSON.stringify(merged));
      setRecentLocations(merged.slice(0, 8));
    } catch (error) {
      console.warn(
        "[LocationAutocompleteInstagram] Failed to persist recent location:",
        error,
      );
    }
  }, []);

  const fetchLegacyPredictions = useCallback(async (text: string) => {
    if (!HAS_GOOGLE_PLACES_KEY) return null;

    try {
      const url =
        "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
        `?key=${GOOGLE_PLACES_API_KEY}` +
        `&input=${encodeURIComponent(text)}` +
        "&language=en" +
        "&components=country:us";

      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      return normalizeLegacyPredictions(data);
    } catch (error) {
      console.warn(
        "[LocationAutocompleteInstagram] Legacy autocomplete failed:",
        error,
      );
      return null;
    }
  }, []);

  const fetchPhotonPredictions = useCallback(async (text: string) => {
    try {
      const response = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=8&lang=en`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      return normalizePhotonPredictions(data);
    } catch (error) {
      console.warn(
        "[LocationAutocompleteInstagram] Photon autocomplete failed:",
        error,
      );
      return null;
    }
  }, []);

  const fetchPredictionsWithFallbacks = useCallback(
    async (text: string): Promise<GooglePlace[]> => {
      const normalizedText = text.trim();

      if (normalizedText.length < 2) {
        return [];
      }

      if (HAS_GOOGLE_PLACES_KEY) {
        try {
          const response = await fetch(
            `https://places.googleapis.com/v1/places:autocomplete?key=${GOOGLE_PLACES_API_KEY}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
              },
              body: JSON.stringify({
                input: normalizedText,
                languageCode: "en",
                includedRegionCodes: ["us"],
              }),
            },
          );

          if (response.ok) {
            const data = await response.json();
            const googlePredictions = Array.isArray(data?.suggestions)
              ? data.suggestions
                  .map(createPredictionFromSuggestion)
                  .filter(Boolean)
              : [];

            if (googlePredictions.length > 0) {
              setGoogleApiUnavailable(false);
              return googlePredictions;
            }
          } else {
            setGoogleApiUnavailable(true);
          }
        } catch (error) {
          console.warn(
            "[LocationAutocompleteInstagram] Places API (v1) failed:",
            error,
          );
          setGoogleApiUnavailable(true);
        }

        const legacyPredictions = await fetchLegacyPredictions(normalizedText);
        if (legacyPredictions) {
          setGoogleApiUnavailable(false);
          return legacyPredictions;
        }

        setGoogleApiUnavailable(true);
      }

      const photonPredictions = await fetchPhotonPredictions(normalizedText);
      return photonPredictions ?? [];
    },
    [fetchLegacyPredictions, fetchPhotonPredictions],
  );

  const handleOpen = useCallback(() => {
    sheetRef.current?.present();
    requestAnimationFrame(() => {
      searchInputRef.current?.focus?.();
    });
  }, []);

  useEffect(() => {
    if (!autoOpen) return;

    requestAnimationFrame(() => {
      handleOpen();
    });
  }, [autoOpen, handleOpen]);

  const handleDismiss = useCallback(() => {
    fetchDebouncerRef.current.cancel();
    setPredictions([]);
    setIsLoading(false);
    onDismiss?.();
  }, [onDismiss]);

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      onTextChange?.(text);
      if (!text) {
        onClear?.();
      }
    },
    [onClear, onTextChange],
  );

  const commitSelection = useCallback(
    (nextLocation: LocationData) => {
      persistRecentLocation(nextLocation);
      onLocationSelect(nextLocation);
      setQuery(nextLocation.formattedAddress || nextLocation.name);
      sheetRef.current?.dismiss();
    },
    [onLocationSelect, persistRecentLocation],
  );

  const fetchPlaceDetails = useCallback(async (placeId: string) => {
    if (!placeId || !HAS_GOOGLE_PLACES_KEY) return null;

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?key=${GOOGLE_PLACES_API_KEY}&place_id=${placeId}&fields=formatted_address,name,geometry,place_id`,
      );

      if (!response.ok) return null;

      const data = await response.json();
      return data?.result ?? null;
    } catch (error) {
      console.warn(
        "[LocationAutocompleteInstagram] Failed to fetch place details:",
        error,
      );
      return null;
    }
  }, []);

  const handleSelectPrediction = useCallback(
    async (prediction: GooglePlace) => {
      setIsLoading(true);
      try {
        if (
          typeof prediction.latitude === "number" &&
          typeof prediction.longitude === "number"
        ) {
          commitSelection({
            name: prediction.structured_formatting.main_text,
            formattedAddress: prediction.description,
            placeId: prediction.place_id,
            latitude: prediction.latitude,
            longitude: prediction.longitude,
          });
          return;
        }

        const details = await fetchPlaceDetails(prediction.place_id);
        commitSelection({
          name: prediction.structured_formatting.main_text,
          formattedAddress: prediction.description,
          placeId: prediction.place_id,
          latitude: details?.geometry?.location?.lat,
          longitude: details?.geometry?.location?.lng,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [commitSelection, fetchPlaceDetails],
  );

  const handleSelectRecent = useCallback(
    (recent: RecentLocation) => {
      commitSelection({
        name: recent.name,
        formattedAddress: recent.address,
        placeId: recent.placeId,
        latitude: recent.latitude,
        longitude: recent.longitude,
      });
    },
    [commitSelection],
  );

  const handleSelectCurrentLocation = useCallback(() => {
    if (!currentLocation) return;
    commitSelection(currentLocation);
  }, [commitSelection, currentLocation]);

  const handleManualSubmit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    commitSelection({
      name: trimmed,
      formattedAddress: trimmed,
    });
  }, [commitSelection, query]);

  const renderSectionHeader = useCallback(
    (title: string, icon: React.ReactNode) => (
      <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
        {icon}
        <Text style={[styles.sectionHeaderText, { color: colors.foreground }]}>
          {title}
        </Text>
      </View>
    ),
    [colors.border, colors.foreground],
  );

  const renderPredictionRow = useCallback(
    (prediction: GooglePlace) => (
      <TouchableOpacity
        key={prediction.place_id}
        onPress={() => void handleSelectPrediction(prediction)}
        activeOpacity={0.8}
        style={[styles.row, { backgroundColor: colors.card }]}
      >
        <View style={styles.rowIconWrap}>
          {prediction.types?.includes("establishment") ? (
            <Building size={16} color={colors.mutedForeground} />
          ) : (
            <MapPin size={16} color={colors.mutedForeground} />
          )}
        </View>
        <View style={styles.rowTextWrap}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>
            {prediction.structured_formatting.main_text}
          </Text>
          {prediction.structured_formatting.secondary_text ? (
            <Text
              style={[styles.rowSubtitle, { color: colors.mutedForeground }]}
            >
              {prediction.structured_formatting.secondary_text}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    ),
    [colors.card, colors.foreground, colors.mutedForeground, handleSelectPrediction],
  );

  const displayValue = value?.trim() || "";

  return (
    <View>
      {!hideTrigger ? (
        <Pressable
          onPress={handleOpen}
          style={[
            styles.trigger,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <MapPin size={18} color={colors.mutedForeground} />
          <Text
            numberOfLines={1}
            style={[
              styles.triggerText,
              {
                color: displayValue ? colors.foreground : colors.mutedForeground,
              },
            ]}
          >
            {displayValue || placeholder}
          </Text>
          {displayValue ? (
            <Pressable
              hitSlop={10}
              onPress={() => {
                onClear?.();
                handleChangeText("");
              }}
            >
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : (
            <Search size={16} color={colors.mutedForeground} />
          )}
        </Pressable>
      ) : null}

      <BottomSheetModal
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={(props: BottomSheetBackdropProps) => (
          <BottomSheetBackdrop
            {...props}
            appearsOnIndex={0}
            disappearsOnIndex={-1}
            opacity={0.5}
            pressBehavior="close"
          />
        )}
        backgroundComponent={GlassSheetBackground}
        handleIndicatorStyle={styles.handle}
        detached
        bottomInset={26}
        style={styles.sheet}
        onDismiss={handleDismiss}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetView style={styles.sheetContent}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Search Location</Text>
            <Pressable onPress={() => sheetRef.current?.dismiss()} hitSlop={10}>
              <X size={18} color="#d4d4d8" />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Search size={16} color="rgba(255,255,255,0.45)" />
            <BottomSheetTextInput
              ref={searchInputRef}
              value={query}
              onChangeText={handleChangeText}
              placeholder={placeholder}
              placeholderTextColor="rgba(255,255,255,0.38)"
              style={styles.searchInput}
              returnKeyType="search"
              autoCapitalize="words"
              autoCorrect={false}
              onSubmitEditing={handleManualSubmit}
            />
            {(isLoading || isLoadingLocation) && (
              <ActivityIndicator size="small" color="#34A2DF" />
            )}
            {query.length > 0 && !isLoading && !isLoadingLocation ? (
              <Pressable hitSlop={10} onPress={() => handleChangeText("")}>
                <X size={16} color="rgba(255,255,255,0.45)" />
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.helperCopy}>
            Search venues, neighborhoods, or exact addresses. Tap a result to
            pin the place and save its coordinates.
          </Text>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {query.trim().length < 2 && currentLocation ? (
              <View style={styles.sectionWrap}>
                {renderSectionHeader(
                  "Use Current Location",
                  <Navigation size={16} color={colors.mutedForeground} />,
                )}
                <TouchableOpacity
                  onPress={handleSelectCurrentLocation}
                  activeOpacity={0.8}
                  style={[styles.row, { backgroundColor: colors.card }]}
                >
                  <View style={styles.rowIconWrap}>
                    <Navigation size={16} color={colors.mutedForeground} />
                  </View>
                  <View style={styles.rowTextWrap}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                      {currentLocation.name}
                    </Text>
                    {currentLocation.formattedAddress ? (
                      <Text
                        style={[
                          styles.rowSubtitle,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {currentLocation.formattedAddress}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              </View>
            ) : null}

            {query.trim().length < 2 && recentLocations.length > 0 ? (
              <View style={styles.sectionWrap}>
                {renderSectionHeader(
                  "Recent Places",
                  <Clock size={16} color={colors.mutedForeground} />,
                )}
                {recentLocations.map((recent) => (
                  <TouchableOpacity
                    key={recent.id}
                    onPress={() => handleSelectRecent(recent)}
                    activeOpacity={0.8}
                    style={[styles.row, { backgroundColor: colors.card }]}
                  >
                    <View style={styles.rowIconWrap}>
                      <Clock size={16} color={colors.mutedForeground} />
                    </View>
                    <View style={styles.rowTextWrap}>
                      <Text
                        style={[styles.rowTitle, { color: colors.foreground }]}
                      >
                        {recent.name}
                      </Text>
                      {recent.address ? (
                        <Text
                          style={[
                            styles.rowSubtitle,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {recent.address}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {query.trim().length >= 2 ? (
              <View style={styles.sectionWrap}>
                {renderSectionHeader(
                  "Suggestions",
                  <MapPin size={16} color={colors.mutedForeground} />,
                )}
                {predictions.map(renderPredictionRow)}

                {!isLoading && predictions.length === 0 ? (
                  <View
                    style={[
                      styles.emptyState,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[
                        styles.emptyStateTitle,
                        { color: colors.foreground },
                      ]}
                    >
                      No suggestions yet
                    </Text>
                    <Text
                      style={[
                        styles.emptyStateCopy,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {googleApiUnavailable
                        ? "Autocomplete is unavailable right now. You can still use the typed location below."
                        : "Try a more specific venue or address, or use the typed location below."}
                    </Text>
                  </View>
                ) : null}

                <Pressable
                  onPress={handleManualSubmit}
                  style={[
                    styles.manualButton,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                >
                  <Text style={[styles.manualButtonTitle, { color: colors.foreground }]}>
                    Use “{query.trim() || "typed location"}”
                  </Text>
                  <Text
                    style={[
                      styles.manualButtonCopy,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Continue with the typed location if you don’t need a pinned
                    place.
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  triggerText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  handle: {
    backgroundColor: "rgba(255,255,255,0.28)",
    width: 40,
  },
  sheet: {
    marginHorizontal: 12,
  },
  sheetContent: {
    paddingHorizontal: 18,
    paddingBottom: 28,
    gap: 14,
    minHeight: 420,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
  },
  searchRow: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },
  helperCopy: {
    color: "rgba(228,228,231,0.72)",
    fontSize: 13,
    lineHeight: 18,
  },
  sectionWrap: {
    gap: 0,
    marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "700",
  },
  row: {
    minHeight: 60,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowIconWrap: {
    width: 28,
    alignItems: "center",
  },
  rowTextWrap: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  rowSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 4,
    marginBottom: 10,
  },
  emptyStateTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  emptyStateCopy: {
    fontSize: 13,
    lineHeight: 18,
  },
  manualButton: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 4,
    marginBottom: 18,
  },
  manualButtonTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  manualButtonCopy: {
    fontSize: 13,
    lineHeight: 18,
  },
});
